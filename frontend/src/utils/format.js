// format.js — Petits formateurs d'affichage (montants FCFA, dates, textes courts).
//
// Décision produit : les montants sont toujours affichés en FCFA entiers avec un
// espace comme séparateur de milliers (« 500 FCFA », « 45 000 FCFA »), jamais avec
// des décimales — personne ne compte les centimes en FCFA.

/** « 45 000 FCFA ». */
export function formatFcfa(montant, { suffixe = true } = {}) {
  const n = Number(montant);
  if (!Number.isFinite(n)) return suffixe ? '— FCFA' : '—';
  const entier = Math.round(n);
  const sep = entier.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return suffixe ? `${sep} FCFA` : sep;
}

/** « 4,6 » (note à une décimale maximum). */
export function formatNote(note) {
  const n = Number(note);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

/** Compteur compacté pour les gros chiffres : 1 240 -> « 1,2 k ». */
export function formatCompteur(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v < 1000) return String(v);
  if (v < 10000) return `${(v / 1000).toFixed(1).replace('.', ',')} k`;
  return `${Math.round(v / 1000)} k`;
}

/**
 * Phrase du fil d'accueil : « 24 utilisateurs ont contacté ces établissements ».
 *
 * Deux corrections (bloc I du 12/10) :
 *   1. SINGULIER : à 1, la phrase affichait « 1 utilisateurs ont contacté » ;
 *   2. ZÉRO : la phrase n'est plus affichée du tout (chaîne vide) — « 0 utilisateurs
 *      ont contacté ces établissements » fait croire à un compteur cassé, alors que
 *      c'est simplement qu'aucun établissement de la liste n'a encore été contacté.
 * L'appelant teste la chaîne : si elle est vide, il n'affiche rien.
 *
 * @param {number} total somme des compteurs d'utilisateurs de la liste affichée
 * @returns {string} la phrase, ou '' s'il n'y a rien à annoncer
 */
export function phraseContactUtilisateurs(total) {
  const v = Number(total);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v === 1) return '1 utilisateur a contacté ces établissements';
  return `${formatCompteur(v)} utilisateurs ont contacté ces établissements`;
}

const MOIS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** « il y a 3 j », « il y a 2 h », « 12 mars 2026 ». */
export function formatDateRelative(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours < 7) return `il y a ${jours} j`;
  if (jours < 30) return `il y a ${Math.floor(jours / 7)} sem.`;
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** « 07 07 12 34 56 » à partir de « +2250707123456 » (lecture facile au téléphone). */
export function formatTelephone(numero) {
  if (!numero) return '';
  const brut = String(numero).replace(/[^\d+]/g, '');
  const local = brut.startsWith('+225') ? brut.slice(4) : brut;
  const groupes = local.match(/.{1,2}/g);
  return groupes ? groupes.join(' ') : local;
}

/** Initiales pour l'avatar de secours : « Awa Koné » -> « AK ». */
export function initiales(nom = '') {
  return String(nom)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() || '')
    .join('');
}

/** Accorde au singulier/pluriel : `pluriel(1, 'avis')` -> « 1 avis », `(3)` -> « 3 avis ». */
export function pluriel(n, mot, suffixePluriel = 's') {
  const v = Number(n) || 0;
  return `${v} ${mot}${v > 1 ? suffixePluriel : ''}`;
}

export default {
  formatFcfa,
  formatNote,
  formatCompteur,
  formatDateRelative,
  formatTelephone,
  initiales,
  pluriel,
};
