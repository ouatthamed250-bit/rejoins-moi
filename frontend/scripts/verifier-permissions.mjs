// verifier-permissions.mjs — preuve de l'autorisation de localisation (bloc B).
//
// CE QU'ON VÉRIFIE, ET POURQUOI ICI
// Deux plaintes de terrain motivent ce bloc :
//   a. « On m'a demandé la localisation sans explication, j'ai refusé, et depuis je
//      n'ai plus jamais de distance. » L'appel partait au chargement, à chaque
//      visite : une fois le refus enregistré, il échouait instantanément et
//      l'utilisateur n'avait plus AUCUN moyen d'obtenir des distances.
//   b. « Sur mon iPhone, ça ne demande jamais rien » : Safari exige un geste.
// La règle corrigée (« lire l'autorisation AVANT d'appeler ») ne se prouve pas en
// relisant le code : il faut un vrai navigateur, avec une autorisation réellement
// refusée / accordée / jamais demandée. Ce script pilote donc le Chrome de la
// machine via le protocole DevTools (CDP) — même outillage que capture-ecrans.mjs,
// aucune dépendance ajoutée — et sert le `dist/` construit localement.
//
// Les autorisations sont imposées par CDP (`Browser.setPermission`) : c'est le
// navigateur lui-même qui répond, pas une simulation dans la page. La page, elle,
// compte les appels réellement faits à `navigator.geolocation.getCurrentPosition`
// (injection avant le chargement du script de l'application).
//
// PREUVE ATTENDUE
//   T1 refus enregistré      → 0 appel GPS, marche à suivre précise, repli carte ;
//   T2 accordé               → appel automatique (non-régression), position stockée ;
//   T3 jamais demandé        → 0 appel au chargement, exactement 1 après le geste ;
//   T4 repli carte           → repère déplaçable, attribution OpenStreetMap visible,
//                              point choisi = point stocké, et il survit au rechargement ;
//   T4ter GPS disponible      → le repère démarre sur la mesure, pas sur le centre ;
//   T5 autorisé entre-temps  → position obtenue SANS aucun clic ;
//   T6 inscription (bloc B2) → un refus n'empêche plus d'inscrire un établissement :
//                              le point se place sur la carte, sans un seul appel GPS,
//                              et le compte puis la fiche PARTENT vraiment (API
//                              bouchonnée : on lit les requêtes réellement émises).
//
// Usage : npm run verifier:permissions   (construire `dist/` avant : npm run build)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const RACINE = join(ICI, '..');
const DIST = join(RACINE, 'dist');
const SORTIE = join(RACINE, 'captures-permissions');
const PORT = 9455; // serveur local (page de test)
const PORT_CDP = 9456; // débogage Chrome
// L'application PUBLIÉE est servie sous son chemin de déploiement (base Vite
// « /rejoins-moi », cf. `npm run build:pages`). Le serveur de test doit donc servir
// SOUS ce préfixe : sinon le navigateur réclame /rejoins-moi/assets/*.js, reçoit
// index.html (text/html) à la place du module, l'application ne démarre jamais —
// page blanche, et des vérifications qui « passent » sans rien mesurer (0 appel GPS
// parce que le code n'a pas tourné). Le préfixe est lu dans dist/index.html, jamais
// deviné (même règle que verifier-barres-basses.mjs).
const ADRESSE = `http://127.0.0.1:${PORT}`;
// `ADRESSE` sert aussi d'ORIGINE au sens des permissions : `Browser.setPermission`
// refuse une origine contenant un chemin. `ORIGINE`, elle, est complétée par le
// préfixe dès que dist/index.html est lu (plus bas).
let ORIGINE = ADRESSE;
const POINT_GPS = { latitude: 5.3242, longitude: -4.0206, accuracy: 25 }; // Abidjan, Plateau

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

// ── 1) Ce que le PAQUET livré contient (aucun navigateur nécessaire) ─────────
// La règle « la carte ne pèse rien tant qu'on ne l'ouvre pas » se lit dans le build.
console.log('\n▶ Autorisation de localisation : preuves dans le paquet livré');

const paquets = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')) : [];
const jsPrincipal = paquets.find((f) => /^index-.*\.js$/.test(f));
const jsCarte = paquets.find((f) => /leaflet.*\.js$/.test(f));
const cssCarte = paquets.find((f) => /leaflet.*\.css$/.test(f));
if (!jsPrincipal) {
  console.error('\ndist/ absent ou incomplet : lancez `npm run build` avant ce script.');
  process.exit(1);
}
const sourcePrincipal = readFileSync(join(DIST, 'assets', jsPrincipal), 'utf8');
const poidsKo = (f) => Math.round(statSync(join(DIST, 'assets', f)).size / 1024);

verifier('le paquet initial ne contient PAS Leaflet', !/leaflet/i.test(sourcePrincipal), jsPrincipal);
verifier('il ne contient aucune adresse de tuiles', !sourcePrincipal.includes('tile.openstreetmap.org'));
verifier(
  'Leaflet part dans son propre fichier, chargé à la demande',
  Boolean(jsCarte) && Boolean(cssCarte),
  jsCarte ? `${jsCarte} (${poidsKo(jsCarte)} Ko)` : 'absent'
);
verifier(
  'la carte est donc un coût à l’ouverture, pas au démarrage',
  Boolean(jsCarte) && poidsKo(jsCarte) > 100,
  jsCarte ? `${poidsKo(jsCarte)} Ko` : '—'
);

