// db.js — Connexion MongoDB via mongoose.connect(process.env.MONGODB_URI)
//
// Deux environnements possibles, une seule variable :
//   • Atlas (production / tournée terrain) : MONGODB_URI="mongodb+srv://…" — gratuit,
//     aucune installation locale. Voir docs/DEPLOIEMENT.md §1 (création du cluster M0).
//   • MongoDB local (développement) : mongodb://127.0.0.1:27017/rejoins-moi
// Le nom de base est forcé à « rejoins-moi » (surchargeable par MONGODB_DB_NAME) :
// sans cela, une URI Atlas sans nom de base créerait une base nommée « test ».
//
// Note produit : le serveur Express démarre même si MongoDB est injoignable
// (mode démo). Les routes répondront alors 503 avec un message explicite, et le
// frontend bascule automatiquement sur son jeu de données de démonstration
// (frontend/src/data/demoData.js) — utile pendant la phase de tournée terrain
// où les connexions sont parfois lentes ou le backend non déployé.

import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/rejoins-moi';
const DEFAULT_DB_NAME = 'rejoins-moi';

export function getMongoUri() {
  return process.env.MONGODB_URI || DEFAULT_URI;
}

/**
 * Nom de la base utilisée.
 * Indispensable pour Atlas : beaucoup d'URI copiées depuis la console (« mongodb+srv://
 * user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true ») ne contiennent PAS de nom de
 * base ; Mongoose créerait alors une base nommée « test ». On impose donc « rejoins-moi ».
 */
export function getMongoDbName() {
  return process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;
}

/** L'URI pointe-t-elle vers Atlas (mongodb+srv) ? Change le diagnostic d'erreur. */
function estAtlas(uri) {
  return /^mongodb\+srv:\/\//i.test(String(uri));
}

/** Masque les identifiants : un mot de passe ne doit jamais finir dans les journaux. */
export function masquerUri(uri = getMongoUri()) {
  return String(uri).replace(/\/\/([^:@/]+)(:[^@/]*)?@/, '//$1:****@');
}

/**
 * Transforme une erreur de connexion en pistes de correction concrètes.
 * Objectif : ne jamais laisser un « MongoServerError » brut à l'artisan ou au
 * développeur qui branche Atlas pour la première fois.
 *
 * @returns {string[]} messages à afficher
 */
export function diagnostiquer(err, uri = getMongoUri()) {
  const message = String(err?.message || '');
  const pistes = [];

  if (/ENOTFOUND|EAI_AGAIN|querySrv|ESERVFAIL/i.test(message)) {
    pistes.push(
      "Nom d'hôte introuvable : l'URI est incomplète, ou le réseau bloque les requêtes DNS « SRV » (fréquent en entreprise / VPN). Recopiez l'URI complète depuis Atlas > Connect > Drivers."
    );
  }
  if (/authentication failed|bad auth/i.test(message)) {
    pistes.push(
      "Mot de passe refusé : si le mot de passe du compte Atlas contient @ # / : ?, il doit être encodé (@ devient %40). Sinon réinitialisez-le (Atlas > Database Access) et remplacez-le dans l'URI."
    );
  }
  if (/not allowed|whitelist|not whitelisted|IP address/i.test(message)) {
    pistes.push(
      'IP non autorisée : Atlas > Network Access > Add IP Address. Pour tester depuis une connexion mobile, ajoutez 0.0.0.0/0 (à restreindre ensuite).'
    );
  }
  if (/ECONNREFUSED/i.test(message)) {
    pistes.push("Rien n'écoute sur cette adresse : MongoDB local n'est pas démarré, ou l'URI/le port est faux.");
  }
  if (/timed out|timeout|Server selection/i.test(message)) {
    pistes.push(
      'Délai dépassé : réseau lent, ou cluster Atlas gratuit (M0) en veille — ouvrez la console Atlas pour le réveiller, puis relancez.'
    );
  }
  if (estAtlas(uri)) {
    pistes.push(
      'URI Atlas attendue, de la forme : mongodb+srv://<utilisateur>:<motdepasse>@cluster0.xxxxx.mongodb.net/rejoins-moi?retryWrites=true&w=majority'
    );
  }
  return pistes;
}

// ── Réessais automatiques de connexion ───────────────────────────────────────
// Pourquoi c'est indispensable en ligne : sur un hébergeur gratuit (Render,
// Railway…) le conteneur démarre « à froid » et un cluster Atlas M0 se met en
// veille. La PREMIÈRE connexion peut alors dépasser serverSelectionTimeoutMS ou
// être refusée par le réseau. Sans réessai, le serveur reste bloqué en 503
// (base « indisponible ») jusqu'au redéploiement suivant — c'est exactement le
// piège rencontré sur https://rejoins-moi-api.onrender.com.
// On retente donc en tâche de fond, avec un délai qui double jusqu'à 60 s.
// (`retryWrites` ci-dessous ne concerne QUE les écritures : ce n'est pas un
//  réessai de connexion.)
const DELAI_REESSAI_MIN_MS = Number(process.env.MONGODB_RETRY_MIN_MS) || 5000;
const DELAI_REESSAI_MAX_MS = Number(process.env.MONGODB_RETRY_MAX_MS) || 60000;

let minuteurReessai = null;
let tentativesConnexion = 0;
let derniereErreurBase = null; // { cause, nom, horodatage }

/**
 * Résume une erreur de connexion en une cause COURTE et lisible.
 * Aucun identifiant, aucune URI : le résultat peut être exposé sans risque.
 * @returns {string}
 */
