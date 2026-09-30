// useFeedAlgorithm.js — Logique de personnalisation du feed (voir cahier-des-charges §3)
//
// Comportement attendu :
// - Au lancement (peu de données) : tri simple = proximité + note moyenne + correspondance de tags déclarés
// - Au fur et à mesure : pondérer avec l'historique d'interactions de l'utilisateur
//   (profils vus, recherches faites, clics sur "Aller chez...") pour affiner l'ordre du feed
// - Doit rester explicable et simple à faire évoluer (pas besoin de ML complexe au départ,
//   un scoring pondéré qui s'ajuste avec les données suffit pour commencer)
//
// COMMENT ÇA MARCHE (et pourquoi c'est fait comme ça) :
//  - Le score est une somme pondérée de 4 signaux lisibles :
//      proximité (0,35) + note (0,25) + affinité apprise (0,30) + signaux explicites (0,10)
//    Aucun modèle pré-entraîné : à chaque nouvelle interaction, les affinités
//    (catégories et tags) se renforcent par simple comptage.
//  - Démarrage à froid : s'il n'y a aucune interaction, le poids de l'affinité est
//    redistribué vers la proximité. Le feed n'est donc jamais « au hasard ».
//  - Chaque carte reçoit `raisons` (ex. « À 300 m », « Très bien noté ») :
//    l'utilisateur comprend pourquoi il voit ça, et le classement reste débogable
//    sans instrumenter quoi que ce soit.
//  - Les interactions sont celles déjà stockées côté backend
//    (User.historiqueInteractions, alimenté par POST /api/users/me/interactions).

import { useMemo } from 'react';
import { distanceDepuis } from '../utils/distance.js';

export const POIDS = {
  proximite: 0.35,
  note: 0.25,
  affinite: 0.3,
  explicite: 0.1,
};

// Pénalité appliquée à un profil déjà ouvert récemment : on ne remonte pas en tête
// du feed ce que l'utilisateur vient de consulter.
const PENALITE_VU_RECENT = 0.18;
// Amplitude de la proximité : au-delà de 30 km, le lieu est lointain pour un
// commerce de quartier d'Abidjan (le score de proximité tombe à zéro).
const DISTANCE_MAX_KM = 30;

/**
 * Construit les affinités (catégories + tags + déjà-vus) à partir de l'historique
 * d'interactions. Tous les types n'ont pas le même poids : un clic sur
 * « Aller chez… » ou un contact vaut beaucoup plus qu'une simple vue de profil.
 */
export function calculerAffinites(interactions = []) {
  const poidsParType = { vue: 1, recherche: 2, clic: 3, favori: 4, contact: 5, itineraire: 5 };
  const categories = {};
  const tags = {};
  const vus = {};

  for (const it of interactions || []) {
    const poids = poidsParType[it?.type] || 1;
    if (it?.categorie) categories[it.categorie] = (categories[it.categorie] || 0) + poids;
    for (const tag of it?.tags || []) {
      const cle = String(tag).toLowerCase();
      tags[cle] = (tags[cle] || 0) + poids;
    }
    if (it?.establishmentId) vus[String(it.establishmentId)] = true;
  }

  return { categories, tags, vus, total: (interactions || []).length };
}

function normaliser(map) {
  const valeurs = Object.values(map || {});
  const max = valeurs.length ? Math.max(...valeurs) : 0;
  if (!max) return {};
  const out = {};
  for (const [cle, v] of Object.entries(map)) out[cle] = v / max;
  return out;
}

/**
 * Score d'un établissement pour un utilisateur donné + explication lisible.
 * @returns {{ score: number, raisons: string[] }}
 */
