// geo.js — Utilitaires géographiques (calcul de distance, tri par proximité).
//
// Décision technique : les coordonnées sont stockées en `{ lat, lng }` simples
// (pas en GeoJSON) et la distance affichée est calculée en Haversine côté Node.
// L'annuaire des établissements fait exception : il possède en plus un miroir
// GeoJSON `position` (index 2dsphere, voir models/Establishment.js) pour que le
// tri par proximité des 6 719 fiches soit fait par MongoDB via `$geoNear`
// (routes/establishments.js). Les autres routes (offres, santé, artisans)
// restent sur Haversine : leur volume ne justifie pas d'index géographique.
// Les deux calculs diffèrent de moins de 0,2 % (rayon sphérique 6 371 km ici,
// 6 378,137 km pour MongoDB) : cela ne change jamais l'ordre des résultats.

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
