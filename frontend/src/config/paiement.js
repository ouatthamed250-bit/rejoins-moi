// paiement.js (frontend) — MIROIR des coordonnées de paiement manuel (dépôt mobile money).
//
// ⚠️ LA SOURCE DE VÉRITÉ EST LE BACKEND : backend/src/config/paiement.js, exposée par
// GET /api/jobs/metiers (champ `depots` + `support`). Ce miroir sert :
//   1. à afficher les numéros MÊME hors ligne (tournée terrain) ;
//   2. à éviter qu'un numéro soit écrit en dur dans un composant.
// En ligne, utils/payment.js remplace ces valeurs par celles du serveur.

const env = import.meta.env || {};

// MODE 100 % GRATUIT : plus aucun montant n'est affiché et la passerelle n'est
// jamais ouverte. Les numéros de dépôt restent dans ce fichier (code conservé)
// pour la réactivation des paiements après la période gratuite.
export const MODE_GRATUIT = true;
/** Libellé unique remplaçant tous les prix dans l'interface. */
export const LIBELLE_GRATUIT = 'Gratuit';

/** Numéro du support WhatsApp (format local). */
export const SUPPORT_WHATSAPP = env.VITE_SUPPORT_WHATSAPP || '0554233234';

/** Numéros de dépôt mobile money (canal = moyenPaiement du modèle de déblocage). */
export const DEPOTS = [
  { canal: 'WAVE', libelle: 'Wave', numero: env.VITE_DEPOT_WAVE || '0554233234' },
  { canal: 'ORANGE_MONEY', libelle: 'Orange Money', numero: env.VITE_DEPOT_ORANGE || '0749883981' },
  { canal: 'MTN_MOMO', libelle: 'MTN MoMo', numero: env.VITE_DEPOT_MTN || '0554233234' },
];

/**
 * « 0554233234 » -> « 2250554233234 » (format wa.me, sans « + »).
 *
 * ATTENTION (correction du 12/10, bloc G) : depuis la refonte de la numérotation
 * ivoirienne de 2021, le 0 initial FAIT PARTIE du numéro (+225 05 54 23 32 34). La
 * version précédente le supprimait, ce qui produisait « 225554233234 » — un numéro
 * qui n'existe pas, donc un lien WhatsApp qui ne menait nulle part. On garde donc le
 * numéro tel quel et on ne préfixe que s'il ne l'est pas déjà.
 */
export function enFormatWhatsapp(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('225') && d.length > 10) return d; // déjà au format international
  return `225${d}`;
}

/** Copie sérialisable (avec lien WhatsApp prêt à l'emploi). */
export function getDepots() {
  return DEPOTS.map((d) => ({ ...d, whatsapp: enFormatWhatsapp(d.numero) }));
}

export function getSupportWhatsapp() {
  return { numero: SUPPORT_WHATSAPP, whatsapp: enFormatWhatsapp(SUPPORT_WHATSAPP) };
}

export default { SUPPORT_WHATSAPP, DEPOTS, getDepots, getSupportWhatsapp, enFormatWhatsapp };