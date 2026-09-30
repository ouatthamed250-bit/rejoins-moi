// abonnement.js (utils) — Souscription à l'abonnement Rejoins'Moi.
//
// ⚠️ AUCUN FAUX PAIEMENT, comme pour le déblocage de contact (utils/payment.js) :
// le frontend demande au backend d'initialiser une transaction CinetPay, ouvre la
// page de paiement, puis demande au backend de VÉRIFIER la transaction. C'est le
// serveur qui active l'abonnement — jamais le navigateur. Sans clés CinetPay côté
// serveur, l'API répond 501 et l'abonnement reste inactif.
//
// Prix et périodicité : ils sont lus depuis GET /api/subscriptions/formules
// (source de vérité : backend/src/config/abonnement.js). Le miroir
// config/abonnement.js ne sert qu'en mode hors ligne.
//
// Le dernier état connu est conservé dans localStorage pour que la page Jobs
// affiche « contacts inclus » sans attendre le réseau ; un état serveur l'écrase
// toujours dès qu'il est disponible.

import { api, ApiError } from './api/client.js';
import {
  ABONNEMENT as ABONNEMENT_MIROIR,
  CATALOGUE,
  FORMULES,
  getFormule,
  libellePrix,
  libellePrixListe,
} from '../config/abonnement.js';

export const CLE_ABONNEMENT = 'rejoinsmoi.abonnement';

/** Erreur de souscription lisible ; `nonConfigure` = passerelle non branchée. */
export class AbonnementError extends Error {
  constructor(message, { nonConfigure = false, statut = null, details = null } = {}) {
    super(message);
    this.name = 'AbonnementError';
    this.nonConfigure = nonConfigure;
    this.statut = statut;
    this.details = details;
  }
}

function traduire(err) {
  if (!(err instanceof ApiError)) {
    return new AbonnementError(err?.message || 'Souscription impossible pour le moment.');
  }
  if (err.status === 501) {
    return new AbonnementError(
      "Le paiement Wave / Orange Money n'est pas encore activé sur cet environnement. Contactez l'équipe Rejoins'Moi.",
      { nonConfigure: true }
    );
  }
  if (err.status === 402) {
    return new AbonnementError(
      `Paiement non confirmé par la passerelle (statut : ${err.details?.statut || 'inconnu'}). Aucun abonnement n'a été activé.`,
      { statut: err.details?.statut || null }
    );
  }
  if (err.offline) {
    return new AbonnementError('Serveur injoignable. Vérifiez votre connexion puis réessayez.');
  }
  return new AbonnementError(err.message || 'Souscription impossible pour le moment.');
}

// ── Miroir local (lecture instantanée, mode hors ligne) ──────────────────────

/** Dernier abonnement connu sur cet appareil (jamais une preuve de paiement). */
export function lireAbonnementLocal() {
  try {
    const brut = localStorage.getItem(CLE_ABONNEMENT);
    const donnees = brut ? JSON.parse(brut) : null;
    return donnees && typeof donnees === 'object' ? donnees : null;
  } catch {
    return null;
  }
}

/** Mémorise (ou efface) l'abonnement connu localement. */
export function ecrireAbonnementLocal(abonnement) {
  try {
    if (abonnement) localStorage.setItem(CLE_ABONNEMENT, JSON.stringify(abonnement));
    else localStorage.removeItem(CLE_ABONNEMENT);
  } catch {
    /* navigation privée : on continue sans persistance */
  }
}

/** L'abonnement local est-il encore valable (échéance non dépassée) ? */
export function abonnementLocalActif(abonnement = lireAbonnementLocal()) {
  if (!abonnement?.finAt) return false;
  return new Date(abonnement.finAt).getTime() > Date.now();
}

// ── Appels API ───────────────────────────────────────────────────────────────

/**
 * Formules, prix et périodicité — lus depuis le serveur (source de vérité).
 * Repli sur le miroir config/abonnement.js si l'API est injoignable : la page
 * reste consultable, mais AUCUNE souscription ne sera possible (voir `horsLigne`).
 *
 * `formules` contient DEUX entrées tant que le tarif n'est pas tranché (semaine +
 * mois) ; `formuleParDefaut` dit laquelle présélectionner (le serveur décide).
 */
export async function chargerFormules() {
  try {
    const reponse = await api.get('/subscriptions/formules', { auth: false });
    const formules = reponse?.formules?.length ? reponse.formules : FORMULES;
    return {
      formules,
      formuleParDefaut: reponse?.formuleParDefaut || formules[0]?.cle || ABONNEMENT_MIROIR.cle,
      periodicitesActives: reponse?.periodicitesActives || formules.map((f) => f.periodicite),
      catalogue: reponse?.catalogue || CATALOGUE,
      devise: reponse?.devise || 'XOF',
      paiementConfigure: Boolean(reponse?.paiementConfigure),
      operateurs: reponse?.operateurs || [],
      horsLigne: false,
    };
  } catch {
    return {
      formules: FORMULES,
      formuleParDefaut: ABONNEMENT_MIROIR.cle,
      periodicitesActives: FORMULES.map((f) => f.periodicite),
      catalogue: CATALOGUE,
      devise: 'XOF',
      paiementConfigure: false,
      operateurs: [],
      horsLigne: true,
    };
  }
}

