// verifier-pagination-proximite.js — PREUVE de pagination de l'annuaire par proximité.
//
// Vérifie, sur la BASE RÉELLE et via les VRAIS routeurs, que l'onglet « Tous » est en
// proximité pure PAR DÉFAUT — c'est-à-dire sans aucun paramètre de tri, exactement ce
// que l'application envoie (elle n'envoie ni `sort` ni `diversite`) :
//   1. le défaut EST la proximité pure : `tri: 'proximity'`, `diversite: false`, et un
//      ordre IDENTIQUE à celui demandé explicitement (`diversite=0`) ;
//   2. tri STRICTEMENT du plus proche au plus loin (distances non décroissantes) ;
//   3. AUCUN doublon et AUCUNE fiche sautée : 10 pages d'affilée, puis balayage COMPLET
//      jusqu'à `hasMore=false`, avec exactement `total` fiches distinctes ;
//   4. départage STABLE à distance égale : ordre des `_id` croissants — c'est lui qui
//      rend la pagination reproductible (`total` étant arrondi au centième de km, les
//      ex æquo sont fréquents) ;
//   5. AUCUN mélange par catégorie : l'ordre suit la distance, jamais des blocs ;
//   6. la RECHERCHE PAR MOT (« §4 ») offre les MÊMES garanties (contrôles identiques
//      sur `q=…`) ;
//   7. l'option de mélange (`diversite=1`) reste disponible MAIS n'est plus le défaut.
//
// Position de référence : Plateau, Abidjan (5.3242, -4.0206) — une position réelle.
// Lecture seule (aucune écriture en base). Lancement (depuis /backend) :
//   node scripts/verifier-pagination-proximite.js

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import establishmentsRouter from '../src/routes/establishments.js';
import Establishment from '../src/models/Establishment.js';
import { escapeRegex } from '../src/utils/validators.js';

// Plateau, Abidjan — position réelle de référence.
const POSITION = { lat: 5.3242, lng: -4.0206 };
const LIMITE = 60; // plafond de pagination de l'API (LIMITE_MAX)
const PAGES_TESTEES = 10;

let reussis = 0;
const echecs = [];

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ✓ ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

const app = express();
app.use(express.json());
app.use('/api/establishments', establishmentsRouter);
const serveur = app.listen(0);

/**
 * Charge une page du feed « Tous ».
 * Aucun paramètre `sort` ni `diversite` n'est envoyé par défaut : c'est ainsi qu'on
 * prouve que le DÉFAUT — ce que l'application reçoit — est la proximité pure.
 */
async function page(numero, { diversite = null, sort = null, q = null } = {}) {
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const p = new URLSearchParams({
    limit: String(LIMITE),
    page: String(numero),
    lat: String(POSITION.lat),
    lng: String(POSITION.lng),
  });
  if (sort) p.set('sort', sort);
  if (diversite !== null) p.set('diversite', String(diversite));
  if (q) p.set('q', q);
  const r = await fetch(`${base}/api/establishments?${p.toString()}`);
  return r.json();
}

/** Distances non décroissantes ? (tolérance d'arrondi de 50 m) */
function distancesCroissantes(items) {
  for (let i = 1; i < items.length; i += 1) {
    const prec = items[i - 1].distanceKm;
    const cour = items[i].distanceKm;
    if (prec == null || cour == null) return false;
    if (cour + 0.05 < prec) return false;
  }
  return true;
}

/**
 * ORDRE EXACT, lu en base avec le MÊME pipeline que la route ($geoNear + $sort).
 *
 * Pourquoi ici : l'API n'expose que `distanceKm` ARRONDI au centième (10 m). Deux fiches
 * peuvent donc afficher « 0,20 km » tout en étant départagées par leur distance EXACTE
 * (198 m vs 199 m) : comparer les `_id` sur la valeur arrondie serait une fausse alerte.
 * On vérifie donc la clé de tri là où elle est exacte — `distanceMetres`, puis `_id` —
 * et on compare l'ordre obtenu à celui que l'API renvoie réellement.
 */
