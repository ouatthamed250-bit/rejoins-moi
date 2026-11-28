// index.js — Point d'entrée du serveur Express
//
// En-têtes de sécurité (bloc F) : `helmet` pose les protections standard sur toutes
// les réponses (nosniff, referrer-policy, HSTS, pas de `X-Powered-By`).
// Tailles de corps : 1 Mo par défaut, 3 Mo pour les routes qui transportent des
// PHOTOS (voir `ROUTES_PHOTOS` ci-dessous) — les photos arrivent en data-URI base64
// pendant la tournée terrain (utils/validators.js).
//  - le `verify` conserve le body brut sur `req.rawBody` pour vérifier la
//    signature HMAC du webhook CinetPay.
//  - le serveur démarre même sans MongoDB : les routes répondent alors 503 et le
//    frontend bascule sur ses données de démo (mode tournée terrain).

// Note de déploiement (27/11/2026) : ce commit force un redémarrage du service
// Render afin de recharger les clés VAPID (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)
// saisies dans le tableau de bord de l'hébergeur. Aucun changement de comportement.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { connectDB, isDbReady, etatBase } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

import usersRouter from './routes/users.js';
import establishmentsRouter from './routes/establishments.js';
import jobsRouter from './routes/jobs.js';
import subscriptionsRouter from './routes/subscriptions.js';
import healthFacilitiesRouter from './routes/healthFacilities.js';
import messagesRouter from './routes/messages.js';
import agentsRouter from './routes/agents.js';
import adminRouter from './routes/admin.js';
import { isPaymentConfigured, getUnlockFee } from './services/cinetpay.js';
import { etatNotifications, cleVapidPublique } from './services/notifications.js';
import {
  ABONNEMENT,
  getFormules,
  PERIODICITES_ACTIVES,
  CATALOGUE,
  getFormulesPubliques,
  GRATUIT_JUSQU_AU,
  estModeGratuit,
} from './config/abonnement.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Render / Railway / Vercel placent l'app derrière un proxy : sans ce réglage,
// Express voit l'IP du proxy (journaux et rate-limiting faux).
app.set('trust proxy', 1);

// ── En-têtes de sécurité (helmet, bloc F du 12/10 ; CSP explicite le 28/11) ──
// L'API ne sert que du JSON et des images binaires (GET /api/establishments/:id/photo/:role) :
//   • CSP EXPLICITE depuis la v46 : helmet garde ses directives par défaut
//     (`useDefaults: true`) et on y AJOUTE les trois origines de la traduction
//     automatique du navigateur — Google Translate charge sa feuille de style
//     depuis gstatic.com, sa bibliothèque depuis translate.googleapis.com /
//     translate.google.com et ses requêtes XHR depuis translate.googleapis.com.
//     Sans ces origines, la traduction échoue en console (« Refused to load … »).
//     Rien n'est retiré : on ajoute ces domaines, les autres protections
//     (`object-src`, `frame-ancestors`, `base-uri`…) gardent leur valeur par défaut.
//     Comme aucune page HTML n'est servie ici, cette politique ne s'applique à
//     aucun document aujourd'hui : elle documente les origines tierces tolérées et
//     protège d'avance si une page venait à être servie par ce serveur.
//     `upgradeInsecureRequests: null` : la directive par défaut de helmet réécrit
//     toute URL en https, ce qui casserait la consultation de l'API depuis un
//     navigateur en développement (http://localhost:4000). Inutile ici : l'API est
//     déjà servie en HTTPS en production.
//   • `crossOriginResourcePolicy: { policy: 'cross-origin' }` : INDISPENSABLE — les
//     photos sont chargées par le frontend, servi depuis un AUTRE domaine (Vercel,
//     GitHub Pages). La valeur par défaut (« same-origin ») ferait disparaître
//     silencieusement toutes les photos de l'application.
// `X-Powered-By`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`
// et consorts restent posés par les réglages par défaut.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Feuille de style du traducteur (widget Google Translate).
        styleSrc: ["'self'", "'unsafe-inline'", 'https://www.gstatic.com'],
        // Bibliothèque du traducteur.
        scriptSrc: ["'self'", 'https://translate.googleapis.com', 'https://translate.google.com'],
        // Requêtes XHR / fetch du traducteur.
        connectSrc: ["'self'", 'https://translate.googleapis.com'],
        // Voir le commentaire ci-dessus : utile en développement seulement.
        upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── CORS : frontend web (Vite) + éventuelle origine PWA/mobile ──