const sourceHook = readFileSync(join(RACINE, 'src', 'hooks', 'useGeolocation.js'), 'utf8');
const sourceBandeau = readFileSync(join(RACINE, 'src', 'components', 'PromptLocalisation.jsx'), 'utf8');
const sourceModule = readFileSync(join(RACINE, 'src', 'utils', 'position.js'), 'utf8');
const occurrences = (texte, motif) => (texte.match(motif) || []).length;
const nbAppelsGps = occurrences(sourceHook, /getCurrentPosition\(/g);

verifier('un seul point d’appel au GPS dans tout le hook', nbAppelsGps === 1, `${nbAppelsGps} occurrence(s)`);
verifier(
  'ce point d’appel n’est atteint qu’après une décision',
  sourceHook.includes('decisionPosition(') && sourceModule.includes('export function decisionPosition')
);
verifier('le refus est constaté, jamais supposé', sourceHook.includes('etatPermissionGeo'));
verifier('le bandeau propose le repli par la carte', sourceBandeau.includes('Choisir sur la carte'));
verifier(
  'le bandeau donne la marche à suivre (Android et iPhone)',
  sourceBandeau.includes('Autorisations') && sourceBandeau.includes('Réglages → Safari')
);
verifier(
  'le point sur carte est annoncé comme un CHOIX, pas une mesure',
  sourceBandeau.includes('Ce n’est pas une mesure') && sourceBandeau.includes('GPS')
);
verifier('la carte n’est téléchargée qu’à l’ouverture', sourceBandeau.includes("lazy(() => import('./ChoisirPosition.jsx'))"));

// ── 2) Serveur local du `dist/` : l'app est testée telle qu'elle est publiée ─
// Le chemin de déploiement est celui écrit dans dist/index.html (base Vite) : c'est
// lui qui compte pour l'application elle-même (BrowserRouter) comme pour ses
// ressources (`/rejoins-moi/assets/...`).
const htmlIndex = readFileSync(join(DIST, 'index.html'), 'utf8');
const trouveAssets = htmlIndex.match(/src="([^"]*\/assets\/[^"]+)"/);
const PREFIXE_URL = trouveAssets ? trouveAssets[1].replace(/\/assets\/.*$/, '') : '';
ORIGINE = `${ADRESSE}${PREFIXE_URL}`;

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

// ── 3) Chrome jetable + client CDP (même approche que capture-ecrans.mjs) ────
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

// Les captures d'un essai précédent ne doivent pas se mêler à celles-ci. Windows
// peut refuser l'effacement tant que le Chrome précédent relâche ses verrous : reprises.
rmSync(SORTIE, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
mkdirSync(SORTIE, { recursive: true });
const PROFIL = join(process.env.TEMP || '.', `chrome-cdp-permissions-${process.pid}`);
const effacerProfil = () => {
  try {
    // Windows : Chrome relâche les verrous du profil par vagues, d'où les reprises
    // (`maxRetries` attend entre deux tentatives au lieu d'abandonner au premier échec).
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
    // Écouteurs d'ÉVÉNEMENTS (messages sans `id`). Sans eux, `Fetch.requestPaused`
    // resterait sans réponse et les requêtes bouchonnées pendraient : c'est ce
    // mécanisme qui permet la preuve d'envoi de la T6.
    this.ecouteurs = new Map();
    ws.addEventListener('message', (evenement) => {
      const message = JSON.parse(evenement.data);
      if (message.id && this.attentes.has(message.id)) {
        const { resolve, reject } = this.attentes.get(message.id);
        this.attentes.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (!message.method) return;
      for (const rappel of this.ecouteurs.get(message.method) || []) {
        // Un écouteur ne doit jamais faire mourir le script : on signale et on continue.
        try {
          rappel(message.params, message.sessionId);
        } catch (err) {
          console.error(`  [CDP] écouteur « ${message.method} » en échec : ${err?.message || err}`);
        }
      }
    });
  }

  /** Abonne un écouteur à un événement CDP (ex. « Fetch.requestPaused »). */
  sur(methode, rappel) {
    if (!this.ecouteurs.has(methode)) this.ecouteurs.set(methode, []);
    this.ecouteurs.get(methode).push(rappel);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.attentes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

const version = await attendreCdp();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
const navigateur = new Cdp(ws);
const { targetId } = await navigateur.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await navigateur.send('Target.attachToTarget', { targetId, flatten: true });

const page = {
  send: (method, params) => navigateur.send(method, params, sessionId),
  async evaluer(expression) {
    const reponse = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reponse.exceptionDetails) throw new Error(JSON.stringify(reponse.exceptionDetails));
    return reponse.result.value;
  },
};

/** Compte les appels réellement faits au GPS : injecté AVANT le script de l'app. */
const INSTRUMENTATION = `(() => {
  window.__appelsGeo = [];
  const geo = navigator.geolocation;
  if (geo && geo.getCurrentPosition) {
    const vrai = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = function (...args) {
      window.__appelsGeo.push(Date.now());
      return vrai(...args);
    };
  }
})();`;
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENTATION });
await page.send('Page.enable');
await page.send('Runtime.enable');

// ── 4) Outils de pilotage de la page ────────────────────────────────────────
async function jusqua(expression, { maxMs = 20000, pas = 200 } = {}) {
  const debut = Date.now();
  while (Date.now() - debut < maxMs) {
    let valeur = null;
    try {
      valeur = await page.evaluer(expression);
    } catch {
      valeur = null;
    }
    if (valeur) return valeur;
    await pause(pas);
  }
  return null;
}

const texte = () => page.evaluer('document.body ? document.body.innerText : ""');
// Route de l'application, PRÉFIXE DE DÉPLOIEMENT RETIRÉ : l'application tourne sous
// « /rejoins-moi » (base Vite), donc `location.pathname` vaut « /rejoins-moi/inscription ».
// Comparer ce chemin à « /inscription » faisait échouer des vérifications pourtant
// justes : c'est le préfixe qu'on lit ici, jamais la route qu'on suppose.
const EXPR_CHEMIN_APP = `(() => {
  const p = location.pathname;
  const prefixe = ${JSON.stringify(PREFIXE_URL)};
  return prefixe && p.startsWith(prefixe) ? (p.slice(prefixe.length) || '/') : p;
})()`;
const cheminApp = () => page.evaluer(EXPR_CHEMIN_APP);
const appelsGps = () => page.evaluer('Array.isArray(window.__appelsGeo) ? window.__appelsGeo.length : -1');
const positionStockee = () =>
  page.evaluer('(() => { try { return JSON.parse(localStorage.getItem("rejoinsmoi.position") || "null"); } catch { return "ILLISIBLE"; } })()');
const permissionVue = () =>
  page.evaluer('navigator.permissions.query({ name: "geolocation" }).then((s) => s.state).catch(() => "inconnue")');

/** Point annoncé à l'écran par le sélecteur de carte (« Point choisi : 5.32420, -4.02060 »). */
async function pointAffiche() {
  const contenu = await texte();
  const trouve = contenu.match(/Point choisi\s*:\s*(-?[\d.]+)[,.]?\s*(-?[\d.]+)?/);
  if (!trouve) return null;
  return { lat: Number(trouve[1]), lng: Number(trouve[2]) };
}

/** Clique un bouton par son libellé (l'application n'expose pas de `data-testid`). */
function cliquer(libelle) {
  return page.evaluer(`(() => {
    const bouton = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(libelle)}));
    if (!bouton) return false;
    bouton.click();
    return true;
  })()`);
}

async function capture(nom) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SORTIE, `${nom}.png`), Buffer.from(data, 'base64'));
}

