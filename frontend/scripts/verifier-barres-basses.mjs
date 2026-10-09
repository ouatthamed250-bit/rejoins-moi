// verifier-barres-basses.mjs — preuve du correctif « barre d'action et navigation
// du bas forment UN SEUL bloc » (bug confirmé sur un vrai téléphone, Chrome
// Android, version déployée, 08/10).
//
// CE QU'ON VÉRIFIE, ET POURQUOI ICI
// À l'étape « photos » de l'inscription d'un établissement, la barre « Retour /
// Suivant » flottait AU-DESSUS de la navigation du bas, avec un interstice où le
// contenu de la page restait visible ; la fin du contenu passait sous la barre.
// Deux causes cumulées :
//   1. la barre était posée à `bottom-[68px]` : une hauteur de navigation ÉCRITE EN
//      DUR, alors qu'elle varie (barre système Android, zoom de police du téléphone,
//      police réellement chargée, bouton « + » surélevé de 24px) ;
//   2. la réserve d'espace de la page (`.espace-barre-action`) était écrasée par
//      l'utilitaire `.py-3` de Tailwind, produit APRÈS elle dans la feuille compilée
//      (vérifié dans dist/ avant correction) : le dernier champ passait donc bel et
//      bien sous la barre.
// La règle corrigée (« mesurer, jamais deviner ») ne se prouve pas en relisant le
// code : il faut un vrai navigateur, à la taille d'un vrai téléphone. Ce script
// pilote donc le Chrome de la machine via le protocole DevTools (CDP) — même
// outillage que verifier-permissions.mjs, aucune dépendance ajoutée — et sert le
// `dist/` construit localement, c'est-à-dire exactement ce qui est publié.
//
// CE QUI EST MESURÉ, ÉCRAN PAR ÉCRAN (9 écrans × 3 conditions)
//   B1 un seul bloc    l'écart entre le bas de la barre d'action et le haut de la
//                      navigation est nul (≤ 1px, arrondi de mesure) ;
//   B2 aucun contenu   à chaque point de la jointure, `elementFromPoint` ne renvoie
//                      QUE la barre ou la navigation, jamais un élément de page
//                      (c'est la manifestation exacte du bug signalé) ;
//   B3 fond opaque     les fonds de la barre et de la navigation sont sans
//                      transparence : plus de bg-white/95 + flou qui laissait
//                      deviner la page dans la bande de la jointure ;
//   B4 dernier élément au bas du défilement, le bord inférieur du dernier élément de
//                      page est au moins 16px AU-DESSUS du bloc fixe ; la réserve du
//                      corps est en outre contrôlée à l'exactitude (B4b), car le
//                      défilement maximal est arrondi au pixel par Chrome ;
//   B5 hauteur mesurée la variable --hauteur-bloc-bas vaut la hauteur RÉELLE relevée
//                      dans le DOM ;
//   B6 elle suit       en gonflant la navigation de 20px, la barre ET la réserve
//                      suivent : preuve qu'aucune valeur n'est écrite en dur
//                      (l'ancien `bottom-[68px]` n'aurait pas bougé d'un pixel).
//   B0/B0b condition   la taille de texte du téléphone et la marge de la barre
//                      système annoncées sont RÉELLEMENT appliquées au document
//                      mesuré : sans elles, un « essai sous texte agrandi » ne
//                      prouverait rien.
//
// Usage :
//   npm run verifier:barres            (construire dist/ avant : npm run build)
//   node scripts/verifier-barres-basses.mjs --prefixe=avant
//     « avant » documente le bug (ancien dist/), « apres » la preuve du correctif.
//     Les captures ne sont jamais mélangées : seules celles du préfixe en cours sont
//     effacées au démarrage.
//   Mise au point rapide (le déroulé complet dure plusieurs minutes) :
//     node scripts/verifier-barres-basses.mjs --conditions=texte-agrandi --ecrans=profil

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const RACINE = join(ICI, '..');
const DIST = join(RACINE, 'dist');
const SORTIE = join(RACINE, 'captures-barres');
const PORT = 9457; // serveur local (application construite)
const PORT_CDP = 9458; // débogage Chrome
const ADRESSE = `http://127.0.0.1:${PORT}`;
// L'application construite est servie sous le chemin de déploiement (base Vite,
// ici « /rejoins-moi ») : le préfixe est lu dans dist/index.html, jamais deviné.
let ORIGINE = ADRESSE;
const PREFIXE = (process.argv.find((a) => a.startsWith('--prefixe=')) || '--prefixe=apres').split('=')[1];
// Filtres de mise au point (le déroulé complet dure plusieurs minutes) :
//   node scripts/verifier-barres-basses.mjs --conditions=texte-agrandi --ecrans=profil
// Le rapport indique toujours ce qui a réellement été joué.
const optionDe = (nom) => ((process.argv.find((a) => a.startsWith(`--${nom}=`)) || '').split('=')[1] || '');
const FILTRE_CONDITIONS = optionDe('conditions');
const FILTRE_ECRANS = optionDe('ecrans');
const retenu = (valeur, filtreTexte) => !filtreTexte || filtreTexte.split(',').includes(valeur);
// L'exigence du correctif, telle qu'elle a été formulée : au moins 16px entre le
// bord bas du dernier élément et le haut du bloc fixe.
const MARGE_EXIGEE = 16;