async function ordreExactEnBase(limite, filtre = { position: { $exists: true } }) {
  const docs = await Establishment.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [POSITION.lng, POSITION.lat] },
        key: 'position',
        distanceField: 'distanceMetres',
        query: filtre,
      },
    },
    { $sort: { distanceMetres: 1, _id: 1 } },
    { $limit: limite },
    { $project: { _id: 1, distanceMetres: 1 } },
  ]);
  let croissant = true;
  let departage = true;
  for (let i = 1; i < docs.length; i += 1) {
    const a = docs[i - 1];
    const b = docs[i];
    if (b.distanceMetres + 1e-9 < a.distanceMetres) croissant = false;
    if (Math.abs(a.distanceMetres - b.distanceMetres) < 1e-9 && String(a._id) > String(b._id)) departage = false;
  }
  return { docs, croissant, departage };
}

/** Nombre de « blocs » de catégorie consécutifs : en proximité pure, il est élevé. */
function blocsDeCategorie(items) {
  let blocs = 0;
  let precedente = null;
  for (const it of items) {
    if (it.categorie !== precedente) blocs += 1;
    precedente = it.categorie;
  }
  return blocs;
}

/**
 * Contrôles communs à un parcours paginé : doublons, fiches sautées, distances
 * croissantes, `_id` en départage, `total` cohérent. `libelle` nomme le parcours.
 */
function controlerParcours(libelle, { ids, items, total, distinct, attendu }) {
  const uniques = new Set(ids);
  verifier(`${libelle} : aucun doublon`, uniques.size === ids.length, `${ids.length - uniques.size} doublon(s)`);
  verifier(`${libelle} : distances non décroissantes`, distancesCroissantes(items));
  verifier(
    `${libelle} : aucune fiche sautée (${distinct} distinctes vs ${attendu} annoncées)`,
    distinct === attendu,
    `total=${total}`
  );
}

