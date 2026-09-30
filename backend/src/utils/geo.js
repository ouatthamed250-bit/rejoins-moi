// geo.js — Utilitaires géographiques (calcul de distance, tri par proximité).
//
// Décision technique : on stocke les coordonnées en `{ lat, lng }` simples
// (pas en GeoJSON) et on calcule la distance en Haversine côté Node, plutôt que
// d'utiliser un index 2dsphere. Raison : le scoring du feed (proximité + note +
// affinité de tags) est de toute façon recalculé en JS pour rester explicable
// (voir hooks/useFeedAlgorithm.js), et le volume d'établissements d'Abidjan
// reste très faible devant la limite de pagination. Bascule possible vers
// $geoNear plus tard sans changer le format de données.

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Distance en kilomètres entre deux points (formule de Haversine).
 * @returns {number|null} null si l'un des points est invalide
 */
export function getDistanceKm(lat1, lng1, lat2, lng2) {
  const nums = [lat1, lng1, lat2, lng2].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [a1, o1, a2, o2] = nums;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Arrondi lisible pour l'affichage ("0,3 km", "2,4 km"). */
export function formatDistanceKm(km) {
  if (km == null || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/**
 * Extrait et valide `{ lat, lng }` depuis un body de requête.
 * Accepte aussi `?lat=&lng=` en query string.
 */
export function parseCoords(source = {}) {
  const lat = Number(source.lat);
  const lng = Number(source.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Point de référence par défaut : le Plateau, Abidjan (centre-ville). */
export const ABIDJAN_CENTER = { lat: 5.3242, lng: -4.0206 };

export default { getDistanceKm, formatDistanceKm, parseCoords, ABIDJAN_CENTER };