let echecs = 0;
let reussis = 0;
function verifier(intitule, ok, detail = '') {
  if (ok) {
    reussis += 1;
    console.log(`  ✓ ${intitule}${detail ? ` — ${detail}` : ''}`);
  } else {
    echecs += 1;
    console.log(`  ✗ ${intitule}${detail ? ` — ${detail}` : ''}`);
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const arrondi = (v) => Math.round(v * 10) / 10;

// ── 1) Ce que le PAQUET livré (et les sources) contiennent ──────────────────
console.log(`\n▶ Barres basses (${PREFIXE}) : preuves dans le paquet livré`);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('\ndist/ absent : construire d’abord (npm run build).');
  process.exit(1);
}
const paquets = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')) : [];
const fichierCss = paquets.find((f) => f.endsWith('.css'));
const fichierJs = paquets.find((f) => /^index-.*\.js$/.test(f));
const css = fichierCss ? readFileSync(join(DIST, 'assets', fichierCss), 'utf8') : '';
const js = fichierJs ? readFileSync(join(DIST, 'assets', fichierJs), 'utf8') : '';
const lireSource = (chemin) => readFileSync(join(RACINE, chemin), 'utf8');
// Les commentaires sont retirés avant les vérifications de source : ils racontent
// l'ancien bug (« c'était un bottom-[68px] écrit en dur ») et feraient échouer le
// contrôle du correctif qui les explique. On vérifie le CODE, pas le récit.
const sansCommentaire = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sourceInscription = sansCommentaire(lireSource('src/pages/RegisterEstablishment.jsx'));
const sourceFiche = sansCommentaire(lireSource('src/pages/EstablishmentProfile.jsx'));
const sourceNav = sansCommentaire(lireSource('src/components/BottomNav.jsx'));
const cssSerre = css.replace(/\s+/g, '');

verifier(
  'plus aucune hauteur de barre écrite en dur dans l’inscription',
  !sourceInscription.includes('bottom-[68px]') && !sourceInscription.includes('safe-area-inset'),
  'ni bottom-[68px], ni marge de barre système recopiée'
);
verifier(
  'la fiche ne colle plus sa barre au bas de la fenêtre',
  !sourceFiche.includes('fixed inset-x-0 bottom-0') && sourceFiche.includes('<BarreActionFixe>')
);
verifier(
  'les deux écrans à barre fixe passent par le MÊME composant',
  sourceInscription.includes('BarreActionFixe') && sourceFiche.includes('BarreActionFixe')
);
verifier(
  'la navigation publie sa hauteur mesurée',
  sourceNav.includes('useMesureNavBas') && sourceNav.includes('nav-basse')
);
verifier(
  'le CSS livré réserve l’espace avec la hauteur MESURÉE',
  cssSerre.includes('padding-bottom:calc(var(--hauteur-bloc-bas'),
  'padding-bottom du corps = --hauteur-bloc-bas + marge'
);
verifier(
  'plus aucune réserve de bas d’écran écrite en dur dans le CSS livré',
  !cssSerre.includes('padding-bottom:calc(64px') && !cssSerre.includes('calc(92px')
);
verifier(
  'les deux classes du bloc sont produites dans le CSS livré',
  cssSerre.includes('.nav-basse{') && cssSerre.includes('.barre-action-fixe{')
);
verifier(
  'la mesure est bien embarquée dans le JS livré',
  js.includes('--hauteur-bloc-bas') && js.includes('ResizeObserver'),
  `paquet ${fichierJs}`
);

// ── 2) Serveur local du `dist/` : l'application est testée telle qu'elle est publiée ──
// Le chemin de déploiement est celui écrit dans dist/index.html (base Vite) : c'est
// lui qui compte pour les captures et pour l'application elle-même (BrowserRouter).
const htmlIndex = readFileSync(join(DIST, 'index.html'), 'utf8');
const trouveAssets = htmlIndex.match(/src="([^"]*\/assets\/[^"]+)"/);
const PREFIXE_URL = trouveAssets ? trouveAssets[1].replace(/\/assets\/.*$/, '') : '';
ORIGINE = `${ADRESSE}${PREFIXE_URL}`;
console.log(`  · application servie sur ${ORIGINE}/ (comme en production)`);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const serveur = createServer((requete, reponse) => {
  let chemin = decodeURIComponent(new URL(requete.url, ADRESSE).pathname);
  // Le chemin de déploiement (« /rejoins-moi ») est retiré : les fichiers vivent à
  // la racine de dist/, exactement comme sur l'hébergement.
  if (PREFIXE_URL && chemin.startsWith(PREFIXE_URL)) {
    chemin = chemin.slice(PREFIXE_URL.length) || '/';
  }
  let fichier = join(DIST, chemin === '/' ? 'index.html' : chemin);
  // L'application est une page unique : toute route inconnue rend index.html.
  if (!fichier.startsWith(DIST) || !existsSync(fichier) || statSync(fichier).isDirectory()) {
    fichier = join(DIST, 'index.html');
  }
  reponse.setHeader('Content-Type', TYPES[extname(fichier)] || 'application/octet-stream');
  createReadStream(fichier).pipe(reponse);
});
await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));