const originesAutorisees = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Règle UNIQUE d'acceptation d'une origine (partagée par le filtre ci-dessous et par
 * le middleware `cors`, pour qu'il n'existe jamais deux vérités).
 * - aucune origine (Postman, webhook CinetPay, curl, requête serveur-à-serveur) : OK ;
 * - origine listée dans CLIENT_URL (ou « * ») : OK ;
 * - hors production, tout localhost/LAN : OK, pour tester depuis un téléphone sur le
 *   même réseau Wi-Fi (typique pendant la tournée terrain).
 */
function origineAutorisee(origin) {
  if (!origin) return true;
  if (originesAutorisees.includes(origin) || originesAutorisees.includes('*')) return true;
  if (process.env.NODE_ENV !== 'production' && /localhost|127\.0\.0\.1|192\.168\.\d+\.\d+/.test(origin)) {
    return true;
  }
  return false;
}

/**
 * Refus d'origine EXPLICITE et PROPRE (bloc F du 12/10).
 * Avant : le callback de `cors` levait une Error -> la requête finissait en 500
 * « Erreur interne du serveur » (faux bug pour l'utilisateur, bruit inutile dans les
 * journaux). Désormais : 403 + JSON, AVANT d'entrer dans les routes. Conséquence
 * importante : un appel depuis un site tiers ne déclenche aucun traitement (aucune
 * écriture, aucun compte, aucun paiement) — il est coupé net.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origineAutorisee(origin)) return next();
  console.warn(`[cors] origine refusée : ${origin}`);
  return res.status(403).json({
    error: `Origine non autorisée : ${origin}`,
    details: { code: 'ORIGINE_REFUSEE' },
  });
});

app.use(
  cors({
    origin(origin, callback) {
      // Le refus est déjà traité ci-dessus : ici on ne fait que POSER les en-têtes
      // CORS pour les origines acceptées (jamais d'erreur -> jamais de 500).
      return callback(null, origineAutorisee(origin));
    },
    credentials: true,
  })
);

/** Conserve le corps brut : indispensable pour vérifier la signature du webhook CinetPay. */
function conserverRawBody(req, res, buf) {
  req.rawBody = buf?.length ? buf.toString('utf8') : '';
}

// ── Corps JSON : 3 Mo pour les routes à PHOTOS, 1 Mo partout ailleurs (bloc F) ──
// Les photos d'établissement partent en data-URI base64 (tournée terrain, réseau
// instable) : deux photos plafonnées à ~300 Ko pèsent ~800 Ko de JSON, d'où les 3 Mo.
// Toutes les autres routes sont ramenées à 1 Mo : un corps énorme envoyé là où aucune
// image n'est attendue est refusé en 413 par Express, avant tout code métier.
// Express (body-parser) n'analyse qu'une fois : la seconde déclaration est ignorée
// quand la première a déjà lu le corps (`req._body`), donc l'ordre compte.
const ROUTES_PHOTOS = ['/api/users', '/api/establishments'];
app.use(ROUTES_PHOTOS, express.json({ limit: '3mb', verify: conserverRawBody }));
app.use(express.json({ limit: '1mb', verify: conserverRawBody }));

