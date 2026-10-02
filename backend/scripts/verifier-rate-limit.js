// verifier-rate-limit.js — PREUVE du limiteur de débit (aucune base, aucun réseau externe).
//
// Monte un mini-serveur Express qui n'expose QUE le middleware `limiteurAuth` (exactement
// celui branché sur /login et /register dans routes/users.js), puis vérifie :
//   • les N premières requêtes du même numéro passent (200) ;
//   • les suivantes sont refusées avec 429 ;
//   • un AUTRE numéro n'est pas pénalisé (la clé inclut le numéro) ;
//   • la réponse 429 porte un en-tête Retry-After.
//
// Lancement (depuis /backend) : node scripts/verifier-rate-limit.js

import express from 'express';
import { limiteurAuth } from '../src/middleware/rateLimit.js';

const MAX = 5;
const FENETRE_MS = 60000;

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
app.post('/login', limiteurAuth({ max: MAX, fenetreMs: FENETRE_MS }), (req, res) =>
  res.json({ ok: true })
);

const serveur = app.listen(0, async () => {
  const port = serveur.address().port;
  const url = `http://127.0.0.1:${port}/login`;

  const appeler = (telephone) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telephone, motDePasse: 'motdepasse' }),
    });

  console.log('\n▶ Vérification du limiteur de débit (/login, /register)');
  console.log(`  Limite testée : ${MAX} requêtes / ${FENETRE_MS / 1000} s, par IP + numéro.\n`);

  const numero = '+2250700000001';
  const statuts = [];
  for (let i = 0; i < MAX + 3; i++) {
    const r = await appeler(numero);
    statuts.push(r.status);
  }

  verifier(
    `les ${MAX} premières requêtes du même numéro passent (200)`,
    statuts.slice(0, MAX).every((s) => s === 200),
    statuts.join(',')
  );
  verifier(
    'les requêtes suivantes sont REFUSÉES (429)',
    statuts.slice(MAX).every((s) => s === 429),
    statuts.join(',')
  );

  const autre = await appeler('+2250700000002');
  verifier('un AUTRE numéro n’est pas bloqué (200)', autre.status === 200, `statut ${autre.status}`);

  const enTete = await appeler(numero);
  verifier(
    'la réponse 429 porte un en-tête Retry-After',
    enTete.status === 429 && Boolean(enTete.headers.get('retry-after')),
    `statut ${enTete.status}`
  );

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Statuts observés (numéro bloqué) : ${statuts.join(' → ')}`);
  if (echecs.length === 0) {
    console.log(`✅ Limiteur de débit : ${reussis}/${reussis} vérifications réussies.\n`);
  } else {
    console.log(`❌ Limiteur de débit : ${echecs.length} échec(s) : ${echecs.join(' | ')}\n`);
  }

  serveur.closeAllConnections?.();
  serveur.close();
  // Sortie NATURELLE : fermer toutes les connexions (keep-alive undici) suffit à ce que
  // Node termine tout seul. On évite `process.exit()` qui, sous Windows, peut interrompre
  // une fermeture libuv en cours (assertion inoffensive mais code de sortie trompeur).
  process.exitCode = echecs.length === 0 ? 0 : 1;
});