// capture-ecrans.mjs — captures d'écran de l'app + relevé des styles calculés.
//
// Pourquoi ce script ? Deux raisons concrètes, apprises à la dure :
//
//  1. Chrome a supprimé la capture en ligne de commande (`--screenshot`), et
//     l'app est mobile-first : il faut un vrai moteur de rendu à 390×844 pour
//     juger l'affichage (pas une inspection du code).
//  2. Vérifier un thème « à l'œil » ne suffit pas : le script relève aussi les
//     STYLES CALCULÉS (dégradé d'en-tête, motif de fond, absence d'aplat orange,
//     vert de la section santé, barre de filtres toujours collante). C'est ce
//     rapport JSON qui prouve qu'une refonte est réellement appliquée.
//
// Aucune dépendance ajoutée : Node >= 22 fournit `fetch` et `WebSocket`, et l'on
// pilote le Chrome déjà installé sur la machine via le protocole DevTools (CDP).
//
// Usage :
//   node scripts/capture-ecrans.mjs <dossier-sortie> [nom=url[|clic=sélecteur][|simule=installee] ...]
//   npm run captures -- captures-refonte
//   npm run captures -- captures-refonte "accueil=http://localhost:5173/" "fiche=<url>|clic=.bouton-principal"
//   npm run captures -- captures-refonte "menu=<url>|clic=[data-bouton-menu]|simule=installee"
//
// Options d'une cible :
//   |clic=<sélecteur>     clique cet élément avant la capture ;
//   |defile=<sélecteur>   fait défiler jusqu'à cet élément (une entrée de menu en
//                         bas du tiroir, par exemple) avant la capture ;
//   |simule=installee     fait croire à la page qu'elle tourne depuis l'écran
//                         d'accueil (`display-mode: standalone`). Sert à vérifier
//                         qu'une app DÉJÀ INSTALLÉE n'affiche plus aucun bandeau
//                         d'installation flottant, ce qui est impossible à voir
//                         depuis un navigateur de bureau autrement.
//
// Sans cible indiquée, la production publiée sur GitHub Pages est capturée.
// Chrome est cherché dans les emplacements habituels, ou imposé par CHROME_PATH.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { lirePng } from './png.mjs';

/** Adresse publiée, utilisée quand aucune cible n'est passée en argument. */
const URL_PRODUCTION = 'https://ouatthamed250-bit.github.io/rejoins-moi/';

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

const PORT = 9333;
const outDir = process.argv[2];

if (!outDir || !CHROME) {
  console.error(
    !outDir
      ? 'Usage : node scripts/capture-ecrans.mjs <dossier-sortie> [nom=url ...]'
      : `Chrome introuvable. Indiquez son chemin : CHROME_PATH="..." node scripts/capture-ecrans.mjs ${outDir}`
  );
  process.exit(1);
}

const cibles = (process.argv.slice(3).length
  ? process.argv.slice(3)
  : [`production=${URL_PRODUCTION}`]
).map((argument) => {
  const [cible, ...options] = argument.split('|');
  const separateur = cible.indexOf('=');
  const option = (nom) => {
    const trouve = options.find((o) => o.startsWith(`${nom}=`));
    return trouve ? trouve.slice(nom.length + 1) : null;
  };
  return {
    nom: cible.slice(0, separateur),
    url: cible.slice(separateur + 1),
    clic: option('clic'),
    defile: option('defile'),
    simule: option('simule'),
  };
});

mkdirSync(outDir, { recursive: true });
const logFile = join(outDir, '_capture.log');
const log = (message) => {
  appendFileSync(logFile, `${new Date().toISOString()}  ${message}\n`);
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* Profil Chrome JETABLE, propre à chaque exécution : sans cela, le service worker
   de la capture précédente resservirait l'ancien index.html depuis son cache et
   l'on photographierait l'ANCIEN thème — précisément le piège que la mise à jour
   du worker (v5) corrige. Un dossier par PID permet aussi deux captures en
   parallèle, et il est effacé à la fin pour ne pas encombrer TEMP. */
const PROFIL = join(process.env.TEMP || '.', `chrome-cdp-rejoins-${process.pid}`);

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
}