/**
 * Ouvre l'application dans un état d'autorisation donné. Deux navigations : la
 * première pour être sur l'origine (et pouvoir vider la mémoire locale de la
 * position), la seconde pour un démarrage réellement à froid, comme une nouvelle
 * visite sur le téléphone.
 */
async function charger({ permission = null, gps = true, garderMemoire = false, point = POINT_GPS } = {}) {
  if (permission) {
    await navigateur.send('Browser.setPermission', {
      // `origin` au sens strict (schéma + hôte + port), sans le chemin de déploiement.
      origin: ADRESSE,
      permission: { name: 'geolocation' },
      setting: permission,
    });
  }
  // `point` permet de simuler une mesure ailleurs qu'au Plateau (carte centrée sur le GPS).
  if (gps) await page.send('Emulation.setGeolocationOverride', point);
  else await page.send('Emulation.clearGeolocationOverride');

  await page.send('Page.navigate', { url: `${ORIGINE}/` });
  await jusqua('document.querySelector("#root") && document.querySelector("#root").children.length > 0');
  if (!garderMemoire) await page.evaluer('localStorage.clear()');
  await page.send('Page.navigate', { url: `${ORIGINE}/` });
  // Une page blanche ne doit JAMAIS passer pour un succès : sans rendu, « aucun
  // appel au GPS » serait vrai par accident (le code n'a pas tourné). On le dit.
  const rendu = await jusqua('document.querySelector("#root") && document.querySelector("#root").children.length > 0');
  if (!rendu) {
    throw new Error(
      `l'application n'a rien rendu depuis ${ORIGINE}/ — vérifier le préfixe de build ` +
        `(base Vite « ${PREFIXE_URL || '/'} » lu dans dist/index.html) : les vérifications ` +
        'navigateur seraient sinon des faux positifs.'
    );
  }
  // 1,5 s : largement de quoi laisser un éventuel appel « au chargement » partir.
  await pause(1500);
}

console.log('\n▶ Même vérification dans un vrai navigateur (Chrome piloté par CDP)');
console.log(`  page servie depuis dist/ sur ${ORIGINE}  (préfixe de build : « ${PREFIXE_URL || '/'} »)\n`);

// ── T1) Le refus enregistré ne provoque plus AUCUN appel ────────────────────
console.log('1) Refus déjà enregistré : plus aucun appel, marche à suivre à l’écran');
{
  await charger({ permission: 'denied' });
  const vu = await permissionVue();
  const appels = await appelsGps();
  const contenu = await texte();
  await capture('1-refus-enregistre');
  verifier('le navigateur répond bien « refusé »', vu === 'denied', String(vu));
  verifier(
    'AUCUN appel au GPS au chargement (l’ancien code en faisait un à chaque visite)',
    appels === 0,
    `${appels} appel(s)`
  );
  verifier('l’écran le dit clairement', contenu.includes('Localisation bloquée pour ce site'));
  verifier(
    'il indique où débloquer (cadenas → Autorisations → Position)',
    contenu.includes('Autorisations') && /cadenas/i.test(contenu)
  );
  verifier('il donne aussi la marche à suivre iPhone', contenu.includes('Réglages → Safari'));
  verifier('il propose le repli immédiat par la carte', contenu.includes('Choisir sur la carte'));
}

/** Le repère : c'est LUI qui porte les coordonnées enregistrées (exigence B2). */
const SELECTEUR_REPERE = '.repere-position';