async function principal() {
  console.log("\n▶ Pagination de l'annuaire par proximité (onglet « Tous »)");
  console.log(`  Position : Plateau, Abidjan (${POSITION.lat}, ${POSITION.lng}) — ${LIMITE}/page\n`);

  const connecte = await connectDB({ reessais: false, silencieux: true });
  if (!connecte) {
    console.error('  ✗ MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    return;
  }

  const attendu = await Establishment.countDocuments({ position: { $exists: true } });
  console.log(`  Fiches géolocalisées en base (position $exists) : ${attendu}\n`);

  // ── 1. DIX PAGES, SANS AUCUN PARAMÈTRE DE TRI (le défaut réel de l'app) ────
  console.log(`  1) Chargement de ${PAGES_TESTEES} pages SANS paramètre de tri (défaut de l’app)`);
  // L'application n'envoie ni `sort` ni `diversite` : le défaut DOIT donc être la
  // proximité pure, et le mélange « Tous » (diversite=1) une simple option.
  const premiere = await page(1);
  verifier(
    'le DÉFAUT (aucun paramètre) est la proximité pure',
    premiere.tri === 'proximity' && premiere.diversite === false,
    `tri=${premiere.tri}, diversite=${premiere.diversite}`
  );
  verifier(
    'le total annoncé couvre TOUTE la base géolocalisée',
    premiere.total === attendu,
    `total=${premiere.total}, base=${attendu}`
  );

  const ids = [];
  const toutes = [];
  let total = null;
  let hasMore = true;
  for (let p = 1; p <= PAGES_TESTEES; p += 1) {
    const r = await page(p);
    total = r.total;
    hasMore = r.hasMore;
    const items = r.items || [];
    for (const it of items) {
      ids.push(String(it.id));
      toutes.push(it);
    }
    console.log(`     page ${String(p).padStart(2)} : ${items.length} fiches (total annoncé ${r.total}, hasMore ${r.hasMore})`);
  }

  const uniques = new Set(ids);
  verifier(
    `${PAGES_TESTEES} pages = ${PAGES_TESTEES * LIMITE} fiches chargées`,
    ids.length === PAGES_TESTEES * LIMITE,
    `vu ${ids.length}`
  );
  verifier('AUCUN doublon sur ces pages (ids tous distincts)', uniques.size === ids.length, `${ids.length - uniques.size} doublon(s)`);
  verifier('distances NON décroissantes (du plus proche au plus loin)', distancesCroissantes(toutes));
  // Le tri stable se prouve LÀ OÙ la clé est exacte (voir ordreExactEnBase) : sur la
  // valeur arrondie, deux fiches peuvent légitimement ne pas suivre l'ordre des `_id`.
  const { docs: ordreBase, croissant, departage } = await ordreExactEnBase(PAGES_TESTEES * LIMITE);
  verifier(
    'en base, la clé de tri exacte est (distance en mètres, puis _id)',
    croissant && departage,
    `${ordreBase.length} fiches`
  );
  verifier(
    'l’API renvoie EXACTEMENT l’ordre de la base sur ces 10 pages',
    ordreBase.length === ids.length && ordreBase.every((d, i) => String(d._id) === ids[i]),
    `${ordreBase.length} vs ${ids.length}`
  );
  const page1bis = await page(1);
  const itemsPage1 = premiere.items || [];
  verifier(
    'reproductibilité : deux appels de la même page donnent le même ordre',
    (page1bis.items || []).length === itemsPage1.length &&
      (page1bis.items || []).every((it, i) => String(it.id) === String(itemsPage1[i].id))
  );
  verifier('le total annoncé correspond aux fiches géolocalisées en base', total === attendu, `total=${total}, base=${attendu}`);
  const blocs = blocsDeCategorie(toutes);
  const categories = new Set(toutes.map((it) => it.categorie));
  verifier(
    'AUCUN mélange par catégorie : l’ordre suit la distance, pas des blocs',
    blocs > categories.size,
    `${blocs} blocs pour ${categories.size} catégorie(s)`
  );

  // ── 2. BALAYAGE COMPLET : toutes les pages jusqu'à épuisement ───────────────
  console.log(`\n  2) Balayage COMPLET de l’annuaire (jusqu’à hasMore=false)`);
  const totalPages = Math.ceil(attendu / LIMITE);
  const vus = new Set();
  const tous = [];
  let ordreStable = true;
  let derniereDistance = -1;
  let doublonsGlobal = 0;
  let pages = 0;
  for (let p = 1; p <= totalPages + 1 && hasMore; p += 1) {
    const r = await page(p);
    hasMore = r.hasMore;
    pages += 1;
    for (const it of r.items || []) {
      if (vus.has(String(it.id))) doublonsGlobal += 1;
      vus.add(String(it.id));
      tous.push(it);
      if (it.distanceKm != null) {
        if (it.distanceKm + 0.05 < derniereDistance) ordreStable = false;
        derniereDistance = it.distanceKm;
      }
    }
  }

  verifier(
    'le balayage complet ramène EXACTEMENT toutes les fiches géolocalisées (aucune sautée)',
    vus.size === attendu,
    `${vus.size} distinctes vs ${attendu} attendues`
  );
  verifier('AUCUN doublon sur le balayage COMPLET', doublonsGlobal === 0, `${doublonsGlobal} doublon(s)`);
  verifier('ordre par proximité respecté sur TOUT l’annuaire', ordreStable);
  const complet = await ordreExactEnBase(attendu + 10);
  verifier(
    'sur TOUT l’annuaire, la clé de tri exacte est bien (distance en mètres, puis _id)',
    complet.croissant && complet.departage,
    `${complet.docs.length} fiches`
  );
  verifier(
    'sur TOUT l’annuaire, l’API suit exactement l’ordre de la base (aucune fiche déplacée)',
    complet.docs.length === tous.length && complet.docs.every((d, i) => String(d._id) === String(tous[i].id)),
    `${complet.docs.length} vs ${tous.length}`
  );

  // ── 3. LE DÉFAUT EST IDENTIQUE À « diversite=0 » demandé explicitement ─────
  console.log('\n  3) Le défaut est identique à `diversite=0` demandé explicitement');
  const explicite = await page(1, { diversite: 0 });
  const itemsExplicite = explicite.items || [];
  const itemsDefaut = premiere.items || [];
  verifier(
    'page 1 : mêmes fiches, dans le même ordre',
    itemsExplicite.length === itemsDefaut.length &&
      itemsExplicite.every((it, i) => String(it.id) === String(itemsDefaut[i].id)),
    `${itemsExplicite.length} vs ${itemsDefaut.length}`
  );
  verifier('même total annoncé', explicite.total === premiere.total, `${explicite.total} vs ${premiere.total}`);

  // ── 4. LE MÉLANGE RESTE UNE OPTION, ET N'EST PLUS LE DÉFAUT ───────────────
  console.log('\n  4) Le mélange par catégorie reste possible, mais sur demande seulement');
  const melange = await page(1, { diversite: 1 });
  verifier(
    'une demande explicite `diversite=1` est honorée (`diversite: true` renvoyé)',
    melange.diversite === true,
    `diversite=${melange.diversite}`
  );
  verifier('sans demande explicite, le mélange n’est PAS appliqué', premiere.diversite === false);

  // ── 5. RECHERCHE PAR MOT (§4) : les MÊMES garanties ──────────────────────
  console.log('\n  5) Recherche par mot (« §4 ») : pagination et tri identiques');
  const MOTS = ['kiosque', 'boutique', 'couture', 'coiffure', 'maquis', 'pharmacie', 'attiéké', 'école'];
  let meilleur = { mot: MOTS[0], total: 0 };
  for (const mot of MOTS) {
    const r = await page(1, { q: mot });
    console.log(`     « ${mot} » : ${r.total} fiche(s), tri=${r.tri}`);
    if ((r.total || 0) > meilleur.total) meilleur = { mot, total: r.total || 0 };
  }
  verifier('la recherche par mot renvoie des résultats exploitables', meilleur.total > 0, `${meilleur.total} fiche(s)`);

  const idsMot = [];
  const itemsMot = [];
  let totalMot = 0;
  let hasMoreMot = true;
  let pagesMot = 0;
  for (let p = 1; p <= PAGES_TESTEES && hasMoreMot; p += 1) {
    const r = await page(p, { q: meilleur.mot });
    totalMot = r.total;
    hasMoreMot = r.hasMore;
    pagesMot += 1;
    for (const it of r.items || []) {
      idsMot.push(String(it.id));
      itemsMot.push(it);
    }
  }
  controlerParcours(`recherche « ${meilleur.mot} » (${pagesMot} page(s))`, {
    ids: idsMot,
    items: itemsMot,
    total: totalMot,
    distinct: new Set(idsMot).size,
    attendu: Math.min(totalMot, LIMITE * PAGES_TESTEES),
  });
  verifier(
    `recherche « ${meilleur.mot} » : toutes les fiches trouvées sont géolocalisées (distance fournie)`,
    itemsMot.every((it) => it.distanceKm != null)
  );
  // Même garantie de tri stable pour la recherche : on rejoue le MÊME filtre mot en base.
  const rxMot = new RegExp(escapeRegex(String(meilleur.mot).trim()), 'i');
  const baseMot = await ordreExactEnBase(itemsMot.length || 1, {
    position: { $exists: true },
    $or: [{ nom: rxMot }, { tags: rxMot }, { quartier: rxMot }, { commune: rxMot }, { description: rxMot }],
  });
  verifier(
    `recherche « ${meilleur.mot} » : clé de tri exacte (distance, puis _id) respectée en base`,
    baseMot.croissant && baseMot.departage
  );
  verifier(
    `recherche « ${meilleur.mot} » : l’API suit exactement l’ordre de la base`,
    baseMot.docs.length === itemsMot.length && baseMot.docs.every((d, i) => String(d._id) === idsMot[i]),
    `${baseMot.docs.length} vs ${itemsMot.length}`
  );

  console.log(`\n${'─'.repeat(64)}`);
  if (echecs.length === 0) {
    console.log(`✅ Pagination proximité : ${reussis}/${reussis} vérifications réussies.`);
    console.log(`   ${PAGES_TESTEES} pages testées (${PAGES_TESTEES * LIMITE} fiches, 0 doublon) ; balayage complet :`);
    console.log(`   ${vus.size}/${attendu} fiches distinctes en ${pages} pages — aucune manquante, aucun doublon.\n`);
  } else {
    console.log(`❌ Pagination proximité : ${echecs.length} échec(s) :`);
    for (const e of echecs) console.log(`   • ${e}`);
    console.log('');
  }
  process.exitCode = echecs.length === 0 ? 0 : 1;
}

principal()
  .catch((err) => {
    console.error('❌ Échec du script :', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
    serveur.closeAllConnections?.();
    serveur.close();
  });