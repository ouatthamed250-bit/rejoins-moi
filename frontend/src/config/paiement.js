// paiement.js (frontend) — MIROIR des coordonnées de paiement manuel (dépôt mobile money).
//
// ⚠️ LA SOURCE DE VÉRITÉ EST LE BACKEND : backend/src/config/paiement.js, exposée par
// GET /api/jobs/metiers (champ `depots` + `support`). Ce miroir sert :
//   1. à afficher les numéros MÊME hors ligne (tournée terrain) ;
//   2. à éviter qu'un numéro soit écrit en dur dans un composant.
// En ligne, utils/payment.js remplace ces valeurs par celles du serveur.

const env = import.meta.env || {};

/** Numéro du support WhatsApp (format local). */
export const SUPPORT_WHATSAPP = env.VITE_SUPPORT_WHATSAPP || '0554233234';

/** Numéros de dépôt mobile money (canal = moyenPaiement du modèle de déblocage). */
export const DEPOTS = [
  { canal: 'WAVE', libelle: 'Wave', numero: env.VITE_DEPOT_WAVE || '0554233234' },
  { canal: 'ORANGE_MONEY', libelle: 'Orange Money', numero: env.VITE_DEPOT_ORANGE || '0749883981' },
  { canal: 'MTN_MOMO', libelle: 'MTN MoMo', numero: env.VITE_DEPOT_MTN || '0554233234' },
];

/** « 0554233234 » -> « 225554233234 » (format wa.me, sans + ni zéro initial). */
export function enFormatWhatsapp(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (!d) return '';
  const sansZero = d.startsWith('0') ? d.slice(1) : d;
  return `225${sansZero}`;
}

/** Copie sérialisable (avec lien WhatsApp prêt à l'emploi). */
export function getDepots() {
  return DEPOTS.map((d) => ({ ...d, whatsapp: enFormatWhatsapp(d.numero) }));
}

export function getSupportWhatsapp() {
  return { numero: SUPPORT_WHATSAPP, whatsapp: enFormatWhatsapp(SUPPORT_WHATSAPP) };
}

export default { SUPPORT_WHATSAPP, DEPOTS, getDepots, getSupportWhatsapp, enFormatWhatsapp };