export function causeErreur(err) {
  const message = String(err?.message || '');
  if (/ENOTFOUND|EAI_AGAIN|querySrv|ESERVFAIL/i.test(message)) {
    return 'hôte introuvable (DNS/SRV : URI incomplète ou réseau qui filtre le SRV)';
  }
  if (/authentication failed|bad auth/i.test(message)) {
    return 'authentification refusée (utilisateur, mot de passe ou URI)';
  }
  if (/not allowed|whitelist|not whitelisted|IP address/i.test(message)) {
    return 'IP non autorisée (Atlas > Network Access)';
  }
  if (/ECONNREFUSED/i.test(message)) {
    return "connexion refusée (rien n'écoute sur cette adresse)";
  }
  if (/timed out|timeout|server selection|topology/i.test(message)) {
    return 'délai dépassé (cluster en veille ou réseau lent)';
  }
  return err?.name || 'erreur inconnue';
}

/**
 * État détaillé de la connexion, pour /api/health.
 * Volontairement limité à des informations non sensibles (route publique).
 */
export function etatBase() {
  return {
    connectee: isDbReady(),
    tentatives: tentativesConnexion,
    cause: derniereErreurBase?.cause || null,
    nomErreur: derniereErreurBase?.nom || null,
    dernierEchec: derniereErreurBase?.horodatage || null,
    prochainReessaiDansSec: minuteurReessai ? minuteurReessai.delaiSec : null,
  };
}

/** Programme une nouvelle tentative en tâche de fond (délai doublant, 60 s max). */
function planifierReessai() {
  if (minuteurReessai) return;
  const delaiMs = Math.min(
    DELAI_REESSAI_MIN_MS * 2 ** Math.max(0, tentativesConnexion - 1),
    DELAI_REESSAI_MAX_MS
  );
  console.warn(`[db] Nouvelle tentative de connexion dans ${Math.round(delaiMs / 1000)} s…`);
  const minuteur = setTimeout(() => {
    minuteurReessai = null;
    connectDB().catch(() => {});
  }, delaiMs);
  // `unref` : un script ou un test qui se termine n'est pas retenu par ce minuteur.
  minuteur.unref?.();
  minuteur.delaiSec = Math.round(delaiMs / 1000);
  minuteurReessai = minuteur;
}

/** Annule le réessai en attente et remet le compteur à zéro (connexion réussie / arrêt). */
function annulerReessai() {
  if (minuteurReessai) {
    clearTimeout(minuteurReessai);
    minuteurReessai = null;
  }
  tentativesConnexion = 0;
}

/**
 * Tente la connexion à MongoDB.
 * Ne lance jamais d'exception : retourne `true` / `false` et journalise.
 * En cas d'échec, une nouvelle tentative est programmée automatiquement
 * (sauf `reessais: false`).
 * @param {{silencieux?: boolean, reessais?: boolean}} [options]
 * @returns {Promise<boolean>}
 */
export async function connectDB({ silencieux = false, reessais = true } = {}) {
  const uri = getMongoUri();
  // `strictQuery` évite les filtres silencieusement ignorés (Mongoose 8).
  mongoose.set('strictQuery', true);

  if (/mongodb\+srv:\/\//i.test(uri)) {
    // Évite un échec obscur en production (Node récent + certains hébergeurs).
    mongoose.set('tls', true);
  }

  try {
    const conn = await mongoose.connect(uri, {
      dbName: getMongoDbName(),
      serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS) || 8000,
      // Les clusters Atlas gratuits se mettent en veille : on laisse Mongoose
      // retenter quelques fois plutôt que de déclarer la base indisponible.
      retryWrites: true,
    });
    annulerReessai();
    if (!silencieux) {
      console.log(`[db] MongoDB connecté -> ${conn.connection.host}/${conn.connection.name}`);
    }
    return true;
  } catch (err) {
    derniereErreurBase = {
      cause: causeErreur(err),
      nom: err?.name || 'Error',
      horodatage: new Date().toISOString(),
    };
    tentativesConnexion += 1;
    if (!silencieux) {
      console.warn('[db] Connexion MongoDB impossible :', err.message);
      console.warn(`[db] URI utilisée : ${masquerUri(uri)} (base « ${getMongoDbName()} »)`);
      console.warn(`[db] Cause probable : ${derniereErreurBase.cause}`);
      for (const piste of diagnostiquer(err, uri)) console.warn(`[db]   → ${piste}`);
      console.warn('[db] Le serveur démarre quand même. Le frontend utilisera ses données de démo.');
    }
    if (reessais) planifierReessai();
    return false;
  }
}

/** Indique si une connexion Mongo est active (utilisé par le middleware de garde). */
export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

/** Middleware Express : renvoie 503 si la base n'est pas disponible. */
export function requireDb(req, res, next) {
  if (!isDbReady()) {
    return res.status(503).json({
      error: 'Base de données indisponible',
      detail:
        "MongoDB n'est pas connecté. Renseignez MONGODB_URI dans backend/.env (Atlas ou MongoDB local) puis relancez le serveur — voir docs/DEPLOIEMENT.md §1.",
      base: getMongoDbName(),
      suivez: 'npm run verifier:base (dans /backend) pour identifier la cause exacte.',
      offline: true,
    });
  }
  return next();
}

export async function disconnectDB() {
  // Un arrêt volontaire (script, test) ne doit pas être suivi d'un réessai.
  annulerReessai();
  await mongoose.disconnect();
}

export default connectDB;
