// verifier-parcours-nouveau.mjs — PREUVE du parcours d'un nouveau venu (bloc E).
//
// LE PARCOURS VISÉ (celui d'un QR code collé sur une devanture, ou d'un lien TikTok) :
//   1. un numéro NEUF ouvre l'URL sur un téléphone ;
//   2. « Oui, j'ai un établissement » → photos (facultatives) → produits → infos ;
//   3. le compte (téléphone + mot de passe) se crée DANS LE MÊME PARCOURS — sinon la fiche
//      en cours de saisie est perdue en route ;
//   4. la fiche est publiée et s'ouvre ;
//   5. elle apparaît dans l'ACCUEIL et dans la RECHERCHE, à proximité ;
//   6. la bannière « Installer l'app » ne recouvre AUCUN bouton d'action.
//
// Le test crée un VRAI compte et une VRAIE fiche (préfixe « ZZ TEST », numéro du bloc
// d'essai 07000000xx) : c'est la seule façon de vérifier une publication réelle. Ils sont
// ensuite supprimés par le script voisin, à partir du numéro imprimé à la fin :
//   cd backend && node scripts/supprimer-parcours-test.js --telephone=<numéro> --oui
//
// Usage : npm run verifier:parcours   (construire `dist/` avant : npm run build)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const RACINE = join(ICI, '..');
const DIST = join(RACINE, 'dist');
const SORTIE = join(RACINE, 'captures-parcours');
const PORT = 9457;
const PORT_CDP = 9458;
const ORIGINE = `http://127.0.0.1:${PORT}`;
const POINT_GPS = { latitude: 5.3242, longitude: -4.0206, accuracy: 25 }; // Plateau, Abidjan
const MARQUE = Date.now().toString().slice(-5);
const NOM_FICHE = `ZZ TEST PARCOURS ${MARQUE}`;
const TELEPHONE_ESSAI = `+22507000000${MARQUE.slice(-2)}`; // bloc d'essai 07000000xx
const MOT_DE_PASSE = 'MotdepasseTest1';

