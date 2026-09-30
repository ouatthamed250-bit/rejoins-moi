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
  prixFcfa: 700,
  periodicite: 'hebdomadaire',
  dureeJours: 7,
  aConfirmer: true,
  avantages: AVANTAGES,
  avantagesCles: CLES_AVANTAGES,
};

/** FORMULE mois — 30 jours d'accès (miroir de FORMULE_MENSUELLE, backend). */
export const FORMULE_MENSUELLE = {
  cle: 'artisan_mensuel',
  libelle: 'Artisan — 1 mois',
  libelleCourt: 'Mois',
  sousTitre: CATALOGUE.sousTitre,
  prixFcfa: 2500,
  periodicite: 'mensuel',
  dureeJours: 30,
  aConfirmer: true,
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

/** « 700 FCFA par semaine » — libellé prêt à afficher. */
export function libellePrix(formule = ABONNEMENT) {
  const sep = Math.round(Number(formule.prixFcfa) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const periode = PERIODICITES[formule.periodicite]?.libelle || formule.periodicite;
  return `${sep} FCFA ${periode}`;
}

/** « 700 FCFA par semaine ou 2 500 FCFA par mois » — pour les résumés. */
export function libellePrixListe(formules = FORMULES) {
  return formules.map((f) => libellePrix(f)).join(' ou ');
}

export default { ABONNEMENT, CATALOGUE, FORMULES, CLES_FORMULES, PERIODICITES, getFormule, libellePrix, libellePrixListe };
