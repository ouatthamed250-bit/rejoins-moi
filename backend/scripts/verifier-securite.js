// verifier-securite.js — PREUVE des mesures de sécurité du bloc F (12/10).
//
// Le script interroge le VRAI serveur (src/index.js), avec NODE_ENV=production et
// SANS clé secrète CinetPay, puis vérifie une par une les protections :
//   1. helmet : en-têtes de sécurité présents, `X-Powered-By` retiré, et surtout
//      `Cross-Origin-Resource-Policy: cross-origin` (sans quoi les photos servies par
//      l'API ne s'afficheraient plus dans le frontend, hébergé sur un autre domaine) ;
//   2. CORS : une origine inconnue reçoit 403 + JSON (jamais 500), une origine
//      autorisée reçoit ses en-têtes, une requête sans origine (webhook, curl) passe ;
//   3. taille des corps : 1 Mo par défaut (413 au-delà), 3 Mo sur les routes à photos ;
//   4. /api/admin/login : limiteur actif -> 429 après 8 essais en une minute ;
//   5. webhook CinetPay : REFUS par défaut sans clé secrète (fail-closed), refus d'une
//      signature fausse, acceptation d'une signature HMAC correcte (contrôle positif) ;
//   6. jeton administrateur : 12 h (et non 30 jours), vérifié sur un jeton signé ;
//   7. plafond des photos : 300 Ko, refus côté serveur au-delà (établissement ET profil).
//
// Lancement (depuis /backend) : npm run verifier:securite
// Aucune écriture en base : les appels utilisés ne créent rien (connexions refusées,
// corps invalides, webhook non signé). Le numéro « 0700000000 » est hors production.

import 'dotenv/config';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// NODE_ENV=production AVANT d'importer le serveur : c'est la condition qui active le
// fail-closed du webhook et les règles CORS strictes. La clé secrète est retirée pour
// prouver le comportement « non configuré en production ».
process.env.NODE_ENV = 'production';
const PORT = Number(process.env.PORT_VERIFICATION) || 4200;
process.env.PORT = String(PORT);
delete process.env.CINETPAY_SECRET_KEY;

const { MAX_PHOTO_OCTETS, poidsPhotoOctets, validateEstablishmentPhotos, validatePhoto } = await import(
  '../src/utils/validators.js'
);
const { DUREE_JETON_ADMIN, signToken } = await import('../src/middleware/auth.js');
const { verifyNotifySignature } = await import('../src/services/cinetpay.js');

const BASE = `http://127.0.0.1:${PORT}`;
const AUTH_RATE_MAX = Number(process.env.AUTH_RATE_MAX) || 8;
const ORIGINE_AUTORISEE = String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();

let reussis = 0;
const echecs = [];

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ✓ ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

function titre(texte) {
  console.log(`\n${texte}`);
}

/** Requête HTTP brute : renvoie statut, en-têtes et corps JSON éventuel. */
async function appel(methode, chemin, { body, origine, entetes = {} } = {}) {
  const t = { Accept: 'application/json', ...entetes };
  if (body !== undefined && typeof body !== 'string') t['Content-Type'] = 'application/json';
  if (typeof body === 'string' && !t['Content-Type']) t['Content-Type'] = 'application/json';
  if (origine) t.Origin = origine;

  let reponse;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      method: methode,
      headers: t,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  } catch (err) {
    return { statut: 0, erreur: err.message, entetes: new Headers(), donnees: null };
  }

  const texte = await reponse.text();
  let donnees = null;
  try {
    donnees = texte ? JSON.parse(texte) : null;
  } catch {
    donnees = { brut: texte.slice(0, 120) };
  }
  return { statut: reponse.status, entetes: reponse.headers, donnees };
}

/** Attend que le serveur réponde (connexion MongoDB incluse). */
async function attendreServeur(maxMs = 25000) {
  const limite = Date.now() + maxMs;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status > 0) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Une base64 « factice » de la taille demandée (on ne mesure que le POIDS). */