export function scorerEtablissement(etablissement, { position, affinites, favoris = [], terme = '' } = {}) {
  const raisons = [];
  let score = 0;

  // 1) Proximité : décroît linéairement jusqu'à 30 km.
  const distance = position ? distanceDepuis(position, etablissement) : null;
  if (distance != null) {
    score += Math.max(0, 1 - distance / DISTANCE_MAX_KM) * POIDS.proximite;
    if (distance < 1) raisons.push(`À ${Math.round(distance * 1000)} m`);
    else if (distance < 6) raisons.push(`À ${distance.toFixed(1).replace('.', ',')} km`);
  } else {
    // Sans position connue, on ne pénalise pas : demi-poids de proximité.
    score += POIDS.proximite * 0.5;
  }

  // 2) Note (0 → 1) pondérée par le volume d'avis : un 5/5 avec 1 avis ne doit pas
  //    dépasser un 4,6/5 avec 128 avis.
  const note = Number(etablissement?.noteMoyenne) || 0;
  const nbAvis = Number(etablissement?.nombreAvis) || 0;
  const confiance = Math.min(1, Math.log10(nbAvis + 1) / 2);
  const noteScore = note / 5;
  score += (noteScore * 0.75 + noteScore * confiance * 0.25) * POIDS.note;
  if (note >= 4.5 && nbAvis >= 20) raisons.push(`Très bien noté (${note}/5)`);

  // 3) Affinité apprise : catégorie privilégiée + tags recherchés.
  if (affinites && affinites.total > 0) {
    const cat = normaliser(affinites.categories)[etablissement?.categorie] || 0;
    const tagsN = normaliser(affinites.tags);
    let tagsScore = 0;
    let tagFort = '';
    for (const tag of etablissement?.tags || []) {
      const v = tagsN[String(tag).toLowerCase()] || 0;
      if (v > tagsScore) {
        tagsScore = v;
        tagFort = tag;
      }
    }
    score += (cat * 0.6 + tagsScore * 0.4) * POIDS.affinite;
    if (cat > 0.5) raisons.push(`Vous consultez souvent « ${etablissement.categorie} »`);
    else if (tagFort && tagsScore > 0.4) raisons.push(`Vous cherchez « ${tagFort} »`);
  } else {
    // Démarrage à froid : le poids de l'affinité va à la proximité.
    score += POIDS.proximite * 0.4;
  }

  // 4) Signaux explicites : favoris, correspondance avec la recherche en cours, vérification.
  const id = etablissement?.id ?? etablissement?._id;
  if (favoris.some((f) => String(f) === String(id))) {
    score += POIDS.explicite * 0.6;
    raisons.push('Dans vos favoris');
  }
  if (terme) {
    const sac = [etablissement?.nom, etablissement?.description, ...(etablissement?.tags || [])]
      .join(' ')
      .toLowerCase();
    if (sac.includes(String(terme).toLowerCase())) {
      score += POIDS.explicite * 0.4;
      raisons.push(`Correspond à « ${terme} »`);
    }
  }
  if (etablissement?.verifie) score += POIDS.explicite * 0.15;

  // 5) On redescend légèrement ce que l'utilisateur vient déjà de voir.
  if (affinites?.vus?.[String(id)]) score -= PENALITE_VU_RECENT;

  return { score: Math.max(0, score), raisons: raisons.slice(0, 2) };
}

/** Réordonne une liste d'établissements selon le scoring. */
export function calculerFeed(liste = [], options = {}) {
  return liste
    .map((e) => {
      const { score, raisons } = scorerEtablissement(e, options);
      return { ...e, scoreFeed: Math.round(score * 1000) / 1000, raisonsFeed: raisons };
    })
    .sort((a, b) => b.scoreFeed - a.scoreFeed);
}

/**
 * Hook de personnalisation du feed.
 *
 * @param {Array} liste  établissements (déjà filtrés par catégorie/mot-clé si besoin)
 * @param {{ userId?: string, position?: {lat:number,lng:number}, interactions?: Array,
 *   favoris?: string[], terme?: string }} [options]
 * @returns {{ orderedEstablishments: Array, affinites: object, personnalise: boolean }}
 */
export function useFeedAlgorithm(liste = [], options = {}) {
  const { userId, position, interactions = [], favoris = [], terme = '' } = options;

  const affinites = useMemo(() => calculerAffinites(interactions), [interactions]);
  const favorisStables = useMemo(() => favoris.map(String), [favoris]);

  const orderedEstablishments = useMemo(
    () =>
      calculerFeed(liste, {
        position,
        affinites,
        favoris: favorisStables,
        terme,
      }),
    [liste, position, affinites, favorisStables, terme]
  );

  return {
    orderedEstablishments,
    affinites,
    // `false` = feed en mode « démarrage à froid » (proximité + note uniquement).
    personnalise: affinites.total > 0,
    userId: userId || null,
  };
}

export default useFeedAlgorithm;


