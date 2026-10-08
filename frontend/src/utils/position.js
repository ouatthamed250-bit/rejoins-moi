// position.js — Position de l'utilisateur : mémorisation, partage entre écrans et
// lecture de l'ÉTAT de l'autorisation de localisation.
//
// POURQUOI CE MODULE (bloc B, correction de lancement)
// Le terrain a remonté deux plaintes précises :
//   1. « On m'a demandé la localisation sans explication, j'ai refusé, et depuis je
//      n'ai plus jamais de distance. » Chaque écran appelait `getCurrentPosition()`
//      au chargement, sans contexte ; une fois refusée, la permission l'était pour
//      de bon, et l'application réessayait pourtant à chaque visite (le navigateur
//      échouait instantanément, l'utilisateur ne voyait qu'un bandeau muet).
//   2. « Sur mon iPhone, ça ne demande jamais rien. » Safari exige un GESTE de
//      l'utilisateur : un appel automatique au chargement échoue en silence.
// La sortie n'est donc pas un réglage du navigateur mais une règle de code : on
// LIT l'état de l'autorisation (Permissions API) AVANT d'appeler quoi que ce soit,
// et on ne réclame la position que sur un geste clair de l'utilisateur, avec une
// explication. Ce module porte cette règle sous forme de fonction PURE
// (`decisionPosition`) pour qu'elle soit vérifiable hors navigateur
// (voir scripts/verifier-permissions.mjs).
//
// Deux façons d'avoir une position, jamais mélangées :
//   - `gps`    : donnée par le téléphone, valable 30 min (la position d'hier soir
//                n'est plus fiable) ;
//   - `manuel` : point choisi par l'utilisateur sur la carte, valable 30 jours :
//                c'est un choix délibéré (quartier, ville), pas une mesure qui périme.
// Aucun point n'est JAMAIS inventé : sans position, l'application affiche les fiches
// sans distance plutôt que des distances fausses (décision déjà prise au 30/09).

export const CLE_POSITION = 'rejoinsmoi.position';
/** Une mesure GPS d'il y a plus de 30 min n'est pas réutilisée telle quelle. */
export const DUREE_GPS_MS = 30 * 60 * 1000;
/** Un point choisi sur la carte reste valable 30 jours (choix explicite de l'utilisateur). */
export const DUREE_MANUEL_MS = 30 * 24 * 60 * 60 * 1000;
/** Événement émis localement quand la position change : tous les écrans se mettent à jour. */
export const EVENEMENT_POSITION = 'rejoinsmoi:position';
/** Vue initiale de la carte de choix manuel : Abidjan (Plateau), jamais une distance. */
export const CENTRE_DEFAUT = { lat: 5.3242, lng: -4.0206 };

/**
 * Règle centrale : que faire, sachant l'état de l'autorisation ?
 *
 * @param {'granted'|'denied'|'prompt'|'inconnue'} etat
 * @returns {{ demanderMaintenant: boolean, actionRequise: boolean, refus: boolean,
 *   explication: 'accordee'|'refus_enregistre'|'demande_a_faire'|'etat_inconnu' }}
 */
export function decisionPosition(etat) {
  switch (etat) {
    case 'granted':
      // Autorisation déjà accordée : aucun message du navigateur ne s'affichera,
      // on peut donc demander la position dès le chargement de l'écran.
      return { demanderMaintenant: true, actionRequise: false, refus: false, explication: 'accordee' };
    case 'denied':
      // Refus enregistré : l'appel échoue toujours instantanément. On n'appelle pas
      // et on explique comment débloquer (réglages du site) — sans harceler.
      return { demanderMaintenant: false, actionRequise: true, refus: true, explication: 'refus_enregistre' };
    case 'prompt':
      // Le navigateur afficherait une demande… sans que l'utilisateur sache pourquoi.
      // On préfère un bandeau explicatif + un bouton : la demande part d'un geste.
      return { demanderMaintenant: false, actionRequise: true, refus: false, explication: 'demande_a_faire' };
    default:
      // État inconnu (Permissions API absente, Safari notamment) : on ne change RIEN
      // au comportement d'hier (appel direct), et si ce premier appel se conclut par
      // un refus alors qu'aucun refus n'était enregistré, l'écran proposera le geste.
      return { demanderMaintenant: true, actionRequise: false, refus: false, explication: 'etat_inconnu' };
  }
}

/** Durée de validité selon l'origine de la position. */
export function dureeValidite(source) {
  return source === 'manuel' ? DUREE_MANUEL_MS : DUREE_GPS_MS;
}