// ── 3) Chrome jetable + client CDP (même approche que verifier-permissions.mjs) ──
const CHROMES_CONNUS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const CHROME = process.env.CHROME_PATH || CHROMES_CONNUS.find((chemin) => chemin && existsSync(chemin));
if (!CHROME) {
  console.error('\nChrome introuvable : indiquez son chemin (CHROME_PATH="…"). La preuve doit être faite dans un vrai navigateur.');
  process.exit(1);
}

// Les captures d'un essai précédent du MÊME préfixe ne doivent pas se mêler à
// celles-ci : celles de l'autre préfixe (avant/apres) sont conservées.
mkdirSync(SORTIE, { recursive: true });
for (const fichier of readdirSync(SORTIE)) {
  if (fichier.startsWith(`${PREFIXE}-`)) {
    try {
      rmSync(join(SORTIE, fichier), { force: true, maxRetries: 6, retryDelay: 250 });
    } catch {
      /* Windows peut refuser tant que le Chrome précédent relâche ses verrous */
    }
  }
}
const PROFIL = join(process.env.TEMP || '.', `chrome-cdp-barres-${process.pid}`);
const effacerProfil = () => {
  try {
    rmSync(PROFIL, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  } catch {
    /* Chrome tient encore un fichier : dossier jetable, sans importance */
  }
};

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=390,844',
    `--user-data-dir=${PROFIL}`,
    `--remote-debugging-port=${PORT_CDP}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

async function attendreCdp(maxMs = 20000) {
  const debut = Date.now();
  while (Date.now() - debut < maxMs) {
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`);
      if (reponse.ok) return reponse.json();
    } catch {
      /* pas encore prêt */
    }
    await pause(300);
  }
  throw new Error('CDP indisponible');
}

