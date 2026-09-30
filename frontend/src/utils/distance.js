// distance.js — Calcul de distance entre deux points géographiques (formule de Haversine)
//
// Décision technique : le tri par proximité est recalculé côté client à partir des
// coordonnées stockées (`localisation: { lat, lng }`), et non via un index
// géospatial Mongo. Raison : le volume d'Abidjan est faible, et le filtre par
// rayon doit pouvoir être appliqué sans aller-retour réseau quand on bouge
// (voir hooks/useGeolocation.js). Le rendu et le scoring restent ainsi explicables.

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Centre par défaut : Plateau, Abidjan (utilisé si la géolocalisation est refusée). */
export const CENTRE_ABIDJAN = {
  lat: Number(import.meta.env?.VITE_DEFAULT_LAT ?? 5.3242),
  lng: Number(import.meta.env?.VITE_DEFAULT_LNG ?? -4.0206),
};

/**
 * Distance en kilomètres entre deux points (Haversine).
 * @returns {number|null} null si l'un des points est invalide
 */
export function getDistanceKm(lat1, lng1, lat2, lng2) {
  const nums = [lat1, lng1, lat2, lng2].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [a1, o1, a2, o2] = nums;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Affichage lisible : « 320 m », « 1,4 km », « 12 km ». */
export function formatDistanceKm(km) {
  if (km == null || Number.isNaN(Number(km))) return null;
  const d = Number(km);
  if (d < 1) return `${Math.round(d * 1000)} m`;
  if (d < 10) return `${d.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(d)} km`;
}

/** Distance depuis une position de référence vers un objet `{ localisation: {lat,lng} }`. */
export function distanceDepuis(position, item) {
  if (!position || !item) return null;
  const loc = item.localisation || item;
  return getDistanceKm(position.lat, position.lng, loc.lat, loc.lng);
}

/**
 * Enrichit une liste avec `distanceKm` puis la trie par proximité croissante
 * (les éléments sans coordonnées valides passent en fin de liste).
 */
export function trierParProximite(items, position) {
  if (!Array.isArray(items)) return [];
  const enrichis = items.map((item) => ({
    ...item,
    distanceKm: distanceDepuis(position, item),
  }));
  if (!position) return enrichis;
  return enrichis.sort(
    (a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * URL d'itinéraire ouvrable depuis un smartphone.
 * Google Maps en priorité : c'est l'app que tout le monde a déjà installée, et le
 * lien `dir/?api=1` ouvre directement le guidage turn-by-turn.
 */
export function urlItineraire(lat, lng) {
  const a = Number(lat);
  const o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o)) return '#';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${a},${o}`
  )}&travelmode=driving`;
}

/** Coordonnées à peu près valides ? (garde-fou avant tout affichage de distance) */
export function coordsValides(lat, lng) {
  return (
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180
  );
}

export default {
  getDistanceKm,
  formatDistanceKm,
  distanceDepuis,
  trierParProximite,
  urlItineraire,
  coordsValides,
  CENTRE_ABIDJAN,
};


