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
//   T4 repli carte           → point choisi = point stocké, et il survit au rechargement ;
//   T5 autorisé entre-temps  → position obtenue SANS aucun clic.
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
const ORIGINE = `http://127.0.0.1:${PORT}`;
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
  const chemin = decodeURIComponent(new URL(requete.url, ORIGINE).pathname);
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
async function charger({ permission = null, gps = true, garderMemoire = false } = {}) {
  if (permission) {
    await navigateur.send('Browser.setPermission', {
      origin: ORIGINE,
      permission: { name: 'geolocation' },
      setting: permission,
    });
  }
  if (gps) await page.send('Emulation.setGeolocationOverride', POINT_GPS);
  else await page.send('Emulation.clearGeolocationOverride');

  await page.send('Page.navigate', { url: `${ORIGINE}/` });
  await jusqua('document.querySelector("#root") && document.querySelector("#root").children.length > 0');
  if (!garderMemoire) await page.evaluer('localStorage.clear()');
  await page.send('Page.navigate', { url: `${ORIGINE}/` });
  await jusqua('document.querySelector("#root") && document.querySelector("#root").children.length > 0');
  // 1,5 s : largement de quoi laisser un éventuel appel « au chargement » partir.
  await pause(1500);
}

console.log('\n▶ Même vérification dans un vrai navigateur (Chrome piloté par CDP)');
console.log(`  page servie depuis dist/ sur ${ORIGINE}\n`);

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

/** Déplace la carte comme le ferait un doigt : appui, glissement, relâchement. */
async function deplacerCarte(dx, dy) {
  const boite = await page.evaluer(`(() => {
    const carte = document.querySelector('.leaflet-container');
    if (!carte) return null;
    const r = carte.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!boite) return false;
  const souris = (type, x, y) =>
    page.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  await souris('mousePressed', boite.x, boite.y);
  for (let i = 1; i <= 8; i += 1) {
    await souris('mouseMoved', boite.x + (dx * i) / 8, boite.y + (dy * i) / 8);
    await pause(30);
  }
  await souris('mouseReleased', boite.x + dx, boite.y + dy);
  return true;
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

  // L'utilisateur fait glisser la carte jusqu'à son quartier.
  let arrivee = null;
  let essais = 0;
  while (essais < 3) {
    essais += 1;
    await deplacerCarte(-70, -55);
    await pause(700);
    arrivee = await pointAffiche();
    if (arrivee && depart && Math.abs(arrivee.lat - depart.lat) > 0.0001) break;
  }
  verifier(
    'le point suit la carte quand on la fait glisser',
    Boolean(arrivee) && Boolean(depart) && Math.abs(arrivee.lat - depart.lat) > 0.0001,
    `${JSON.stringify(depart)} → ${JSON.stringify(arrivee)} (${essais} glissement(s))`
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

// ── T5) L'utilisateur autorise depuis les réglages : aucun clic nécessaire ──
console.log('\n5) Autorisation accordée pendant la visite : la position arrive sans aucun clic');
{
  await charger({ permission: 'prompt' });
  const avant = await appelsGps();

  // L'utilisateur sort dans les réglages du navigateur et choisit « Autoriser ».
  await navigateur.send('Browser.setPermission', {
    origin: ORIGINE,
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

