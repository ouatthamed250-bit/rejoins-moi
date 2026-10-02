// paiement.js — Coordonnées de paiement MANUEL par dépôt mobile money + support.
//
// Contexte (lancement) : la passerelle CinetPay n'est pas encore branchée. Pour
// encaisser les 500 FCFA du déblocage de contact, on utilise un paiement MANUEL :
// l'utilisateur envoie le montant sur l'un de ces numéros (Wave / Orange Money /
// MTN MoMo), puis l'équipe Rejoins'Moi VALIDE le déblocage depuis le back-office
// admin (voir routes/admin.js + modèles/Depot.js). Aucun faux succès : le contact
// n'est révélé qu'après validation humaine côté serveur.
//
// Ces numéros sont aussi montrés dans l'app. Pour les changer sans redéployer :
//   SUPPORT_WHATSAPP, DEPOT_WAVE, DEPOT_ORANGE, DEPOT_MTN (backend/.env).

/** Numéro du support WhatsApp (format local affiché). */
export const SUPPORT_WHATSAPP = process.env.SUPPORT_WHATSAPP || '0554233234';

function chiffres(valeur) {
  return String(valeur || '').replace(/\D/g, '');
}

/** Convertit un numéro local ivoirien (« 0554233234 ») en format E.164 sans « + » (pour wa.me). */
export function enFormatWhatsapp(numero) {
  const d = chiffres(numero);
  if (!d) return '';
  const sansZero = d.startsWith('0') ? d.slice(1) : d;
  return `225${sansZero}`;
}

/**
 * Numéros de dépôt mobile money (surchargeables par variables d'environnement).
 * `canal` correspond au champ `moyenPaiement` du modèle de déblocage.
 */
export const DEPOTS = [
  {
    canal: 'WAVE',
    libelle: 'Wave',
    numero: process.env.DEPOT_WAVE || '0554233234',
  },
  {
    canal: 'ORANGE_MONEY',
    libelle: 'Orange Money',
    numero: process.env.DEPOT_ORANGE || '0749883981',
  },
  {
    canal: 'MTN_MOMO',
    libelle: 'MTN MoMo',
    numero: process.env.DEPOT_MTN || '0554233234',
  },
];

/** Copie sérialisable pour l'API (avec le format WhatsApp prêt pour le lien). */
export function getDepots() {
  return DEPOTS.map((d) => ({
    ...d,
    whatsapp: enFormatWhatsapp(d.numero),
  }));
}

/** Support au format WhatsApp (pour un lien direct). */
export function getSupportWhatsapp() {
  return { numero: SUPPORT_WHATSAPP, whatsapp: enFormatWhatsapp(SUPPORT_WHATSAPP) };
}

export default { SUPPORT_WHATSAPP, DEPOTS, getDepots, getSupportWhatsapp, enFormatWhatsapp };