// ── Journal de requêtes minimal (utile sur réseau instable : on voit ce qui part) ──
//
// Le temps de traitement est aussi renvoyé dans l'en-tête `X-Temps-Serveur`. C'est
// ce qui permet de SÉPARER le temps serveur du temps réseau lors d'une mesure :
// le client lit cet en-tête au lieu de le deviner. Il est posé juste avant l'envoi
// de la réponse (en interceptant `res.writeHead`), donc il est toujours présent.
app.use((req, res, next) => {
  const debut = Date.now();
  // `X-Temps-Serveur` doit être annoncé tôt : on l'inscrit dans l'en-tête avant
  // l'envoi. La valeur est donc calculée au moment où le corps part réellement
  // (hook `res.writeHead`), ce qui reste exact sans charger les routes.
  const ecrireEntete = res.writeHead.bind(res);
  res.writeHead = function writeHeadAvecTemps(...params) {
    res.setHeader('X-Temps-Serveur', `${Date.now() - debut}ms`);
    res.setHeader('Access-Control-Expose-Headers', 'X-Temps-Serveur');
    return ecrireEntete(...params);
  };
  res.on('finish', () => {
    const duree = Date.now() - debut;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${duree} ms)`);
  });
  next();
});

// ── Santé du service ──
app.get('/api', (req, res) => {
  res.json({
    nom: "API Rejoins'Moi",
    version: '0.1.0',
    ville: 'Abidjan, Côte d’Ivoire',
    endpoints: [
      '/api/users',
      '/api/establishments',
      '/api/jobs',
      '/api/subscriptions',
      '/api/health-facilities',
      '/api/messages',
      '/api/agents',
      '/api/push/public-key',
    ],
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    baseDonnees: isDbReady() ? 'connectée' : 'indisponible',
    // Pourquoi la base est-elle indisponible ? Cause courte, nombre de tentatives et
    // délai avant le prochain réessai automatique (voir config/db.js). Cette route est
    // PUBLIQUE : on n'expose que ces champs — jamais l'URI, jamais un identifiant.
    baseDetails: etatBase(),
    paiement: {
      // MODE 100 % GRATUIT : tant que la date n'est pas dépassée, `configure` est
      // volontairement false — même si des clés CinetPay existent, elles ne doivent
      // pas être utilisées. `modeGratuit` permet au frontend d'afficher « Gratuit »
      // sans recalculer la règle de son côté.
      configure: estModeGratuit() ? false : isPaymentConfigured(),
      modeGratuit: estModeGratuit(),
      gratuitJusquAu: GRATUIT_JUSQU_AU.toISOString(),
      fraisDeblocageFcfa: estModeGratuit() ? 0 : getUnlockFee(),
      passerelle: estModeGratuit()
        ? 'Désactivée (100 % gratuit)'
        : 'CinetPay (Wave, Orange Money, MTN MoMo, Moov Money)',
    },
    // Prix/périodicité PROVISOIRES : ils vivent uniquement dans config/abonnement.js.
    // Deux formules en parallèle (semaine + mois) pour trancher sur le terrain.
    abonnement: {
      titre: CATALOGUE.titre,
      // Prix MASQUÉS pendant la gratuité : 0 partout (voir getFormulesPubliques).
      formules: getFormulesPubliques().map((f) => ({
        cle: f.cle,
        libelle: f.libelle,
        prixFcfa: f.prixFcfa,
        periodicite: f.periodicite,
        dureeJours: f.dureeJours,
        aConfirmer: f.aConfirmer,
      })),
      periodicitesActives: PERIODICITES_ACTIVES,
      formuleParDefaut: ABONNEMENT.cle,
      prixAConfirmer: estModeGratuit() ? false : ABONNEMENT.aConfirmer,
    },
    // État des notifications Web Push : `pret` ne vaut true que si les clés VAPID
    // de l'hébergeur ont été lues ET acceptées par la bibliothèque. Aucune clé
    // n'est exposée ici (voir GET /api/push/public-key pour la clé publique).
    notifications: etatNotifications(),
    horodatage: new Date().toISOString(),
  });
});

// ── Clé publique VAPID (notifications Web Push) ──
// La clé publique VAPID n'est PAS un secret : chaque navigateur doit la posséder
// pour s'abonner (`PushManager.subscribe({ applicationServerKey })`). Elle est
// publiée ici pour qu'une seule source fasse foi : le serveur qui signe les envois
// avec VAPID_PRIVATE_KEY. Le frontend lit cette clé au lieu d'en figer une copie
// au moment du build ; remplacer les clés dans le tableau de bord de l'hébergeur
// ne peut donc plus produire d'abonnements refusés (403 du service de push) tant
// que le frontend servi est à jour. Aucune clé privée n'est exposée ici.
app.get('/api/push/public-key', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Clé effectivement utilisée pour signer : si VAPID_PUBLIC_KEY manque dans
  // l'hébergeur, elle est déduite de VAPID_PRIVATE_KEY (voir services/notifications.js).
  res.json({ publicKey: cleVapidPublique() });
});

// ── Routes API ──
app.use('/api/users', usersRouter);
app.use('/api/establishments', establishmentsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/health-facilities', healthFacilitiesRouter);
// Messagerie interne (prompt B) : chat privé entre deux comptes, recherche d'un
// destinataire, et lecture des conversations du compte connecté.
app.use('/api/messages', messagesRouter);
// Espace AGENT DE TERRAIN (26/11) : connexion/activation par code, pointage GPS
// pendant le service, et création des fiches (compte gérant + établissement).
// Jeton distinct de celui des utilisateurs (middleware/auth.js → protectAgent).
app.use('/api/agents', agentsRouter);
// Back-office administrateur (dépôts + validation des déblocages + comptes).
app.use('/api/admin', adminRouter);

// ── 404 + erreurs ──
app.use(notFound);
app.use(errorHandler);

async function demarrer() {
  const ok = await connectDB();

  app.listen(PORT, () => {
    console.log('');
    console.log("  ██  Rejoins'Moi — API démarrée");
    console.log(`  ▸ http://localhost:${PORT}/api`);
    console.log(`  ▸ MongoDB : ${ok ? 'connectée' : 'INDISPONIBLE (mode démo côté frontend)'}`);
    console.log(
      `  ▸ Paiement : ${estModeGratuit()
        ? 'désactivé (100 % gratuit)'
        : isPaymentConfigured()
          ? 'CinetPay configuré'
          : 'non configuré (déblocage contact -> HTTP 501)'}`
    );
    console.log('');
  });
}

demarrer();

export default app;