/** Attend que la page soit rendue ET stable. On ne se fie pas au premier rendu :
 *  le feed attend d'abord la position (repli Plateau au bout de 8 s) puis l'API,
 *  sinon on photographie un écran vide. D'où : au moins 12 s, puis deux mesures
 *  consécutives identiques. */
async function attendreStable(cdp, maxMs = 30000) {
  const debut = Date.now();
  let precedente = -1;
  let stable = 0;
  while (Date.now() - debut < maxMs) {
    let longueur = 0;
    try {
      longueur = await cdp.evaluer('document.body ? document.body.innerText.length : 0');
    } catch {
      longueur = 0;
    }
    if (longueur === precedente) stable += 1;
    else stable = 0;
    precedente = longueur;
    if (Date.now() - debut > 12000 && stable >= 2) return true;
    await pause(700);
  }
  return false;
}

/* ── Simulation « app installée » (option |simule=installee) ──
   pwa.js lit `display-mode` au premier import : il faut donc mentir AVANT tout
   chargement de page, d'où une injection `Page.addScriptToEvaluateOnNewDocument`
   (et non une évaluation après coup). C'est le seul moyen de vérifier depuis un
   ordinateur ce que voit un téléphone sur lequel l'app est DÉJÀ installée. */
const SIMULATION_INSTALLEE = `(() => {
  const vrai = window.matchMedia.bind(window);
  window.matchMedia = (requete) => {
    if (String(requete).includes('display-mode: standalone')) {
      return {
        matches: true,
        media: requete,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      };
    }
    return vrai(requete);
  };
})();`;

/* ── Contrôle du fondu d'en-tête, sur les PIXELS de la capture ──
   Le défaut signalé (« le bloc orange du haut s'arrête net ») ne se lit pas dans
   le CSS : il faut regarder l'image. Pour chaque ligne du haut de l'écran, on
   mesure la teinte orange (R − B : ~7 pour l'ivoire pur, ~43 pour le haut de
   l'en-tête) au 75e centile des colonnes — quasi-maximum, donc insensible au
   texte et aux icônes, qui n'occupent qu'une minorité de la largeur.
   Une MARCHE d'une ligne à l'autre trahit soit une rampe qui redémarre (saut vers
   le haut), soit un liseré ou une bordure (saut vers le bas).
   La mesure est bornée à la fenêtre que le thème CONTRÔLE (--haut-degrade, lu
   dans la page) : au-delà, le contenu (cartes, titres, tiroir du menu) prend la
   majorité de la largeur et fausserait la lecture. */
const SEUIL_MARCHE = 6;
function analyserRaccord(chemin, fenetre) {
  const image = lirePng(chemin);
  const hauteur = Math.min(fenetre, image.height);
  const lignes = [];
  for (let y = 0; y < hauteur; y += 1) {
    const teintes = [];
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      teintes.push(image.pixels[i] - image.pixels[i + 2]);
    }
    teintes.sort((a, b) => a - b);
    lignes.push(teintes[Math.floor(teintes.length * 0.75)]);
  }
  let marcheMax = 0;
  let ligneMarche = 0;
  for (let y = 1; y < lignes.length; y += 1) {
    const delta = Math.abs(lignes[y] - lignes[y - 1]);
    if (delta > marcheMax) {
      marcheMax = delta;
      ligneMarche = y;
    }
  }
  // Profil lisible dans le rapport JSON : une valeur toutes les 8 lignes.
  const profil = lignes.filter((_, index) => index % 8 === 0);
  return {
    fenetre: hauteur,
    profil,
    marcheMax,
    ligneMarche,
    seuil: SEUIL_MARCHE,
    conforme: marcheMax <= SEUIL_MARCHE,
  };
}

/* Relevé de styles calculés : la preuve que le thème est bien celui attendu.
   ATTENTION : tout ce bloc est un littéral de gabarit — ne jamais y écrire de
   backtick (il fermerait le littéral et le script ne démarrerait plus). */
