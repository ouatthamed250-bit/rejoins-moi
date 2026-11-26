// abonnement.js (frontend) — MIROIR de backend/src/config/abonnement.js.
//
// ⚠️ LA SOURCE DE VÉRITÉ EST LE BACKEND : backend/src/config/abonnement.js.
// Ce fichier n'existe que pour deux raisons :
//   1. afficher le prix/périodicité MÊME hors ligne (mode démonstration pendant la
//      tournée terrain, serveur injoignable) ;
//   2. éviter qu'un prix soit écrit en dur dans un composant.
// En ligne, `utils/abonnement.js` remplace ces valeurs par celles renvoyées par
// GET /api/subscriptions/formules. Si vous changez le tarif, modifiez D'ABORD le
// backend, puis reportez la valeur ici pour rester cohérent hors ligne.
//
// Le prix et la périodicité ne sont PAS tranchés (voir cahier des charges) : la
// mention « tarif provisoire » est affichée tant que `aConfirmer` vaut true.

// ── MODE 100 % GRATUIT ──────────────────────────────────────────────────────
// Miroir EXACT de backend/src/config/abonnement.js : la source de vérité reste le
// serveur, mais le frontend doit pouvoir afficher « Gratuit » même hors ligne
// (tournée terrain). Aucun montant n'est donc plus écrit ici : les formules
// valent 0 pendant la gratuité. Le jour où la date sera dépassée, le serveur
// renverra ses propres prix et l'interface les affichera de nouveau.
export const GRATUIT_JUSQU_AU = new Date('2027-05-20T00:00:00.000Z');

const MOIS_EN_FRANCAIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** « 20 mai 2027 » — date de fin de la gratuité, en clair. */
export function libelleGratuitJusquAu(date = GRATUIT_JUSQU_AU) {
  const d = new Date(date);
  return `${d.getUTCDate()} ${MOIS_EN_FRANCAIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Le mode gratuit est-il actif à l'instant `maintenant` ? */
export function estModeGratuit(maintenant = new Date()) {
  return new Date(maintenant).getTime() < GRATUIT_JUSQU_AU.getTime();
}

/** Phrase affichée dans les mentions légales et à l'inscription. */
export const TEXTE_GRATUIT =
  "Gratuit aujourd'hui. Des options de visibilité payantes arriveront plus tard ; la fiche de base reste gratuite.";

/** Périodicités possibles, en clair pour l'interface. */
export const PERIODICITES = {
  hebdomadaire: { libelle: 'par semaine', jours: 7 },
  mensuel: { libelle: 'par mois', jours: 30 },
};

/** En-tête commun du bloc « Abonnement » (miroir de CATALOGUE côté backend). */
export const CATALOGUE = {
  titre: 'Abonnement Artisan',
  sousTitre: 'Offres de boulot + demandes de main-d’œuvre + profil mis en avant',
  mentionProvisoire: 'tarif provisoire',
};

/** Avantages communs aux deux formules : seule la DURÉE change. */
const AVANTAGES = [
  {
    cle: 'offres_boulot',
    libelle: 'Offres de boulot : contacts inclus, sans frais à l’unité',
    icone: 'briefcase',
  },
  {
    cle: 'demandes_main_oeuvre',
    libelle: 'Demandes de main-d’œuvre du quartier : contacts inclus',
    icone: 'users',
  },
  {
    cle: 'mise_en_avant_artisan',
    libelle: 'Votre profil d’artisan mis en avant dans le feed et la recherche',
    icone: 'star',
  },
];

const CLES_AVANTAGES = AVANTAGES.map((a) => a.cle);

/** FORMULE semaine — 7 jours d'accès (miroir de FORMULE_HEBDOMADAIRE, backend). */
export const FORMULE_HEBDOMADAIRE = {
  cle: 'artisan_hebdo',
  libelle: 'Artisan — 1 semaine',
  libelleCourt: 'Semaine',
  sousTitre: CATALOGUE.sousTitre,
  // Gratuit : aucun montant n'est affiché tant que la gratuité court.
  prixFcfa: 0,
  periodicite: 'hebdomadaire',
  dureeJours: 7,
  aConfirmer: false,
  avantages: AVANTAGES,
  avantagesCles: CLES_AVANTAGES,
};

/** FORMULE mois — 30 jours d'accès (miroir de FORMULE_MENSUELLE, backend). */
export const FORMULE_MENSUELLE = {
  cle: 'artisan_mensuel',
  libelle: 'Artisan — 1 mois',
  libelleCourt: 'Mois',
  sousTitre: CATALOGUE.sousTitre,
  // Gratuit : aucun montant n'est affiché tant que la gratuité court.
  prixFcfa: 0,
  periodicite: 'mensuel',
  dureeJours: 30,
  aConfirmer: false,
  avantages: AVANTAGES,
  avantagesCles: CLES_AVANTAGES,
};

/** Les deux formules vendues en parallèle (le backend peut en désactiver une). */
export const FORMULES = [FORMULE_HEBDOMADAIRE, FORMULE_MENSUELLE];

/** Clés canoniques connues. */
export const CLES_FORMULES = FORMULES.map((f) => f.cle);

/**
 * Formule présélectionnée hors ligne. Doit rester alignée sur
 * SUBSCRIPTION_FORMULA_DEFAULT du backend (artisan_hebdo par défaut).
 */
export const ABONNEMENT = FORMULE_HEBDOMADAIRE;

/** Formule par clé ; repli sur la formule présélectionnée si la clé est inconnue. */
export function getFormule(cle) {
  return FORMULES.find((f) => f.cle === cle) || ABONNEMENT;
}

/** « Gratuit » (ou le prix réel après la période de gratuité) — prêt à afficher. */
export function libellePrix(formule = ABONNEMENT) {
  // Aucun montant tant que la gratuité court, ni pour une formule à 0 (miroir hors
  // ligne) : on n'affiche jamais « 0 FCFA », qui ressemblerait à une erreur.
  if (estModeGratuit() || !Number(formule.prixFcfa)) return 'Gratuit';
  const sep = Math.round(Number(formule.prixFcfa) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const periode = PERIODICITES[formule.periodicite]?.libelle || formule.periodicite;
  return `${sep} FCFA ${periode}`;
}

/** « 700 FCFA par semaine ou 2 500 FCFA par mois » — pour les résumés. */
export function libellePrixListe(formules = FORMULES) {
  if (estModeGratuit()) return 'Gratuit';
  return formules.map((f) => libellePrix(f)).join(' ou ');
}

export default {
  ABONNEMENT,
  CATALOGUE,
  FORMULES,
  CLES_FORMULES,
  PERIODICITES,
  GRATUIT_JUSQU_AU,
  TEXTE_GRATUIT,
  libelleGratuitJusquAu,
  estModeGratuit,
  getFormule,
  libellePrix,
  libellePrixListe,
};
