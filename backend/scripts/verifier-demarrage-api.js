// verifier-demarrage-api.js — MESURE du démarrage de l'API (bloc A).
//
// Répond à la question posée : « GET /api/establishments est-il encore lent à
// chaud, et où partent les secondes ? »
//
// Le script fait des appels RÉELS (aucun mock) à l'API de production, avec de
// vraies coordonnées (Plateau, Abidjan), et mesure chaque PHASE de la requête :
//
//   dns      : résolution du nom          -> réseau
//   connect  : poignée de main TCP        -> réseau (1 aller-retour)
//   tls      : fin de la poignée HTTPS    -> réseau (2 allers-retours)
//   ttfb     : 1er octet de réponse reçue -> handshake + 1 RTT + TRAVAIL SERVEUR
//   total    : corps complet reçu         -> + transfert des données
//
// Temps réseau pur  = handshake (dns + tcp + tls) et le RTT estimé (connect - dns).
// Temps serveur     = ttfb - handshake - RTT : la part qui n'est ni le handshake ni
//                     le trajet du paquet, c'est-à-dire Express + requête MongoDB.
//
// Deux modes :
//   --chaud            (défaut) plusieurs appels à la suite.
//   --froid            UN SEUL appel, sur une connexion neuve, après une pause
//                      d'inactivité (voir --attendre-minutes). C'est le cas
//                      « j'ouvre l'app le matin » : sur l'offre gratuite de
//                      Render, l'instance s'endort et doit redémarrer.
//
// Options :
//   --url=<base>                 défaut : VITE_API_URL ou l'API Render publiée
//   --attendre-minutes=<n>       pause AVANT la mesure (mode froid uniquement)
//   --json=<fichier>             écrit le rapport JSON complet
//   --lat/--lng                  coordonnées réelles utilisées
//
// Lancement (depuis /backend) :
//   node scripts/verifier-demarrage-api.js --chaud
//   node scripts/verifier-demarrage-api.js --froid --attendre-minutes=20 --json=captures-demarrage/froid.json

import https from 'node:https';
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const option = (nom, defaut = null) => {
  const trouve = args.find((a) => a === `--${nom}` || a.startsWith(`--${nom}=`));
  if (!trouve) return defaut;
  const [, valeur] = trouve.split('=');
  return valeur === undefined ? true : valeur;
};

const URL_BASE = String(
  option('url') || process.env.VITE_API_URL || 'https://rejoins-moi-api.onrender.com'
).replace(/\/$/, '');
const COORDS = {
  lat: Number(option('lat', 5.3242)), // Plateau, Abidjan — position RÉELLE de terrain
  lng: Number(option('lng', -4.0206)),
};
const MODE_FROID = Boolean(option('froid', false));
const ATTENDRE_MINUTES = Number(option('attendre-minutes', 0)) || 0;
const FICHIER_JSON = option('json', null);
const APPELS_CHAUDS = Number(option('appels', 3)) || 3;

const CHEMIN = `/api/establishments?limit=30&page=1&diversite=0&lat=${COORDS.lat}&lng=${COORDS.lng}`;
const URL_COMPLETE = `${URL_BASE}${CHEMIN}`;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const arrondi = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

/**
 * Un appel HTTP instrumenté. `agent: false` = connexion neuve (aucune réutilisation
 * du socket), c'est-à-dire exactement ce que fait un téléphone qui arrive sur l'app.
 */
function mesurer(url) {
  return new Promise((resolve, reject) => {
    const depart = process.hrtime.bigint();
    const ecouleMs = () => Number(process.hrtime.bigint() - depart) / 1e6;
    const phases = {};

    const client = url.startsWith('https:') ? https : http;
    const requete = client.get(url, { agent: false, headers: { Accept: 'application/json' } }, (reponse) => {
      phases.ttfb = ecouleMs();
      phases.statut = reponse.statusCode;
      let octets = 0;
      reponse.on('data', (bloc) => {
        octets += bloc.length;
      });
      reponse.on('end', () => {
        phases.total = ecouleMs();
        phases.octets = octets;
        phases.typeContenu = reponse.headers['content-type'] || '';
        // En-tête ajouté par l'API (middleware de journalisation) : temps de
        // traitement MESURÉ côté serveur, à comparer avec notre estimation.
        phases.tempsServeurEnteteMs = reponse.headers['x-temps-serveur']
          ? Number(String(reponse.headers['x-temps-serveur']).replace('ms', ''))
          : null;
        resolve(phases);
      });
      reponse.on('error', reject);
    });

    requete.on('socket', (socket) => {
      if (!socket.connecting) return;
      socket.once('lookup', () => {
        phases.dns = ecouleMs();
      });
      socket.once('connect', () => {
        phases.connect = ecouleMs();
      });
      socket.once('secureConnect', () => {
        phases.tls = ecouleMs();
      });
    });
    requete.on('error', reject);
  });
}

/** Complète une mesure brute avec la lecture réseau/serveur. */
function analyser(phases) {
  const rtt = phases.connect != null && phases.dns != null ? phases.connect - phases.dns : null;
  const finHandshake = phases.tls ?? phases.connect ?? phases.dns ?? 0;
  return {
    ...phases,
    rttMs: arrondi(rtt),
    handshakeReseauMs: arrondi(finHandshake),
    ttfbHorsHandshakeMs: arrondi((phases.ttfb ?? 0) - finHandshake),
    serveurEstimeMs: arrondi((phases.ttfb ?? 0) - finHandshake - (rtt || 0)),
    transfertMs: arrondi((phases.total ?? 0) - (phases.ttfb ?? 0)),
  };
}

