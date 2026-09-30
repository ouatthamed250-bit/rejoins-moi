// abonnement.js — SOURCE DE VÉRITÉ UNIQUE de l'abonnement Rejoins'Moi.
//
// ⚠️ LES PRIX NE SONT PAS ENCORE TRANCHÉS AU CAHIER DES CHARGES.
// C'est POURQUOI ils vivent ici, et NULLE PART ailleurs : aucun montant d'abonnement
// n'est écrit en dur dans les routes, les modèles ou le frontend. Pour ajuster un
// tarif, il suffit de modifier les formules ci-dessous (ou de définir les variables
// d'environnement SUBSCRIPTION_* dans backend/.env).
//
// DEUX FORMULES ACTIVES EN PARALLÈLE (décision du 29/09, à trancher sur le terrain) :
//   • `artisan_hebdo`   : 7 jours  — 700 FCFA (provisoire)
//   • `artisan_mensuel` : 30 jours — 2 500 FCFA (provisoire, ancien placeholder)
// On ne fige AUCUNE formule : les deux sont vendues en même temps et la tournée
// terrain dira laquelle les artisans préfèrent. Pour n'en garder qu'une plus tard,
// il suffit de renseigner SUBSCRIPTION_PERIODICITY (liste CSV, voir plus bas) :
// aucune ligne de code n'est à modifier.
//
// `SUBSCRIPTION_PERIODICITY` est une LISTE (« hebdomadaire,mensuel ») et non une
// valeur unique : c'est elle qui décide des formules réellement proposées. Une
// formule désactivée reste lisible (les abonnements déjà vendus restent valides) et
// peut être réactivée sans migration de données.
//
// Le frontend récupère ces valeurs par l'API (GET /api/subscriptions/formules) :
// `frontend/src/config/abonnement.js` n'est qu'un MIROIR de secours pour le mode
// hors ligne (tournée terrain). Toute modification doit être faite ICI d'abord.
//
// Ce que débloque l'abonnement (cahier des charges, ajout du 29/09) :
//   1. accès complet à la page Jobs (offres de boulot + demandes de main-d'œuvre)
//      sans payer 500 FCFA à chaque déblocage de contact ;
//   2. pour un compte artisan : mise en avant du profil dans le feed/recherche ;
//   3. (implicite par 1) le prix du déblocage à l'unité reste disponible pour les
//      non-abonnés — les deux modèles cohabitent, ils ne s'excluent pas.
//
// Décision d'implémentation à valider : une SEULE formule (`artisan`) coche les
// trois éléments. Le code accepte déjà un tableau `FORMULES` : ajouter une formule
// « commercial », « établissement »... ne demandera qu'une entrée supplémentaire,
// sans toucher aux routes.

/** Périodicités acceptées (utils pour les validations). */
export const PERIODICITES = ['hebdomadaire', 'mensuel'];

function lireNombre(nomVariable, defaut) {
  const valeur = Number(process.env[nomVariable]);
  return Number.isFinite(valeur) && valeur > 0 ? valeur : defaut;
}

/**
 * Lit une LISTE de périodicités depuis l'environnement.
 * `SUBSCRIPTION_PERIODICITY=hebdomadaire,mensuel` (valeur par défaut) active les deux
 * formules ; `SUBSCRIPTION_PERIODICITY=mensuel` n'en propose qu'une, sans toucher au
 * code. Les valeurs inconnues sont ignorées (jamais d'erreur de démarrage).
 */
function lirePeriodicites(nomVariable, defaut = PERIODICITES) {
  const brut = process.env[nomVariable];
  if (!brut) return [...defaut];
  const liste = String(brut)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => PERIODICITES.includes(v));
  return liste.length ? [...new Set(liste)] : [...defaut];
}

/** Périodicités réellement proposées à la vente (liste, jamais une valeur unique). */
export const PERIODICITES_ACTIVES = lirePeriodicites('SUBSCRIPTION_PERIODICITY');

/** En-tête commun aux formules (titre du bloc « Abonnement » dans l'interface). */
export const CATALOGUE = {
  titre: 'Abonnement Artisan',
  sousTitre: 'Offres de boulot + demandes de main-d’œuvre + profil mis en avant',
  mentionProvisoire: 'tarif provisoire',
};

/**
 * Avantages communs aux deux formules (identiques : seule la DURÉE change).
 * Les clés (`cle`) sont utilisées par le code, jamais les libellés.
 */
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

/**
 * FORMULE 1 — semaine (7 jours d'accès).
 *
 * `aConfirmer: true` tant que le tarif n'est pas validé : l'interface affiche alors
 * « tarif provisoire » au lieu de faire croire à un prix définitif.
 */
export const FORMULE_HEBDOMADAIRE = {
  cle: 'artisan_hebdo',
  libelle: 'Artisan — 1 semaine',
  libelleCourt: 'Semaine',
  sousTitre: CATALOGUE.sousTitre,
  prixFcfa: lireNombre('SUBSCRIPTION_PRICE_WEEKLY_FCFA', 700),
  periodicite: 'hebdomadaire',
  dureeJours: lireNombre('SUBSCRIPTION_DURATION_WEEKLY_DAYS', 7),
  aConfirmer: true,
  avantages: AVANTAGES,
  avantagesCles: CLES_AVANTAGES,
};

/**
 * FORMULE 2 — mois (30 jours d'accès). C'est l'ancienne formule unique (2 500 FCFA) :
 * le tarif et la durée se surchargent avec SUBSCRIPTION_PRICE_MONTHLY_FCFA /
 * SUBSCRIPTION_DURATION_MONTHLY_DAYS.
 */
