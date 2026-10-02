// capture-admin.mjs — Captures d'écran du BACK-OFFICE (/admin), pilotées par CDP.
//
// Pourquoi ce script ? Le back-office est un outil interne, séparé de l'app mobile
// (styles/admin.css, préfixe `bo-`). Il ne se juge pas dans le code : il faut ouvrir
// la page, se connecter, et regarder chaque écran. Chrome a supprimé la capture en
// ligne de commande (--screenshot) : on pilote donc le Chrome déjà installé via le
// protocole DevTools, comme scripts/capture-ecrans.mjs.
//
// Ce script va PLUS LOIN qu'une capture : il se connecte réellement avec le compte
// administrateur fourni (formulaire rempli, puis soumis), parcourt les 5 sections de
// la barre latérale, et relève pour chacune ce qui est affiché (titres, compteurs,
// nombre de lignes de tableau, texte visible) + les erreurs de console. C'est ce
// rapport JSON qui prouve que les écrans sont peuplés par l'API, pas seulement jolis.
//
// Usage (depuis /frontend) :
//   node scripts/capture-admin.mjs <dossier-sortie> [identifiant] [motDePasse]
// Les identifiants par défaut viennent de ADMIN_IDENTIFIANT / ADMIN_MOT_DE_PASSE
// (compte de TEST attendu : jamais le compte administrateur réel).
//
// Prérequis : backend local (port 4000) + serveur de développement Vite (5173),
// avec frontend/.env.local qui force VITE_API_URL vide (appels relatifs → proxy).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROMES_CONNUS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const CHROME =
  process.env.CHROME_PATH || CHROMES_CONNUS.find((chemin) => chemin && existsSync(chemin));

const PORT = 9334;
const outDir = process.argv[2];
const IDENTIFIANT = process.argv[3] || process.env.ADMIN_IDENTIFIANT || '0700000001';
const MOT_DE_PASSE = process.argv[4] || process.env.ADMIN_MOT_DE_PASSE || 'Test-Audit-2026-x9';
const URL_ADMIN = process.env.URL_ADMIN || 'http://localhost:5173/admin';

if (!outDir || !CHROME) {
  console.error(
    !outDir
      ? 'Usage : node scripts/capture-admin.mjs <dossier-sortie> [identifiant] [motDePasse]'
      : `Chrome introuvable. Indiquez son chemin : CHROME_PATH="..." node scripts/capture-admin.mjs ${outDir}`
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const PROFIL = join(process.env.TEMP || '.', `chrome-cdp-admin-${process.pid}`);

const log = (texte) => console.log(texte);
const pause = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms));

