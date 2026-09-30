// verifier-base.js — Vérification de BOUT EN BOUT avec MongoDB.
//
// Répond à une seule question : « une fois MongoDB branché, l'application enregistre-t-elle
// vraiment les inscriptions, et les routes répondent-elles autre chose que 503 ? »
//
// Ce que fait le script, dans l'ordre :
//   1. il démarre le VRAI serveur (src/index.js) sur un port dédié ;
//   2. il interroge toutes les routes publiques et échoue si l'une répond 503 ;
//   3. il CRÉE un compte de test par l'API, se reconnecte, lit /api/users/me ;
//   4. il relit la ligne DIRECTEMENT en base (Preuve de persistance) ;
//   5. il vérifie qu'aucun abonnement n'est activé sans paiement confirmé ;
//   6. il supprime le compte de test (sauf option --garder).
//
// Lancement (depuis /backend) :
//   npm run verifier:base                 -> crée puis nettoie le compte de test
//   npm run verifier:base -- --garder     -> conserve le compte de test
//
// Prérequis : MONGODB_URI renseigné dans backend/.env — voir docs/DEPLOIEMENT.md §1.

import 'dotenv/config';
import { randomInt } from 'node:crypto';

import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Subscription from '../src/models/Subscription.js';

const PORT = Number(process.env.PORT_VERIFICATION) || 4100;
const BASE = `http://127.0.0.1:${PORT}`;
const GARDER = process.argv.includes('--garder');
const JOUR_MS = 86400000;

let reussis = 0;
const echecs = [];
const journal = [];

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

/** Petit client HTTP sans dépendance (Node 18+ dispose de fetch). */
async function appel(methode, chemin, { body, token } = {}) {
  const entetes = { Accept: 'application/json' };
  if (body !== undefined) entetes['Content-Type'] = 'application/json';
  if (token) entetes.Authorization = `Bearer ${token}`;

  let reponse;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      method: methode,
      headers: entetes,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    journal.push({ methode, chemin, statut: 'réseau', erreur: err.message });
    return { statut: 0, donnees: null, erreur: err.message };
  }

  const texte = await reponse.text();
  let donnees = null;
  if (texte) {
    try {
      donnees = JSON.parse(texte);
    } catch {
      donnees = { brut: texte.slice(0, 200) };
    }
  }
  journal.push({ methode, chemin, statut: reponse.status });
  return { statut: reponse.status, donnees };
}

