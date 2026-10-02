// verifier-localisation-ui.mjs — Preuve UI « réelle » (moteur Chrome, pas de mock JS).
//
// Sert le build de production (dist/, qui pointe vers l'API de production Render),
// puis pilote Chrome headless via CDP pour :
//   1) accorder la permission de géolocalisation + fixer une vraie coordonnée :
//      la demande de position réussit (même chemin qu'une PWA installée qui autorise
//      la localisation) et des distances réelles s'affichent ;
//   2) refuser la permission : AUCUNE distance chiffrée ne doit s'afficher, et le
//      bandeau « Activez la localisation… » doit apparaître.
//
// Usage : node scripts/verifier-localisation-ui.mjs [dossier-sortie]

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const OUT = process.argv[2] || 'captures-localisation';

const CHROME =
  process.env.CHROME_PATH ||
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe');

const PORT = 4180;
const CDP_PORT = 9334;
const ORIGIN = `http://localhost:${PORT}`;

const COORDS = { lat: 5.2239, lng: -3.7431 }; // Grand-Bassam (~33 km du Plateau)

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

await mkdir(OUT, { recursive: true });

// ── Serveur statique minimal pour dist/ ────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  let file = join(DIST, pathname);
  if (!existsSync(file) || !extname(pathname)) file = join(DIST, 'index.html');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(join(DIST, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  }
});
await new Promise((r) => server.listen(PORT, r));

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Chrome + CDP ───────────────────────────────────────────────────────────────
const PROFIL = join(process.env.TEMP || '.', `chrome-cdp-geo-${process.pid}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--user-data-dir=${PROFIL}`, `--remote-debugging-port=${CDP_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

async function attendreCdp(maxMs = 20000) {
  const debut = Date.now();
  while (Date.now() - debut < maxMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return r.json();
    } catch { /* pas prêt */ }
    await pause(300);
  }
  throw new Error('CDP indisponible');
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.attentes = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.attentes.has(m.id)) {
        const { resolve, reject } = this.attentes.get(m.id);
        this.attentes.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.attentes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluer(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
}

async function attendre(cdp, expression, maxMs = 25000) {
  const debut = Date.now();
  while (Date.now() - debut < maxMs) {
    if (await cdp.evaluer(expression)) return true;
    await pause(500);
  }
  return false;
}

// ── Analyse des distances affichées dans le DOM ───────────────────────────────
const RELEVE_DISTANCES = `(() => {
  const parse = (t) => {
    const s = String(t).trim().replace(/\\s/g, '');
    if (s.endsWith('km')) return parseFloat(s.replace(',', '.')) * 1000;
    if (s.endsWith('m')) return parseFloat(s.replace(',', '.'));
    return NaN;
  };
  const badges = [...document.querySelectorAll('span')]
    .map((el) => el.textContent.trim())
    .filter((t) => /^\\d+(?:[.,]\\d+)?\\s*(m|km)$/.test(t));
  const metres = badges.map(parse).filter((n) => Number.isFinite(n));
  let inversions = 0;
  for (let i = 1; i < metres.length; i++) if (metres[i] < metres[i - 1] - 1) inversions++;
  return {
    promptPresent: document.body.innerText.includes('Activez la localisation pour voir les établissements'),
    badges: badges.slice(0, 10),
    metresPremiers: metres.slice(0, 10),
    inversions,
    cartes: document.querySelectorAll('.carte').length,
    aResultats: document.body.innerText.includes('résultat'),
    texte: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
  };
})()`;

try {
  const version = await attendreCdp();
  const liste = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = liste.find((c) => c.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });

  const rapport = {};

  // ── Scénario 1 : permission ACCORDÉE + vraie coordonnée ────────────────────
  await cdp.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] });
  await cdp.send('Emulation.setGeolocationOverride', {
    latitude: COORDS.lat, longitude: COORDS.lng, accuracy: 50,
  });
  await cdp.send('Page.navigate', { url: `${ORIGIN}/` });
  await attendre(cdp, `document.body && document.body.innerText.length > 200`);
  await pause(3000);
  const accorde = await cdp.evaluer(RELEVE_DISTANCES);
  const capAccorde = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: 1200, scale: 1 } });
  await writeFile(join(OUT, 'acces-accorde.png'), Buffer.from(capAccorde.data, 'base64'));
  rapport.accesAccorde = { chrome: version.Browser, coords: COORDS, ...accorde };

  // ── Scénario 2 : permission REFUSÉE (cache vidé, pour ne pas réutiliser la
  //    position du scénario 1) ─────────────────────────────────────────────────
  await cdp.evaluer('localStorage.clear(); true');
  await cdp.send('Browser.resetPermissions');
  try {
    await cdp.send('Browser.setPermission', { origin: ORIGIN, permission: { name: 'geolocation' }, setting: 'denied' });
  } catch { /* méthode optionnelle */ }
  await cdp.send('Emulation.setGeolocationOverride', {});
  await cdp.send('Page.navigate', { url: `${ORIGIN}/` });
  await attendre(cdp, `document.body && document.body.innerText.length > 200`);
  await pause(3000);
  const refuse = await cdp.evaluer(RELEVE_DISTANCES);
  const capRefuse = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: 1200, scale: 1 } });
  await writeFile(join(OUT, 'acces-refuse.png'), Buffer.from(capRefuse.data, 'base64'));
  rapport.accesRefuse = refuse;

  // ── Scénario 3 : tri pur (recherche, catégorie unique) ─────────────────────
  await cdp.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] });
  await cdp.send('Emulation.setGeolocationOverride', { latitude: COORDS.lat, longitude: COORDS.lng, accuracy: 50 });
  await cdp.evaluer('localStorage.clear(); true');
  await cdp.send('Page.navigate', { url: `${ORIGIN}/recherche?categorie=alimentation` });
  await attendre(cdp, `document.body && document.body.innerText.length > 200`);
  await pause(3000);
  const tri = await cdp.evaluer(RELEVE_DISTANCES);
  const capTri = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: 1200, scale: 1 } });
  await writeFile(join(OUT, 'recherche-triee.png'), Buffer.from(capTri.data, 'base64'));
  rapport.triRecherche = tri;

  rapport.conclusion = {
    accordeAfficheDistances: accorde.badges.length > 0 && !accorde.promptPresent,
    accordeDistancesReelles: accorde.metresPremiers.length > 0 && accorde.metresPremiers[0] > 20000,
    refuseAffichePrompt: refuse.promptPresent,
    refuseAucuneDistance: refuse.badges.length === 0,
    rechercheAfficheDistances: tri.badges.length > 0,
    rechercheTriCroissant: tri.inversions === 0 && tri.metresPremiers.length > 1,
  };

  rapport.note =
    "Le navigateur de test (origine http://localhost) n'est pas dans la liste CORS de l'API " +
    "de production : les écrans basculent donc sur les données de démonstration. Cela n'affecte " +
    "pas la logique de géolocalisation testée ici (les distances sont calculées côté client " +
    "depuis la position réellement accordée). Le tri sur TOUTE la liste réelle est prouvé par " +
    "scripts/verifier-tri-proximite.mjs.";

  await writeFile(join(OUT, '_rapport.json'), JSON.stringify(rapport, null, 2), 'utf8');
  console.log(JSON.stringify(rapport, null, 2));

  try { await cdp.send('Browser.close'); } catch { /* ignore */ }
  chrome.kill();
  server.close();
  process.exit(0);
} catch (err) {
  console.error('ERREUR :', err.message);
  try { chrome.kill(); } catch { /* ignore */ }
  server.close();
  process.exit(1);
}

