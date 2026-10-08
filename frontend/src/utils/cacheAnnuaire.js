// cacheAnnuaire.js — Mémoire locale de la DERNIÈRE liste d'établissements reçue.
//
// POURQUOI : l'API est hébergée sur une offre qui s'endort après quelques minutes
// d'inactivité. Au premier lancement du matin, la réponse peut mettre 30 à 60 s à
// arriver. Sans mémoire locale, l'utilisateur voit un écran de chargement, puis —
// si la requête expire — des fiches d'exemple, c'est-à-dire un annuaire qui semble
// faux. Avec ce cache, il voit immédiatement les fiches RÉELLES de sa dernière
// visite, et elles sont remplacées par les données fraîches dès que l'API répond.
//
// PÉRIMÈTRE STRICT (décision de lancement) : ce cache ne concerne QUE la liste
// publique de l'annuaire, soit `GET /api/establishments`. Il ne doit JAMAIS servir
// à mettre en cache un compte, un jeton, un abonnement, un paiement ou une donnée
// d'administration : ces informations doivent toujours venir du serveur, même hors
// ligne, sinon l'application afficherait un état financier ou un profil périmé.
// (Les favoris et l'historique sont gérés par le serveur via /api/users/me.)
//
// DONNÉES STOCKÉES : uniquement des champs PUBLICS déjà renvoyés par l'API
// (nom, catégorie, coordonnées, distance, photo...). Aucune donnée privée.

const CLE = 'rejoinsmoi.annuaire.derniereListe';
/** Au-delà, la liste est considérée trop vieille pour être montrée sans réserve. */
export const AGE_MAX_MINUTES = 24 * 60;
const MAX_FICHES_PAR_CATEGORIE = 30;
const MAX_CATEGORIES = 6;

function lireTout() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return {};
    const objet = JSON.parse(brut);
    return objet && typeof objet === 'object' ? objet : {};
  } catch {
    // Navigation privée, quota plein, JSON corrompu : on repart de zéro.
    return {};
  }
}

/**
 * Dernière liste connue pour une catégorie.
 * @returns {{items: Array, total: number, quand: number, ageMinutes: number}|null}
 */
export function lireCacheAnnuaire(categorie = 'tous') {
  const entree = lireTout()[categorie];
  if (!entree || !Array.isArray(entree.items) || entree.items.length === 0) return null;
  return {
    items: entree.items,
    total: Number(entree.total) || entree.items.length,
    quand: Number(entree.quand) || 0,
    ageMinutes: Math.round((Date.now() - (Number(entree.quand) || 0)) / 60000),
  };
}

/**
 * Mémorise la première page d'une catégorie. Seule la PREMIÈRE page est gardée :
 * au-delà, la liste est déjà longue et se recharge en quelques dizaines de Ko.
 */
export function ecrireCacheAnnuaire(categorie, items, total) {
  if (!Array.isArray(items) || items.length === 0) return;
  try {
    const tout = lireTout();
    tout[categorie] = {
      items: items.slice(0, MAX_FICHES_PAR_CATEGORIE),
      total: Number(total) || items.length,
      quand: Date.now(),
    };
    // On ne garde que les catégories les plus récentes : le stockage local est
    // limité (~5 Mo) et rien ne justifie de garder tout l'annuaire.
    const entrees = Object.entries(tout).sort((a, b) => (b[1].quand || 0) - (a[1].quand || 0));
    localStorage.setItem(CLE, JSON.stringify(Object.fromEntries(entrees.slice(0, MAX_CATEGORIES))));
  } catch {
    /* quota atteint ou navigation privée : le cache est un confort, jamais un blocage */
  }
}

// LIMITE ASSUMÉE : la mémoire est rangée par catégorie, PAS par position. Si
// l'utilisateur ouvre l'application dans une autre ville, il verra quelques
// secondes les fiches de son dernier lieu (le temps du réveil de l'API), avec un
// bandeau qui l'annonce explicitement (« Fiches réelles enregistrées il y a X »).
// C'est un choix délibéré : mieux vaut de vraies fiches datées et signalées qu'un
// écran vide ou que des fiches d'exemple. Dès la première réponse du serveur, la
// liste est remplacée par celle du lieu courant.

/** Vrai si la liste mémorisée n'est plus assez fraîche pour être présentée comme telle. */
export function cachePerime(ageMinutes) {
  return Number(ageMinutes) > AGE_MAX_MINUTES;
}
export default { lireCacheAnnuaire, ecrireCacheAnnuaire, cachePerime, AGE_MAX_MINUTES };