/** Attend que le serveur réponde (le temps que la connexion Mongo s'établisse). */
async function attendreServeur(maxMs = 25000) {
  const limite = Date.now() + maxMs;
  while (Date.now() < limite) {
    try {
      const reponse = await fetch(`${BASE}/api/health`);
      if (reponse.status > 0) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((resoudre) => setTimeout(resoudre, 400));
  }
  return false;
}

function rappelAtlas() {
  console.warn('\nÀ vérifier du côté MongoDB Atlas :');
  console.warn('  1. Database Access : le compte de base existe et son mot de passe est exactement');
  console.warn('     celui de MONGODB_URI (@ doit être écrit %40 dans l’URI) ;');
  console.warn('  2. Network Access : votre adresse IP est autorisée (0.0.0.0/0 pour tester) ;');
  console.warn("  3. le cluster n'est pas en veille (console Atlas > Resume) ;");
  console.warn('  4. l’URI complète a bien été recopiée (mongodb+srv://…, sans espace).');
  console.warn('\nRelancez ensuite : npm run verifier:base\n');
}

async function principal() {
  console.log('\n▶ Vérification de bout en bout (MongoDB + API Rejoins’Moi)');

  const uri = process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('\n❌ MONGODB_URI est absent.');
    console.error('   Copiez backend/.env.example en backend/.env, puis collez l’URI du cluster');
    console.error('   MongoDB Atlas (mode d’emploi détaillé : docs/DEPLOIEMENT.md §1).\n');
    process.exitCode = 2;
    return;
  }
  console.log(`  URI  : ${uri.replace(/\/\/([^:@/]+)(:[^@/]*)?@/, '//$1:****@')}`);
  console.log(`  Base : ${process.env.MONGODB_DB_NAME || 'rejoins-moi'}`);

  // index.js lit process.env.PORT à l'import : on le fixe AVANT de l'importer pour
  // ne pas gêner un serveur de développement déjà lancé sur le port 4000.
  process.env.PORT = String(PORT);

  titre('0. Démarrage du serveur');
  await import('../src/index.js');
  const pret = await attendreServeur();
  verifier(`le serveur répond sur ${BASE}`, pret);
  if (!pret) {
    rappelAtlas();
    process.exitCode = 1;
    process.exit(1);
  }

  const sante = await appel('GET', '/api/health');
  verifier('GET /api/health répond 200', sante.statut === 200, `statut ${sante.statut}`);
  verifier(
    'MongoDB est connecté (baseDonnees = « connectée »)',
    sante.donnees?.baseDonnees === 'connectée',
    `vu : ${sante.donnees?.baseDonnees}`
  );
  if (sante.donnees?.baseDonnees !== 'connectée') {
    rappelAtlas();
    console.warn('  Sans base de données, le reste des vérifications est impossible : arrêt.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }

  // ── 1. Toutes les routes publiques : fini les 503 ─────────────────────────
  titre('1. Routes publiques (aucune ne doit répondre 503)');
  const routes = [
    ['GET', '/api'],
    ['GET', '/api/health'],
    ['GET', '/api/establishments'],
    ['GET', '/api/establishments/categories'],
    ['GET', '/api/health-facilities'],
    ['GET', '/api/jobs'],
    ['GET', '/api/jobs/metiers'],
    ['GET', '/api/users/artisans'],
    ['GET', '/api/subscriptions/formules'],
  ];
  for (const [methode, chemin] of routes) {
    const resultat = await appel(methode, chemin);
    verifier(
      `${methode} ${chemin} → 200`,
      resultat.statut === 200,
      resultat.statut === 503 ? 'encore 503 (base indisponible)' : `statut ${resultat.statut}`
    );
  }

  // ── 2. Catalogue d'abonnement : DEUX formules ─────────────────────────────
  titre('2. Catalogue d’abonnement (deux formules en parallèle)');
  const formules = await appel('GET', '/api/subscriptions/formules');
  const cles = (formules.donnees?.formules || []).map((f) => f.cle);
  verifier('les deux formules sont proposées', cles.join(',') === 'artisan_hebdo,artisan_mensuel', cles.join(','));
  verifier(
    'les prix provisoires sont publiés (700 / 2 500 FCFA)',
    formules.donnees?.formules?.some((f) => f.prixFcfa === 700) &&
      formules.donnees?.formules?.some((f) => f.prixFcfa === 2500)
  );
  verifier('à confirmer : mention « tarif provisoire » toujours active', formules.donnees?.formules?.every((f) => f.aConfirmer === true));
  verifier('formule par défaut exposée au frontend', formules.donnees?.formuleParDefaut === 'artisan_hebdo');

  // ── 3. Inscription : le cœur du sujet ─────────────────────────────────────
  titre('3. Inscription d’un artisan (écriture réelle en base)');
  const telephone = `+2250701${String(randomInt(100000, 999999))}`;
  const motDePasse = 'MotDePasseTest2026';
  const inscription = await appel('POST', '/api/users/register', {
    body: {
      telephone,
      motDePasse,
      nom: 'ZOGBO',
      prenom: 'Vérification',
      metier: 'Électricien',
      quartier: 'Angré 8e tranche',
      commune: 'Cocody',
      localisation: { lat: 5.4045, lng: -3.9765 },
      estArtisan: true,
      chercheTravail: true,
    },
  });
  verifier('POST /api/users/register → 201', inscription.statut === 201, `statut ${inscription.statut} — ${inscription.donnees?.error || ''}`);
  const jeton = inscription.donnees?.token || '';
  verifier('un jeton JWT est renvoyé', Boolean(jeton));
  verifier('le téléphone est normalisé au format +225…', inscription.donnees?.user?.telephone?.startsWith('+225'), inscription.donnees?.user?.telephone);

  const moi = await appel('GET', '/api/users/me', { token: jeton });
  verifier('GET /api/users/me → 200 avec le jeton', moi.statut === 200, `statut ${moi.statut}`);
  verifier('le profil renvoyé est bien celui créé', moi.donnees?.user?.metier === 'Électricien', moi.donnees?.user?.metier);

  const connexion = await appel('POST', '/api/users/login', { body: { telephone, motDePasse } });
  verifier('POST /api/users/login → 200 (mot de passe vérifié)', connexion.statut === 200, `statut ${connexion.statut} — ${connexion.donnees?.error || ''}`);

  const maj = await appel('PATCH', '/api/users/me', {
    token: jeton,
    body: { quartier: 'Quartier de vérification' },
  });
  verifier('PATCH /api/users/me → 200 (mise à jour du profil)', maj.statut === 200, `statut ${maj.statut}`);

  // ── 4. Persistance réelle en base ─────────────────────────────────────────
  titre('4. Persistance (relecture par une requête Mongo, pas par l’API)');
  const telephoneStocke = String(inscription.donnees?.user?.telephone || telephone);
  const enBase = await User.findOne({ telephone: telephoneStocke });
  verifier('le compte est présent dans MongoDB', Boolean(enBase), 'aucune ligne trouvée avec ce téléphone');
  if (enBase) {
    verifier(
      'le mot de passe est stocké HACHÉ (jamais en clair)',
      Boolean(enBase.motDePasseHash) && enBase.motDePasseHash !== motDePasse
    );
    verifier(
      'la mise à jour du profil a bien été écrite',
      enBase.quartier === 'Quartier de vérification',
      enBase.quartier
    );
  }
  const total = await User.countDocuments();
  console.log(`  ℹ ${total} compte(s) dans la base « ${mongoose.connection.name} »`);

  const artisans = await appel('GET', '/api/users/artisans');
  verifier('GET /api/users/artisans → 200', artisans.statut === 200, `statut ${artisans.statut}`);
  verifier(
    'le nouvel artisan est visible dans l’annuaire',
    (artisans.donnees?.items || []).some((u) => String(u.id) === String(enBase?._id))
  );
  verifier(
    'l’annuaire ne divulgue aucun numéro de téléphone',
    (artisans.donnees?.items || []).every((u) => !u.telephone)
  );

  // ── 5. Abonnements : aucun faux paiement ──────────────────────────────────
  titre('5. Abonnements (sécurité du paiement)');
  const bidon = await appel('POST', '/api/subscriptions/souscrire', {
    token: jeton,
    body: { formule: 'formule-bidon' },
  });
  verifier('une formule INCONNUE est refusée (400)', bidon.statut === 400, `statut ${bidon.statut}`);

  const sansPaiement = await appel('POST', '/api/subscriptions/souscrire', {
    token: jeton,
    body: { formule: 'artisan_hebdo' },
  });
  const paiementConfigure = sante.donnees?.paiement?.configure === true;
  verifier(
    paiementConfigure
      ? 'CinetPay configuré : une URL de paiement est renvoyée (202)'
      : 'CinetPay non configuré : souscription refusée (501), rien n’est activé',
    paiementConfigure ? sansPaiement.statut === 202 : sansPaiement.statut === 501,
    `statut ${sansPaiement.statut} — ${sansPaiement.donnees?.error || ''}`
  );
  const alias = await appel('POST', '/api/subscriptions/souscrire', {
    token: jeton,
    body: { formule: 'artisan' },
  });
  verifier('l’ancienne clé « artisan » reste acceptée (pas de 400)', alias.statut !== 400, `statut ${alias.statut}`);

  const lignesAbo = enBase ? await Subscription.countDocuments({ userId: enBase._id }) : 0;
  verifier('AUCUN abonnement activé sans paiement confirmé', lignesAbo === 0, `${lignesAbo} ligne(s) créée(s)`);
  const monAbo = await appel('GET', '/api/subscriptions/moi', { token: jeton });
  verifier(
    'GET /api/subscriptions/moi → 200, abonnement nul',
    monAbo.statut === 200 && monAbo.donnees?.abonnement === null,
    `statut ${monAbo.statut} / actif : ${monAbo.donnees?.abonnementActif}`
  );

  // ── 6. Nettoyage ──────────────────────────────────────────────────────────
  titre('6. Nettoyage du compte de test');
  if (GARDER) {
    console.log(`  ℹ Compte conservé (option --garder) : ${inscription.donnees?.user?.telephone} / ${motDePasse}`);
  } else if (enBase) {
    await Subscription.deleteMany({ userId: enBase._id });
    await User.deleteOne({ _id: enBase._id });
    const reste = await User.countDocuments({ telephone: enBase.telephone });
    verifier('le compte de test a été supprimé', reste === 0, `${reste} ligne(s) restante(s)`);
  }

  // ── Bilan ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(64)}`);
  console.log('Journal des requêtes :');
  for (const ligne of journal) {
    const marque = ligne.statut === 503 ? '  ← 503 (base indisponible) !' : '';
    console.log(`  ${String(ligne.statut).padStart(4)}  ${ligne.methode.padEnd(6)} ${ligne.chemin}${marque}`);
  }
  console.log('─'.repeat(64));
  if (echecs.length === 0) {
    console.log(`✅ Base de données : ${reussis}/${reussis} vérifications réussies.`);
    console.log('   Inscriptions persistées, plus aucun 503, aucune activation sans paiement.\n');
  } else {
    console.log(`❌ Base de données : ${echecs.length} échec(s) sur ${reussis + echecs.length} vérifications :`);
    for (const echec of echecs) console.log(`   • ${echec}`);
    console.log('');
  }

  await mongoose.disconnect().catch(() => {});
  process.exit(echecs.length === 0 ? 0 : 1);
}

principal();
