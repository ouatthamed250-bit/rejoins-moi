// verifier-mentions-legales.mjs — PREUVE des textes légaux honnêtes (bloc G du 12/10).
//
// Ce que le script vérifie, sans navigateur et sans réseau :
//   1. la phrase unique de suppression/correction est EXACTEMENT celle demandée, et
//      elle vient d'une seule constante de configuration (config/legal.js) ;
//   2. le lien WhatsApp est bien formé et pointe vers 2250554233234 (indicatif +225 ET
//      zéro initial conservé : depuis 2021, le 0 fait partie du numéro ivoirien) ;
//   3. la phrase est bien POSÉE dans les trois endroits demandés : profil,
//      connexion/inscription et page Mentions légales (et la route existe) ;
//   4. plus AUCUNE source ne promet une suppression qui n'existe pas (« onglet
//      Messages », « déclaration ARTCI en cours ») — garde-fou anti-régression.
//
// Lancement (depuis /frontend) : npm run verifier:mentions

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEXTE_DONNEES, LIEN_DONNEES, NUMERO_SUPPORT, MESSAGE_DONNEES } from '../src/config/legal.js';
import { enFormatWhatsapp } from '../src/config/paiement.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(ICI, '..', 'src');

const ATTENDU_TEXTE = 'Pour supprimer ou corriger vos données, écrivez-nous sur WhatsApp au 0554233234';

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

/** Lit un fichier source du frontend (pour vérifier les PLACEMENTS, pas seulement la config). */
function lire(cheminRelatif) {
  return readFileSync(join(SRC, cheminRelatif), 'utf8');
}

/** Tous les fichiers .js/.jsx de src/ (pour la recherche de promesses interdites). */
function fichiersSource(dossier = SRC) {
  const sortie = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersSource(chemin));
    else if (/\.(js|jsx)$/.test(entree)) sortie.push(chemin);
  }
  return sortie;
}

console.log('\n▶ Vérification des textes légaux (bloc G)');

// ── 1. La phrase unique ──
console.log('\n1. Phrase unique de suppression / correction');
verifier('la phrase est exactement celle demandée', TEXTE_DONNEES === ATTENDU_TEXTE, `vu : « ${TEXTE_DONNEES} »`);
verifier('le numéro affiché est 0554233234', NUMERO_SUPPORT === '0554233234', `vu : ${NUMERO_SUPPORT}`);
verifier(
  'la phrase est fabriquée à partir de la constante de numéro (une seule source)',
  TEXTE_DONNEES.includes(NUMERO_SUPPORT)
);

// ── 2. Le lien WhatsApp ──
console.log('\n2. Lien WhatsApp (indicatif +225, zéro initial conservé)');
verifier('le lien mené par https://wa.me/', LIEN_DONNEES.startsWith('https://wa.me/'), `vu : ${LIEN_DONNEES}`);
verifier(
  'le numéro du lien est 2250554233234 (et non l’ancien 225554233234, injoignable)',
  LIEN_DONNEES.startsWith('https://wa.me/2250554233234'),
  `vu : ${LIEN_DONNEES.split('?')[0]}`
);
verifier(
  'le lien est bien formé (chiffres puis texte encodé)',
  /^https:\/\/wa\.me\/\d{8,15}(\?text=[^?]*)?$/.test(LIEN_DONNEES),
  `vu : ${LIEN_DONNEES}`
);
verifier('le message pré-rempli est présent (rien à rédiger pour l’utilisateur)', LIEN_DONNEES.includes('?text='));
verifier(
  'le message pré-rempli parle bien de suppression/correction',
  /supprimer ou corriger/i.test(decodeURIComponent(MESSAGE_DONNEES))
);
verifier('un numéro local devient international sans perdre le 0', enFormatWhatsapp('0554233234') === '2250554233234');
verifier('le même numéro déjà international n’est pas préfixé deux fois', enFormatWhatsapp('+225 05 54 23 32 34') === '2250554233234');
verifier('un autre numéro local suit la même règle', enFormatWhatsapp('0749883981') === '2250749883981');


