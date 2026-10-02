// verifier-tri-proximite.mjs — Preuve « test réel » du tri par proximité.
//
// Interroge l'API de PRODUCTION (pas des données de démonstration) avec une vraie
// coordonnée et vérifie que les distances renvoyées vont bien du plus proche au plus
// loin sur PLUSIEURS pages (pas seulement les 30 premières fiches).
//
// Usage :
//   node scripts/verifier-tri-proximite.mjs
//   node scripts/verifier-tri-proximite.mjs '{"lat":5.4159,"lng":-4.0137}'

const BASE = 'https://rejoins-moi-api.onrender.com';

const coords = process.argv[2]
  ? JSON.parse(process.argv[2])
  : { lat: 5.2239, lng: -3.7431 }; // Grand-Bassam, ~33 km du Plateau (loin, pour prouver le point)

async function chargerPage(p) {
  const q = new URLSearchParams({
    limit: '60',
    page: String(p),
    sort: 'proximity',
    lat: String(coords.lat),
    lng: String(coords.lng),
    diversite: '0', // tri par proximité PUR (pas le mélange « Tous »)
  });
  const res = await fetch(`${BASE}/api/establishments?${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const toutes = [];
let page = 1;
let total = 0;
let hasMore = true;
const PAGE_MAX = 4; // 4 × 60 = 240 fiches, bien au-delà des 30 premières

while (hasMore && page <= PAGE_MAX) {
  const r = await chargerPage(page);
  total = Number(r.total) || 0;
  const items = r.items || [];
  toutes.push(...items);
  hasMore = r.hasMore !== false;
  page += 1;
  if (items.length === 0) break;
}

const distances = toutes
  .map((e) => Number(e.distanceKm))
  .filter((d) => Number.isFinite(d));

let inversions = 0;
for (let i = 1; i < distances.length; i += 1) {
  if (distances[i] < distances[i - 1] - 1e-9) inversions += 1;
}

const premieres = distances.slice(0, 8);
const dernieres = distances.slice(-8);

console.log(JSON.stringify({
  api: BASE,
  coordonneeTestee: coords,
  totalAnnonce: total,
  pagesLues: page - 1,
  fichesRecuperees: toutes.length,
  distancesValides: distances.length,
  premieresDistancesKm: premieres,
  dernieresDistancesKm: dernieres,
  inversions: inversions,
  triCroissant: inversions === 0 && distances.length > 0,
  preuvePlateauAbsent: distances.length > 0 && distances[0] > 20,
}, null, 2));