function afficher(libelle, m) {
  console.log(`  ${libelle}`);
  console.log(
    `    réseau   : dns ${arrondi(m.dns) ?? '—'} ms | tcp ${
      m.connect != null ? arrondi(m.connect - (m.dns || 0)) : '—'
    } ms | tls ${m.tls != null ? arrondi(m.tls - (m.connect || 0)) : '—'} ms  (handshake total ${
      m.handshakeReseauMs
    } ms, rtt ≈ ${m.rttMs} ms)`
  );
  console.log(
    `    serveur  : ≈ ${m.serveurEstimeMs} ms${
      m.tempsServeurEnteteMs != null ? ` (mesuré par l'API : ${m.tempsServeurEnteteMs} ms)` : ''
    }`
  );
  console.log(
    `    réponse  : ttfb ${arrondi(m.ttfb)} ms | transfert ${m.transfertMs} ms | total ${arrondi(m.total)} ms | ${
      m.octets
    } octets | HTTP ${m.statut}`
  );
}

async function principal() {
  console.log("\n▶ Mesure du démarrage — GET /api/establishments (liste de l'annuaire)");
  console.log(`  API         : ${URL_BASE}`);
  console.log(`  Coordonnées : ${COORDS.lat}, ${COORDS.lng} (vraies coordonnées de terrain)`);
  console.log(
    `  Mode        : ${MODE_FROID ? 'FROID (connexion neuve après inactivité)' : 'CHAUD (appels successifs)'}`
  );

  const rapport = {
    base: URL_BASE,
    chemin: CHEMIN,
    coords: COORDS,
    mode: MODE_FROID ? 'froid' : 'chaud',
    mesures: [],
  };

  if (MODE_FROID && ATTENDRE_MINUTES > 0) {
    console.log(`\n  ⏳ Pause d'inactivité de ${ATTENDRE_MINUTES} min (AUCUN appel pendant ce temps)…`);
    await pause(ATTENDRE_MINUTES * 60 * 1000);
    console.log('  ⏳ Fin de la pause : mesure du tout premier appel (démarrage à froid).');
  }

  if (MODE_FROID) {
    const m = analyser(await mesurer(URL_COMPLETE));
    rapport.mesures.push({ etiquette: 'premier appel après inactivité', ...m });
    console.log('\n  1er appel après inactivité (démarrage à froid) :');
    afficher('réveil de l’instance', m);
  } else {
    for (let i = 1; i <= APPELS_CHAUDS; i += 1) {
      const m = analyser(await mesurer(URL_COMPLETE));
      rapport.mesures.push({ etiquette: `appel ${i}`, ...m });
      console.log(`\n  Appel ${i}/${APPELS_CHAUDS}${i === 1 ? ' (sert aussi d’échauffement)' : ''} :`);
      afficher(i === 1 ? 'premier appel' : 'appel suivant', m);
      if (i < APPELS_CHAUDS) await pause(1200);
    }
  }

  const totaux = rapport.mesures.map((m) => m.total).filter((v) => v != null);
  const ttfbs = rapport.mesures.map((m) => m.ttfb).filter((v) => v != null);
  const serveurs = rapport.mesures.map((m) => m.serveurEstimeMs).filter((v) => v != null);
  const median = (liste) => (liste.length ? arrondi(liste.slice().sort((a, b) => a - b)[Math.floor(liste.length / 2)]) : null);

  rapport.synthese = {
    totalMinMs: arrondi(Math.min(...totaux)),
    totalMedianeMs: median(totaux),
    totalMaxMs: arrondi(Math.max(...totaux)),
    ttfbMedianeMs: median(ttfbs),
    serveurMedianeMs: median(serveurs),
    tailleReponseOctets: rapport.mesures[0]?.octets ?? null,
  };

  console.log('\n' + '─'.repeat(72));
  console.log(
    `  Synthèse : total min ${rapport.synthese.totalMinMs} ms / médiane ${rapport.synthese.totalMedianeMs} ms / max ${rapport.synthese.totalMaxMs} ms`
  );
  console.log(
    `             ttfb médian ${rapport.synthese.ttfbMedianeMs} ms — dont travail serveur ≈ ${rapport.synthese.serveurMedianeMs} ms`
  );
  console.log(
    `             réponse : ${rapport.synthese.tailleReponseOctets} octets (${(
      rapport.synthese.tailleReponseOctets / 1024
    ).toFixed(1)} Ko)`
  );
  console.log('');

  if (FICHIER_JSON) {
    await mkdir(dirname(FICHIER_JSON), { recursive: true }).catch(() => {});
    await writeFile(FICHIER_JSON, JSON.stringify(rapport, null, 2), 'utf8');
    console.log(`  Rapport JSON écrit : ${FICHIER_JSON}\n`);
  }
}

principal().catch((err) => {
  console.error('❌ Mesure impossible :', err.message);
  process.exitCode = 1;
});
