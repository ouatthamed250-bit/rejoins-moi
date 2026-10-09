// rapprochement.js — « Est-ce le même établissement ? » (bloc D, doublons et réclamation).
//
// POURQUOI CE MODULE
// Les fiches publiques importées (~6 700) ne sont pas réclamées : un gérant qui s'inscrivait
// créait donc une SECONDE fiche pour le même commerce — avis, photos et compteurs séparés,
// et deux fois le même lieu dans son quartier. Le rapprochement ne s'appuie que sur deux
// critères, que le gérant comprend en une phrase : le NOM et la DISTANCE.
//
// DÉCISIONS (dites au gérant, pas cachées)
//   - réclamation ACCEPTÉE automatiquement si le demandeur est à 150 m ou moins : il est
//     sur place, c'est la preuve la plus simple à obtenir sans paperasse ;
//   - au-delà, la demande part en file d'attente et une PERSONNE tranche : jamais
//     d'écrasement silencieux d'une fiche ;
//   - à moins de 50 m, un nom identique EST le même établissement : créer une seconde
//     fiche est refusé (doublon exact).

import { getDistanceKm } from './geo.js';

/** Réclamation acceptée sans intervention humaine jusqu'à cette distance (mètres). */
export const DISTANCE_RECLAMATION_M = 150;
/** En dessous, un nom identique est un doublon exact : la création est refusée. */
export const DISTANCE_DOUBLON_M = 50;

/**
 * Minuscules, sans accents ni ponctuation, espaces réduits.
 * « Chez Fatou ! » → « chez fatou » ; « L'ATELIER   d'Awa » → « l atelier d awa ».
 */
export function normaliserNom(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deux noms désignent-ils le même lieu ?
 *  - identiques après normalisation → oui ;
 *  - l'un contient la suite de mots de l'autre (« kiosque awa » ⊂ « kiosque awa plateau ») ;
 *  - un nom d'UN SEUL mot ne rapproche rien (« kiosque » désignerait tout le quartier).
 */
export function nomsProches(a, b) {
  const x = normaliserNom(a);
  const y = normaliserNom(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [court, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!court.includes(' ')) return false;
  return long.includes(court);
}

/**
 * Distance en MÈTRES entre deux points `{ lat, lng }`, ou `null` si l'un des deux manque.
 * On passe par `getDistanceKm` (utils/geo.js) : une seule formule dans tout le projet.
 */
export function distanceMetresEntre(a, b) {
  const km = getDistanceKm(a?.lat, a?.lng, b?.lat, b?.lng);
  return km == null ? null : Math.round(km * 1000);
}