function dataUriDeTaille(octets) {
  const base64 = Math.ceil(octets / 3) * 4;
  return `data:image/jpeg;base64,${'A'.repeat(base64)}`;
}

/** Corps JSON d'environ `octets` (une clé inutile, jamais utilisée par les routes appelées). */
function corpsDeTaille(octets) {
  return JSON.stringify({ remplissage: 'x'.repeat(octets) });
}

// ───────────────────────────── Vérifications ─────────────────────────────

console.log('\n▶ Vérification des mesures de sécurité (bloc F)');
console.log(`  Serveur de test : ${BASE} | NODE_ENV=production | CINETPAY_SECRET_KEY : absente`);
console.log(`  Origine autorisée attendue : ${ORIGINE_AUTORISEE}`);

titre('0. Démarrage du serveur (configuration réelle)');
await import('../src/index.js');
const pret = await attendreServeur();
verifier(`le serveur répond sur ${BASE}`, pret);
if (!pret) {
  console.error('Serveur injoignable : vérifiez backend/.env (MONGODB_URI) puis relancez.');
  process.exitCode = 1;
  process.exit(1);
}

// ── 1. En-têtes de sécurité (helmet) ──
titre('1. En-têtes de sécurité (helmet)');
const sante = await appel('GET', '/api/health');
verifier('GET /api/health répond 200', sante.statut === 200, `statut ${sante.statut}`);
const h = sante.entetes;
verifier('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff', `vu : ${h.get('x-content-type-options')}`);
verifier('Referrer-Policy présent', Boolean(h.get('referrer-policy')), `vu : ${h.get('referrer-policy')}`);
verifier('X-Frame-Options présent', Boolean(h.get('x-frame-options')), `vu : ${h.get('x-frame-options')}`);
verifier(
  'Strict-Transport-Security présent (HTTPS imposé)',
  Boolean(h.get('strict-transport-security')),
  `vu : ${h.get('strict-transport-security')}`
);
verifier(
  'Cross-Origin-Resource-Policy: cross-origin (les photos servies par l’API restent affichables depuis le frontend)',
  (h.get('cross-origin-resource-policy') || '').toLowerCase() === 'cross-origin',
  `vu : ${h.get('cross-origin-resource-policy')}`
);
verifier('X-Powered-By retiré (on n’annonce plus Express)', h.get('x-powered-by') === null, `vu : ${h.get('x-powered-by')}`);

// ── 2. CORS : refus propre en 403 ──
titre('2. CORS — une origine inconnue reçoit 403, jamais 500');
const intrusive = await appel('GET', '/api/health', { origine: 'https://site-pirate.example' });
verifier('origine inconnue -> 403 (et non 500)', intrusive.statut === 403, `statut ${intrusive.statut}`);
verifier('la réponse 403 est du JSON exploitable', typeof intrusive.donnees?.error === 'string', `vu : ${JSON.stringify(intrusive.donnees)}`);
verifier(
  'le code métier ORIGINE_REFUSEE est annoncé',
  intrusive.donnees?.details?.code === 'ORIGINE_REFUSEE',
  `vu : ${intrusive.donnees?.details?.code}`
);
verifier(
  'aucun en-tête CORS n’est accordé à l’origine refusée',
  intrusive.entetes.get('access-control-allow-origin') === null,
  `vu : ${intrusive.entetes.get('access-control-allow-origin')}`
);

const autorisee = await appel('GET', '/api/health', { origine: ORIGINE_AUTORISEE });
verifier(`origine autorisée (${ORIGINE_AUTORISEE}) -> 200`, autorisee.statut === 200, `statut ${autorisee.statut}`);
verifier(
  'l’origine autorisée reçoit son en-tête Access-Control-Allow-Origin',
  autorisee.entetes.get('access-control-allow-origin') === ORIGINE_AUTORISEE,
  `vu : ${autorisee.entetes.get('access-control-allow-origin')}`
);