/** Client minimal du protocole DevTools, avec session de page (« flatten »). */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.attentes = new Map();
    ws.addEventListener('message', (evenement) => {
      const message = JSON.parse(evenement.data);
      if (message.id && this.attentes.has(message.id)) {
        const { resolve, reject } = this.attentes.get(message.id);
        this.attentes.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.attentes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

const info = await attendreCdp();
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
const navigateur = new Cdp(ws);
const { targetId } = await navigateur.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await navigateur.send('Target.attachToTarget', { targetId, flatten: true });
console.log(`  · Chrome ${info.Browser} conduit par CDP (port ${PORT_CDP})`);

/** Petite façade de page : évaluation, attente de condition, clic par libellé. */
const page = {
  cible: targetId,
  session: sessionId,
  send: (method, params) => navigateur.send(method, params, sessionId),

  async evaluer(expression) {
    const resultat = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (resultat.exceptionDetails) {
      throw new Error(`Évaluation en échec : ${resultat.exceptionDetails.text}`);
    }
    return resultat.result.value;
  },

  /** Attend qu'une condition écrite en JS devienne vraie (sinon on le signale). */
  async jusqua(condition, { maxMs = 12000, pas = 150 } = {}) {
    const debut = Date.now();
    while (Date.now() - debut < maxMs) {
      try {
        if (await this.evaluer(`Boolean(${condition})`)) return true;
      } catch {
        /* document en cours de remplacement pendant une navigation */
      }
      await pause(pas);
    }
    return false;
  },

  /** Clique le premier bouton/lien dont le libellé contient `libelle`. */
  async cliquer(libelle) {
    const fait = await this.evaluer(`(() => {
      const cible = ${JSON.stringify(libelle)};
      const trouvables = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = trouvables.find((n) => (n.innerText || '').replace(/\\s+/g, ' ').includes(cible));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 40);
    })()`);
    if (!fait) throw new Error(`aucun élément cliquable ne contient « ${libelle} »`);
    await pause(500);
    return fait;
  },

  /** Ouvre un chemin de l'application et attend que le contenu soit là. */
  async charger(chemin, { pret } = {}) {
    // Au TOUT premier chargement (profil Chrome neuf, paquet lu du disque), l'app
    // peut mettre plus longtemps que prévu : on retente une fois plutôt que de
    // déclarer l'écran inaccessible — un faux échec ne prouve rien.
    for (let essai = 1; essai <= 2; essai += 1) {
      await this.send('Page.navigate', { url: `${ORIGINE}${chemin}` });
      const rendu = await this.jusqua("document.querySelector('#root') && document.querySelector('#root').children.length > 0", { maxMs: 20000 });
      if (rendu) {
        // Taille de texte du téléphone : ELLE EST REPOSÉE APRÈS CHAQUE CHARGEMENT.
        // Le script d'injection de Chrome (Page.addScriptToEvaluateOnNewDocument)
        // n'a aucun effet dans ce montage piloté par CDP — constaté : la police
        // restait à 16px et le réglage en ligne était absent du document mesuré.
        // Un réglage posé une fois pour toutes ne survit pas non plus à la
        // navigation suivante. On le repose donc ici, et B0 vérifie qu'il a suivi.
        if (policeEnCours !== 100) {
          await this.evaluer(`document.documentElement.style.fontSize = '${policeEnCours}%'`);
        }
        await pause(900); // données de démonstration / appels API de l'écran
        if (pret) await this.jusqua(pret, { maxMs: 15000 });
        await pause(300);
        return chemin;
      }
    }
    throw new Error(`l'application n'a pas rendu ${chemin}`);
  },

  async texte() {
    return this.evaluer("document.querySelector('#root') ? document.querySelector('#root').innerText : ''");
  },

  /** Capture pleine page de la fenêtre courante (PNG) dans captures-barres/. */
  async capturer(nom) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const fichier = join(SORTIE, `${PREFIXE}-${nom}.png`);
    writeFileSync(fichier, Buffer.from(data, 'base64'));
    return fichier;
  },
};

// Domaines nécessaires pour la suite (navigation + évaluation dans la page).
await page.send('Page.enable');
await page.send('Runtime.enable');

// ── 4) Relevé de géométrie, exécuté DANS la page ────────────────────────────
// Écrit comme une VRAIE fonction (et non comme une chaîne) : elle est envoyée au
// navigateur via `toString()`, ce qui évite tout problème d'échappement.
function releverGeometrie() {
  const arr = (v) => Math.round(v * 10) / 10;
  const boite = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { haut: arr(b.top), bas: arr(b.bottom), hauteur: arr(b.height) };
  };
  const nav = document.querySelector('.nav-basse');
  const barre = document.querySelector('.barre-action-fixe');
  const blocFixe = [nav, barre].filter(Boolean);
  const dansLeBloc = (el) => blocFixe.some((b) => b === el || b.contains(el));
  const estFige = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  };
  // Dernier élément de PAGE : le plus bas des éléments en flux, visibles, hors bloc
  // fixe et hors éléments flottants (bannière d'installation, feuille du « + »).
  let dernier = null;
  for (const el of document.querySelectorAll('#root *')) {
    if (dansLeBloc(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.height < 1 || b.width < 1) continue;
    if (dernier && b.bottom <= dernier.bas) continue;
    if (estFige(el)) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) continue;
    dernier = {
      balise: el.tagName.toLowerCase(),
      classe: String(el.className || '').slice(0, 56),
      bas: arr(b.bottom),
    };
  }
  // Haut réellement occupé par la navigation : son bouton « + » est remonté de 24px
  // au-dessus de sa boîte (classe -mt-6) et recouvre le contenu.
  let hautVisuel = nav ? arr(nav.getBoundingClientRect().top) : null;
  if (nav) {
    for (const el of nav.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && b.top >= 0) hautVisuel = Math.min(hautVisuel, arr(b.top));
    }
  }
  const racine = getComputedStyle(document.documentElement);
  const lireVar = (nom) => (racine.getPropertyValue(nom) || '').trim();
  const fond = (el) => (el ? getComputedStyle(el).backgroundColor : null);
  // Jointure barre/navigation : on demande au navigateur QUEL élément est
  // réellement sous chaque point de la zone. Si la page apparaît ici, l'interstice
  // du bug est revenu.
  const points = [];
  if (barre && nav) {
    const jointure = barre.getBoundingClientRect().bottom;
    const colonnes = [2, Math.round(innerWidth / 4), Math.round(innerWidth / 2), Math.round((innerWidth * 3) / 4), innerWidth - 2];
    const lignes = [jointure - 2, jointure - 1, jointure, jointure + 1, jointure + 2];
    for (const y of lignes) {
      for (const x of colonnes) {
        const el = document.elementFromPoint(x, y);
        let role = 'page';
        if (el && (el === nav || nav.contains(el))) role = 'nav';
        else if (el && (el === barre || barre.contains(el))) role = 'barre';
        points.push({
          x: x,
          y: arr(y),
          role: role,
          element: el ? el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 40) : 'aucun',
        });
      }
    }
  }
  const titre = document.querySelector('h1, h2');
  return {
    chemin: location.pathname + location.search,
    fenetre: { largeur: innerWidth, hauteur: innerHeight },
    // Taille de texte effective du document : sert à prouver que la condition
    // « texte agrandi du téléphone » est réellement appliquée à l'écran mesuré.
    police: getComputedStyle(document.documentElement).fontSize,
    // Réglage EN LIGNE posé par le banc d'essai : « (aucune) » signifie que la
    // condition d'essai n'est pas allée jusqu'au document (diagnostic).
    policePosee: document.documentElement.style.fontSize || '(aucune)',
    // Réserve de bas de page réellement appliquée, et géométrie du défilement :
    // permet d'expliquer une marge d'un dixième de pixel près (sous-pixel).
    reserve: getComputedStyle(document.body).paddingBottom,
    reserveBanniere: getComputedStyle(document.documentElement).getPropertyValue('--reserve-banniere').trim() || '0px',
    // Marge de la barre système réellement vue par le CSS : sans cette mesure, la
    // « barre gestuelle simulée » du banc d'essai resterait une intention.
    barreSysteme: (() => {
      const sonde = document.createElement('div');
      sonde.style.cssText = 'position:absolute;width:0;height:0;padding-bottom:env(safe-area-inset-bottom, 0px)';
      document.body.appendChild(sonde);
      const valeur = getComputedStyle(sonde).paddingBottom;
      sonde.remove();
      return valeur;
    })(),
    page: {
      hauteur: arr(document.documentElement.scrollHeight),
      fenetre: arr(document.documentElement.clientHeight),
      defilement: arr(window.scrollY),
      hauteurCorps: arr(document.body.scrollHeight),
    },
    titre: titre ? titre.innerText.replace(/\s+/g, ' ').slice(0, 48) : null,
    nav: boite(nav),
    barre: boite(barre),
    navHautVisuel: hautVisuel,
    dernier: dernier,
    fondBarre: fond(barre),
    fondNav: fond(nav),
    variables: {
      nav: lireVar('--hauteur-nav'),
      barre: lireVar('--hauteur-barre-action'),
      bloc: lireVar('--hauteur-bloc-bas'),
      marge: lireVar('--marge-securite-bas'),
    },
    attributs: {
      navBasse: document.documentElement.dataset.navBasse || null,
      barreAction: document.documentElement.dataset.barreAction || null,
      fond: document.documentElement.dataset.fond || null,
    },
    points: points,
  };
}