/** Boîte à l'écran d'un élément (son centre), pour le piloter comme un doigt. */
async function boiteDe(selecteur) {
  return page.evaluer(`(() => {
    const el = document.querySelector(${JSON.stringify(selecteur)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
}

/** Glisse un élément comme le ferait un doigt : appui, glissement, relâchement. */
async function glisser(selecteur, dx, dy) {
  const depart = await boiteDe(selecteur);
  if (!depart) return false;
  const souris = (type, x, y) =>
    page.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  await souris('mousePressed', depart.x, depart.y);
  for (let i = 1; i <= 8; i += 1) {
    await souris('mouseMoved', depart.x + (dx * i) / 8, depart.y + (dy * i) / 8);
    await pause(30);
  }
  await souris('mouseReleased', depart.x + dx, depart.y + dy);
  return true;
}

const glisserRepere = (dx, dy) => glisser(SELECTEUR_REPERE, dx, dy);
const glisserCarte = (dx, dy) => glisser('.leaflet-container', dx, dy);

/** Attribution affichée par la carte : la licence OpenStreetMap doit être VISIBLE. */
const attributionCarte = () =>
  page.evaluer(`(() => {
    const el = document.querySelector('.leaflet-control-attribution');
    return el ? el.innerText.trim() : '';
  })()`);

/**
 * Ouvre l'étape 3 (« Infos ») du formulaire d'inscription d'un établissement : c'est
 * l'étape qui exige une position, donc celle où se joue le bloc B2.
 */
async function ouvrirEtape3Inscription() {
  await page.send('Page.navigate', { url: `${ORIGINE}/inscription` });
  const question = await jusqua('document.body.innerText.includes("Avez-vous un établissement ?")');
  await cliquer('Oui, j’ai un établissement');
  await jusqua('document.body.innerText.includes("Étape 1/3")');
  await cliquer('Suivant'); // les photos sont facultatives
  await jusqua('document.querySelectorAll("button[aria-pressed]").length >= 3');
  const pastilles = await cocherTags(3);
  await cliquer('Suivant');
  const etape3 = await jusqua('document.body.innerText.includes("Localisation")');
  return { question: Boolean(question), pastilles, etape3: Boolean(etape3) };
}

// ── T2) Autorisation accordée : non-régression (comportement d’origine) ────
console.log('\n2) Autorisation accordée : la position arrive automatiquement (comportement d’origine)');
{
  await charger({ permission: 'granted' });
  await jusqua('localStorage.getItem("rejoinsmoi.position") !== null', { maxMs: 10000 });
  const appels = await appelsGps();
  const stockee = await positionStockee();
  const contenu = await texte();
  await capture('2-autorisation-accordee');
  verifier('le téléphone est interrogé sans que l’utilisateur ait à toucher l’écran', appels >= 1, `${appels} appel(s)`);
  verifier('la mesure est mémorisée comme mesure GPS', stockee?.source === 'gps', String(stockee?.source));
  verifier(
    'elle correspond au point donné par le téléphone',
    stockee && Math.abs(stockee.lat - POINT_GPS.latitude) < 0.001 && Math.abs(stockee.lng - POINT_GPS.longitude) < 0.001,
    stockee ? `${stockee.lat}, ${stockee.lng}` : 'absente'
  );
  verifier(
    'aucun bandeau de localisation ne vient encombrer l’écran',
    !contenu.includes('Localisation désactivée') && !contenu.includes('Localisation bloquée')
  );
}

// ── T3) Autorisation jamais demandée : la demande part d'un geste ───────────
console.log('\n3) Autorisation jamais demandée : rien au chargement, un geste déclenche la demande');
{
  await charger({ permission: 'prompt' });
  const auChargement = await appelsGps();
  const avant = await texte();
  await capture('3-jamais-demande-avant-geste');
  verifier('aucune demande surprise à l’ouverture', auChargement === 0, `${auChargement} appel(s)`);
  verifier(
    'l’écran explique à quoi sert la localisation',
    avant.includes('Localisation désactivée') && avant.includes('établissements proches')
  );

  const clique = await cliquer('Activer');
  await jusqua('window.__appelsGeo && window.__appelsGeo.length > 0', { maxMs: 6000 });
  await pause(1500); // le navigateur d'essai n'a pas de boîte de dialogue : la réponse arrive vite
  const apresGeste = await appelsGps();
  const apres = await texte();
  await capture('3-jamais-demande-apres-geste');
  verifier('le bouton « Activer » existe et a bien été touché', clique === true);
  verifier('exactement un appel part du geste (aucune boucle de relance)', apresGeste === 1, `${apresGeste} appel(s)`);
  verifier(
    'l’écran reste utile après l’échec : il propose encore le geste ou la carte',
    apres.includes('Autorisez la localisation') || apres.includes('trop de temps') || apres.includes('Choisir sur la carte'),
    /Autorisez la localisation/.test(apres) ? 'demande de geste affichée' : 'repli affiché'
  );
}

// ── T4) Repli par la carte : un point choisi remplace une mesure GPS ────────
console.log('\n4) Refus toujours en place : l’utilisateur désigne son quartier sur la carte');
{
  await charger({ permission: 'denied' });
  const avant = await appelsGps();
  const ouverture = await cliquer('Choisir sur la carte');
  const prete = await jusqua('Boolean(document.querySelector(".leaflet-container"))', { maxMs: 25000 });
  await pause(1000); // tuiles et premier rendu de la carte
  await capture('4-carte-ouverte');

  verifier('le bouton de repli existe et a été touché', ouverture === true);
  verifier('la carte s’ouvre', Boolean(prete));
  const ressourcesCarte = await page.evaluer(
    'performance.getEntriesByType("resource").filter((r) => /leaflet/i.test(r.name)).map((r) => r.name.split("/").pop())'
  );
  verifier(
    'la bibliothèque de carte n’est téléchargée qu’à cet instant',
    Array.isArray(ressourcesCarte) && ressourcesCarte.length >= 1,
    (ressourcesCarte || []).join(', ') || 'aucune'
  );

  const depart = await pointAffiche();
  verifier(
    'la carte part d’une vue de repérage (Abidjan), sans prétendre être la position de l’utilisateur',
    Boolean(depart) && Math.abs(depart.lat - 5.3242) < 0.02 && Math.abs(depart.lng + 4.0206) < 0.02,
    JSON.stringify(depart)
  );
  verifier('le repère est présent, prêt à être déplacé', await page.evaluer(`Boolean(document.querySelector("${SELECTEUR_REPERE}"))`));
  const attribution = await attributionCarte();
  verifier(
    'les tuiles OpenStreetMap affichent leur attribution, visible',
    /OpenStreetMap/.test(attribution),
    attribution
  );

  // L'utilisateur fait glisser LE REPÈRE jusqu'à son quartier.
  let arrivee = null;
  let essais = 0;
  while (essais < 3) {
    essais += 1;
    await glisserRepere(-70, -55);
    await pause(700);
    arrivee = await pointAffiche();
    if (arrivee && depart && Math.abs(arrivee.lat - depart.lat) > 0.0001) break;
  }
  verifier(
    'le repère est déplaçable et le point affiché suit le repère',
    Boolean(arrivee) && Boolean(depart) && Math.abs(arrivee.lat - depart.lat) > 0.0001,
    `${JSON.stringify(depart)} → ${JSON.stringify(arrivee)} (${essais} glissement(s))`
  );

  // Déplacer la CARTE, en revanche, ne doit plus déplacer le point : les coordonnées
  // enregistrées sont celles du repère, jamais le centre de l'écran (exigence B2).
  const avantCarte = await pointAffiche();
  await glisserCarte(-80, -60);
  await pause(900);
  const apresCarte = await pointAffiche();
  verifier(
    'déplacer la carte ne change PAS le point : la coordonnée est celle du repère',
    Boolean(avantCarte) &&
      Boolean(apresCarte) &&
      Math.abs(apresCarte.lat - avantCarte.lat) < 1e-9 &&
      Math.abs(apresCarte.lng - avantCarte.lng) < 1e-9,
    `${JSON.stringify(apresCarte)} (repère : ${JSON.stringify(avantCarte)})`
  );

  const validation = await cliquer('Valider cette position');
  await pause(800);
  const stockee = await positionStockee();
  const contenu = await texte();
  await capture('4-point-choisi-valide');
  verifier('le bouton de validation a été touché', validation === true);
  verifier(
    'le point validé est EXACTEMENT celui qui est mémorisé',
    Boolean(stockee) &&
      stockee.source === 'manuel' &&
      Math.abs(stockee.lat - arrivee.lat) < 0.0001 &&
      Math.abs(stockee.lng - arrivee.lng) < 0.0001,
    `${JSON.stringify(stockee)} (affiché ${JSON.stringify(arrivee)})`
  );
  verifier('la carte se referme après validation', (await page.evaluer('Boolean(document.querySelector(".leaflet-container"))')) === false);
  verifier('l’écran annonce l’origine des distances', contenu.includes('Position choisie sur la carte'));
  verifier('aucun appel GPS n’a été nécessaire à ce parcours', (await appelsGps()) === avant, `${await appelsGps()} appel(s)`);

  // Visite suivante : le point choisi doit survivre et rester utilisé.
  await charger({ permission: 'denied', garderMemoire: true });
  const stockeeApres = await positionStockee();
  const contenuApres = await texte();
  await capture('4-point-choisi-apres-rechargement');
  verifier('le point choisi survit à un redémarrage de l’application', stockeeApres?.source === 'manuel', String(stockeeApres?.source));
  verifier('l’écran le rappelle au lieu de redemander une autorisation', contenuApres.includes('Position choisie sur la carte'));

  // Et si l'utilisateur retente le GPS (toujours refusé) : il ne perd rien.
  const avantGps = await appelsGps();
  await cliquer('Revenir au GPS');
  await jusqua(`window.__appelsGeo && window.__appelsGeo.length > ${avantGps}`, { maxMs: 6000 });
  await pause(1200);
  const apresGps = await appelsGps();
  const contenuGps = await texte();
  await capture('4-retour-gps-refuse');
  verifier('la tentative GPS part bien du geste, une seule fois', apresGps === avantGps + 1, `${apresGps - avantGps} appel(s)`);
  verifier(
    'en cas d’échec, les distances déjà obtenues sont CONSERVÉES',
    contenuGps.includes('Position choisie sur la carte') && (await positionStockee())?.source === 'manuel'
  );
}

// ── T4 ter) GPS disponible : le repère démarre sur la mesure ────────────────
// Exigence B2 : « Le repère est déplaçable et centré sur le GPS si disponible. »
console.log('\n4 ter) GPS disponible : la carte s’ouvre sur la position mesurée');
{
  // Une mesure AILLEURS qu'au Plateau : sinon « centré sur le GPS » serait indiscernable
  // du centre de carte par défaut (les deux valent 5,3242 / -4,0206).
  const POINT_AILLEURS = { latitude: 5.35, longitude: -4.07, accuracy: 20 }; // Yopougon
  await charger({ permission: 'granted', point: POINT_AILLEURS });
  await jusqua('localStorage.getItem("rejoinsmoi.position") !== null', { maxMs: 10000 });
  const { etape3 } = await ouvrirEtape3Inscription();
  const vu = await texte();
  verifier('l’étape 3 du formulaire reprend la position détectée', etape3 && /Position enregistrée/.test(vu));

  await cliquer('Placer sur la carte');
  const prete = await jusqua(`Boolean(document.querySelector("${SELECTEUR_REPERE}"))`, { maxMs: 25000 });
  await pause(900);
  const departGps = await pointAffiche();
  await capture('4ter-repere-part-du-gps');
  verifier(
    'le repère démarre sur la mesure GPS, pas sur le centre de carte par défaut',
    Boolean(prete) &&
      Boolean(departGps) &&
      Math.abs(departGps.lat - POINT_AILLEURS.latitude) < 0.002 &&
      Math.abs(departGps.lng - POINT_AILLEURS.longitude) < 0.002,
    JSON.stringify(departGps)
  );
}

// ── T5) L'utilisateur autorise depuis les réglages : aucun clic nécessaire ──
console.log('\n5) Autorisation accordée pendant la visite : la position arrive sans aucun clic');
{
  await charger({ permission: 'prompt' });
  const avant = await appelsGps();

  // L'utilisateur sort dans les réglages du navigateur et choisit « Autoriser ».
  await navigateur.send('Browser.setPermission', {
    // Ici aussi : origine stricte, sans chemin.
    origin: ADRESSE,
    permission: { name: 'geolocation' },
    setting: 'granted',
  });
  // Il revient sur l'application : le téléphone rend la main à la page.
  await page.evaluer('document.dispatchEvent(new Event("visibilitychange"))');
  await jusqua('localStorage.getItem("rejoinsmoi.position") !== null', { maxMs: 8000 });

  const stockee = await positionStockee();
  const contenu = await texte();
  await capture('5-autorisation-en-cours-de-visite');
  verifier('rien n’avait été demandé à l’ouverture', avant === 0, `${avant} appel(s)`);
  verifier(
    'la position arrive quand même, sans aucun clic',
    (await appelsGps()) >= 1 && stockee?.source === 'gps',
    `${await appelsGps()} appel(s), source « ${stockee?.source} »`
  );
  verifier(
    'le bandeau de localisation disparaît de l’écran',
    !contenu.includes('Localisation désactivée') && !contenu.includes('Localisation bloquée')
  );
}

/** Renseigne un champ comme le ferait un doigt (React n'écoute que les vrais événements). */
function remplir(placeholder, valeur) {
  return page.evaluer(`(() => {
    const champ = [...document.querySelectorAll('input')].find((i) => i.placeholder === ${JSON.stringify(placeholder)});
    if (!champ) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(champ, ${JSON.stringify(valeur)});
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

/**
 * Renseigne le champ porté par le <label> dont le TEXTE est exactement `libelle`.
 *
 * Pourquoi cette variante : à l'étape 3, DEUX champs portent le placeholder
 * « 07 07 12 34 56 » — le numéro affiché sur la fiche (label « Téléphone ») et le
 * numéro du COMPTE (label « Téléphone * »). `remplir()` prend le premier trouvé dans
 * le DOM, c'est-à-dire celui de la fiche : le numéro du compte restait vide et
 * « Publier ma fiche » s'arrêtait sur « Indiquez votre numéro de téléphone pour créer
 * votre compte » — un échec qui n'avait rien à voir avec la localisation.
 */
function remplirSousLibelle(libelle, valeur) {
  return page.evaluer(`(() => {
    const normaliser = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
    const etiquette = [...document.querySelectorAll('label')].find(
      (l) => normaliser(l.innerText) === ${JSON.stringify(libelle)}
    );
    const champ = etiquette && etiquette.querySelector('input, textarea');
    if (!champ) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(champ, ${JSON.stringify(valeur)});
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

/** Présence d'un bouton portant ce libellé, sans le toucher. */
const boutonPresent = (libelle) =>
  page.evaluer(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(libelle)}))`);

/** Coche `nombre` pastilles de produits/services (seules elles portent `aria-pressed`). */
function cocherTags(nombre) {
  return page.evaluer(`(() => {
    const pastilles = [...document.querySelectorAll('button[aria-pressed]')];
    if (pastilles.length < ${nombre}) return pastilles.length;
    pastilles.slice(0, ${nombre}).forEach((p) => p.click());
    return ${nombre};
  })()`);
}

// ── L'API bouchonnée de la preuve finale de la T6 ───────────────────────────
// Le `dist/` servi ici est un site STATIQUE : « /api/users/register » y reçoit du
// HTML, que le client traduit (à juste titre) par « serveur injoignable ». Impossible
// donc de distinguer « la validation bloque » de « le réseau manque ». On installe
// donc un bouchon AU NIVEAU DU RÉSEAU (CDP `Fetch`), qui répond du JSON comme l'API
// et NOTE chaque appel : c'est cette liste qui prouve que l'envoi part vraiment.
const TELEPHONE_COMPTE = '0707987654';
const MOT_DE_PASSE_COMPTE = 'motdepasse6';
const NOM_FICHE = 'Chez Awa';
// Forme d'une fiche servie par l'API (mêmes champs que src/data/demoData.js) : la
// fiche publiée doit pouvoir s'OUVRIR, sinon la capture finale ne montrerait qu'un
// écran vide.
const ETABLISSEMENT_ESSAI = {
  id: 'etab-essai',
  nom: NOM_FICHE,
  categorie: 'alimentation',
  description: 'Maquis de quartier, plats du jour et jus naturels.',
  photoDevanture: '',
  photoVendeur: '',
  tags: ['Attiéké', 'Poisson braisé', 'Jus naturels'],
  localisation: null,
  commune: '',
  quartier: 'Cocody',
  horaires: '',
  telephone: '0707123456',
  whatsapp: '0707123456',
  texteBoutonAction: `Aller chez ${NOM_FICHE}`,
  noteMoyenne: 0,
  nombreAvis: 0,
  compteurVisites: 1,
  compteurUtilisateurs: 1,
  verifie: false,
};

const appelsApi = [];

async function poserApiFactice() {
  await page.send('Fetch.enable', {
    // ⚠️ Le motif est VOLONTAIREMENT large : le `dist/` publié porte l'adresse du
    // backend déployé (`VITE_API_URL`, cf. `npm run build:pages`) — un motif limité à
    // l'origine locale ne retiendrait RIEN, et la T6 publierait pour de vrai un
    // compte et une fiche d'essai sur l'API de production. Seules les requêtes d'API
    // sont ainsi détournées ; le site (JS, CSS, images, tuiles) passe normalement.
    patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }],
  });
  // En-têtes CORS : l'appel bouchonné peut viser une AUTRE origine que la page, et le
  // navigateur vérifie donc la réponse (y compris le préflight OPTIONS, que le POST
  // JSON déclenche).
  const normesCors = [
    { name: 'Access-Control-Allow-Origin', value: '*' },
    { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
    { name: 'Access-Control-Allow-Headers', value: 'content-type, authorization, accept' },
    { name: 'Access-Control-Max-Age', value: '600' },
  ];
  navigateur.sur('Fetch.requestPaused', async ({ requestId, request }) => {
    // « /api » peut être précédé d'un chemin (site statique) ou suivi du domaine de
    // l'API déployée : on ne garde que la route réellement appelée.
    const chemin = new URL(request.url).pathname.split('/api').pop() || '';
    const repondre = (statut, donnees, entetes = []) =>
      page.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: statut,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          ...normesCors,
          ...entetes,
        ],
        ...(statut === 204 ? {} : { body: Buffer.from(JSON.stringify(donnees)).toString('base64') }),
      });
    try {
      // Préflight CORS : il ne compte pas comme un appel de l'application.
      if (request.method === 'OPTIONS') {
        await repondre(204);
        return;
      }
      let corps = null;
      if (request.postData) {
        try {
          corps = JSON.parse(request.postData);
        } catch {
          corps = { brut: request.postData };
        }
      }
      appelsApi.push({ methode: request.method, chemin, corps });
      if (chemin === '/users/register') {
        await repondre(201, {
          token: 'jeton-dessai',
          user: { id: 'u-essai', telephone: corps?.telephone || '', nomComplet: 'Awa Traoré' },
        });
      } else if (chemin === '/establishments' && request.method === 'POST') {
        await repondre(201, { etablissement: { ...ETABLISSEMENT_ESSAI, localisation: corps?.localisation || null } });
      } else if (/^\/establishments\/[^/]+$/.test(chemin) && request.method === 'GET') {
        await repondre(200, { etablissement: { ...ETABLISSEMENT_ESSAI }, avis: [] });
      } else {
        // Le reste (visite comptée, interactions…) : succès vide, comme l'API le fait
        // pour ces appels sans contenu attendu.
        await repondre(200, { ok: true });
      }
    } catch (err) {
      // Requête annulée par la page pendant qu'on répondait : sans conséquence.
      console.error(`  [API d'essai] ${request.method} ${chemin} : ${err?.message || err}`);
    }
  });
}

// ── T6) Bloc B2 : un refus n'empêche plus d'inscrire un établissement ───────
// LE cas visé : l'étape 3 du formulaire EXIGE une position. Avant B2, la seule issue
// proposée était « autorisez la géolocalisation » (et une saisie de quartier qui ne
// remplaçait pas le point) : quelqu'un qui avait refusé ne pouvait donc PAS inscrire
// son établissement. Tout le parcours ci-dessous se fait avec un refus ENREGISTRÉ.
console.log('\n6) Refus toujours en place : l’inscription de l’établissement va jusqu’au bout');
{
  await charger({ permission: 'denied' });
  const appelsAvant = await appelsGps();
  const { question, pastilles, etape3 } = await ouvrirEtape3Inscription();
  verifier('le formulaire d’inscription s’ouvre malgré le refus', question);
  verifier('trois produits/services cochés (minimum exigé par l’étape 2)', pastilles === 3, `${pastilles} pastille(s)`);
  verifier('l’étape 3 (celle qui exige une position) est atteinte', etape3);

  // Étape 3 : nom et numéro renseignés, position volontairement absente. Le numéro
  // visé ici est celui de la FICHE (« Téléphone » sans astérisque) : l'autre champ
  // « 07 07 12 34 56 » de l'écran est celui du compte, il vient plus bas.
  const nomRempli = await remplir('Ex. Chez Fatou', NOM_FICHE);
  const telRempli = await remplirSousLibelle('Téléphone', '0707123456');
  const quartierRempli = await remplir('Quartier', 'Cocody');
  verifier(
    'le nom, le numéro et le quartier sont renseignés (seule la position manque)',
    nomRempli && telRempli && quartierRempli
  );
  await capture('6-inscription-sans-position');

  const sansPosition = await texte();
  verifier(
    'l’écran nomme la vraie cause : blocage POUR CE SITE',
    sansPosition.includes('Localisation bloquée pour ce site')
  );
  verifier(
    'il propose la sortie du blocage : placer soi-même son point (bloc B2)',
    await boutonPresent('Placer sur la carte')
  );
  verifier(
    'aucun appel GPS n’a été tenté jusque-là (le refus est respecté)',
    (await appelsGps()) === appelsAvant,
    `${await appelsGps()} appel(s)`
  );

  // Un quartier saisi ne suffit pas : la fiche exige un POINT, et le message le dit.
  await cliquer('Publier ma fiche');
  await pause(500);
  const refus = await texte();
  const pageApresRefus = await cheminApp();
  await capture('6-inscription-refus-sans-point');
  verifier(
    'sans point, la fiche n’est pas publiée',
    refus.includes('Position obligatoire') && pageApresRefus === '/inscription',
    pageApresRefus
  );
  verifier(
    'le message renvoie bien vers les DEUX issues (GPS ou carte)',
    refus.includes('Utiliser ma position actuelle') && refus.includes('Placer sur la carte')
  );

  // La carte de désignation : c'est elle qui débloque l'inscription.
  const ouverture = await cliquer('Placer sur la carte');
  const cartePrete = await jusqua(`Boolean(document.querySelector("${SELECTEUR_REPERE}"))`, { maxMs: 25000 });
  await pause(900);
  await capture('6-inscription-carte-ouverte');
  verifier('le bouton ouvre la carte de désignation', ouverture === true && Boolean(cartePrete));
  const attribution = await attributionCarte();
  verifier(
    'l’attribution « © OpenStreetMap » est visible sous la carte',
    /OpenStreetMap/.test(attribution),
    attribution
  );

  const depart = await pointAffiche();
  let arrivee = null;
  let essais = 0;
  while (essais < 3) {
    essais += 1;
    await glisserRepere(-60, -45);
    await pause(700);
    arrivee = await pointAffiche();
    if (arrivee && depart && Math.abs(arrivee.lat - depart.lat) > 0.0001) break;
  }
  verifier(
    'le repère se déplace et le point affiché suit le repère',
    Boolean(depart) && Boolean(arrivee) && Math.abs(arrivee.lat - depart.lat) > 0.0001,
    `${JSON.stringify(depart)} → ${JSON.stringify(arrivee)}`
  );

  await cliquer('Valider cette position');
  await pause(800);
  const stockee = await positionStockee();
  const contenu = await texte();
  await capture('6-inscription-point-choisi');
  verifier(
    'le point validé devient la position de l’inscription, mémorisée comme un CHOIX',
    Boolean(stockee) &&
      stockee.source === 'manuel' &&
      Boolean(arrivee) &&
      Math.abs(stockee.lat - arrivee.lat) < 0.0001 &&
      Math.abs(stockee.lng - arrivee.lng) < 0.0001,
    `${JSON.stringify(stockee)} (carte : ${JSON.stringify(arrivee)})`
  );
  verifier(
    'le formulaire l’affiche en le présentant comme un choix, jamais comme une mesure',
    contenu.includes('Position enregistrée') && contenu.includes('point que vous avez choisi')
  );
  verifier(
    'la carte se referme après validation',
    (await page.evaluer('Boolean(document.querySelector(".leaflet-container"))')) === false
  );

  // ── Preuve finale : la validation passe, et l'envoi PART VRAIMENT ─────────
  // Depuis le parcours « nouveau venu », l'inscription ne renvoie plus vers
  // /connexion : elle CRÉE le compte dans le même écart d'écran, puis publie la fiche
  // — sinon photos, tags et point choisi seraient perdus, et c'était le principal
  // abandon du parcours. On prouve donc la suite RÉELLE des deux appels (« POST
  // /users/register » puis « POST /establishments »), pas une redirection : c'est la
  // seule façon de distinguer « le formulaire a laissé passer » de « c'est parti ».
  const identification = await remplirSousLibelle('Téléphone *', TELEPHONE_COMPTE);
  const motDePasseCompte = await remplirSousLibelle('Mot de passe *', MOT_DE_PASSE_COMPTE);
  await capture('6-inscription-compte-renseigne');
  verifier(
    'le numéro et le mot de passe du COMPTE sont saisis (les deux champs « 07 07… » de l’écran sont distincts)',
    identification && motDePasseCompte,
    `compte : ${TELEPHONE_COMPTE}`
  );

  await poserApiFactice();
  await cliquer('Publier ma fiche');
  const partiSurLaFiche = await jusqua(`${EXPR_CHEMIN_APP} === "/etablissement/etab-essai"`, { maxMs: 15000 });
  await capture('6-inscription-envoi-accepte');
  const creationCompte = appelsApi.find((a) => a.chemin === '/users/register');
  const publication = appelsApi.find((a) => a.chemin === '/establishments' && a.methode === 'POST');
  verifier(
    'le compte est créé dans le parcours, avec le numéro saisi à l’écran',
    Boolean(creationCompte) && creationCompte.corps?.telephone === TELEPHONE_COMPTE,
    creationCompte ? `POST /users/register — ${creationCompte.corps?.telephone}` : 'aucun appel'
  );
  verifier(
    'la fiche part avec le POINT choisi sur la carte (jamais une mesure GPS)',
    Boolean(publication) &&
      Boolean(arrivee) &&
      Math.abs((publication.corps?.localisation?.lat ?? NaN) - arrivee.lat) < 0.0001 &&
      Math.abs((publication.corps?.localisation?.lng ?? NaN) - arrivee.lng) < 0.0001,
    publication ? JSON.stringify(publication.corps?.localisation) : 'aucun appel'
  );
  verifier(
    'la fiche publiée porte le nom, le quartier et le numéro saisis',
    publication?.corps?.nom === NOM_FICHE &&
      publication?.corps?.quartier === 'Cocody' &&
      publication?.corps?.telephone === '0707123456',
    publication ? `« ${publication.corps.nom} » / ${publication.corps.quartier} / ${publication.corps.telephone}` : '—'
  );
  verifier(
    'l’écran bascule sur la fiche publiée, sans repasser par la connexion',
    Boolean(partiSurLaFiche),
    await cheminApp()
  );
  verifier(
    'ce parcours complet n’a coûté AUCUN appel GPS',
    (await appelsGps()) === appelsAvant,
    `${await appelsGps()} appel(s)`
  );
}

// ── Bilan, rapport et nettoyage ─────────────────────────────────────────────
const fichierRapport = join(SORTIE, '_rapport.json');
writeFileSync(
  fichierRapport,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      pageServie: ORIGINE,
      paquet: { principal: jsPrincipal, carte: jsCarte || null, poidsCarteKo: jsCarte ? poidsKo(jsCarte) : 0 },
      verifications: { reussies: reussis, echecs },
      captures: readdirSync(SORTIE).filter((f) => f.endsWith('.png')),
    },
    null,
    2
  ),
  'utf8'
);

console.log(`\n${'─'.repeat(72)}`);
console.log(`  Résultat : ${reussis} vérification(s) réussie(s), ${echecs} échec(s)`);
console.log(`  Captures et rapport : ${SORTIE}`);
console.log('');

serveur.close();
try {
  await navigateur.send('Browser.close');
} catch {
  /* la fenêtre est peut-être déjà fermée */
}
// Chrome n'a pas fini de mourir quand `kill` rend la main : ses processus fils
// tiennent encore des fichiers du profil. On attend donc sa sortie réelle (avec un
// plafond raisonnable) avant d'effacer le dossier jetable.
await new Promise((resoudre) => {
  const tropTard = setTimeout(resoudre, 5000);
  chrome.once('exit', () => {
    clearTimeout(tropTard);
    setTimeout(resoudre, 300);
  });
  chrome.kill();
});
effacerProfil();
console.log(`  Profil temporaire effacé : ${existsSync(PROFIL) ? 'non (verrou Windows)' : 'oui'}`);
if (echecs > 0) process.exitCode = 1;