const RAPPORT = `(() => {
  const cs = (selecteur, pseudo) => {
    const el = document.querySelector(selecteur);
    if (!el) return null;
    const s = getComputedStyle(el, pseudo || null);
    const boite = el.getBoundingClientRect();
    return {
      backgroundImage: s.backgroundImage.slice(0, 120),
      backgroundColor: s.backgroundColor,
      backgroundSize: s.backgroundSize,
      backgroundPosition: s.backgroundPosition,
      color: s.color,
      borderColor: s.borderColor,
      // « Ligne de coupure » cherchée le 30/09 : une bordure basse, une ombre ou
      // une marge laisseraient un trait visible entre l'en-tête et le contenu.
      borderBottomWidth: s.borderBottomWidth,
      borderBottomColor: s.borderBottomColor,
      boxShadow: s.boxShadow.slice(0, 70),
      animation: s.animationName,
      hauteur: Math.round(boite.height),
    };
  };
  return {
    bodyFond: getComputedStyle(document.body).backgroundColor,
    barreDuHaut: cs('[data-barre-haut]'),
    fonduEntete: cs('[data-fondu-entete]'),
    banniereAccueil: cs('[data-banniere-accueil]'),
    motifFond: cs('.fond-traits-fins', '::before'),
    boutonPrincipal: cs('.bouton-principal'),
    carte: cs('.carte'),
    sante: {
      carteSante: cs('.carte-health'),
      lisererVert: cs('.border-l-health'),
      boutonSante: cs('.btn-health'),
    },
    // Fiches SANS photo : le visuel de secours doit rester ivoire. Un
    // backgroundImage en linear-gradient(...#FF9A4D...) ou #F9680B signalerait
    // le retour de l'aplat orange que la v2 a supprimé.
    photoSecours: (() => {
      const elements = document.querySelectorAll('[data-photo-secours]');
      if (!elements.length) return { nombre: 0 };
      const s = getComputedStyle(elements[0]);
      return {
        nombre: elements.length,
        backgroundColor: s.backgroundColor,
        backgroundImage: s.backgroundImage.slice(0, 90),
        pastille: getComputedStyle(elements[0].firstElementChild).color,
      };
    })(),
    // Bannière d'installation : affichée seulement si le navigateur a émis son
    // invite (0 est donc un résultat normal en capture automatique).
    banniereInstallation: (() => {
      const el = document.querySelector('[data-banniere-installation]');
      if (!el) return { affichee: false };
      const s = getComputedStyle(el);
      return { affichee: true, backgroundColor: s.backgroundColor, couleurTexte: s.color };
    })(),
    // Entrée « Application » du menu hamburger : c'est elle qui porte l'installation
    // (bouton, ou repère « App installée ») une fois la bannière flottante retirée.
    optionMenuInstallation: (() => {
      const el = document.querySelector('[data-option-installation]');
      if (!el) return { presente: false };
      return { presente: true, texte: el.innerText.replace(/\s+/g, ' ').slice(0, 160) };
    })(),
    // « L'app se croit-elle installée ? » — utile quand on capture avec
    // |simule=installee pour prouver qu'aucun bandeau ne flotte plus.
    modeStandalone: window.matchMedia('(display-mode: standalone)').matches,
    // La barre de filtres du feed doit rester COLLANTE : le motif de fond est
    // posé en z-index -1 (et non en surélevant tous les enfants, ce qui aurait
    // écrasé position: sticky).
    filtreColle: (() => {
      const nav = document.querySelector('.puces');
      if (!nav) return { trouve: false };
      const position = getComputedStyle(nav).position;
      window.scrollTo(0, 700);
      const boite = nav.getBoundingClientRect();
      return {
        trouve: true,
        position,
        topApresDefilement: Math.round(boite.top),
        resteVisible: boite.top >= 0 && boite.top < 200,
      };
    })(),
    compteurs: {
      enteteDegrade: document.querySelectorAll('.entete-degrade').length,
      motifFond: document.querySelectorAll('.fond-traits-fins').length,
      boutonPrincipal: document.querySelectorAll('.bouton-principal').length,
      ctaMajeur: document.querySelectorAll('.bouton-principal--cta-majeur').length,
      classesV1Residuelles: document.querySelectorAll('.btn-primary').length,
    },
    texte: document.body.innerText.slice(0, 400),
  };
})()`;

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
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  const rapport = {};
  for (const { nom, url, clic, defile, simule } of cibles) {
    log(`-> ${nom} : ${url}`);
    // « App installée » simulée : le mensonge doit être en place AVANT le premier
    // chargement (pwa.js lit `display-mode` au moment où le module s'exécute).
    let injection = null;
    if (simule === 'installee') {
      injection = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: SIMULATION_INSTALLEE,
      });
      log('  app installée simulée (display-mode: standalone)');
    }
    await cdp.send('Page.navigate', { url });
    const stable = await attendreStable(cdp);
    // Étape optionnelle : un clic (sélecteur CSS) pour atteindre un écran qui
    // n'existe qu'après interaction — par exemple le CTA de l'étape 0 de
    // l'inscription, qui porte la classe cta-majeur.
    if (clic) {
      const fait = await cdp.evaluer(
        `(() => { const el = document.querySelector(${JSON.stringify(clic)}); if (!el) return 0; el.click(); return 1; })()`
      );
      log(`  clic sur « ${clic} » : ${fait ? 'ok' : 'SELECTEUR INTROUVABLE'}`);
      await pause(2500);
    }
    // Étape optionnelle : amener un élément sous les yeux (entrée en bas d'un
    // tiroir défilant), sans quoi la capture ne montrerait que le haut du tiroir.
    if (defile) {
      const fait = await cdp.evaluer(
        `(() => { const el = document.querySelector(${JSON.stringify(defile)}); if (!el) return 0; el.scrollIntoView({ block: 'center' }); return 1; })()`
      );
      log(`  defile jusqu'à « ${defile} » : ${fait ? 'ok' : 'SELECTEUR INTROUVABLE'}`);
      await pause(1200);
    }
    const hauteur = await cdp.evaluer('document.documentElement.scrollHeight');
    const image = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      // Bornée à 2400 px : au-delà, l'image devient énorme pour rien.
      clip: { x: 0, y: 0, width: 390, height: Math.min(hauteur, 2400), scale: 1 },
    });
    const cheminImage = join(outDir, `${nom}.png`);
    writeFileSync(cheminImage, Buffer.from(image.data, 'base64'));
    rapport[nom] = await cdp.evaluer(RAPPORT);
    // ── Contrôle du fondu d'en-tête, sur les PIXELS de la capture ──
    // Il ne s'applique qu'à une capture de PAGE, sans interaction : un tiroir
    // ouvert recouvre l'en-tête et la mesure ne dirait plus rien du raccord.
    if (clic || defile) {
      rapport[nom].raccordEntete = {
        mesure: false,
        raison: 'capture avec interaction (tiroir ou écran ouvert) : hors sujet pour le fondu',
      };
      log("  raccord d'en-tête : non mesuré (tiroir ouvert)");
    } else {
      // La fenêtre mesurée est celle du thème (--haut-degrade, lue dans la page),
      // convertie en PIXELS D'IMAGE : la capture est prise en 2×
      // (devicePixelRatio), sinon on n'analyserait que la moitié du fondu.
      const fenetre = await cdp.evaluer(
        `(() => {
           const valeur = getComputedStyle(document.documentElement).getPropertyValue('--haut-degrade');
           const nombre = parseInt(valeur, 10);
           const hauteur = Number.isFinite(nombre) ? nombre : 132;
           return Math.round(hauteur * (window.devicePixelRatio || 1));
         })()`
      );
      rapport[nom].raccordEntete = { mesure: true, ...analyserRaccord(cheminImage, fenetre) };
      log(
        `  raccord d'en-tête (fenêtre ${fenetre} px d'image) : teinte ${rapport[nom].raccordEntete.profil.join(' → ')}, ` +
          `marche max ${rapport[nom].raccordEntete.marcheMax} px (ligne ${rapport[nom].raccordEntete.ligneMarche}) — ` +
          `${rapport[nom].raccordEntete.conforme ? 'CONFORME' : 'MARCHE VISIBLE'}`
      );
    }
    log(`${nom} : ${stable ? 'stable' : 'DELAI DEPASSE'} — hauteur ${hauteur}px — ${nom}.png ecrit`);
    if (injection) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: injection.identifier,
      });
    }
  }
  writeFileSync(join(outDir, '_rapport.json'), JSON.stringify(rapport, null, 2), 'utf8');
  log('rapport ecrit');
  try {
    await cdp.send('Browser.close');
  } catch {
    /* sans importance */
  }
  effacerProfil();
  process.exit(0);
} catch (erreur) {
  log(`ERREUR : ${erreur.message}`);
  try {
    chrome.kill();
  } catch {
    /* sans importance */
  }
  effacerProfil();
  process.exit(1);
}
