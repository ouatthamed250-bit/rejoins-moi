// payment.js — Intégration paiement Wave / Orange Money (recharge 500 FCFA pour débloquer un contact)
//
// ⚠️ AUCUN FAUX PAIEMENT. Le frontend ne décide jamais qu'un paiement a réussi :
// il demande au backend d'initialiser une transaction auprès de CinetPay (qui
// agrège Wave, Orange Money, MTN MoMo et Moov Money), redirige l'utilisateur vers
// la page de paiement, puis demande au backend de VÉRIFIER la transaction auprès
// de CinetPay. C'est le backend qui débloque le contact, jamais le navigateur.
//
// Flux (voir backend/src/routes/jobs.js POST /:id/unlock-contact) :
//   1. initiatePayment(jobId)                -> { transactionId, paymentUrl }
//   2. payer sur Wave / Orange Money (page CinetPay)
//   3. au retour dans l'app : confirmPayment(jobId, transactionId) -> { telephoneContact }
// Si la passerelle n'est pas configurée côté serveur, l'API répond 501 : on
// affiche alors un message clair, on n'invente jamais un succès.

import { api, ApiError } from './api/client.js';

export const FRAIS_DEBLOCAGE = Number(import.meta.env.VITE_CONTACT_UNLOCK_FEE || 500);
export const DEVISE = import.meta.env.VITE_CURRENCY || 'XOF';
export const OPERATEURS = ['Wave', 'Orange Money', 'MTN MoMo', 'Moov Money'];

/** Erreur de paiement lisible ; `nonConfigure` = la passerelle n'est pas branchée. */
export class PaymentError extends Error {
  constructor(message, { nonConfigure = false, statut = null, details = null } = {}) {
    super(message);
    this.name = 'PaymentError';
    this.nonConfigure = nonConfigure;
    this.statut = statut;
    this.details = details;
  }
}

function traduire(err) {
  if (!(err instanceof ApiError)) {
    return new PaymentError(err?.message || 'Paiement impossible pour le moment.');
  }
  if (err.status === 501) {
    return new PaymentError(
      "Le paiement Wave / Orange Money n'est pas encore activé sur cet environnement. Contactez l'équipe Rejoins'Moi.",
      { nonConfigure: true }
    );
  }
  if (err.status === 402) {
    return new PaymentError(
      `Paiement non confirmé par la passerelle (statut : ${err.details?.statut || 'inconnu'}). Le contact reste masqué.`,
      { statut: err.details?.statut || null }
    );
  }
  if (err.offline) {
    return new PaymentError('Serveur injoignable. Vérifiez votre connexion puis réessayez.');
  }
  return new PaymentError(err.message || 'Paiement impossible pour le moment.', { details: err.details });
}

/**
 * Étape 1 — Demande l'initialisation d'un paiement de 500 FCFA pour débloquer le
 * contact d'un besoin de main-d'œuvre.
 *
 * Cas particulier §2 (segment « journalier ») : si le besoin prévoit un premier
 * contact gratuit, le backend renvoie directement le contact sans paiement.
 *
 * @returns {Promise<{paiementRequis: boolean, debloque: boolean, gratuit: boolean,
 *   telephoneContact: string|null, transactionId: string|null, paymentUrl: string|null,
 *   montant: number, devise: string, operateurs: string[], message: string}>}
 */
export async function initiatePayment(jobId) {
  try {
    const reponse = await api.post(`/jobs/${jobId}/unlock-contact`, {});
    return {
      paiementRequis: Boolean(reponse?.paiementRequis),
      debloque: Boolean(reponse?.debloque),
      gratuit: Boolean(reponse?.gratuit),
      telephoneContact: reponse?.telephoneContact || null,
      transactionId: reponse?.transactionId || null,
      paymentUrl: reponse?.paymentUrl || null,
      montant: Number(reponse?.montant ?? FRAIS_DEBLOCAGE),
      devise: reponse?.devise || DEVISE,
      operateurs: reponse?.operateurs || OPERATEURS,
      message: reponse?.message || '',
    };
  } catch (err) {
    throw traduire(err);
  }
}

/**
 * Étape 3 — Demande au backend de vérifier la transaction auprès de CinetPay et de
 * révéler le numéro de contact si (et seulement si) elle est acceptée.
 *
 * @returns {Promise<{telephoneContact: string, montantPaye: number, transactionId: string, message: string}>}
 */
export async function confirmPayment(jobId, transactionId) {
  if (!transactionId) {
    throw new PaymentError('Identifiant de transaction manquant : impossible de vérifier le paiement.');
  }
  try {
    const reponse = await api.post(`/jobs/${jobId}/unlock-contact`, { transactionId });
    if (!reponse?.debloque || !reponse?.telephoneContact) {
      throw new PaymentError(
        'Le paiement n’a pas encore été confirmé par la passerelle. Réessayez dans quelques secondes.'
      );
    }
    return {
      telephoneContact: reponse.telephoneContact,
      montantPaye: Number(reponse.montantPaye || 0),
      transactionId: reponse.transactionId || transactionId,
      message: reponse.message || 'Contact débloqué.',
    };
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    throw traduire(err);
  }
}

/**
 * Ouvre la page de paiement CinetPay.
 * Nouvel onglet plutôt que redirection : l'utilisateur revient ainsi sur l'écran
 * de la mission sans perdre son contexte, ce qui est important sur les navigateurs
 * in-app (WhatsApp / Facebook) où une redirection casse la session.
 */
export function ouvrirPaiement(paymentUrl) {
  if (!paymentUrl) return false;
  window.open(paymentUrl, '_blank', 'noopener,noreferrer');
  return true;
}

/** Vérifie si le backend a une passerelle de paiement configurée. */
export async function paiementDisponible() {
  try {
    const info = await api.get('/jobs/metiers', { auth: false });
    return {
      configure: Boolean(info?.paiementConfigure),
      frais: Number(info?.fraisDeblocage || FRAIS_DEBLOCAGE),
    };
  } catch {
    return { configure: false, frais: FRAIS_DEBLOCAGE };
  }
}

export default {
  initiatePayment,
  confirmPayment,
  ouvrirPaiement,
  paiementDisponible,
  FRAIS_DEBLOCAGE,
  OPERATEURS,
};