/**
 * Abonnement en cours de l'utilisateur connecté.
 * Renvoie `{ abonnement, abonnementActif, operateurs, paiementConfigure, horsLigne }`.
 * En cas de serveur injoignable, on renvoie le miroir local en le marquant comme
 * tel : l'interface ne doit jamais confondre « dernier état connu » et « vérifié ».
 */
export async function monAbonnement() {
  const local = lireAbonnementLocal();
  try {
    const reponse = await api.get('/subscriptions/moi');
    const abonnement = reponse?.abonnement || null;
    ecrireAbonnementLocal(abonnement);
    return {
      abonnement,
      abonnementActif: Boolean(reponse?.abonnementActif),
      historique: reponse?.historique || [],
      paiementConfigure: Boolean(reponse?.paiementConfigure),
      operateurs: reponse?.operateurs || [],
      horsLigne: false,
    };
  } catch (err) {
    return {
      abonnement: local,
      abonnementActif: abonnementLocalActif(local),
      historique: [],
      paiementConfigure: false,
      operateurs: [],
      horsLigne: true,
      erreur: err?.message || '',
    };
  }
}

/**
 * Étape 1 — Demande l'initialisation d'un paiement d'abonnement.
 * Cas particulier : si un abonnement est déjà actif et `renouveler === false`,
 * le backend répond directement l'état, sans paiement (`paiementRequis: false`).
 *
 * @returns {Promise<{paiementRequis: boolean, abonnementActif: boolean, abonnement: object|null,
 *   transactionId: string|null, paymentUrl: string|null, montant: number, devise: string,
 *   periodicite: string, dureeJours: number, operateurs: string[], message: string}>}
 */
export async function souscrire({ formule = ABONNEMENT_MIROIR.cle, renouveler = true } = {}) {
  try {
    const reponse = await api.post('/subscriptions/souscrire', { formule, renouveler });
    if (reponse?.abonnement) ecrireAbonnementLocal(reponse.abonnement.actif ? reponse.abonnement : null);
    return {
      paiementRequis: Boolean(reponse?.paiementRequis),
      abonnementActif: Boolean(reponse?.abonnementActif),
      abonnement: reponse?.abonnement || null,
      transactionId: reponse?.transactionId || null,
      paymentUrl: reponse?.paymentUrl || null,
      montant: Number(reponse?.montant ?? ABONNEMENT_MIROIR.prixFcfa),
      devise: reponse?.devise || 'XOF',
      periodicite: reponse?.periodicite || ABONNEMENT_MIROIR.periodicite,
      dureeJours: Number(reponse?.dureeJours ?? ABONNEMENT_MIROIR.dureeJours),
      operateurs: reponse?.operateurs || [],
      message: reponse?.message || '',
    };
  } catch (err) {
    throw traduire(err);
  }
}

/**
 * Étape 3 — Demande au backend de vérifier la transaction auprès de CinetPay et
 * d'activer l'abonnement si (et seulement si) elle est acceptée.
 */
export async function confirmerSouscription({ formule = ABONNEMENT_MIROIR.cle, transactionId }) {
  if (!transactionId) {
    throw new AbonnementError(
      'Identifiant de transaction manquant : impossible de vérifier le paiement.'
    );
  }
  try {
    const reponse = await api.post('/subscriptions/souscrire', { formule, transactionId });
    if (!reponse?.abonnementActif) {
      throw new AbonnementError(
        'Le paiement n’a pas encore été confirmé par la passerelle. Réessayez dans quelques secondes.'
      );
    }
    if (reponse.abonnement) ecrireAbonnementLocal(reponse.abonnement);
    return {
      abonnement: reponse.abonnement,
      montantPaye: Number(reponse.montantPaye || 0),
      devise: reponse.devise || 'XOF',
      transactionId: reponse.transactionId || transactionId,
      message: reponse.message || 'Abonnement activé.',
    };
  } catch (err) {
    if (err instanceof AbonnementError) throw err;
    throw traduire(err);
  }
}

/** Arrête le renouvellement (l'accès court jusqu'à l'échéance déjà payée). */
export async function resilierAbonnement() {
  try {
    const reponse = await api.post('/subscriptions/resilier', {});
    if (reponse?.abonnement) ecrireAbonnementLocal(reponse.abonnement);
    return { abonnement: reponse?.abonnement || null, message: reponse?.message || '' };
  } catch (err) {
    throw traduire(err);
  }
}

export { FORMULES, ABONNEMENT_MIROIR, CATALOGUE, getFormule, libellePrix, libellePrixListe };

export default {
  CLE_ABONNEMENT,
  AbonnementError,
  lireAbonnementLocal,
  ecrireAbonnementLocal,
  abonnementLocalActif,
  chargerFormules,
  monAbonnement,
  souscrire,
  confirmerSouscription,
  resilierAbonnement,
  getFormule,
  libellePrix,
  libellePrixListe,
};