const sansOrigine = await appel('GET', '/api/health');
verifier(
  'requête sans origine (webhook, curl, serveur à serveur) -> 200',
  sansOrigine.statut === 200,
  `statut ${sansOrigine.statut}`
);

// ── 3. Taille des corps : 1 Mo par défaut, 3 Mo sur les routes à photos ──
titre('3. Tailles de corps (1 Mo par défaut, 3 Mo pour les photos)');
const mo = 1024 * 1024;
const grosSurRouteStandard = await appel('POST', '/api/jobs/webhook/cinetpay', { body: corpsDeTaille(1.5 * mo) });
verifier(
  'corps de 1,5 Mo sur une route sans photo -> 413 (refusé par Express)',
  grosSurRouteStandard.statut === 413,
  `statut ${grosSurRouteStandard.statut}`
);
verifier(
  'la réponse 413 explique la limite en français',
  /trop volumineux/i.test(grosSurRouteStandard.donnees?.error || ''),
  `vu : ${grosSurRouteStandard.donnees?.error}`
);

const grosSurRoutePhoto = await appel('POST', '/api/users/register', { body: corpsDeTaille(1.5 * mo) });
verifier(
  'le même corps sur une route à photos n’est PAS refusé en 413',
  grosSurRoutePhoto.statut !== 413,
  `statut ${grosSurRoutePhoto.statut}`
);

const tresGrosSurRoutePhoto = await appel('POST', '/api/establishments', { body: corpsDeTaille(2.8 * mo) });
verifier(
  'corps de 2,8 Mo sur une route à photos -> accepté par le lecteur (pas de 413)',
  tresGrosSurRoutePhoto.statut !== 413,
  `statut ${tresGrosSurRoutePhoto.statut}`
);

// ── 4. Limiteur de connexion sur /api/admin/login ──
titre(`4. /api/admin/login — limiteur actif (${AUTH_RATE_MAX} essais/minute)`);
const identifiantDEssai = '0700000000'; // hors production : aucun compte réel
const statutsAdmin = [];
for (let i = 0; i < AUTH_RATE_MAX + 1; i++) {
  const r = await appel('POST', '/api/admin/login', {
    body: { identifiant: identifiantDEssai, motDePasse: 'mauvais-mot-de-passe' },
  });
  statutsAdmin.push(r.statut);
}
verifier(
  `les ${AUTH_RATE_MAX} premiers essais sont refusés proprement (401, pas de fuite d’information)`,
  statutsAdmin.slice(0, AUTH_RATE_MAX).every((s) => s === 401),
  statutsAdmin.join(',')
);
verifier(
  `l’essai n°${AUTH_RATE_MAX + 1} est BLOQUÉ (429)`,
  statutsAdmin[AUTH_RATE_MAX] === 429,
  `statuts observés : ${statutsAdmin.join(' → ')}`
);
const bloque = await appel('POST', '/api/admin/login', {
  body: { identifiant: identifiantDEssai, motDePasse: 'mauvais-mot-de-passe' },
});
verifier(
  'la réponse 429 annonce un délai d’attente (Retry-After)',
  bloque.statut === 429 && Boolean(bloque.entetes.get('retry-after')),
  `statut ${bloque.statut} | Retry-After ${bloque.entetes.get('retry-after')}`
);
const autreIdentifiant = await appel('POST', '/api/admin/login', {
  body: { identifiant: '0700000001', motDePasse: 'mauvais-mot-de-passe' },
});
verifier(
  'un AUTRE identifiant n’est pas pénalisé (clé = IP + numéro)',
  autreIdentifiant.statut === 401,
  `statut ${autreIdentifiant.statut}`
);

// ── 5. Webhook CinetPay : fail-closed + signature en temps constant ──
titre('5. Webhook CinetPay — fail-closed sans clé secrète (NODE_ENV=production)');
const corpsWebhook = JSON.stringify({ cpm_trans_id: 'TEST-FAIL-CLOSED', cpm_custom: 'job:000000000000000000000000:user:000000000000000000000000' });