const RELEVE = `(${releverGeometrie.toString()})()`;

/** Lit la valeur d'une longueur CSS publiée (« 79px » → 79). */
const enPx = (valeur) => {
  const n = parseFloat(valeur);
  return Number.isFinite(n) ? n : NaN;
};

/** Un fond est opaque s'il n'a pas de canal alpha partiel (rgba(…, 0.95)). */
const estOpaque = (fond) => Boolean(fond) && !/rgba?\([^)]*,\s*0?\.\d+\s*\)/.test(fond);

let conditionEnCours = '';
/** Taille de texte du téléphone en cours (100 % ou 130 %) : vérifiée à l'écran. */
let policeEnCours = 100;
const rapport = [];

// ── 5) B6 — la hauteur est MESURÉE, donc elle SUIT (preuve du correctif) ─────
/**
 * Gonfle la navigation de 20px, comme le ferait une barre système ou un zoom de
 * police plus grands, et exige que la barre d'action ET la réserve d'espace
 * suivent. L'ancien `bottom-[68px]` n'aurait pas bougé d'un pixel : c'est la
 * différence entre une constante devinée et une hauteur mesurée.
 */
async function preuveDeMesure(nom) {
  const avant = await page.evaluer(RELEVE);
  if (!avant.nav || !avant.barre) {
    verifier(`${nom} · B6 la mesure suit la navigation (gonflage +20px)`, false, 'barre et navigation requises');
    return;
  }
  await page.evaluer(`(() => {
    const style = document.createElement('style');
    style.id = 'essai-mesure';
    style.textContent = '.nav-basse{padding-top:20px}';
    document.head.appendChild(style);
  })()`);
  await pause(700);
  await defilerEnBas();
  await pause(400);
  const apres = await page.evaluer(RELEVE);
  await page.capturer(`${nom}-gonflee-20px-${conditionEnCours}`);
  // La gonflette est retirée aussitôt : les écrans suivants sont jugés dans les
  // conditions normales (certains s'enchaînent sans recharger la page).
  await page.evaluer("document.querySelector('#essai-mesure')?.remove()");
  await pause(400);

  const grandie = arrondi(apres.nav.hauteur - avant.nav.hauteur);
  const ecart = arrondi(apres.barre.bas - apres.nav.haut);
  const reserve = arrondi(enPx(apres.variables.bloc) - enPx(avant.variables.bloc));
  const marge = apres.dernier ? arrondi(apres.barre.haut - apres.dernier.bas) : -999;
  verifier(`${nom} · B6 la navigation grandit de 20px`, Math.abs(grandie - 20) <= 1, `${avant.nav.hauteur}px → ${apres.nav.hauteur}px`);
  verifier(`${nom} · B6 la barre a SUIVI la navigation (toujours un seul bloc)`, Math.abs(ecart) <= 1, `écart ${ecart}px après gonflage`);
  verifier(`${nom} · B6 la réserve d'espace a suivi`, Math.abs(reserve - grandie) <= 1, `${avant.variables.bloc} → ${apres.variables.bloc}`);
  verifier(`${nom} · B6 le contenu reste ≥ ${MARGE_EXIGEE}px au-dessus du bloc gonflé`, marge >= MARGE_EXIGEE, `marge ${marge}px`);

  await page.evaluer("document.getElementById('essai-mesure')?.remove()");
  await pause(400);
}

// ── 6) Les 9 écrans, atteints en suivant le parcours réel d'un utilisateur ───
/** Clique un bouton repéré dans la page par une fonction de recherche dédiée. */
async function cliquerPar(description, recherche, rang = 0) {
  const fait = await page.evaluer(`(() => {
    const recherche = ${recherche.toString()};
    const candidats = [...document.querySelectorAll('#root button')].filter(
      (b) => !b.closest('.barre-action-fixe') && !b.closest('.nav-basse')
    );
    const el = candidats.filter(recherche)[${rang}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 32);
  })()`);
  if (!fait) throw new Error(`clic impossible : ${description}`);
  await pause(600);
  console.log(`     · clic « ${fait} » (${description})`);
  return fait;
}

