// generer-sitemap.mjs — Fabrique frontend/public/sitemap.xml.
//
// À QUOI ÇA SERT : Google ne découvre pas tout seul 6 700 fiches cachées derrière
// une SPA React (toutes les adresses servent le même index.html). Le sitemap est
// la liste explicite des adresses à explorer ; avec le JSON-LD servi par la
// fonction Cloudflare Pages, chaque fiche devient une vraie page indexable
// (« Boulangerie l'épi royal à Port-Bouët »), et non un doublon de l'accueil.
//
// PAGINATION OBLIGATOIRE : l'API plafonne `limit` à 60 (LIMITE_MAX dans
// backend/src/routes/establishments.js). Demander `limit=10000` ne renvoie donc
// que 60 fiches — on parcourt les pages une à une, avec `sort=recent` pour un
// ordre STABLE d'une page à l'autre (sans tri explicite, l'API peut mélanger les
// catégories, et deux pages successives risqueraient de répéter ou de sauter une
// fiche).
//
// Les fiches marquées `test: true` sont exclues par l'API elle-même : elles ne
// peuvent pas se retrouver ici.
//
// Usage :
//   node scripts/generer-sitemap.mjs
//   SITE_PUBLIC=https://rejoins-moi.pages.dev node scripts/generer-sitemap.mjs
//
// Aucune dépendance : `fetch` natif de Node 18+.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = String(process.env.REJOINS_MOI_API || 'https://rejoins-moi-api.onrender.com').replace(/\/+$/, '');
const SITE = String(process.env.SITE_PUBLIC || 'https://rejoins-moi.pages.dev').replace(/\/+$/, '');

/** Borne DURE de l'API : au-delà, la valeur est ramenée à 60. */
const LIMITE_PAGE = 60;
/** Garde-fou : 60 × 2000 = 120 000 fiches, bien au-delà du besoin. */
const PAGES_MAX = 2000;

const SORTIE = fileURLToPath(new URL('../frontend/public/sitemap.xml', import.meta.url));

/**
 * Pages fixes de l'application (le routeur React). Les fiches sont ajoutées
 * après, à partir de l'API.
 */
const PAGES_FIXES = [
  { chemin: '/', priorite: '1.0', frequence: 'daily' },
  { chemin: '/recherche', priorite: '0.6', frequence: 'weekly' },
  { chemin: '/jobs', priorite: '0.6', frequence: 'daily' },
  { chemin: '/main-doeuvre', priorite: '0.6', frequence: 'daily' },
  { chemin: '/pharmacies-cliniques', priorite: '0.5', frequence: 'weekly' },
];

/** Échappe une valeur pour du XML (`&` d'abord, comme toujours). */
function echapperXml(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `2026-11-19T20:13:36.070Z` -> `2026-11-19` (format attendu par un sitemap). */
function jourDe(date) {
  const brut = String(date || '');
  const correspondance = brut.match(/^\d{4}-\d{2}-\d{2}/);
  return correspondance ? correspondance[0] : '';
}

/** Pause simple, sans dépendance. */
function attendre(ms) {
  return new Promise((resoudre) => setTimeout(resoudre, ms));
}

/**
 * Appelle l'API avec réessais : l'instance Render s'endort après quelques
 * minutes et le PREMIER appel de la journée peut dépasser 20 s (démarrage à
 * froid) ou répondre 502/503. On réessaie donc, en laissant le temps à
 * l'instance de se réveiller — sinon un sitemap partiel écraserait le complet.
 */
async function appelerApi(chemin, { essais = 3, delaiMs = 90000 } = {}) {
  let derniereErreur = null;
  for (let essai = 1; essai <= essais; essai += 1) {
    try {
      const reponse = await fetch(`${API}${chemin}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(delaiMs),
      });
      if (reponse.status === 502 || reponse.status === 503) {
        throw new Error(`hébergeur en démarrage (${reponse.status})`);
      }
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      return await reponse.json();
    } catch (erreur) {
      derniereErreur = erreur;
      console.warn(`  ⚠ ${chemin} — essai ${essai}/${essais} échoué (${erreur.message})`);
      if (essai < essais) await attendre(3000 * essai);
    }
  }
  throw derniereErreur;
}

/**
 * Parcourt toutes les pages de l'annuaire.
 * @returns {Promise<{fiches: Map<string, object>, total: number|null}>}
 */
async function collecterFiches() {
  const fiches = new Map();
  let total = null;

  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const chemin = `/api/establishments?page=${page}&limit=${LIMITE_PAGE}&sort=recent`;
    const donnees = await appelerApi(chemin, { essais: page === 1 ? 4 : 3 });
    const items = Array.isArray(donnees.items) ? donnees.items : [];
    total = Number.isFinite(donnees.total) ? donnees.total : total;

    for (const fiche of items) {
      if (fiche && fiche.id) fiches.set(String(fiche.id), fiche);
    }

    console.log(
      `  page ${String(page).padStart(3, ' ')} : +${items.length} fiche(s) — ${fiches.size}/${total ?? '?'}`
    );

    if (!items.length || donnees.hasMore !== true) break;
  }

  return { fiches, total };
}

/** Assemble le document XML. */
function construireSitemap(fiches) {
  const lignes = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const { chemin, priorite, frequence } of PAGES_FIXES) {
    lignes.push(
      '  <url>',
      `    <loc>${echapperXml(`${SITE}${chemin}`)}</loc>`,
      `    <changefreq>${frequence}</changefreq>`,
      `    <priority>${priorite}</priority>`,
      '  </url>'
    );
  }

  for (const [id, fiche] of fiches) {
    const dernierJour = jourDe(fiche.updatedAt || fiche.createdAt);
    lignes.push('  <url>', `    <loc>${echapperXml(`${SITE}/etablissement/${id}`)}</loc>`);
    if (dernierJour) lignes.push(`    <lastmod>${dernierJour}</lastmod>`);
    lignes.push('    <changefreq>weekly</changefreq>', '    <priority>0.8</priority>', '  </url>');
  }

  lignes.push('</urlset>', '');
  return lignes.join('\n');
}

async function principal() {
  console.log('→ Sitemap Rejoins\'Moi');
  console.log(`  API  : ${API}`);
  console.log(`  Site : ${SITE}`);

  const { fiches, total } = await collecterFiches();

  // Sécurité : un sitemap VIDE ne doit jamais écraser un sitemap complet (API
  // endormie, base indisponible…). On garde l'ancien fichier et on sort en
  // erreur, pour que le problème soit visible.
  if (fiches.size === 0) {
    console.error('✗ Aucune fiche reçue de l’API : sitemap existant conservé, rien n’a été écrit.');
    process.exit(1);
  }

  const xml = construireSitemap(fiches);
  writeFileSync(SORTIE, xml, 'utf8');

  const nombreLignes = xml.split('\n').length - 1;
  console.log(`\n✓ ${SORTIE}`);
  console.log(
    `  ${fiches.size} fiche(s) + ${PAGES_FIXES.length} page(s) fixe(s) — ${nombreLignes} ligne(s).`
  );
  if (total && fiches.size !== total) {
    console.warn(
      `  ⚠ L'API annonce ${total} fiches : ${total - fiches.size} manquante(s) (relancer le script).`
    );
  }
}

principal().catch((erreur) => {
  console.error('✗ Génération impossible :', erreur.message);
  console.error('  (sitemap existant conservé)');
  process.exit(1);
});