const sansSignature = await appel('POST', '/api/jobs/webhook/cinetpay', { body: corpsWebhook });
verifier(
  'notification NON signée, clé secrète absente en production -> 401 (refus par défaut)',
  sansSignature.statut === 401,
  `statut ${sansSignature.statut}`
);

process.env.CINETPAY_SECRET_KEY = 'secret-de-verification-bloc-f';
const signatureFausse = await appel('POST', '/api/jobs/webhook/cinetpay', {
  body: corpsWebhook,
  entetes: { 'x-token': 'a'.repeat(64) },
});
verifier('signature fausse (même longueur) -> 401', signatureFausse.statut === 401, `statut ${signatureFausse.statut}`);

const signatureCourte = await appel('POST', '/api/jobs/webhook/cinetpay', {
  body: corpsWebhook,
  entetes: { 'x-token': 'abc' },
});
verifier('signature de mauvaise longueur -> 401 (jamais d’exception)', signatureCourte.statut === 401, `statut ${signatureCourte.statut}`);

const signatureValide = crypto
  .createHmac('sha256', process.env.CINETPAY_SECRET_KEY)
  .update(corpsWebhook)
  .digest('hex');
const signee = await appel('POST', '/api/jobs/webhook/cinetpay', {
  body: corpsWebhook,
  entetes: { 'x-token': signatureValide },
});
verifier(
  'signature HMAC correcte -> la vérification passe (réponse 200, puis refus de la passerelle non configurée)',
  signee.statut === 200 && typeof signee.donnees?.erreur === 'string',
  `statut ${signee.statut} | corps : ${JSON.stringify(signee.donnees)}`
);

// Contrôle direct de la comparaison (temps constant) et du fail-closed.
delete process.env.CINETPAY_SECRET_KEY;
verifier(
  'verifyNotifySignature() -> false sans clé secrète en production (fail-closed)',
  verifyNotifySignature(corpsWebhook, signatureValide) === false
);
process.env.CINETPAY_SECRET_KEY = 'secret-de-verification-bloc-f';
verifier(
  'verifyNotifySignature() -> true avec la bonne signature',
  verifyNotifySignature(corpsWebhook, signatureValide) === true
);
verifier(
  'verifyNotifySignature() -> false avec une signature de même longueur mais fausse',
  verifyNotifySignature(corpsWebhook, 'b'.repeat(64)) === false
);
verifier(
  'verifyNotifySignature() -> false avec une signature tronquée (pas d’exception « timingSafeEqual »)',
  verifyNotifySignature(corpsWebhook, signatureValide.slice(0, 10)) === false
);

// ── 6. Jeton administrateur : 12 heures ──
titre('6. Jeton du back-office — 12 h (au lieu de 30 jours)');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-verification-bloc-f';
verifier(`DUREE_JETON_ADMIN = « ${DUREE_JETON_ADMIN} »`, DUREE_JETON_ADMIN === '12h', `vu : ${DUREE_JETON_ADMIN}`);
const jetonAdmin = signToken({ _id: '000000000000000000000000', telephone: '+2250700000000' }, { expiresIn: DUREE_JETON_ADMIN });
const decodeAdmin = jwt.decode(jetonAdmin);
const heuresAdmin = (decodeAdmin.exp - decodeAdmin.iat) / 3600;
verifier('le jeton signé pour l’admin vit 12 h', heuresAdmin === 12, `vu : ${heuresAdmin} h`);
const jetonUtilisateur = signToken({ _id: '000000000000000000000000', telephone: '+2250700000000' });
const decodeUtilisateur = jwt.decode(jetonUtilisateur);
const joursUtilisateur = (decodeUtilisateur.exp - decodeUtilisateur.iat) / 86400;
verifier(
  'le jeton d’un utilisateur garde sa durée longue (30 j) : seuls les admins sont raccourcis',
  joursUtilisateur === 30,
  `vu : ${joursUtilisateur} j`
);