/** Pastille de catégorie de l'étape « Produits » (dans le bloc de son titre). */
function estChipCategorie(bouton) {
  const titre = [...document.querySelectorAll('p')].find((n) => (n.textContent || '').includes('Cat'));
  return Boolean(titre) && titre.parentElement.contains(bouton);
}

/** Pastilles de produits/services de l'étape « Produits ». */
function estPastilleProduit(bouton) {
  const titre = [...document.querySelectorAll('p')].find((n) => (n.textContent || '').includes('Vos produits'));
  return Boolean(titre) && titre.closest('div').parentElement.contains(bouton);
}

/** L'écran d'entrée de l'inscription : la question, navigation seule. */
async function allerQuestion() {
  await page.charger('/inscription', { pret: "document.querySelector('#root').innerText.includes('Avez-vous un')" });
}

/** Attend l'apparition de la barre d'action (étapes de l'inscription, fiche). */
async function attendreBarre(ou) {
  const pret = await page.jusqua("Boolean(document.querySelector('.barre-action-fixe'))", { maxMs: 15000 });
  if (!pret) throw new Error(`la barre d'action n'est pas apparue sur ${ou}`);
}

/** Ouvre une fiche établissement depuis le feed (écran plein : sans navigation). */
async function allerFiche() {
  await page.charger('/', { pret: `Boolean(document.querySelector("[href*='/etablissement/']"))` });
  const lien = await page.evaluer(`(() => {
    const a = document.querySelector('#root a[href*="/etablissement/"]');
    if (!a) return null;
    a.scrollIntoView({ block: 'center' });
    a.click();
    return a.getAttribute('href');
  })()`);
  if (!lien) throw new Error('aucune fiche à ouvrir depuis le feed');
  await attendreBarre('la fiche');
  await pause(700);
  return lien;
}

const ECRANS = [
  { nom: 'inscription-question', avecBarre: false, aller: allerQuestion },
  {
    nom: 'inscription-photos',
    avecBarre: true,
    // L'étape du bug signalé : barre + navigation + réserve d'espace.
    mesureSuit: true,
    aller: async () => {
      await allerQuestion();
      await page.cliquer('Oui, j');
      await attendreBarre('les photos');
    },
  },
  {
    nom: 'inscription-produits',
    avecBarre: true,
    aller: async () => {
      await page.cliquer('Suivant');
      await attendreBarre('les produits');
    },
  },
  {
    nom: 'inscription-infos',
    avecBarre: true,
    aller: async () => {
      await cliquerPar('catégorie de l’établissement', estChipCategorie);
      for (let i = 0; i < 3; i += 1) await cliquerPar(`produit ${i + 1}/3`, estPastilleProduit, i);
      await page.cliquer('Suivant');
      await attendreBarre('les informations pratiques');
    },
  },
  {
    nom: 'inscription-profil-simple',
    avecBarre: true,
    aller: async () => {
      await allerQuestion();
      await page.cliquer('Non, pas d');
      await attendreBarre('le profil simple');
    },
  },
  { nom: 'fiche-etablissement', avecBarre: true, aller: allerFiche },
  { nom: 'jobs', avecBarre: false, aller: () => page.charger('/jobs') },
  { nom: 'main-doeuvre', avecBarre: false, aller: () => page.charger('/main-doeuvre?mode=poster') },
  { nom: 'profil', avecBarre: false, aller: () => page.charger('/profil') },
].filter((e) => retenu(e.nom, FILTRE_ECRANS));

// Les trois conditions d'essai, calquées sur de vrais téléphones Android :
//   · le gabarit courant (Pixel/Samsung récents) ;
//   · un petit gabarit, qui laisse moins de place et serre les marges ;
//   · le gabarit courant AVEC le texte agrandi du téléphone (Accessibilité →
//     « Taille du texte ») : c'est là que les hauteurs écrites en dur lâchaient.
const CONDITIONS = [
  { nom: 'telephone-standard', largeur: 390, hauteur: 844, police: 100 },
  { nom: 'petit-telephone', largeur: 360, hauteur: 740, police: 100 },
  { nom: 'texte-agrandi', largeur: 390, hauteur: 844, police: 130 },
].filter((c) => retenu(c.nom, FILTRE_CONDITIONS));