// ── 3. Les trois emplacements demandés ──
console.log('\n3. Emplacements (profil, connexion/inscription, mentions légales)');
const profil = lire('pages/Profile.jsx');
const connexion = lire('pages/Login.jsx');
const mentions = lire('pages/MentionsLegales.jsx');
const app = lire('App.jsx');

for (const [nom, source] of [
  ['Profil', profil],
  ['Connexion / Inscription', connexion],
  ['Mentions légales', mentions],
]) {
  verifier(`${nom} : la phrase vient de config/legal.js`, source.includes("from '../config/legal.js'"));
  verifier(`${nom} : la phrase unique est affichée (TEXTE_DONNEES)`, source.includes('TEXTE_DONNEES'));
  verifier(`${nom} : le lien WhatsApp est utilisé (LIEN_DONNEES)`, source.includes('LIEN_DONNEES'));
}
verifier(
  'la route /mentions-legales existe et est déclarée dans App.jsx',
  /<Route\s+path="\/mentions-legales"/.test(app) && app.includes('MentionsLegales')
);
verifier(
  'la page Mentions légales est atteignable (lien depuis le profil)',
  profil.includes('to="/mentions-legales"')
);
verifier(
  'la page Mentions légales est atteignable (lien depuis la connexion)',
  connexion.includes('to="/mentions-legales"')
);
verifier(
  'la page Mentions légales est atteignable (entrée dans le menu principal)',
  lire('components/MenuPrincipal.jsx').includes("to: '/mentions-legales'")
);

// ── 4. Garde-fou : plus aucune promesse d'un moyen de suppression qui n'existe pas ──
console.log('\n4. Garde-fou anti-régression (promesses interdites)');
const sources = fichiersSource();

/**
 * Retire les commentaires avant la recherche : les commentaires EXPLIQUENT pourquoi la
 * mention ARTCI a été retirée (« ne pas la remettre tant qu'elle n'est pas déposée »),
 * ils ne promettent rien à l'utilisateur. Ce qui compte, c'est le texte AFFICHÉ et les
 * chaînes exportées.
 */
function sansCommentaires(texte) {
  return texte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const contientPartout = (motif, { avecCommentaires = false } = {}) =>
  sources.filter((f) => {
    const brut = readFileSync(f, 'utf8');
    return motif.test(avecCommentaires ? brut : sansCommentaires(brut));
  });

const artci = contientPartout(/ARTCI/);
verifier('plus aucune mention « ARTCI » dans le frontend (déclaration non déposée)', artci.length === 0, artci.join(', '));
const ongletMessages = contientPartout(/suppression de vos données à tout moment depuis/i);
verifier(
  'plus aucune phrase « suppression… depuis l’onglet Messages »',
  ongletMessages.length === 0,
  ongletMessages.join(', ')
);
const arctiEnCours = contientPartout(/déclaration ARTCI en cours/i);
verifier('plus aucune mention « déclaration ARTCI en cours »', arctiEnCours.length === 0, arctiEnCours.join(', '));
const numDansUnComposant = contientPartout(/wa\.me\/[0-9]/);
verifier(
  'aucun composant n’écrit un lien wa.me en dur (tout passe par config/legal.js)',
  numDansUnComposant.length === 0,
  numDansUnComposant.join(', ')
);
verifier(
  'le numéro n’est écrit qu’une fois, dans la configuration',
  contientPartout(/0554233234/).filter((f) => !f.includes('config')).length === 0,
  contientPartout(/0554233234/).join(', ')
);

// ───────────────────────────── Bilan ─────────────────────────────
console.log(`\n${'─'.repeat(64)}`);
console.log(`  Phrase   : ${TEXTE_DONNEES}`);
console.log(`  Lien     : ${LIEN_DONNEES.split('?')[0]}`);
if (echecs.length === 0) {
  console.log(`✅ Textes légaux (bloc G) : ${reussis}/${reussis} vérifications réussies.\n`);
} else {
  console.log(`❌ Textes légaux (bloc G) : ${echecs.length} échec(s) : ${echecs.join(' | ')}\n`);
}
process.exit(echecs.length === 0 ? 0 : 1);
