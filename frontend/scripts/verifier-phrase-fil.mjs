// verifier-phrase-fil.mjs — PREUVE de la phrase « utilisateurs ont contacté … » (bloc I).
//
// Deux défauts signalés le 12/10 :
//   • « 1 utilisateurs ont contacté ces établissements » : faute de pluriel ;
//   • « 0 utilisateurs ont contacté ces établissements » : phrase à afficher nulle part,
//     elle fait croire à un compteur cassé alors qu'il n'y a simplement aucun contact.
// La phrase est désormais produite par une fonction unique (utils/format.js) qui renvoie
// une chaîne VIDE quand il n'y a rien à annoncer. Ce script le prouve sans navigateur,
// et vérifie que le fil d'accueil l'utilise réellement (aucune phrase écrite en dur).
//
// Lancement (depuis /frontend) : npm run verifier:phrase

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { phraseContactUtilisateurs } from '../src/utils/format.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const FEED = resolve(ICI, '..', 'src', 'pages', 'Feed.jsx');

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

const feed = readFileSync(FEED, 'utf8');
const feedUtile = feed.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

console.log('\n▶ Vérification de la phrase du fil d’accueil (bloc I)');

// ── 1. Pluriel correct ──
console.log('\n1. Pluriel');
verifier(
  'à 2 : « 2 utilisateurs ont contacté ces établissements »',
  phraseContactUtilisateurs(2) === '2 utilisateurs ont contacté ces établissements',
  `vu : « ${phraseContactUtilisateurs(2)} »`
);
verifier(
  'à 12 : la marque du pluriel est conservée',
  phraseContactUtilisateurs(12) === '12 utilisateurs ont contacté ces établissements',
  `vu : « ${phraseContactUtilisateurs(12)} »`
);
verifier(
  'à 1240 : le compteur reste compacté (« 1,2 k »)',
  phraseContactUtilisateurs(1240) === '1,2 k utilisateurs ont contacté ces établissements',
  `vu : « ${phraseContactUtilisateurs(1240)} »`
);

// ── 2. Singulier ──
console.log('\n2. Singulier (le défaut signalé)');
verifier(
  'à 1 : « 1 utilisateur a contacté ces établissements »',
  phraseContactUtilisateurs(1) === '1 utilisateur a contacté ces établissements',
  `vu : « ${phraseContactUtilisateurs(1)} »`
);
verifier(
  'à 1, le mot « utilisateurs » et le verbe « ont » ont disparu',
  !phraseContactUtilisateurs(1).includes('utilisateurs') && !phraseContactUtilisateurs(1).includes(' ont ')
);

// ── 3. Zéro : rien à afficher ──
console.log('\n3. Zéro (et valeurs inutilisables) : la phrase disparaît');
for (const [etiquette, valeur] of [
  ['0', 0],
  ['undefined', undefined],
  ['null', null],
  ['NaN', Number.NaN],
  ['négatif (-5)', -5],
]) {
  verifier(`à ${etiquette}, la phrase est vide (donc non affichée)`, phraseContactUtilisateurs(valeur) === '', `vu : « ${phraseContactUtilisateurs(valeur)} »`);
}

// ── 4. Le fil d'accueil utilise bien cette fonction ──
console.log('\n4. Le fil d’accueil (Feed.jsx)');
verifier('Feed.jsx importe phraseContactUtilisateurs', /import \{[^}]*phraseContactUtilisateurs[^}]*\} from '\.\.\/utils\/format\.js'/.test(feed));
verifier('Feed.jsx appelle la fonction avec le total', /phraseContactUtilisateurs\(totalUtilisateurs\)/.test(feedUtile));
verifier(
  'la phrase n’est plus écrite en dur dans Feed.jsx',
  !/utilisateurs ont contacté/.test(feedUtile),
  'une phrase en dur subsiste'
);
verifier(
  'l’affichage est conditionné à une phrase non vide',
  /orderedEstablishments\.length > 0 && phraseUtilisateurs &&/.test(feedUtile)
);

// ───────────────────────────── Bilan ─────────────────────────────
console.log(`\n${'─'.repeat(64)}`);
console.log(`  à 0 : « ${phraseContactUtilisateurs(0)} » (rien)  |  à 1 : « ${phraseContactUtilisateurs(1)} »`);
console.log(`  à 2 : « ${phraseContactUtilisateurs(2)} »`);
if (echecs.length === 0) {
  console.log(`✅ Phrase du fil (bloc I) : ${reussis}/${reussis} vérifications réussies.\n`);
} else {
  console.log(`❌ Phrase du fil (bloc I) : ${echecs.length} échec(s) : ${echecs.join(' | ')}\n`);
}
process.exit(echecs.length === 0 ? 0 : 1);