export const FORMULE_MENSUELLE = {
  cle: 'artisan_mensuel',
  libelle: 'Artisan — 1 mois',
  libelleCourt: 'Mois',
  sousTitre: CATALOGUE.sousTitre,
  prixFcfa: lireNombre('SUBSCRIPTION_PRICE_MONTHLY_FCFA', 2500),
  periodicite: 'mensuel',
  dureeJours: lireNombre('SUBSCRIPTION_DURATION_MONTHLY_DAYS', 30),
  aConfirmer: true,
  avantages: AVANTAGES,
  avantagesCles: CLES_AVANTAGES,
};

/** Catalogue complet (y compris les formules temporairement désactivées). */
export const FORMULES = [FORMULE_HEBDOMADAIRE, FORMULE_MENSUELLE];

/** Clés canoniques de toutes les formules connues. */
export const CLES_FORMULES = FORMULES.map((f) => f.cle);

/**
 * Anciennes clés rencontrées en base ou dans un ancien client (le miroir hors ligne
 * envoyait « artisan ») : elles sont résolues vers la formule mensuelle au lieu de
 * provoquer une erreur ou, pire, un prix par défaut inattendu.
 */
export const CLES_HERITEES = { artisan: FORMULE_MENSUELLE.cle };

/** Formules réellement proposées à la vente, filtrées par PERIODICITES_ACTIVES. */
export const FORMULES_ACTIVES = FORMULES.filter((f) => PERIODICITES_ACTIVES.includes(f.periodicite));

/**
 * Formule présélectionnée dans l'interface et utilisée quand le client n'en envoie
 * aucune. Décision produit : la formule SEMAINE sert de porte d'entrée (montant le
 * plus faible pour un artisan qui teste), surchargeable par
 * SUBSCRIPTION_FORMULA_DEFAULT sans redéployer.
 */
export const FORMULE_PAR_DEFAUT =
  FORMULES_ACTIVES.find((f) => f.cle === (process.env.SUBSCRIPTION_FORMULA_DEFAULT || '').trim()) ||
  FORMULES_ACTIVES[0] ||
  FORMULE_MENSUELLE;

/**
 * Raccourci historique : `ABONNEMENT` désignait l'unique formule. Il pointe désormais
 * sur la formule par défaut, pour ne pas casser le code existant (seed, anciens
 * composants). Le code neuf doit passer par `getFormule()` / `getFormules()`.
 */
export const ABONNEMENT = FORMULE_PAR_DEFAUT;

/** Devise des abonnements (alignée sur le paiement à l'unité). */
export function getDeviseAbonnement() {
  return process.env.CURRENCY || 'XOF';
}

/**
 * Formule par clé — version TOLÉRANTE (lecture).
 * Une clé héritée est résolue (`artisan` → mensuel), une clé inconnue retombe sur la
 * formule par défaut. À n'utiliser que pour AFFICHER un abonnement déjà enregistré
 * ou interpréter un webhook : jamais pour décider d'un montant à encaisser
 * (voir `getFormuleStricte`).
 */
export function getFormule(cle) {
  const canonique = CLES_HERITEES[String(cle || '').trim()] || String(cle || '').trim();
  return FORMULES.find((f) => f.cle === canonique) || FORMULE_PAR_DEFAUT;
}

/**
 * Formule par clé — version STRICTE (encaissement).
 * Renvoie `null` si la clé est inconnue : la route répond alors 400 au lieu de
 * facturer silencieusement un autre tarif que celui demandé.
 */
export function getFormuleStricte(cle) {
  if (!cle) return null;
  const brut = String(cle).trim();
  const canonique = CLES_HERITEES[brut] || brut;
  return FORMULES.find((f) => f.cle === canonique) || null;
}

/** La formule est-elle proposée à la vente en ce moment (périodicité active) ? */
export function estFormuleActive(cle) {
  const formule = getFormuleStricte(cle);
  return Boolean(formule) && FORMULES_ACTIVES.some((f) => f.cle === formule.cle);
}

/** Durée d'accès (en jours) d'une formule donnée. */
export function dureeJoursFormule(cle) {
  return getFormule(cle).dureeJours;
}

/**
 * Fin de période : date de départ + durée de la formule.
 * Fonction PURE (donc testable sans base de données) : c'est l'arithmétique qui
 * décide de ce que l'utilisateur a payé, elle ne doit jamais être recopiée ailleurs.
 */
export function calculerFinPeriode(debut, cle) {
  return new Date(new Date(debut).getTime() + dureeJoursFormule(cle) * 86400000);
}

/** Version sérialisable pour l'API : uniquement les formules proposées à la vente. */
export function getFormules() {
  return FORMULES_ACTIVES.map((f) => ({ ...f }));
}

/** Formules désactivées mais toujours lisibles (support / diagnostic). */
export function getFormulesInactives() {
  return FORMULES.filter((f) => !FORMULES_ACTIVES.includes(f)).map((f) => ({ ...f }));
}

export default {
  PERIODICITES,
  PERIODICITES_ACTIVES,
  CATALOGUE,
  ABONNEMENT,
  FORMULES,
  FORMULES_ACTIVES,
  FORMULE_PAR_DEFAUT,
  FORMULE_HEBDOMADAIRE,
  FORMULE_MENSUELLE,
  CLES_FORMULES,
  CLES_HERITEES,
  getDeviseAbonnement,
  getFormule,
  getFormuleStricte,
  estFormuleActive,
  dureeJoursFormule,
  calculerFinPeriode,
  getFormules,
  getFormulesInactives,
};
