// index.js — Point d'entrée du serveur Express
// TODO (DeepSeek) :
// - Charger dotenv, se connecter à MongoDB via config/db.js
// - Monter les routes : /api/establishments, /api/users, /api/jobs, /api/health-facilities
// - Servir sur le port process.env.PORT (défaut 4000)
//
// Détails d'implémentation :
//  - `express.json({ limit: '12mb' })` : l'inscription établissement accepte deux
//    photos en data-URI (voir utils/validators.js). À réduire à '1mb' quand le
//    stockage objet (Cloudinary/S3) sera branché.
//  - le `verify` conserve le body brut sur `req.rawBody` pour vérifier la
//    signature HMAC du webhook CinetPay.
//  - le serveur démarre même sans MongoDB : les routes répondent alors 503 et le
//    frontend bascule sur ses données de démo (mode tournée terrain).

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { connectDB, isDbReady, etatBase } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

import usersRouter from './routes/users.js';
import establishmentsRouter from './routes/establishments.js';
import jobsRouter from './routes/jobs.js';
import subscriptionsRouter from './routes/subscriptions.js';
import healthFacilitiesRouter from './routes/healthFacilities.js';
import adminRouter from './routes/admin.js';
import { isPaymentConfigured, getUnlockFee } from './services/cinetpay.js';
import { ABONNEMENT, getFormules, PERIODICITES_ACTIVES, CATALOGUE } from './config/abonnement.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Render / Railway / Vercel placent l'app derrière un proxy : sans ce réglage,
// Express voit l'IP du proxy (journaux et rate-limiting faux).
app.set('trust proxy', 1);

// ── CORS : frontend web (Vite) + éventuelle origine PWA/mobile ──
const originesAutorisees = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Requêtes sans Origin (Postman, webhooks CinetPay, curl) : autorisées.
      if (!origin) return callback(null, true);
      if (originesAutorisees.includes(origin) || originesAutorisees.includes('*')) {
        return callback(null, true);
      }
      // En développement on tolère tout localhost/LAN pour tester depuis un
      // téléphone sur le même réseau Wi-Fi (typique en tournée terrain).
      if (process.env.NODE_ENV !== 'production' && /localhost|127\.0\.0\.1|192\.168\.\d+\.\d+/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origine non autorisée : ${origin}`));
    },
    credentials: true,
  })
);

app.use(
  express.json({
    limit: '12mb',
    verify(req, res, buf) {
      req.rawBody = buf?.length ? buf.toString('utf8') : '';
    },
  })
);

// ── Journal de requêtes minimal (utile sur réseau instable : on voit ce qui part) ──
app.use((req, res, next) => {
  const debut = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - debut} ms)`);
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
      configure: isPaymentConfigured(),
      fraisDeblocageFcfa: getUnlockFee(),
      passerelle: 'CinetPay (Wave, Orange Money, MTN MoMo, Moov Money)',
    },
    // Prix/périodicité PROVISOIRES : ils vivent uniquement dans config/abonnement.js.
    // Deux formules en parallèle (semaine + mois) pour trancher sur le terrain.
    abonnement: {
      titre: CATALOGUE.titre,
      formules: getFormules().map((f) => ({
        cle: f.cle,
        libelle: f.libelle,
        prixFcfa: f.prixFcfa,
        periodicite: f.periodicite,
        dureeJours: f.dureeJours,
        aConfirmer: f.aConfirmer,
      })),
      periodicitesActives: PERIODICITES_ACTIVES,
      formuleParDefaut: ABONNEMENT.cle,
      prixAConfirmer: ABONNEMENT.aConfirmer,
    },
    horodatage: new Date().toISOString(),
  });
});

// ── Routes API ──
app.use('/api/users', usersRouter);
app.use('/api/establishments', establishmentsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/health-facilities', healthFacilitiesRouter);
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
      `  ▸ Paiement : ${isPaymentConfigured() ? 'CinetPay configuré' : 'non configuré (déblocage contact -> HTTP 501)'}`
    );
    console.log('');
  });
}

demarrer();

export default app;

