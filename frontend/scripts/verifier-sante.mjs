// verifier-sante.mjs — PREUVE de la page « Pharmacies & Cliniques » (bloc H du 12/10).
//
// La production ne contient AUCUNE fiche de santé (0 pharmacie, 0 clinique). Cette page
// ne doit donc JAMAIS meubler : ni fiches d'exemple, ni notes, ni avis, et elle doit
// garder son avertissement de responsabilité. Le script vérifie ces garanties sur le
// code (aucun navigateur, aucun réseau) et interroge en plus l'API de production si
// elle répond — sans en faire un critère d'échec (le plan gratuit Render s'endort).
//
// Lancement (depuis /frontend) : npm run verifier:sante

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(ICI, '..', 'src');
const BACKEND = resolve(ICI, '..', '..', 'backend', 'src');
const PAGE = join(SRC, 'pages', 'PharmaciesCliniques.jsx');

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

/** Retire les commentaires : un commentaire n'est pas affiché à l'utilisateur. */
const sansCommentaires = (texte) =>
  texte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

function fichiersSource(dossier) {
  const sortie = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersSource(chemin));
    else if (/\.(js|jsx)$/.test(entree)) sortie.push(chemin);
  }
  return sortie;
}

const page = readFileSync(PAGE, 'utf8');
const pageUtile = sansCommentaires(page);

console.log('\n▶ Vérification de Pharmacies & Cliniques (bloc H)');

// ── 1. Aucune donnée de démonstration sur cette page ──
console.log('\n1. Aucun jeu de démonstration (les fiches doivent être réelles)');
verifier('la page n’importe plus de données de santé de démonstration', !/filtrerSanteDemo|SANTE_DEMO/.test(pageUtile));
const dansSrc = fichiersSource(SRC).filter((f) =>
  /SANTE_DEMO|filtrerSanteDemo/.test(sansCommentaires(readFileSync(f, 'utf8')))
);
verifier('SANTE_DEMO et son filtre ont disparu de src/ (aucun retour possible)', dansSrc.length === 0, dansSrc.join(', '));
verifier(
  'en cas de serveur injoignable, la liste reste VIDE (setBruts([]))',
  /setBruts\(\[\]\)/.test(pageUtile)
);
verifier(
  'aucun bandeau « Données d’exemple » sur cette page',
  !/variante="demo"/.test(pageUtile)
);

// ── 2. État vide honnête ──
console.log('\n2. État vide honnête quand il n’y a rien à montrer');
verifier('la page annonce « Cette liste arrive bientôt »', pageUtile.includes('Cette liste arrive bientôt'));
verifier(
  'l’état vide est conditionné à une réponse RÉELLE de l’API (bruts.length === 0)',
  /bruts\.length === 0/.test(pageUtile)
);
verifier(
  'le message explique qu’aucune fiche d’exemple n’est affichée',
  /jamais de fiche d’exemple|ne contiendra jamais/i.test(pageUtile)
);

// ── 3. Ni notes, ni avis, ni compteurs (déontologie §6) ──
console.log('\n3. Ni notes, ni avis, ni classement de popularité');
const interdits = [
  ['<StarRating', /<StarRating/],
  ['noteMoyenne', /noteMoyenne/],
  ['nombreAvis', /nombreAvis/],
  ['avis (au sens d’avis utilisateur)', /avis/i],
  ['compteur de visites/utilisateurs', /compteurUtilisateurs|compteurVisites/i],
  ['commentaire', /commentaire/i],
];
for (const [nom, motif] of interdits) {
  verifier(`la page n’affiche aucun « ${nom} »`, !motif.test(pageUtile));
}
verifier(
  'la page n’importe pas le composant d’étoiles',
  !/StarRating\.jsx/.test(page)
);

// Côté serveur : aucune route de notation d'un établissement de santé.
const routeSante = sansCommentaires(readFileSync(join(BACKEND, 'routes', 'healthFacilities.js'), 'utf8'));
verifier(
  'l’API santé n’expose toujours aucune route de note/avis',
  !/router\.(post|put|patch)\(\s*['"][^'"]*(avis|note|commentaire)/i.test(routeSante)
);
verifier(
  'l’API santé n’a pas de champ de note/avis dans son modèle',
  !/noteMoyenne|nombreAvis|avis\s*:|commentaire/i.test(
    sansCommentaires(readFileSync(join(BACKEND, 'models', 'HealthFacility.js'), 'utf8'))
  )
);

// ── 4. Mention de responsabilité conservée ──
console.log('\n4. Mention « statut mis à jour par l’établissement »');
verifier('la page affiche l’avertissement renvoyé par l’API', /\{avertissement\}/.test(pageUtile));
verifier(
  'l’avertissement par défaut reste celui du cahier des charges',
  pageUtile.includes('AVERTISSEMENT_GARDE')
);
const modeleSante = readFileSync(join(BACKEND, 'routes', 'healthFacilities.js'), 'utf8');
verifier(
  'l’API renvoie elle-même l’avertissement (le frontend ne peut pas l’oublier)',
  /avertissement: AVERTISSEMENT_GARDE/.test(modeleSante)
);
verifier(
  'le texte exact est celui attendu',
  modeleSante.includes("Statut mis à jour par l'établissement, à confirmer par téléphone en cas d'urgence.")
);

// ── 5. Comptage réel en production (facultatif : ne fait pas échouer le script) ──
console.log('\n5. Comptage en production (informatif)');
const API = process.env.VITE_API_URL || 'https://rejoins-moi-api.onrender.com';
let totalProd = null;
try {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 25000);
  const reponse = await fetch(`${API}/api/health-facilities?limit=60`, { signal: controleur.signal });
  clearTimeout(minuteur);
  const corps = await reponse.json();
  totalProd = Number(corps?.total ?? 0);
  console.log(`  ℹ API production : ${totalProd} fiche(s) de santé (sur ${API})`);
  console.log(`  ℹ avertissement renvoyé : ${corps?.avertissement ? 'oui' : 'non'}`);
} catch (err) {
  console.log(`  ℹ API production injoignable (${err.message}) — plan gratuit en veille : non bloquant.`);
}
if (totalProd !== null) {
  verifier(
    totalProd === 0 ? 'la production ne contient aucune fiche de santé (état vide attendu)' : 'la production contient des fiches réelles',
    true
  );
}

// ───────────────────────────── Bilan ─────────────────────────────
console.log(`\n${'─'.repeat(64)}`);
if (echecs.length === 0) {
  console.log(`✅ Pharmacies & Cliniques (bloc H) : ${reussis}/${reussis} vérifications réussies.\n`);
} else {
  console.log(`❌ Pharmacies & Cliniques (bloc H) : ${echecs.length} échec(s) : ${echecs.join(' | ')}\n`);
}
process.exit(echecs.length === 0 ? 0 : 1);