/** La mémoire locale est-elle utilisable dans cet environnement ? */
function stockageDisponible() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Relit la position mémorisée. Renvoie `null` si elle est absente, illisible ou
 * périmée — jamais un point approximatif « au cas où ».
 *
 * @returns {{ lat: number, lng: number, source: 'gps'|'manuel', at: number,
 *   ageMinutes: number }|null}
 */
export function lirePositionMemorisee() {
  if (!stockageDisponible()) return null;
  try {
    const brut = localStorage.getItem(CLE_POSITION);
    if (!brut) return null;
    const donnees = JSON.parse(brut);
    const lat = Number(donnees?.lat);
    const lng = Number(donnees?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Compatibilité : les positions enregistrées avant ce correctif n'ont pas de
    // champ `source` : ce sont des mesures GPS.
    const source = donnees.source === 'manuel' ? 'manuel' : 'gps';
    const at = Number(donnees.at);
    if (!Number.isFinite(at)) return null;
    const age = Date.now() - at;
    if (age > dureeValidite(source)) return null;
    return { lat, lng, source, at, ageMinutes: Math.max(0, Math.round(age / 60000)) };
  } catch {
    return null;
  }
}

/**
 * Enregistre une position et prévient les écrans ouverts.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {'gps'|'manuel'} [source]
 * @returns {{ lat: number, lng: number, source: 'gps'|'manuel', at: number, ageMinutes: 0 }|null}
 */
export function enregistrerPosition(lat, lng, source = 'gps') {
  const propre = {
    lat: Number(lat),
    lng: Number(lng),
    source: source === 'manuel' ? 'manuel' : 'gps',
    at: Date.now(),
  };
  if (!Number.isFinite(propre.lat) || !Number.isFinite(propre.lng)) return null;
  if (stockageDisponible()) {
    try {
      localStorage.setItem(CLE_POSITION, JSON.stringify(propre));
    } catch {
      /* navigation privée : la position reste utilisable pour la session en cours */
    }
  }
  const avecAge = { ...propre, ageMinutes: 0 };
  prevenirEcrans(avecAge);
  return avecAge;
}

/** Oublie la position (bouton « Ne plus utiliser ma position »). */
export function oublierPosition() {
  if (stockageDisponible()) {
    try {
      localStorage.removeItem(CLE_POSITION);
    } catch {
      /* rien à faire */
    }
  }
  prevenirEcrans(null);
}

/** Prévient les instances ouvertes du hook (Feed, Recherche, Pharmacies…) sans rechargement. */
function prevenirEcrans(position) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENEMENT_POSITION, { detail: position }));
  } catch {
    /* environnement sans CustomEvent : les écrans liront la mémoire à leur montage */
  }
}

/**
 * S'abonne aux changements de position (choix manuel, oubli, nouvelle mesure GPS).
 *
 * @param {(position: object|null) => void} ecouteur
 * @returns {() => void} désabonnement
 */
export function surPosition(ecouteur) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const relais = (evt) => ecouteur(evt?.detail ?? null);
  window.addEventListener(EVENEMENT_POSITION, relais);
  return () => window.removeEventListener(EVENEMENT_POSITION, relais);
}

// ── État de l'autorisation de localisation (Permissions API) ─────────────────
//
// LECTURE SEULE : ce module ne DEMANDE jamais la permission, il la constate.
// `navigator.permissions.query({ name: 'geolocation' })` renvoie `granted`,
// `denied` ou `prompt` — et, dans certains navigateurs (Safari), rejette : on
// répond alors `inconnue` et l'application garde son comportement d'hier.

/**
 * @returns {Promise<'granted'|'denied'|'prompt'|'inconnue'>}
 */
export async function etatPermissionGeo() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'inconnue';
    const statut = await navigator.permissions.query({ name: 'geolocation' });
    const etat = statut?.state;
    return etat === 'granted' || etat === 'denied' || etat === 'prompt' ? etat : 'inconnue';
  } catch {
    return 'inconnue';
  }
}

/**
 * S'abonne aux changements d'autorisation : dès que l'utilisateur revient des
 * réglages du navigateur avec « Autoriser », la position est obtenue SANS qu'il
 * ait à retoucher l'écran — c'est exactement le parcours qui manquait.
 *
 * @param {(etat: 'granted'|'denied'|'prompt'|'inconnue') => void} rappel
 * @returns {() => void} désabonnement (toujours appelable)
 */
export async function surChangementPermission(rappel) {
  let statut = null;
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return () => {};
    statut = await navigator.permissions.query({ name: 'geolocation' });
  } catch {
    return () => {};
  }
  if (!statut || typeof statut.addEventListener !== 'function') return () => {};
  const relais = () => rappel(statut.state);
  statut.addEventListener('change', relais);
  return () => statut.removeEventListener('change', relais);
}


