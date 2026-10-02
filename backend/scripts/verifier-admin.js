// verifier-admin.js — Vérification de BOUT EN BOUT du BACK-OFFICE administrateur.
//
// Répond aux questions que se pose l'équipe au lancement :
//   « puis-je suivre les utilisateurs et leurs paiements ? »
//   « puis-je valider un compte, puis le suspendre — et la suspension coupe-t-elle
//     vraiment l'accès, même pour un utilisateur déjà connecté ? »
//
// Scénario complet, avec MongoDB :
//   1. le VRAI serveur démarre sur un port dédié ;
//   2. un administrateur se connecte par NUMÉRO DE TÉLÉPHONE (comme tout le monde) ;
//   3. recherche/filtres/tri du parc de comptes + compteurs globaux ;
//   4. la fiche d'un compte expose son activité (dépôts, contacts débloqués) ;
//   5. un dépôt mobile money réel est déclaré : il apparaît dans le journal d'activité ;
//   6. SUSPENSION d'un compte : connexion refusée ET jeton déjà émis refusé (403) ;
//   7. RÉACTIVATION : l'utilisateur se reconnecte, et son ancien jeton remarche ;
//   8. garde-fous : pas de suspension de soi-même, ni d'un compte administrateur ;
//   9. nettoyage des lignes créées (sauf --garder).
//
// Lancement (depuis /backend) :
//   npm run verifier:admin                 -> crée puis nettoie les données de test
//   npm run verifier:admin -- --garder     -> conserve les lignes créées
//
// Prérequis :
//   - MONGODB_URI renseigné dans backend/.env (voir docs/DEPLOIEMENT.md §1) ;
//   - le compte admin existe : npm run admin:creer
//     (numéro « 0102030405 » / mot de passe « 00admin-fix » par défaut —
//      surchargeables par ADMIN_IDENTIFIANT et ADMIN_MOT_DE_PASSE).

import 'dotenv/config';
import { randomInt } from 'node:crypto';

import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Job from '../src/models/Job.js';
import Depot from '../src/models/Depot.js';

const PORT = Number(process.env.PORT_VERIFICATION_ADMIN) || 4103;
const BASE = `http://127.0.0.1:${PORT}`;
const GARDER = process.argv.includes('--garder');
const ADMIN_IDENTIFIANT = process.env.ADMIN_IDENTIFIANT || '0102030405';
const ADMIN_MOT_DE_PASSE = process.env.ADMIN_MOT_DE_PASSE || '00admin-fix';