let reussis = 0;
const echecs = [];
function verifier(libelle, ok, detail = '') {
  if (ok) {
    reussis += 1;
    console.log(`  ✓ ${libelle}${detail ? ` — ${detail}` : ''}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ absent : lancez `npm run build` avant ce script.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const serveur = createServer((requete, reponse) => {
  const chemin = decodeURIComponent(new URL(requete.url, ORIGINE).pathname);
  let fichier = join(DIST, chemin === '/' ? 'index.html' : chemin);
  if (!fichier.startsWith(DIST) || !existsSync(fichier) || statSync(fichier).isDirectory()) {
    fichier = join(DIST, 'index.html');
  }
  reponse.setHeader('Content-Type', TYPES[extname(fichier)] || 'application/octet-stream');
  createReadStream(fichier).pipe(reponse);
});
await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));

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
  console.error('Chrome introuvable : indiquez son chemin (CHROME_PATH="…").');
  process.exit(1);
}

rmSync(SORTIE, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
mkdirSync(SORTIE, { recursive: true });
const PROFIL = join(process.env.TEMP || '.', `chrome-cdp-parcours-${process.pid}`);
const effacerProfil = () => {
  try {
    rmSync(PROFIL, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  } catch {
    /* dossier jetable */
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

async function jusqua(expression, { maxMs = 20000, pas = 250 } = {}) {
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
const chemin = () => page.evaluer('location.pathname');
let numeroCapture = 0;
async function capture(nom) {
  numeroCapture += 1;
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SORTIE, `${String(numeroCapture).padStart(2, '0')}-${nom}.png`), Buffer.from(data, 'base64'));
}

function cliquer(libelle) {
  return page.evaluer(`(() => {
    const bouton = [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes(${JSON.stringify(libelle)}));
    if (!bouton) return false;
    bouton.click();
    return true;
  })()`);
}

/** Renseigne un champ comme le ferait un doigt (React n'écoute que les vrais événements). */
function remplir(selecteur, valeur) {
  return page.evaluer(`(() => {
    const champ = document.querySelector(${JSON.stringify(selecteur)});
    if (!champ) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(champ, ${JSON.stringify(valeur)});
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

/**
 * LA bannière « Installer l'app » recouvre-t-elle un bouton ? On pose la question au
 * navigateur, bouton par bouton visible : si l'élément réellement sous son centre n'est ni
 * le bouton ni l'un de ses enfants, quelque chose le masque.
 */
const boutonsMasques = () =>
  page.evaluer(`(() => {
    const boutons = [...document.querySelectorAll('button, a')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && !b.disabled && b.textContent.trim().length > 0;
    });
    const masques = [];
    for (const b of boutons) {
      const r = b.getBoundingClientRect();
      const dessus = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (dessus && dessus !== b && !b.contains(dessus) && !dessus.contains(b)) {
        masques.push({ bouton: b.textContent.trim().slice(0, 40), par: String(dessus.className || dessus.tagName).slice(0, 60) });
      }
    }
    return { total: boutons.length, masques };
  })()`);

console.log('\n▶ Parcours d’un nouveau venu : de l’URL à la fiche visible');
console.log(`  téléphone d’essai : ${TELEPHONE_ESSAI} | fiche : « ${NOM_FICHE} »\n`);

// Un téléphone qui a le GPS : le parcours le plus courant (QR code dans la rue).
await navigateur.send('Browser.setPermission', {
  origin: ORIGINE,
  permission: { name: 'geolocation' },
  setting: 'granted',
});
await page.send('Emulation.setGeolocationOverride', POINT_GPS);
await page.send('Page.enable');
await page.send('Runtime.enable');

// Démarrage à froid, comme un premier clic sur un lien : mémoire locale vidée.
await page.send('Page.navigate', { url: `${ORIGINE}/` });
await jusqua('document.querySelector("#root") && document.querySelector("#root").children.length > 0');
await page.evaluer('localStorage.clear()');
await page.send('Page.navigate', { url: `${ORIGINE}/inscription` });
const ouverture = await jusqua('document.body.innerText.includes("Avez-vous un établissement ?")');
await capture('inscription-ouverture');
verifier('un numéro neuf arrive directement sur la création de profil', Boolean(ouverture));

// ── Étapes 1 et 2 : parcours « Oui, j'ai un établissement » ──────────────
await cliquer('Oui, j’ai un établissement');
const etape1 = await jusqua('document.body.innerText.includes("Photo de la devanture")');
await cliquer('Suivant'); // photos facultatives
await jusqua('document.querySelectorAll("button[aria-pressed]").length >= 3');
await page.evaluer('[...document.querySelectorAll("button[aria-pressed]")].slice(0,3).forEach((p) => p.click())');
await cliquer('Suivant');
const etape3 = await jusqua('document.body.innerText.includes("Localisation")');
await capture('inscription-etape-infos');
verifier('le parcours « établissement » mène bien à l’étape des informations', Boolean(etape1 && etape3));

// ── Étape 3 : nom, position (GPS), et le COMPTE dans le même parcours ────
await remplir('input[placeholder="Ex. Chez Fatou"]', NOM_FICHE);
const positionPrete = await jusqua('document.body.innerText.includes("Position enregistrée")', { maxMs: 15000 });
verifier('la position du téléphone est reprise automatiquement', Boolean(positionPrete));
verifier(
  'le compte se crée DANS le parcours : téléphone et mot de passe demandés ici',
  (await texte()).includes('Créer mon compte')
);
await remplir('input[type="tel"]', '0700000099'); // numéro affiché sur la fiche
await page.evaluer(`(() => {
  const champs = [...document.querySelectorAll('input[type="tel"]')];
  const dernier = champs[champs.length - 1];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(dernier, ${JSON.stringify(TELEPHONE_ESSAI)});
  dernier.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await remplir('input[type="password"]', MOT_DE_PASSE);
await capture('inscription-compte-et-infos');

// ── Publication : le compte est créé PUIS la fiche publiée ──────────────
await cliquer('Publier ma fiche');
const publiee = await jusqua('location.pathname.startsWith("/etablissement/")', { maxMs: 30000 });
const contenuFiche = await texte();
await capture('fiche-publiee');
if (!publiee) {
  // Diagnostic : on imprime ce que l'écran dit réellement (bandeau d'erreur compris).
  console.log(`     [diagnostic] resté sur ${await chemin()} — écran : ${(await texte()).slice(0, 400).replace(/\s+/g, ' ')}`);
}
verifier('la fiche est publiée et s’ouvre (aucune redirection vers la connexion)', Boolean(publiee), await chemin());
verifier('la fiche porte bien le nom saisi', contenuFiche.includes(NOM_FICHE));

const masquesFiche = await boutonsMasques();
verifier(
  'la bannière d’installation ne recouvre aucun bouton sur la fiche',
  masquesFiche.masques.length === 0,
  `${masquesFiche.total} bouton(s) visible(s)${masquesFiche.masques.length ? ` — masqué(s) : ${JSON.stringify(masquesFiche.masques)}` : ''}`
);

// ── La fiche doit apparaître dans l'accueil (proximité) ─────────────────
await page.send('Page.navigate', { url: `${ORIGINE}/` });
const dansAccueil = await jusqua(`document.body.innerText.includes(${JSON.stringify(NOM_FICHE)})`, { maxMs: 30000 });
await capture('accueil-nouvelle-fiche');
verifier('la fiche apparaît dans l’accueil, à proximité', Boolean(dansAccueil));

// ── … et dans la recherche ──────────────────────────────────────────────
await page.send('Page.navigate', { url: `${ORIGINE}/recherche?q=${encodeURIComponent(NOM_FICHE)}` });
const dansRecherche = await jusqua(`document.body.innerText.includes(${JSON.stringify(NOM_FICHE)})`, { maxMs: 30000 });
const masquesRecherche = await boutonsMasques();
await capture('recherche-nouvelle-fiche');
verifier('la fiche apparaît dans la recherche', Boolean(dansRecherche));
verifier(
  'la bannière d’installation ne recouvre aucun bouton sur la recherche',
  masquesRecherche.masques.length === 0,
  `${masquesRecherche.total} bouton(s) visible(s)`
);

// ── Rapport (et rappel de ce qu'il faut supprimer) ──────────────────────
writeFileSync(
  join(SORTIE, '_rapport.json'),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      pageServie: ORIGINE,
      compteDEssai: TELEPHONE_ESSAI,
      ficheCreee: NOM_FICHE,
      verifications: { reussies: reussis, echecs },
      captures: readdirSync(SORTIE).filter((f) => f.endsWith('.png')),
      nettoyage: `cd backend && node scripts/supprimer-parcours-test.js --telephone=${TELEPHONE_ESSAI} --oui`,
    },
    null,
    2
  ),
  'utf8'
);

console.log(`\n${'─'.repeat(72)}`);
console.log(`  Résultat : ${reussis} vérification(s) réussie(s), ${echecs.length} échec(s)`);
for (const e of echecs) console.log(`   • ${e}`);
console.log(`  Captures et rapport : ${SORTIE}`);
console.log(`  À SUPPRIMER (créé par ce test) : compte ${TELEPHONE_ESSAI}, fiche « ${NOM_FICHE} »`);
console.log(`  cd backend && node scripts/supprimer-parcours-test.js --telephone=${TELEPHONE_ESSAI} --oui`);
console.log('');

serveur.close();
try {
  await navigateur.send('Browser.close');
} catch {
  /* fenêtre déjà fermée */
}
// Chrome relâche ses verrous par vagues sous Windows : on attend sa sortie réelle.
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
if (echecs.length > 0) process.exitCode = 1;