// ── 7) Déroulé : 3 conditions × 9 écrans ────────────────────────────────────
let margeSysteme = 'non simulée';
try {
  for (const condition of CONDITIONS) {
    conditionEnCours = condition.nom;
    console.log(`\n▶ ${condition.nom} — ${condition.largeur}×${condition.hauteur} px, police ${condition.police} %`);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: condition.largeur,
      height: condition.hauteur,
      deviceScaleFactor: 2,
      mobile: true,
    });
    // Taille du texte du téléphone (≈ « Taille du texte » d'Android) : les tailles en
    // rem suivent, celles écrites en px non — l'essai est donc plus pessimiste.
    // Le réglage est posé ici ET reposé après chaque chargement (méthode `charger`) :
    // page.charger remet la police en place car l'injection de script de Chrome n'a
    // aucun effet dans ce montage (constaté), et B0 vérifie que la police a suivi.
    policeEnCours = condition.police;
    await page.evaluer(`document.documentElement.style.fontSize = '${condition.police}%'`);
    // Barre de navigation gestuelle Android (≈ 34px) : env(safe-area-inset-bottom).
    try {
      await page.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, left: 0, right: 0, bottom: 34 },
      });
      margeSysteme = '34px (barre gestuelle simulée)';
    } catch {
      margeSysteme = 'non simulable dans ce Chrome (marge système = 0)';
    }
    await pause(500);

    for (const ecran of ECRANS) {
      try {
        await ecran.aller();
        const releve = await controler(ecran.nom, ecran);
        if (ecran.mesureSuit && releve.barre && releve.nav) await preuveDeMesure(ecran.nom);
      } catch (erreur) {
        echecs += 1;
        console.log(`  ✗ ${ecran.nom} · écran non atteint : ${erreur.message}`);
      }
    }
  }
} finally {
  // Le relevé complet est écrit à côté des captures : c'est la trace chiffrée du
  // correctif (positions, marges, variables publiées) pour la relecture.
  writeFileSync(
    join(SORTIE, `rapport-${PREFIXE}.json`),
    JSON.stringify({ prefixe: PREFIXE, quand: new Date().toISOString(), margeSysteme, conditions: CONDITIONS, ecrans: rapport }, null, 2),
    'utf8'
  );
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`Captures et relevés : ${SORTIE}`);
  if (echecs === 0) {
    console.log(`✓ ${reussis} vérifications réussies : bloc du bas posé, uni, opaque, mesuré — et il suit.`);
  } else {
    console.log(`✗ ${echecs} échec(s) sur ${reussis + echecs} vérifications.`);
  }
  process.exitCode = echecs === 0 ? 0 : 1;
  try {
    ws.close();
  } catch {
    /* connexion déjà fermée */
  }
  chrome.kill();
  serveur.close();
  await pause(800);
  effacerProfil();
}

/**
 * Descend tout en bas de la page, et y RESTE.
 * Un seul « descends » ne suffit pas : certaines listes (Jobs) s'allongent en cours
 * de route (contenu ajouté après le défilement), et la position reste alors bloquée
 * en haut du nouveau contenu — le dernier élément se retrouve 500px sous le bloc et
 * la mesure échoue pour une mauvaise raison (constaté en 360×740). On redescend
 * donc jusqu'à ce que la position soit stable ET collée au bas.
 */
async function defilerEnBas() {
  const etat = () =>
    page.evaluer('({ y: window.scrollY, h: document.documentElement.scrollHeight, f: window.innerHeight })');
  let precedent = await etat();
  for (let essai = 0; essai < 8; essai += 1) {
    await page.evaluer("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })");
    await pause(350);
    const courant = await etat();
    // Arrivé en bas : le bas de la fenêtre touche le bas de la page, et la page ne
    // s'est plus allongée depuis le tour précédent.
    if (courant.y + courant.f >= courant.h - 1 && Math.abs(courant.y - precedent.y) < 1) return courant;
    precedent = courant;
  }
  return precedent;
}

/**
 * Vérifie le bloc fixe de l'écran affiché, AU BAS DU DÉFILEMENT : c'est là que le
 * bug se voyait (la fin du contenu passait sous la barre), et c'est donc là que la
 * marge du dernier élément se mesure.
 */
