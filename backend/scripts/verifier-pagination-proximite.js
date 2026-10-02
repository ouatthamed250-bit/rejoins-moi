// verifier-pagination-proximite.js — PREUVE de pagination de l'annuaire par proximité.
//
// Vérifie, sur la BASE RÉELLE et via les VRAIS routeurs, que l'onglet « Tous » en
// proximité pure (mode par défaut depuis le correctif de lancement) :
//   1. trie STRICTEMENT du plus proche au plus loin (distances non décroissantes) ;
//   2. ne répète JAMAIS une fiche (aucun doublon) ;
//   3. ne saute AUCUNE fiche : en parcourant toutes les pages, on obtient EXACTEMENT
//      `total` fiches distinctes — donc l'intégralité de l'annuaire géolocalisé.
//
// Le test charge d'abord 10 pages (comme demandé), puis fait un balayage COMPLET.
// Position de référence : Plateau, Abidjan (5.3242, -4.0206) — une position réelle.
//
// Lecture seule (aucune écriture en base). Lancement (depuis /backend) :
//   node scripts/verifier-pagination-proximite.js

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import establishmentsRouter from '../src/routes/establishments.js';
import Establishment from '../src/models/Establishment.js';

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

/** Charge une page du feed « Tous » en proximité pure (diversite=0 explicite). */
async function page(numero) {
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const q = new URLSearchParams({
    limit: String(LIMITE),
    page: String(numero),
    diversite: '0',
    lat: String(POSITION.lat),
    lng: String(POSITION.lng),
  });
  const r = await fetch(`${base}/api/establishments?${q.toString()}`);
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

// ── 1. DIX PAGES (comme demandé) ────────────────────────────────────────────
  console.log(`  1) Chargement de ${PAGES_TESTEES} pages (${PAGES_TESTEES * LIMITE} fiches attendues)`);
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
  verifier('le total annoncé correspond aux fiches géolocalisées en base', total === attendu, `total=${total}, base=${attendu}`);

  // ── 2. BALAYAGE COMPLET : toutes les pages jusqu'à épuisement ───────────────
  console.log(`\n  2) Balayage COMPLET de l’annuaire (jusqu’à hasMore=false)`);
  const totalPages = Math.ceil(attendu / LIMITE);
  const vus = new Set();
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