let reussis = 0;
const echecs = [];
const journal = [];
const aNettoyer = { utilisateurs: [], jobs: [], depots: [] };

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
    journal.push({ methode, chemin, statut: 'réseau' });
    return { statut: 0, donnees: null, erreur: err.message };
  }

  const texte = await reponse.text();
  let donnees = null;
  if (texte) {
    try {
      donnees = JSON.parse(texte);
    } catch {
      donnees = null;
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

/** Crée un compte de test par l'API et renvoie son téléphone, son mot de passe et la réponse. */
async function creerCompte(suffixe, motDePasse) {
  const telephone = `+2250703${suffixe}`;
  const reponse = await appel('POST', '/api/users/register', {
    body: {
      telephone,
      motDePasse,
      nom: 'Suivi',
      prenom: `Admin${suffixe.slice(-3)}`,
      metier: 'Électricien',
      quartier: 'Yopougon',
      commune: 'Abidjan',
      localisation: { lat: 5.3364, lng: -4.0744 },
      estArtisan: true,
      chercheTravail: true,
    },
  });
  return { statut: reponse.statut, donnees: reponse.donnees, telephone, motDePasse };
}

async function principal() {
  console.log('\n▶ Vérification du back-office administrateur (suivi, validation, suspension)');

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

  // index.js lit process.env.PORT à l'import : on le fixe AVANT de l'importer.
  process.env.PORT = String(PORT);

  titre('0. Démarrage du serveur');
  await import('../src/index.js');
  const pret = await attendreServeur();
  verifier(`le serveur répond sur ${BASE}`, pret);
  if (!pret) {
    console.error('\n❌ Le serveur n’a pas démarré : vérifiez MONGODB_URI et le port.\n');
    process.exit(1);
  }

  // ── 1. Connexion administrateur par NUMÉRO DE TÉLÉPHONE ─────────────────────
  titre('1. Connexion au back-office (numéro de téléphone administrateur)');
  const connexion = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: ADMIN_MOT_DE_PASSE },
  });
  verifier(
    `connexion admin par numéro « ${ADMIN_IDENTIFIANT} » → 200`,
    connexion.statut === 200 && Boolean(connexion.donnees?.token),
    `statut ${connexion.statut} · ${connexion.donnees?.error || ''}`
  );
  const jetonAdmin = connexion.donnees?.token;
  const idAdmin = connexion.donnees?.user?.id;
  verifier('la réponse marque bien un administrateur (admin: true)', connexion.donnees?.admin === true);
  verifier(
    'le mot de passe n’est jamais renvoyé',
    !JSON.stringify(connexion.donnees || {}).includes('motDePasseHash')
  );

  const identifie = await appel('GET', '/api/admin/moi', { token: jetonAdmin });
  verifier('GET /api/admin/moi → 200', identifie.statut === 200, `statut ${identifie.statut}`);
  verifier(
    'la dernière connexion de l’admin est enregistrée (dernierLoginAt)',
    Boolean(identifie.donnees?.user?.dernierLoginAt)
  );

  if (!jetonAdmin || !idAdmin) {
    console.error('\n❌ Connexion administrateur impossible : lancez npm run admin:creer.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }

  // ── 2. Comptes de test ──────────────────────────────────────────────────────
  titre('2. Comptes de test (un posteur, un ouvrier)');
  const motDePasse = 'Verif-admin-2026';
  const posteur = await creerCompte(String(randomInt(100000, 999999)), motDePasse);
  const ouvrier = await creerCompte(String(randomInt(100000, 999999)), motDePasse);
  verifier('le compte du posteur est créé (201)', posteur.statut === 201, `statut ${posteur.statut}`);
  verifier('le compte de l’ouvrier est créé (201)', ouvrier.statut === 201, `statut ${ouvrier.statut}`);
  if (posteur.statut !== 201 || ouvrier.statut !== 201) {
    console.error('\n❌ Impossible de créer les comptes de test : arrêt.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }

  const idPosteur = posteur.donnees?.user?.id;
  const idOuvrier = ouvrier.donnees?.user?.id;
  aNettoyer.utilisateurs.push(idPosteur, idOuvrier);

  // Connexion de l'ouvrier : c'est elle qui renseigne `dernierLoginAt`, donc qui
  // alimente « connectés ces dernières 24 h » et le journal des connexions.
  const loginOuvrier = await appel('POST', '/api/users/login', {
    body: { telephone: ouvrier.telephone, motDePasse },
  });
  verifier('l’ouvrier se connecte (200)', loginOuvrier.statut === 200, `statut ${loginOuvrier.statut}`);
  const jetonOuvrier = loginOuvrier.donnees?.token;
  verifier(
    'sa dernière connexion est enregistrée (dernierLoginAt)',
    Boolean(loginOuvrier.donnees?.user?.dernierLoginAt)
  );

  // ── 3. Parc de comptes : recherche, filtres, tri, fiche ─────────────────────
  titre('3. Suivi des utilisateurs (recherche, filtres, tri, fiche)');
  const liste = await appel('GET', '/api/admin/utilisateurs?limit=100', { token: jetonAdmin });
  verifier('GET /api/admin/utilisateurs → 200', liste.statut === 200, `statut ${liste.statut}`);
  const compteurs = liste.donnees?.compteurs || {};
  verifier(
    'les compteurs globaux sont publiés (utilisateurs, suspendus, connectés 24 h, …)',
    Number.isFinite(compteurs.utilisateurs) &&
      Number.isFinite(compteurs.suspendus) &&
      Number.isFinite(compteurs.connectes24h),
    `compteurs : ${JSON.stringify(compteurs)}`
  );

  const ligneOuvrier = (liste.donnees?.items || []).find((u) => u.id === idOuvrier);
  verifier('le compte de test apparaît dans la liste', Boolean(ligneOuvrier));
  verifier('chaque ligne porte l’état du compte (statutCompte)', ligneOuvrier?.statutCompte === 'actif');
  verifier('chaque ligne porte le nombre de dépôts du compte', Boolean(ligneOuvrier?.depots));

  const recherche = await appel('GET', `/api/admin/utilisateurs?q=${encodeURIComponent(ouvrier.telephone)}`, {
    token: jetonAdmin,
  });
  verifier(
    'recherche par numéro complet : le compte remonte',
    (recherche.donnees?.items || []).some((u) => u.id === idOuvrier),
    `total ${recherche.donnees?.total}`
  );

  // Le numéro local formaté « 07 03 12 34 56 » doit aussi fonctionner : c'est ce qu'un
  // administrateur tape au téléphone.
  const numeroEspaces = (ouvrier.telephone.replace(/^\+225/, '').match(/.{1,2}/g) || []).join(' ');
  const rechercheEspaces = await appel('GET', `/api/admin/utilisateurs?q=${encodeURIComponent(numeroEspaces)}`, {
    token: jetonAdmin,
  });
  verifier(
    `recherche tolérante aux espaces (« ${numeroEspaces} »)`,
    (rechercheEspaces.donnees?.items || []).some((u) => u.id === idOuvrier),
    `total ${rechercheEspaces.donnees?.total}`
  );

  const filtreSuspendusAvant = await appel('GET', '/api/admin/utilisateurs?filtre=suspendus', {
    token: jetonAdmin,
  });
  verifier(
    'filtre « suspendus » : 200 et uniquement des comptes suspendus',
    filtreSuspendusAvant.statut === 200 &&
      (filtreSuspendusAvant.donnees?.items || []).every((u) => u.statutCompte === 'suspendu'),
    `statut ${filtreSuspendusAvant.statut}`
  );
  const filtreColonnes = await appel('GET', '/api/admin/utilisateurs?filtre=chercheurs', { token: jetonAdmin });
  verifier(
    'filtre « chercheurs » : 200 et uniquement des chercheurs d’emploi',
    filtreColonnes.statut === 200 && (filtreColonnes.donnees?.items || []).every((u) => u.chercheTravail === true),
    `statut ${filtreColonnes.statut}`
  );

  const triActivite = await appel('GET', '/api/admin/utilisateurs?tri=activite&limit=5', { token: jetonAdmin });
  verifier('tri par activité → 200', triActivite.statut === 200, `statut ${triActivite.statut}`);
  verifier(
    'le tri par activité met en tête les connexions récentes (jamais les valeurs vides)',
    Boolean(triActivite.donnees?.items?.[0]?.dernierLoginAt),
    JSON.stringify((triActivite.donnees?.items || []).map((u) => u.dernierLoginAt))
  );

  const fiche = await appel('GET', `/api/admin/utilisateurs/${idOuvrier}`, { token: jetonAdmin });
  verifier('GET /api/admin/utilisateurs/:id → 200', fiche.statut === 200, `statut ${fiche.statut}`);
  verifier('la fiche expose un résumé d’activité (resume)', Boolean(fiche.donnees?.resume));
  verifier(
    'à ce stade : 0 dépôt et 0 contact débloqué',
    Number(fiche.donnees?.resume?.depots?.total) === 0 &&
      Number(fiche.donnees?.resume?.contactsDebloques) === 0,
    JSON.stringify(fiche.donnees?.resume)
  );
  verifier('la fiche liste les dépôts du compte', Array.isArray(fiche.donnees?.depots));

  const ficheInconnue = await appel('GET', '/api/admin/utilisateurs/000000000000000000000000', {
    token: jetonAdmin,
  });
  verifier('fiche d’un compte inexistant → 404', ficheInconnue.statut === 404, `statut ${ficheInconnue.statut}`);

  // ── 4. Un paiement réel : le dépôt déclaré remonte dans le suivi ────────────
  titre('4. Paiement : le dépôt déclaré remonte dans le suivi');
  const creation = await appel('POST', '/api/jobs', {
    token: posteur.donnees?.token,
    body: {
      typeAnnonce: 'demande',
      metier: 'Électricien',
      intitule: 'Mise aux normes d’un tableau électrique',
      description: 'Tableau vétuste à remplacer, logement de 3 pièces à Yopougon.',
      localisation: { lat: 5.3364, lng: -4.0744 },
      commune: 'Abidjan',
      quartier: 'Yopougon',
      telephoneContact: posteur.telephone,
      budgetFcfa: 30000,
      segment: 'specialise',
    },
  });
  verifier('le posteur publie un besoin (201)', creation.statut === 201, `statut ${creation.statut}`);
  const besoin = creation.donnees?.job;
  if (besoin?.id) aNettoyer.jobs.push(besoin.id);

  const declaration = await appel('POST', `/api/jobs/${besoin?.id}/demande-deblocage`, {
    token: jetonOuvrier,
    body: { operateur: 'WAVE', telephonePayeur: ouvrier.telephone, reference: 'REF-ADMIN-1' },
  });
  verifier('l’ouvrier déclare son dépôt Wave (202)', declaration.statut === 202, `statut ${declaration.statut}`);
  const idDepot = declaration.donnees?.depot?.id;
  if (idDepot) aNettoyer.depots.push(idDepot);
  verifier(
    'le dépôt est enregistré en attente (aucun déblocage automatique)',
    declaration.donnees?.statut === 'en_attente'
  );

  const fileDepots = await appel('GET', '/api/admin/depots?statut=en_attente', { token: jetonAdmin });
  verifier(
    'le dépôt apparaît dans la file « à valider » du back-office',
    (fileDepots.donnees?.items || []).some((d) => d.id === idDepot),
    `total en attente : ${fileDepots.donnees?.total}`
  );

  const ficheApresDepot = await appel('GET', `/api/admin/utilisateurs/${idOuvrier}`, { token: jetonAdmin });
  verifier(
    'la fiche du compte compte son dépôt en attente',
    Number(ficheApresDepot.donnees?.resume?.depots?.enAttente) >= 1,
    JSON.stringify(ficheApresDepot.donnees?.resume?.depots)
  );

  const listeApresDepot = await appel(
    'GET',
    `/api/admin/utilisateurs?q=${encodeURIComponent(ouvrier.telephone)}`,
    { token: jetonAdmin }
  );
  const ligneApresDepot = (listeApresDepot.donnees?.items || []).find((u) => u.id === idOuvrier);
  verifier(
    'la liste affiche le dépôt du compte sans ouvrir la fiche',
    Number(ligneApresDepot?.depots?.enAttente) >= 1,
    JSON.stringify(ligneApresDepot?.depots)
  );

  // ── 5. Journal d'activité (inscriptions, connexions, paiements) ─────────────
  titre('5. Journal d’activité du back-office');
  const activite = await appel('GET', '/api/admin/activite?limit=60', { token: jetonAdmin });
  verifier('GET /api/admin/activite → 200', activite.statut === 200, `statut ${activite.statut}`);
  const types = new Set((activite.donnees?.evenements || []).map((e) => e.type));
  verifier(
    'le journal mélange inscriptions, connexions et paiements',
    types.has('inscription') && types.has('connexion') && types.has('paiement'),
    `types vus : ${[...types].join(', ')}`
  );
  verifier(
    'le journal est trié du plus récent au plus ancien',
    (activite.donnees?.evenements || []).every(
      (e, i, tous) => i === 0 || new Date(tous[i - 1].at) >= new Date(e.at)
    )
  );
  verifier(
    'les compteurs de présence sont exposés (24 h / 7 j) et non nuls',
    Number(activite.donnees?.connectes?.dernier24h) >= 1 && Number(activite.donnees?.connectes?.dernier7j) >= 1,
    JSON.stringify(activite.donnees?.connectes)
  );

  const paiement = (activite.donnees?.evenements || []).find((e) => e.type === 'paiement' && e.depotId === idDepot);
  verifier(
    'le dépôt de l’ouvrier est visible dans le journal, avec son montant et son opérateur',
    Boolean(paiement) && Number(paiement?.montant) > 0 && Boolean(paiement?.operateur),
    JSON.stringify(paiement)
  );

  const activiteConnexions = await appel('GET', '/api/admin/activite?type=connexions', { token: jetonAdmin });
  verifier(
    'filtre « connexions » : uniquement des connexions',
    activiteConnexions.statut === 200 &&
      (activiteConnexions.donnees?.evenements || []).length > 0 &&
      (activiteConnexions.donnees?.evenements || []).every((e) => e.type === 'connexion'),
    `statut ${activiteConnexions.statut}`
  );

  // ── 6. SUSPENSION : coupe la connexion ET les jetons déjà émis ──────────────
  titre('6. Suspension d’un compte (l’accès doit être coupé immédiatement)');
  const suspension = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}/statut`, {
    token: jetonAdmin,
    body: { statut: 'suspendu', motif: 'Paiement non reçu — vérification en cours' },
  });
  verifier(
    'PATCH …/statut {suspendu} → 200',
    suspension.statut === 200,
    `statut ${suspension.statut} · ${suspension.donnees?.error || ''}`
  );
  verifier('le compte est marqué « suspendu »', suspension.donnees?.user?.statutCompte === 'suspendu');
  verifier('la date de suspension est enregistrée', Boolean(suspension.donnees?.user?.suspenduAt));
  verifier('le motif est conservé', Boolean(suspension.donnees?.user?.motifSuspension));

  const meSuspendu = await appel('GET', '/api/users/me', { token: jetonOuvrier });
  verifier(
    '⚠ un jeton DÉJÀ ÉMIS ne fonctionne plus (403)',
    meSuspendu.statut === 403,
    `statut ${meSuspendu.statut}`
  );
  verifier(
    'le code COMPTE_SUSPENDU est renvoyé au client',
    meSuspendu.donnees?.details?.code === 'COMPTE_SUSPENDU',
    JSON.stringify(meSuspendu.donnees)
  );
  const actionSuspendue = await appel('POST', `/api/jobs/${besoin?.id}/demande-deblocage`, {
    token: jetonOuvrier,
    body: { operateur: 'WAVE', telephonePayeur: ouvrier.telephone },
  });
  verifier(
    'aucune action métier n’est possible (403)',
    actionSuspendue.statut === 403,
    `statut ${actionSuspendue.statut}`
  );

  const reconnexionSuspendue = await appel('POST', '/api/users/login', {
    body: { telephone: ouvrier.telephone, motDePasse },
  });
  verifier(
    'toute nouvelle connexion est refusée (403)',
    reconnexionSuspendue.statut === 403,
    `statut ${reconnexionSuspendue.statut}`
  );
  verifier(
    'le motif est affiché à l’utilisateur (jamais de sanction silencieuse)',
    String(reconnexionSuspendue.donnees?.error || '').includes('Paiement non reçu'),
    reconnexionSuspendue.donnees?.error
  );

  const filtreSuspendusApres = await appel('GET', '/api/admin/utilisateurs?filtre=suspendus&limit=100', {
    token: jetonAdmin,
  });
  verifier(
    'le compte apparaît dans le filtre « suspendus »',
    (filtreSuspendusApres.donnees?.items || []).some((u) => u.id === idOuvrier),
    JSON.stringify(filtreSuspendusApres.donnees?.compteurs)
  );
  verifier(
    'le compteur global des suspendus augmente',
    Number(filtreSuspendusApres.donnees?.compteurs?.suspendus) >= 1
  );
  const filtreActifs = await appel('GET', '/api/admin/utilisateurs?filtre=actifs&limit=100', { token: jetonAdmin });
  verifier(
    'le compte disparaît du filtre « actifs »',
    !(filtreActifs.donnees?.items || []).some((u) => u.id === idOuvrier)
  );

  // ── 7. RÉACTIVATION ────────────────────────────────────────────────────────
  titre('7. Réactivation du compte (la suspension doit être réversible)');
  const reactivation = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}/statut`, {
    token: jetonAdmin,
    body: { statut: 'actif' },
  });
  verifier('PATCH …/statut {actif} → 200', reactivation.statut === 200, `statut ${reactivation.statut}`);
  verifier('le compte redevient actif', reactivation.donnees?.user?.statutCompte === 'actif');
  verifier(
    'le motif et la date de suspension sont effacés',
    !reactivation.donnees?.user?.motifSuspension && !reactivation.donnees?.user?.suspenduAt
  );
  const meReactive = await appel('GET', '/api/users/me', { token: jetonOuvrier });
  verifier(
    'l’ancien jeton remarche : la réactivation est réelle, pas cosmétique',
    meReactive.statut === 200,
    `statut ${meReactive.statut}`
  );
  const reconnexionOk = await appel('POST', '/api/users/login', {
    body: { telephone: ouvrier.telephone, motDePasse },
  });
  verifier(
    'l’utilisateur peut se reconnecter',
    reconnexionOk.statut === 200 && Boolean(reconnexionOk.donnees?.token),
    `statut ${reconnexionOk.statut}`
  );

  // ── 8. Garde-fous du back-office ────────────────────────────────────────────
  titre('8. Garde-fous (on ne se coupe pas la main)');
  const surSoiMeme = await appel('PATCH', `/api/admin/utilisateurs/${idAdmin}/statut`, {
    token: jetonAdmin,
    body: { statut: 'suspendu', motif: 'test' },
  });
  verifier(
    'impossible de suspendre son PROPRE compte (409)',
    surSoiMeme.statut === 409,
    `statut ${surSoiMeme.statut}`
  );

  const statutInvalide = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}/statut`, {
    token: jetonAdmin,
    body: { statut: 'banni' },
  });
  verifier('statut inconnu refusé (400)', statutInvalide.statut === 400, `statut ${statutInvalide.statut}`);

  // Un administrateur ne doit pas pouvoir être suspendu : sinon on peut verrouiller le
  // back-office pour de bon. On promeut temporairement le compte de test pour le prouver.
  const promotion = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}`, {
    token: jetonAdmin,
    body: { estAdmin: true },
  });
  verifier('promotion temporaire en administrateur (200)', promotion.statut === 200, `statut ${promotion.statut}`);
  const suspendreAdmin = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}/statut`, {
    token: jetonAdmin,
    body: { statut: 'suspendu', motif: 'test' },
  });
  verifier(
    'un compte administrateur ne peut pas être suspendu (409)',
    suspendreAdmin.statut === 409,
    `statut ${suspendreAdmin.statut}`
  );
  const retraitAdmin = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}`, {
    token: jetonAdmin,
    body: { estAdmin: false },
  });
  verifier('le rôle administrateur de test est retiré', retraitAdmin.donnees?.user?.estAdmin === false);

  const sansJeton = await appel('GET', '/api/admin/utilisateurs');
  verifier('sans jeton, l’espace admin est fermé (401)', sansJeton.statut === 401, `statut ${sansJeton.statut}`);
  const avecJetonUtilisateur = await appel('GET', '/api/admin/activite', { token: jetonOuvrier });
  verifier(
    'un compte non administrateur est refusé (403)',
    avecJetonUtilisateur.statut === 403,
    `statut ${avecJetonUtilisateur.statut}`
  );

  // ── 9. Tableau de bord ──────────────────────────────────────────────────────
  titre('9. Tableau de bord (statistiques de suivi)');
  const stats = await appel('GET', '/api/admin/statistiques', { token: jetonAdmin });
  verifier('GET /api/admin/statistiques → 200', stats.statut === 200, `statut ${stats.statut}`);
  verifier(
    'les compteurs de suivi sont publiés (suspendus, inscrits 7/30 j, connectés 24 h/7 j)',
    Number.isFinite(stats.donnees?.suspendus) &&
      Number.isFinite(stats.donnees?.inscrits7j) &&
      Number.isFinite(stats.donnees?.inscrits30j) &&
      Number.isFinite(stats.donnees?.connectes?.dernier24h) &&
      Number.isFinite(stats.donnees?.connectes?.dernier7j),
    JSON.stringify(stats.donnees?.connectes)
  );
  verifier(
    'la série des 7 derniers jours est présente (7 points)',
    (stats.donnees?.depots?.serie7j || []).length === 7,
    `points : ${(stats.donnees?.depots?.serie7j || []).length}`
  );
  verifier(
    'les dépôts du jour sont comptés séparément',
    Number.isFinite(stats.donnees?.depots?.aujourdhui) && Number(stats.donnees?.depots?.aujourdhui) >= 1,
    `aujourd’hui : ${stats.donnees?.depots?.aujourdhui}`
  );

  // ── 10. Nettoyage ───────────────────────────────────────────────────────────
  titre('10. Nettoyage des données de test');
  if (GARDER) {
    console.log('  ℹ Données conservées (option --garder) :');
    console.log(`     posteur : ${posteur.telephone} / ${motDePasse}`);
    console.log(`     ouvrier : ${ouvrier.telephone} / ${motDePasse}`);
  } else {
    const idsDepots = aNettoyer.depots.filter(Boolean);
    const idsJobs = aNettoyer.jobs.filter(Boolean);
    const idsUtilisateurs = aNettoyer.utilisateurs.filter(Boolean);
    await Depot.deleteMany({ _id: { $in: idsDepots } });
    await Job.deleteMany({ _id: { $in: idsJobs } });
    await User.deleteMany({ _id: { $in: idsUtilisateurs } });
    const restes = await Promise.all([
      Depot.countDocuments({ _id: { $in: idsDepots } }),
      Job.countDocuments({ _id: { $in: idsJobs } }),
      User.countDocuments({ _id: { $in: idsUtilisateurs } }),
    ]);
    verifier(
      'dépôts, annonces et comptes de test supprimés',
      restes.every((n) => n === 0),
      `restes : ${restes.join(' / ')}`
    );
  }

  // ── Bilan ───────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(64)}`);
  console.log('Journal des requêtes :');
  for (const ligne of journal) {
    console.log(`  ${String(ligne.statut).padStart(4)}  ${ligne.methode.padEnd(6)} ${ligne.chemin}`);
  }
  console.log('─'.repeat(64));
  if (echecs.length === 0) {
    console.log(`✅ Back-office : ${reussis}/${reussis} vérifications réussies.`);
    console.log('   Suivi des utilisateurs et des paiements, suspension réversible — OK.\n');
  } else {
    console.log(`❌ Back-office : ${echecs.length} échec(s) sur ${reussis + echecs.length} vérifications :`);
    for (const echec of echecs) console.log(`   • ${echec}`);
    console.log('');
  }

  await mongoose.disconnect().catch(() => {});
  process.exit(echecs.length === 0 ? 0 : 1);
}

principal();