async function controler(nom, { avecBarre }) {
  await defilerEnBas();
  await pause(300);
  const r = await page.evaluer(RELEVE);
  await page.capturer(`${nom}-${conditionEnCours}`);
  rapport.push({ ecran: nom, condition: conditionEnCours, capture: `${PREFIXE}-${nom}-${conditionEnCours}.png`, ...r });
  console.log(`\n  ── ${nom} (${conditionEnCours}) · ${r.chemin} · « ${r.titre || '?'} »`);

  const attenduPresent = avecBarre ? Boolean(r.barre) : Boolean(r.nav);
  verifier(
    `${nom} · le bloc fixe attendu est à l'écran`,
    attenduPresent,
    avecBarre ? 'barre d’action + navigation mesurées' : 'navigation mesurée'
  );
  if (!attenduPresent) return r;

  // B0 — la condition d'essai est bien celle annoncée : c'est ce qui donne sa valeur
  // au reste (un « texte agrandi » non appliqué ne prouverait rien).
  const policeAttendue = (16 * policeEnCours) / 100;
  verifier(
    `${nom} · B0 la taille de texte du téléphone (${policeEnCours} %) est appliquée`,
    Math.abs(enPx(r.police) - policeAttendue) <= 0.5,
    `police de base mesurée ${r.police} (attendu ${policeAttendue}px, réglage en ligne « ${r.policePosee} »)`
  );

  // B0b — la barre système du téléphone est bien simulée (sinon tout l'essai porte
  // sur un téléphone sans barre gestuelle, et ne prouve plus grand-chose).
  if (margeSysteme.includes('simulée')) {
    verifier(
      `${nom} · B0b la marge de la barre système est bien vue par le CSS`,
      Math.abs(enPx(r.barreSysteme) - 34) <= 0.5,
      `env(safe-area-inset-bottom) = ${r.barreSysteme} (attendu 34px)`
    );
  }

  // B1 — un seul bloc : la barre est posée sur le haut RÉEL de la navigation.
  if (r.barre && r.nav) {
    const ecart = arrondi(r.barre.bas - r.nav.haut);
    verifier(
      `${nom} · B1 la barre est POSÉE sur la navigation (écart nul)`,
      Math.abs(ecart) <= 1,
      `bas barre ${r.barre.bas} / haut nav ${r.nav.haut} → écart ${ecart}px`
    );
    // B2 — aucun contenu de page visible dans la jointure.
    const intrus = r.points.filter((p) => p.role === 'page');
    verifier(
      `${nom} · B2 aucun contenu visible dans la jointure`,
      intrus.length === 0,
      intrus.length
        ? `${intrus.length}/${r.points.length} points laissent voir la page (ex. ${intrus[0].element} à y=${intrus[0].y})`
        : `${r.points.length} points sondés, tous dans le bloc`
    );
  }

  // B3 — fonds opaques : rien du contenu ne transparaît dans le bloc.
  const fonds = [r.barre ? ['barre', r.fondBarre] : null, r.nav ? ['navigation', r.fondNav] : null].filter(Boolean);
  verifier(
    `${nom} · B3 les fonds du bloc sont opaques`,
    fonds.every(([, f]) => estOpaque(f)),
    fonds.map(([qui, f]) => `${qui} ${f}`).join(' / ')
  );

  // B4a — préalable : la page est bien DÉFILÉE jusqu'en bas. Sans cela, la marge
  // mesurée ne dit rien (le dernier élément est simplement plus bas, hors écran).
  if (r.page.defilement + r.page.fenetre < r.page.hauteur - 1) {
    verifier(
      `${nom} · B4a le défilement a atteint le bas de la page`,
      false,
      `position ${r.page.defilement} + fenêtre ${r.page.fenetre} < page ${r.page.hauteur}`
    );
  }

  // B4 — le dernier élément de page reste AU-DESSUS du bloc, marge visible comprise.
  // La mesure se fait au défilement maximal, que Chrome arrondit au pixel près
  // (scrollHeight est un entier) : la marge peut donc apparaître plus courte de
  // moins d'1px sans que la réserve soit insuffisante. La réserve elle-même, exacte
  // et sans arrondi, est contrôlée juste en dessous (B4b).
  const hautDuBloc = r.barre ? r.barre.haut : r.navHautVisuel;
  const marge = r.dernier ? arrondi(hautDuBloc - r.dernier.bas) : -999;
  verifier(
    `${nom} · B4 le dernier élément reste ≥ ${MARGE_EXIGEE}px au-dessus du bloc`,
    marge >= MARGE_EXIGEE - 1,
    r.dernier
      ? `${r.dernier.balise}.${r.dernier.classe} bas ${r.dernier.bas} / haut du bloc ${arrondi(hautDuBloc)} → marge ${marge}px · réserve ${r.reserve} · page ${r.page.hauteur}/${r.page.fenetre} défilée ${r.page.defilement}`
      : 'aucun élément de page détecté'
  );

  // B4b — la réserve du bas de page (padding du corps) vaut EXACTEMENT la hauteur
  // mesurée du bloc + la marge exigée : c'est la garantie chiffrée de B4, à l'abri
  // des arrondis d'affichage.
  const reserveAttendue = enPx(r.variables.bloc) + MARGE_EXIGEE + enPx(r.reserveBanniere);
  verifier(
    `${nom} · B4b la réserve du corps vaut la hauteur du bloc + ${MARGE_EXIGEE}px`,
    Math.abs(enPx(r.reserve) - reserveAttendue) <= 0.5,
    `réserve ${r.reserve} = bloc ${r.variables.bloc} + marge ${MARGE_EXIGEE}px${
      enPx(r.reserveBanniere) ? ` + bannière ${r.reserveBanniere}` : ''
    }`
  );

  // B5 — la hauteur publiée est bien la hauteur RÉELLE du bloc dessiné.
  const attendue =
    r.barre && r.nav
      ? arrondi(r.nav.hauteur + r.barre.hauteur)
      : r.barre
        ? r.barre.hauteur
        : arrondi(r.fenetre.hauteur - r.navHautVisuel);
  verifier(
    `${nom} · B5 --hauteur-bloc-bas = hauteur réelle du bloc`,
    Math.abs(enPx(r.variables.bloc) - attendue) <= 1,
    `publié ${r.variables.bloc} / mesuré ${attendue}px (nav ${r.variables.nav}, barre ${r.variables.barre})`
  );
  if (r.nav) {
    verifier(
      `${nom} · B5b --hauteur-nav = boîte réelle de la navigation`,
      Math.abs(enPx(r.variables.nav) - r.nav.hauteur) <= 1,
      `publié ${r.variables.nav} / mesuré ${r.nav.hauteur}px`
    );
  }
  return r;
}