const effacerProfil = () => {
  try {
    rmSync(PROFIL, { recursive: true, force: true });
  } catch {
    /* Chrome tient encore un fichier : sans importance, le dossier est jetable */
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
    `--user-data-dir=${PROFIL}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

async function attendreCdp(maxMs = 20000) {
  const debut = Date.now();
  while (Date.now() - debut < maxMs) {
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (reponse.ok) return reponse.json();
    } catch {
      /* pas encore prêt */
    }
    await pause(300);
  }
  throw new Error('CDP indisponible');
}

/** Client minimal du protocole DevTools : une méthode, une réponse. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.attentes = new Map();
    this.erreurs = [];
    ws.addEventListener('message', (evenement) => {
      const message = JSON.parse(evenement.data);
      // Erreurs de page / de console : la preuve qu'un écran tourne « propre ».
      if (message.method === 'Runtime.exceptionThrown') {
        this.erreurs.push(
          String(message.params?.exceptionDetails?.exception?.description || 'exception').slice(0, 160)
        );
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.erreurs.push(
          (message.params.args || [])
            .map((a) => String(a.value ?? a.description ?? ''))
            .join(' ')
            .slice(0, 160)
        );
      }
      if (message.id && this.attentes.has(message.id)) {
        const { resolve, reject } = this.attentes.get(message.id);
        this.attentes.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
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
    const reponse = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reponse.exceptionDetails) throw new Error(JSON.stringify(reponse.exceptionDetails));
    return reponse.result.value;
  }

  /** Attend que la page soit rendue ET stable (texte identique deux mesures de suite). */
  async attendreStable(minMs = 2500, maxMs = 30000) {
    const debut = Date.now();
    let precedente = -1;
    let stable = 0;
    while (Date.now() - debut < maxMs) {
      let longueur = 0;
      try {
        longueur = await this.evaluer('document.body ? document.body.innerText.length : 0');
      } catch {
        longueur = 0;
      }
      if (longueur === precedente) stable += 1;
      else stable = 0;
      precedente = longueur;
      if (Date.now() - debut > minMs && stable >= 2) return true;
      await pause(500);
    }
    return false;
  }

  /** Attend l'apparition d'un sélecteur. Nécessaire au PREMIER chargement : Vite
   *  compile l'application à la demande, ce qui peut prendre une dizaine de secondes. */
  async attendreSelecteur(selecteur, maxMs = 45000) {
    const debut = Date.now();
    while (Date.now() - debut < maxMs) {
      const present = await this.evaluer(
        `Boolean(document.querySelector(${JSON.stringify(selecteur)}))`
      ).catch(() => false);
      if (present) return true;
      await pause(400);
    }
    return false;
  }
}

/* Relevé d'un écran du back-office. ATTENTION : littéral de gabarit — ne jamais y
   écrire de backtick, il fermerait le littéral et le script ne démarrerait plus. */
const RAPPORT_ECRAN = `(() => {
  const net = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
  const texte = (sel) => {
    const el = document.querySelector(sel);
    return el ? net(el.innerText).slice(0, 200) : null;
  };
  const tuiles = Array.from(document.querySelectorAll('.bo-tuile')).map((el) => ({
    libelle: net((el.querySelector('.bo-tuile-libelle') || {}).innerText).slice(0, 60),
    valeur: net((el.querySelector('.bo-tuile-valeur') || {}).innerText).slice(0, 40),
    note: net((el.querySelector('.bo-tuile-note') || {}).innerText).slice(0, 60),
  })).slice(0, 14);
  const tableau = document.querySelector('table');
  return {
    titreEcran: texte('.bo-entete-titre') || texte('h1'),
    sousTitreEcran: texte('.bo-entete-sous'),
    identiteAdmin: (texte('.bo-nav-identite-nom') || '') + ' / ' + (texte('.bo-nav-identite-numero') || ''),
    sectionsNav: Array.from(document.querySelectorAll('.bo-nav-lien-texte')).map((e) => net(e.innerText)),
    sectionActive: texte('.bo-nav-lien--actif'),
    tuiles: tuiles,
    onglets: Array.from(document.querySelectorAll('.bo-onglet')).map((e) => net(e.innerText).slice(0, 40)),
    ongletActif: texte('.bo-onglet--actif'),
    badges: Array.from(document.querySelectorAll('.bo-badge')).map((e) => net(e.innerText).slice(0, 30)).slice(0, 12),
    panneaux: Array.from(document.querySelectorAll('.bo-panneau-titre')).map((e) => net(e.innerText).slice(0, 60)).slice(0, 8),
    lignesTableau: tableau ? tableau.querySelectorAll('tbody tr').length : 0,
    colonnesTableau: tableau ? tableau.querySelectorAll('thead th').length : 0,
    messagesVides: Array.from(document.querySelectorAll('.bo-vide, .bo-vide-titre')).map((e) => net(e.innerText).slice(0, 120)).slice(0, 4),
    chargementEncoreAffiche: document.querySelectorAll('.bo-chargement, .bo-squelette').length,
    texteVisible: net(document.body.innerText).slice(0, 700),
  };
})()`;

let cdp = null;

try {
  const version = await attendreCdp();
  log(`Chrome ${version.Browser} piloté sur le port ${PORT}`);
  const liste = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = liste.find((cible) => cible.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resoudre, rejeter) => {
    ws.addEventListener('open', resoudre);
    ws.addEventListener('error', rejeter);
  });

  cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // Écran large : le back-office est un outil de bureau (barre latérale de 244 px + tableaux).
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const rapport = {};

  /** Attend la stabilité, photographie la page entière et relève ce qui est affiché. */
  async function photographier(nom, { minMs = 2500 } = {}) {
    const stable = await cdp.attendreStable(minMs);
    const hauteur = await cdp.evaluer('document.documentElement.scrollHeight');
    const image = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      // Bornée à 2600 px : au-delà, l'image devient énorme pour rien.
      clip: { x: 0, y: 0, width: 1440, height: Math.min(hauteur, 2600), scale: 1 },
    });
    writeFileSync(join(outDir, `${nom}.png`), Buffer.from(image.data, 'base64'));
    rapport[nom] = await cdp.evaluer(RAPPORT_ECRAN);
    log(`  ${nom}.png ${stable ? '' : '(STABILITÉ NON ATTEINTE) '}— « ${rapport[nom].titreEcran || 'sans titre'} »`);
    return rapport[nom];
  }

  // ── 1. Écran de connexion ───────────────────────────────────────────────────
  log(`-> ${URL_ADMIN}`);
  await cdp.send('Page.navigate', { url: URL_ADMIN });
  const formulairePret = await cdp.attendreSelecteur('.bo-connexion-boite');
  log(`  formulaire de connexion : ${formulairePret ? 'affiché' : 'ABSENT (45 s)'}`);
  if (!formulairePret) {
    await photographier('admin-00-page-blanche', { minMs: 800 });
    throw new Error('écran de connexion introuvable : l’application ne s’est pas rendue');
  }
  await photographier('admin-01-connexion', { minMs: 1200 });

  // ── 2. Connexion réelle par le formulaire (pas d'injection de jeton) ────────
  const rempli = await cdp.evaluer(`(() => {
    const form = document.querySelector('form.bo-connexion-boite');
    if (!form) return 'formulaire introuvable';
    const champs = form.querySelectorAll('input');
    if (champs.length < 2) return 'champs introuvables';
    const poser = (el, valeur) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, valeur);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    poser(champs[0], ${JSON.stringify(IDENTIFIANT)});
    poser(champs[1], ${JSON.stringify(MOT_DE_PASSE)});
    return 'rempli';
  })()`);
  log(`  formulaire de connexion : ${rempli}`);
  await pause(400);
  const soumis = await cdp.evaluer(
    `(() => { const f = document.querySelector('form.bo-connexion-boite'); if (!f) return 'formulaire perdu'; f.requestSubmit(); return 'soumis'; })()`
  );
  log(`  soumission : ${soumis}`);

  // ── 3. La barre latérale apparaît = le jeton admin est accepté ──────────────
  let connecte = false;
  for (let i = 0; i < 40 && !connecte; i += 1) {
    connecte = await cdp.evaluer("Boolean(document.querySelector('.bo-nav'))");
    if (!connecte) await pause(500);
  }
  if (!connecte) {
    const erreur = await cdp.evaluer(
      "(() => { const a = document.querySelector('.bo-alerte--erreur'); return a ? a.innerText.trim().slice(0, 200) : null; })()"
    );
    await photographier('admin-02-echec-connexion', { minMs: 800 });
    throw new Error(`connexion refusée : ${erreur || 'barre latérale absente'}`);
  }
  log('  connexion acceptée (barre latérale affichée)');
  await photographier('admin-02-tableau-de-bord');

  // ── 4. Les quatre autres sections de la barre latérale ─────────────────────
  const SECTIONS = [
    ['Dépôts', 'admin-03-depots'],
    ['Utilisateurs', 'admin-04-utilisateurs'],
    ['Activité', 'admin-05-activite'],
    ['Mon profil', 'admin-06-mon-profil'],
  ];
  for (const [libelle, nom] of SECTIONS) {
    const clique = await cdp.evaluer(`(() => {
      const lien = Array.from(document.querySelectorAll('.bo-nav-lien')).find((b) => (b.innerText || '').trim().startsWith(${JSON.stringify(libelle)}));
      if (!lien) return false;
      lien.click();
      return true;
    })()`);
    log(`  section « ${libelle} » : ${clique ? 'ouverte' : 'LIEN INTROUVABLE'}`);
    if (!clique) continue;
    await pause(1200);
    await photographier(nom);
  }

  // ── 5. Rapport lisible (et exploitable pour l'audit) ───────────────────────
  writeFileSync(join(outDir, '_rapport-admin.json'), JSON.stringify(rapport, null, 2), 'utf8');
  log(`\nRapport écrit : ${join(outDir, '_rapport-admin.json')}`);
  log('\nCe que montrent les captures :');
  for (const [nom, releve] of Object.entries(rapport)) {
    const tuiles = (releve.tuiles || []).map((t) => `${t.libelle}=${t.valeur}`).join(' · ') || '—';
    log(`  • ${nom}`);
    log(`      écran : ${releve.titreEcran || '(sans titre)'}${releve.sectionActive ? ` [actif : ${releve.sectionActive}]` : ''}`);
    log(`      identité admin : ${releve.identiteAdmin || '(hors session)'}`);
    log(`      tuiles : ${tuiles}`);
    log(`      tableau : ${releve.lignesTableau} ligne(s) × ${releve.colonnesTableau} colonne(s)`);
    if (releve.chargementEncoreAffiche) log(`      ⚠ chargement encore affiché (${releve.chargementEncoreAffiche})`);
  }
  if (cdp.erreurs.length) {
    log(`\n⚠ ${cdp.erreurs.length} erreur(s) console/page :`);
    for (const e of [...new Set(cdp.erreurs)]) log(`   • ${e}`);
  } else {
    log('\nAucune erreur de console détectée pendant le parcours.');
  }
  log(`\nImages : ${outDir}\\admin-01-connexion.png → admin-06-mon-profil.png`);

  try {
    await cdp.send('Browser.close');
  } catch {
    /* sans importance */
  }
  effacerProfil();
  process.exit(0);
} catch (erreur) {
  log(`ERREUR : ${erreur.message}`);
  if (cdp && cdp.erreurs.length) {
    log(`\n${cdp.erreurs.length} erreur(s) console/page relevée(s) :`);
    for (const e of [...new Set(cdp.erreurs)]) log(`   • ${e}`);
  }
  try {
    chrome.kill();
  } catch {
    /* sans importance */
  }
  effacerProfil();
  process.exit(1);
}