// ── 7. Plafond des photos : 300 Ko ──
titre('7. Plafond des photos — 300 Ko par image');
verifier(
  `la constante serveur vaut bien 300 Ko (${MAX_PHOTO_OCTETS} octets)`,
  MAX_PHOTO_OCTETS === 300 * 1024,
  `vu : ${MAX_PHOTO_OCTETS}`
);

const photo250 = dataUriDeTaille(250 * 1024);
const photo310 = dataUriDeTaille(310 * 1024);
verifier(
  `une photo de 250 Ko est acceptée (poids mesuré : ${Math.round(poidsPhotoOctets(photo250) / 1024)} Ko)`,
  validateEstablishmentPhotos(photo250, '').ok === true
);
const refusDevanture = validateEstablishmentPhotos(photo310, '');
verifier('une photo de 310 Ko est REFUSÉE', refusDevanture.ok === false, JSON.stringify(refusDevanture));
verifier(
  'le message de refus donne le poids reçu et la limite en français',
  /310 Ko/.test(refusDevanture.error || '') && /300 Ko/.test(refusDevanture.error || ''),
  `vu : ${refusDevanture.error}`
);

const refusVendeur = validateEstablishmentPhotos('', photo310);
verifier('le plafond s’applique aussi à la seconde photo (vendeur/gérant)', refusVendeur.ok === false, `vu : ${refusVendeur.error}`);

verifier(
  'deux photos différentes sous la limite sont acceptées',
  validateEstablishmentPhotos(photo250, dataUriDeTaille(240 * 1024)).ok === true
);
verifier(
  'deux photos IDENTIQUES restent refusées (règle du 30/09 conservée)',
  validateEstablishmentPhotos(photo250, photo250).ok === false
);
verifier(
  'une URL https reste acceptée sans limite de poids (l’image n’est pas stockée chez nous)',
  validateEstablishmentPhotos('https://res.cloudinary.com/rejoins-moi/photo.jpg', '').ok === true
);
verifier('aucune photo (champ vide) est accepté (« Ajouter plus tard »)', validateEstablishmentPhotos('', '').ok === true);

// Photo de profil (route utilisateurs) : même plafond.
verifier(
  'photo de profil de 310 Ko -> refusée',
  validatePhoto(photo310, 'La photo de profil').ok === false
);
verifier(
  'photo de profil de 250 Ko -> acceptée',
  validatePhoto(photo250, 'La photo de profil').ok === true
);
verifier('photo de profil vide -> acceptée (facultative)', validatePhoto('', 'La photo de profil').ok === true);

// Refus de bout en bout : le serveur rejette une photo trop lourde (400) avant toute
// écriture. Route publique d'inscription : aucun compte n'est créé par cet appel.
const inscriptionTropLourde = await appel('POST', '/api/users/register', {
  body: { telephone: '0700000002', motDePasse: 'motdepasse', photoProfil: photo310 },
});
verifier(
  'POST /api/users/register avec une photo de 310 Ko -> 400 (refus serveur)',
  inscriptionTropLourde.statut === 400,
  `statut ${inscriptionTropLourde.statut} | ${JSON.stringify(inscriptionTropLourde.donnees)}`
);

// ───────────────────────────── Bilan ─────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log(`  Statuts /api/admin/login : ${statutsAdmin.join(' → ')}`);
console.log(`  Webhook non signé : ${sansSignature.statut} | signature fausse : ${signatureFausse.statut} | signature valide : ${signee.statut}`);
if (echecs.length === 0) {
  console.log(`✅ Sécurité (bloc F) : ${reussis}/${reussis} vérifications réussies.\n`);
} else {
  console.log(`❌ Sécurité (bloc F) : ${echecs.length} échec(s) : ${echecs.join(' | ')}\n`);
}

// Le serveur de test garde le port ouvert : on coupe MongoDB puis le processus
// explicitement (sinon Node ne se termine jamais — même logique que verifier-base.js).
const mongoose = (await import('mongoose')).default;
await mongoose.disconnect().catch(() => {});
process.exit(echecs.length === 0 ? 0 : 1);
