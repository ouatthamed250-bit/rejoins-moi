// verifier-admin-complement.js — Complément du contrôle de bout en bout du BACK-OFFICE.
//
// Pourquoi un second script ? verifier-admin.js couvre le suivi (recherche, filtres,
// fiche, journal d'activité) et la suspension/réactivation d'un compte. Restaient les
// gestes qui touchent à des données SENSIBLES, donc volontairement laissés de côté
// jusqu'ici :
//   1. changer le mot de passe de l'ADMINISTRATEUR (PATCH /moi/mot-de-passe) ;
//   2. réinitialiser le mot de passe d'un UTILISATEUR ;
//   3. VALIDER un dépôt mobile money — le geste qui révèle réellement le contact ;
//   4. REJETER un dépôt (et vérifier qu'un dépôt validé ne peut plus être rejeté) ;
//   5. les accès refusés (401 / 403 / 404 / 409) sur ces mêmes routes.
//
// Règle de sécurité de cette campagne : AUCUNE donnée réelle n'est modifiée. Le script
// ne travaille que sur des lignes QU'IL A CRÉÉES (comptes, annonces, dépôts) et les
// supprime à la fin. Il vérifie explicitement que la production est intacte :
//   • empreinte du mot de passe du VRAI administrateur (doit être identique) ;
//   • date de sa dernière connexion (aucune connexion de sa part n'est provoquée) ;
//   • statut du dépôt historique en attente et de son annonce.
//
// Lancement (depuis /backend) :
//   npm run verifier:admin-complement              -> crée puis nettoie les données de test
//   npm run verifier:admin-complement -- --garder  -> conserve les lignes créées
//
// Prérequis : un administrateur de TEST dédié (jamais le compte réel) :
//   $env:ADMIN_IDENTIFIANT='0700000001'
//   $env:ADMIN_MOT_DE_PASSE='Test-Audit-2026-x9'
//   npm run admin:creer
// Les identifiants sont lus dans ADMIN_IDENTIFIANT / ADMIN_MOT_DE_PASSE. Si la
// connexion échoue, le script s'arrête net : il ne retombe JAMAIS sur le compte réel.

import 'dotenv/config';
import { randomInt } from 'node:crypto';

import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Job from '../src/models/Job.js';
import Depot from '../src/models/Depot.js';

const PORT = Number(process.env.PORT_VERIFICATION_ADMIN_COMPLEMENT) || 4104;
const BASE = `http://127.0.0.1:${PORT}`;
const GARDER = process.argv.includes('--garder');
const ADMIN_IDENTIFIANT = process.env.ADMIN_IDENTIFIANT || '0700000001';
const ADMIN_MOT_DE_PASSE = process.env.ADMIN_MOT_DE_PASSE || 'Test-Audit-2026-x9';

// Le vrai administrateur et le dépôt en attente du 01/10 : à ne JAMAIS modifier.
// On les relit avant/après pour prouver noir sur blanc qu'ils sont intacts.
const ADMIN_REEL = '+225102030405';
const DEPOT_HISTORIQUE = '6abeed6aa9261ac1101cdba7';

let reussis = 0;
const echecs = [];
const constats = [];
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

/** Observation : ni réussite ni échec — un manque mesuré, à arbitrer par l'équipe. */
function constat(libelle, detail = '') {
  constats.push(libelle);
  console.log(`  ⚠ À ARBITRER : ${libelle}${detail ? ` — ${detail}` : ''}`);
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

/** Crée un compte de test par l'API (numéros 07 00 00 00 xx : inexistants en production). */
async function creerCompte(suffixe, motDePasse) {
  const telephone = `+2250700000${suffixe}`;
  const reponse = await appel('POST', '/api/users/register', {
    body: {
      telephone,
      motDePasse,
      nom: 'Test',
      prenom: `Complement${suffixe.slice(-2)}`,
      metier: 'Maçon',
      quartier: 'Cocody',
      commune: 'Abidjan',
      localisation: { lat: 5.3364, lng: -4.0744 },
      estArtisan: true,
      chercheTravail: true,
    },
  });
  return { statut: reponse.statut, donnees: reponse.donnees, telephone, motDePasse };
}

/** Relève l'état de la production : tout doit être identique en fin de script. */
async function instantaneProduction() {
  const [utilisateurs, jobs, depots] = await Promise.all([
    User.countDocuments({}),
    Job.countDocuments({}),
    Depot.countDocuments({}),
  ]);
  const adminReel = await User.findOne({ telephone: ADMIN_REEL }).select('+motDePasseHash');
  const depotHistorique = await Depot.findById(DEPOT_HISTORIQUE).catch(() => null);
  const annonceHistorique = depotHistorique ? await Job.findById(depotHistorique.jobId) : null;
  return {
    utilisateurs,
    jobs,
    depots,
    adminHash: adminReel?.motDePasseHash || null,
    adminDerniereConnexion: adminReel?.dernierLoginAt ? String(adminReel.dernierLoginAt) : null,
    depotStatut: depotHistorique?.statut || 'absent',
    depotContactsDebloques: (annonceHistorique?.contactDebloquePar || []).length,
  };
}

/** Supprime TOUT ce que le script a créé (jamais autre chose : on ne travaille que sur nos _id). */
async function nettoyer() {
  const depots = aNettoyer.depots.filter(Boolean);
  const jobs = aNettoyer.jobs.filter(Boolean);
  const utilisateurs = aNettoyer.utilisateurs.filter(Boolean);
  if (depots.length) await Depot.deleteMany({ _id: { $in: depots } });
  if (jobs.length) await Job.deleteMany({ _id: { $in: jobs } });
  if (utilisateurs.length) await User.deleteMany({ _id: { $in: utilisateurs } });
  return { depots: depots.length, jobs: jobs.length, utilisateurs: utilisateurs.length };
}

/** Arrêt sur incident : on nettoie AVANT de sortir, pour ne rien laisser traîner en base. */
async function arreter(message) {
  console.error(`\n❌ ${message}`);
  const bilan = await nettoyer().catch(() => ({ depots: 0, jobs: 0, utilisateurs: 0 }));
  console.error(
    `   Nettoyage de secours : ${bilan.depots} dépôt(s), ${bilan.jobs} annonce(s), ${bilan.utilisateurs} compte(s) supprimé(s).\n`
  );
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}

async function principal() {
  console.log('\n▶ Vérification COMPLÉMENTAIRE du back-office (mots de passe, validation de dépôts)');

  const uri = process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('\n❌ MONGODB_URI est absent.');
    console.error('   Copiez backend/.env.example en backend/.env, puis collez l’URI du cluster.\n');
    process.exitCode = 2;
    return;
  }
  console.log(`  URI  : ${uri.replace(/\/\/([^:@/]+)(:[^@/]*)?@/, '//$1:****@')}`);
  console.log(`  Base : ${process.env.MONGODB_DB_NAME || 'rejoins-moi'}`);
  console.log(`  Admin de test : ${ADMIN_IDENTIFIANT} — le compte réel ${ADMIN_REEL} n’est JAMAIS utilisé.`);

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

  // ── 1. Photo de la production, AVANT toute écriture ─────────────────────────
  titre('1. Photo de la production (doit être identique à la fin)');
  const avant = await instantaneProduction();
  verifier('le compte du VRAI administrateur est retrouvé', Boolean(avant.adminHash));
  verifier('le dépôt historique est retrouvé', avant.depotStatut !== 'absent', `statut ${avant.depotStatut}`);
  console.log(`  comptes : ${avant.utilisateurs} · annonces : ${avant.jobs} · dépôts : ${avant.depots}`);
  console.log(
    `  dépôt ${DEPOT_HISTORIQUE} : ${avant.depotStatut} · contacts débloqués sur son annonce : ${avant.depotContactsDebloques}`
  );

  // ── 2. Connexion de l'administrateur de TEST ────────────────────────────────
  titre('2. Connexion de l’administrateur de TEST (jamais le compte réel)');
  const connexion = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: ADMIN_MOT_DE_PASSE },
  });
  verifier(
    `connexion « ${ADMIN_IDENTIFIANT} » → 200`,
    connexion.statut === 200 && Boolean(connexion.donnees?.token),
    `statut ${connexion.statut} · ${connexion.donnees?.error || ''}`
  );
  if (connexion.statut !== 200 || !connexion.donnees?.token) {
    console.error('\n❌ Créez d’abord l’administrateur de TEST (jamais le compte réel) :');
    console.error(
      `   $env:ADMIN_IDENTIFIANT='${ADMIN_IDENTIFIANT}'; $env:ADMIN_MOT_DE_PASSE='${ADMIN_MOT_DE_PASSE}'; npm run admin:creer\n`
    );
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
  let jetonAdmin = connexion.donnees.token;
  const idAdmin = connexion.donnees.user?.id;
  verifier('la réponse marque bien un administrateur (admin: true)', connexion.donnees.admin === true);
  verifier('le compte connecté n’est PAS le compte réel', connexion.donnees.user?.telephone !== ADMIN_REEL);
  verifier(
    'le mot de passe n’est jamais renvoyé',
    !JSON.stringify(connexion.donnees).includes('motDePasseHash')
  );

  const motDePasseFaux = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: 'Ce-nest-pas-le-bon-mdp' },
  });
  verifier('un mot de passe faux est refusé (401)', motDePasseFaux.statut === 401, `statut ${motDePasseFaux.statut}`);

  // ── 3. Changement du mot de passe ADMINISTRATEUR ─────────────────────────────
  titre('3. Changement du mot de passe administrateur (PATCH /moi/mot-de-passe)');
  const motDePasseBis = `${ADMIN_MOT_DE_PASSE}-bis`;
  const ancienFaux = await appel('PATCH', '/api/admin/moi/mot-de-passe', {
    token: jetonAdmin,
    body: { ancienMotDePasse: 'faux-ancien-mot-de-passe', nouveauMotDePasse: motDePasseBis },
  });
  verifier('un ancien mot de passe incorrect est refusé (401)', ancienFaux.statut === 401, `statut ${ancienFaux.statut}`);

  const tropCourtAdmin = await appel('PATCH', '/api/admin/moi/mot-de-passe', {
    token: jetonAdmin,
    body: { ancienMotDePasse: ADMIN_MOT_DE_PASSE, nouveauMotDePasse: 'abc' },
  });
  verifier('un nouveau mot de passe trop court est refusé (400)', tropCourtAdmin.statut === 400, `statut ${tropCourtAdmin.statut}`);

  const jetonAvantChangement = jetonAdmin;
  const changement = await appel('PATCH', '/api/admin/moi/mot-de-passe', {
    token: jetonAdmin,
    body: { ancienMotDePasse: ADMIN_MOT_DE_PASSE, nouveauMotDePasse: motDePasseBis },
  });
  verifier(
    'le changement est accepté (200)',
    changement.statut === 200 && changement.donnees?.ok === true,
    `statut ${changement.statut}`
  );

  const connexionAncien = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: ADMIN_MOT_DE_PASSE },
  });
  verifier('l’ANCIEN mot de passe ne fonctionne plus (401)', connexionAncien.statut === 401, `statut ${connexionAncien.statut}`);
  const connexionNouveau = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: motDePasseBis },
  });
  verifier(
    'le NOUVEAU mot de passe fonctionne (200)',
    connexionNouveau.statut === 200 && Boolean(connexionNouveau.donnees?.token),
    `statut ${connexionNouveau.statut}`
  );
  jetonAdmin = connexionNouveau.donnees?.token || jetonAdmin;

  // Le point sensible à mesurer : changer le mot de passe ne coupe PAS les jetons
  // déjà émis (contrairement à la SUSPENSION d'un compte, qui les refuse tous).
  const jetonAvantEncoreValide = await appel('GET', '/api/admin/moi', { token: jetonAvantChangement });
  if (jetonAvantEncoreValide.statut === 200) {
    constat(
      'un jeton admin émis AVANT le changement de mot de passe reste accepté',
      'changer son mot de passe ne ferme pas les sessions ouvertes ailleurs (contrairement à la suspension d’un compte)'
    );
  } else {
    verifier('un jeton admin émis AVANT le changement est refusé', jetonAvantEncoreValide.statut === 401);
  }

  // Remise en place : on rend au compte de test son mot de passe d'origine pour que
  // le script reste réutilisable (et pour ne pas laisser une surprise à l'équipe).
  const remise = await appel('PATCH', '/api/admin/moi/mot-de-passe', {
    token: jetonAdmin,
    body: { ancienMotDePasse: motDePasseBis, nouveauMotDePasse: ADMIN_MOT_DE_PASSE },
  });
  verifier('mot de passe du compte de test remis en place (200)', remise.statut === 200, `statut ${remise.statut}`);
  const reconnexion = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: ADMIN_MOT_DE_PASSE },
  });
  verifier(
    'reconnexion avec le mot de passe d’origine (200)',
    reconnexion.statut === 200 && Boolean(reconnexion.donnees?.token),
    `statut ${reconnexion.statut}`
  );
  jetonAdmin = reconnexion.donnees?.token || jetonAdmin;

  // ── 4. Réinitialisation du mot de passe d'un UTILISATEUR ─────────────────────
  titre('4. Réinitialisation du mot de passe d’un utilisateur');
  const motDePasseOrigine = 'Verif-complement-origine';
  const compteCible = await creerCompte(String(randomInt(10, 99)), motDePasseOrigine);
  verifier('le compte cible est créé (201)', compteCible.statut === 201, `statut ${compteCible.statut}`);
  if (compteCible.statut !== 201) await arreter('Impossible de créer le compte de test : arrêt.');
  const idCible = compteCible.donnees?.user?.id;
  aNettoyer.utilisateurs.push(idCible);

  const motDePasseReinit = 'Reinit-complement-2026';
  const reinit = await appel('POST', `/api/admin/utilisateurs/${idCible}/mot-de-passe`, {
    token: jetonAdmin,
    body: { motDePasse: motDePasseReinit },
  });
  verifier('réinitialisation acceptée (200)', reinit.statut === 200 && reinit.donnees?.ok === true, `statut ${reinit.statut}`);
  verifier(
    'la réponse ne divulgue ni le mot de passe ni son empreinte',
    !JSON.stringify(reinit.donnees || {}).includes(motDePasseReinit) &&
      !JSON.stringify(reinit.donnees || {}).includes('Hash')
  );

  const ancienUtilisateurRefuse = await appel('POST', '/api/users/login', {
    body: { telephone: compteCible.telephone, motDePasse: motDePasseOrigine },
  });
  verifier(
    'l’ancien mot de passe de l’utilisateur ne marche plus (401)',
    ancienUtilisateurRefuse.statut === 401,
    `statut ${ancienUtilisateurRefuse.statut}`
  );
  const utilisateurReconnecte = await appel('POST', '/api/users/login', {
    body: { telephone: compteCible.telephone, motDePasse: motDePasseReinit },
  });
  verifier(
    'le nouveau mot de passe ouvre la session (200)',
    utilisateurReconnecte.statut === 200 && Boolean(utilisateurReconnecte.donnees?.token),
    `statut ${utilisateurReconnecte.statut}`
  );
  const jetonUtilisateur = utilisateurReconnecte.donnees?.token;

  const reinitTropCourt = await appel('POST', `/api/admin/utilisateurs/${idCible}/mot-de-passe`, {
    token: jetonAdmin,
    body: { motDePasse: '123' },
  });
  verifier('mot de passe trop court refusé (400)', reinitTropCourt.statut === 400, `statut ${reinitTropCourt.statut}`);
  const reinitCompteInconnu = await appel('POST', '/api/admin/utilisateurs/000000000000000000000000/mot-de-passe', {
    token: jetonAdmin,
    body: { motDePasse: 'Nimporte-quoi-1' },
  });
  verifier('compte inconnu → 404', reinitCompteInconnu.statut === 404, `statut ${reinitCompteInconnu.statut}`);

  // ── 5. VALIDATION d'un dépôt : le contact est-il vraiment révélé ? ───────────
  titre('5. Validation d’un dépôt mobile money (le geste qui révèle le contact)');
  const posteur = await creerCompte(String(randomInt(10, 99)), 'Verif-complement-posteur');
  const ouvrier = await creerCompte(String(randomInt(10, 99)), 'Verif-complement-ouvrier');
  verifier('le compte du posteur est créé (201)', posteur.statut === 201, `statut ${posteur.statut}`);
  verifier('le compte de l’ouvrier est créé (201)', ouvrier.statut === 201, `statut ${ouvrier.statut}`);
  if (posteur.statut !== 201 || ouvrier.statut !== 201) {
    await arreter('Impossible de créer les comptes de test : arrêt.');
  }
  aNettoyer.utilisateurs.push(posteur.donnees?.user?.id, ouvrier.donnees?.user?.id);

  const creationBesoin = await appel('POST', '/api/jobs', {
    token: posteur.donnees?.token,
    body: {
      typeAnnonce: 'demande',
      metier: 'Maçon',
      intitule: 'Mur de clôture — contrôle du back-office',
      description: 'Besoin créé par le contrôle automatique du back-office (données de test).',
      localisation: { lat: 5.3364, lng: -4.0744 },
      commune: 'Abidjan',
      quartier: 'Cocody',
      telephoneContact: posteur.telephone,
      budgetFcfa: 20000,
      segment: 'specialise',
    },
  });
  verifier('le posteur publie un besoin (201)', creationBesoin.statut === 201, `statut ${creationBesoin.statut}`);
  const besoin = creationBesoin.donnees?.job;
  if (besoin?.id) aNettoyer.jobs.push(besoin.id);

  const reference = `REF-COMPL-${Date.now()}`;
  const declaration = await appel('POST', `/api/jobs/${besoin?.id}/demande-deblocage`, {
    token: ouvrier.donnees?.token,
    body: { operateur: 'WAVE', telephonePayeur: ouvrier.telephone, reference },
  });
  verifier('l’ouvrier déclare son dépôt Wave (202)', declaration.statut === 202, `statut ${declaration.statut}`);
  const idDepot = declaration.donnees?.depot?.id;
  if (idDepot) aNettoyer.depots.push(idDepot);
  verifier('le dépôt est en attente (aucun déblocage automatique)', declaration.donnees?.statut === 'en_attente');

  const avantValidation = await appel('GET', `/api/jobs/${besoin?.id}/demande-deblocage`, {
    token: ouvrier.donnees?.token,
  });
  verifier(
    'avant validation, le contact reste masqué côté utilisateur',
    avantValidation.donnees?.debloque === false && avantValidation.donnees?.telephoneContact === null,
    JSON.stringify(avantValidation.donnees?.telephoneContact)
  );

  const fileAttente = await appel('GET', '/api/admin/depots?statut=en_attente', { token: jetonAdmin });
  verifier(
    'le dépôt apparaît dans la file « à valider »',
    (fileAttente.donnees?.items || []).some((d) => d.id === idDepot),
    `total en attente : ${fileAttente.donnees?.total}`
  );
  const ligneDepot = (fileAttente.donnees?.items || []).find((d) => d.id === idDepot);
  verifier(
    'la ligne porte l’utilisateur ET l’annonce (jointures)',
    Boolean(ligneDepot?.utilisateur?.telephone) && Boolean(ligneDepot?.job?.titre),
    JSON.stringify({ utilisateur: ligneDepot?.utilisateur, job: ligneDepot?.job })
  );

  const validation = await appel('POST', `/api/admin/depots/${idDepot}/valider`, {
    token: jetonAdmin,
    body: { noteAdmin: 'Contrôle du back-office — données de test' },
  });
  verifier(
    'la validation est acceptée (200)',
    validation.statut === 200,
    `statut ${validation.statut} · ${validation.donnees?.error || ''}`
  );
  verifier('le dépôt passe en « validé »', validation.donnees?.depot?.statut === 'valide');
  const depotEnBase = await Depot.findById(idDepot);
  verifier(
    'l’administrateur qui valide est enregistré en base (valideParUserId)',
    String(depotEnBase?.valideParUserId) === String(idAdmin),
    String(depotEnBase?.valideParUserId)
  );
  verifier('la date de validation est enregistrée en base', Boolean(depotEnBase?.valideAt));
  // La trace « qui a validé » est bien écrite en base, mais Depot.toJSON() (méthode de
  // sérialisation du modèle) ne l'expose pas : le back-office ne peut donc PAS afficher
  // le nom du validateur, ni pour une validation ni pour un rejet. Manque de traçabilité.
  if (validation.donnees?.depot?.valideParUserId === undefined) {
    constat(
      'l’API des dépôts n’expose pas valideParUserId (omis par Depot.toJSON())',
      'la trace existe en base mais reste invisible dans le back-office : impossible de savoir qui a validé ou rejeté un dépôt'
    );
  } else {
    verifier(
      'l’API expose l’administrateur qui a validé',
      String(validation.donnees?.depot?.valideParUserId) === String(idAdmin)
    );
  }
  verifier(
    'le contact renvoyé à l’administrateur est bien celui de l’annonce',
    validation.donnees?.telephoneContact === posteur.telephone,
    `${validation.donnees?.telephoneContact} vs ${posteur.telephone}`
  );
  if (besoin?.telephoneContact === null) {
    constat(
      'la réponse de création d’annonce masque le contact, même au posteur (Job.toJSONFor)',
      'comportement voulu par le modèle (contact révélé après paiement) — à confirmer côté interface du posteur'
    );
  }

  // Preuve en base : ce n'est pas seulement un statut affiché, le contact est débloqué.
  const annonceEnBase = await Job.findById(besoin?.id);
  const deblocages = annonceEnBase?.contactDebloquePar || [];
  verifier('le contact est réellement débloqué sur l’annonce (1 destinataire)', deblocages.length === 1, `contacts : ${deblocages.length}`);
  verifier(
    'le déblocage est marqué « via dépôt » et accepté',
    deblocages[0]?.viaDepot === true && deblocages[0]?.statutPaiement === 'ACCEPTED',
    JSON.stringify({ viaDepot: deblocages[0]?.viaDepot, statutPaiement: deblocages[0]?.statutPaiement })
  );
  verifier(
    'le montant débloqué correspond au dépôt déclaré',
    Number(deblocages[0]?.montant) === Number(declaration.donnees?.montant),
    `${deblocages[0]?.montant} vs ${declaration.donnees?.montant}`
  );

  // Effet FINAL, côté utilisateur : c'est la raison d'être du back-office.
  const apresValidation = await appel('GET', `/api/jobs/${besoin?.id}/demande-deblocage`, {
    token: ouvrier.donnees?.token,
  });
  verifier(
    'l’ouvrier voit enfin le contact après validation',
    apresValidation.donnees?.debloque === true && apresValidation.donnees?.telephoneContact === posteur.telephone,
    `debloque=${apresValidation.donnees?.debloque}`
  );

  const revalidation = await appel('POST', `/api/admin/depots/${idDepot}/valider`, { token: jetonAdmin, body: {} });
  verifier(
    'revalider ne crée pas de doublon (message « déjà validé »)',
    revalidation.statut === 200 && /déjà validé/i.test(revalidation.donnees?.message || ''),
    revalidation.donnees?.message
  );
  const annonceApresRevalidation = await Job.findById(besoin?.id);
  verifier(
    'le contact n’est débloqué qu’UNE fois après revalidation',
    (annonceApresRevalidation?.contactDebloquePar || []).length === 1
  );

  // Irréversibilité : un dépôt validé (donc un contact révélé) ne peut pas être annulé.
  const rejetApresValidation = await appel('POST', `/api/admin/depots/${idDepot}/rejeter`, {
    token: jetonAdmin,
    body: { noteAdmin: 'test d’irréversibilité' },
  });
  verifier(
    'un dépôt VALIDÉ ne peut plus être rejeté (409)',
    rejetApresValidation.statut === 409,
    `statut ${rejetApresValidation.statut}`
  );

  // ── 6. REJET d'un dépôt (le motif doit rester visible) ───────────────────────
  titre('6. Rejet d’un dépôt mobile money (motif conservé, décision irréversible)');
  const creationBesoin2 = await appel('POST', '/api/jobs', {
    token: posteur.donnees?.token,
    body: {
      typeAnnonce: 'demande',
      metier: 'Maçon',
      intitule: 'Dalle de terrasse — contrôle du back-office',
      description: 'Second besoin créé par le contrôle automatique du back-office (données de test).',
      localisation: { lat: 5.3364, lng: -4.0744 },
      commune: 'Abidjan',
      quartier: 'Cocody',
      telephoneContact: posteur.telephone,
      budgetFcfa: 25000,
      segment: 'specialise',
    },
  });
  verifier('le second besoin est publié (201)', creationBesoin2.statut === 201, `statut ${creationBesoin2.statut}`);
  const besoin2 = creationBesoin2.donnees?.job;
  if (besoin2?.id) aNettoyer.jobs.push(besoin2.id);

  const declaration2 = await appel('POST', `/api/jobs/${besoin2?.id}/demande-deblocage`, {
    token: ouvrier.donnees?.token,
    body: { operateur: 'ORANGE_MONEY', telephonePayeur: ouvrier.telephone, reference: `REF-REJET-${Date.now()}` },
  });
  verifier('l’ouvrier déclare un dépôt Orange Money (202)', declaration2.statut === 202, `statut ${declaration2.statut}`);
  const idDepot2 = declaration2.donnees?.depot?.id;
  if (idDepot2) aNettoyer.depots.push(idDepot2);

  const motif = 'Transaction introuvable chez l’opérateur (contrôle du back-office)';
  const rejet = await appel('POST', `/api/admin/depots/${idDepot2}/rejeter`, {
    token: jetonAdmin,
    body: { noteAdmin: motif },
  });
  verifier('le rejet est accepté (200)', rejet.statut === 200, `statut ${rejet.statut} · ${rejet.donnees?.error || ''}`);
  verifier('le dépôt passe en « rejeté »', rejet.donnees?.depot?.statut === 'rejete');
  verifier(
    'le motif saisi est conservé (noteAdmin)',
    String(rejet.donnees?.depot?.noteAdmin || '').includes('introuvable'),
    rejet.donnees?.depot?.noteAdmin
  );
  verifier('la date de traitement est enregistrée', Boolean(rejet.donnees?.depot?.valideAt));

  const ouvrierApresRejet = await appel('GET', `/api/jobs/${besoin2?.id}/demande-deblocage`, {
    token: ouvrier.donnees?.token,
  });
  verifier(
    'le rejet est visible côté utilisateur (contact toujours masqué)',
    ouvrierApresRejet.donnees?.debloque === false &&
      ouvrierApresRejet.donnees?.depot?.statut === 'rejete' &&
      ouvrierApresRejet.donnees?.telephoneContact === null,
    JSON.stringify({ statut: ouvrierApresRejet.donnees?.depot?.statut, debloque: ouvrierApresRejet.donnees?.debloque })
  );

  const validerRejete = await appel('POST', `/api/admin/depots/${idDepot2}/valider`, { token: jetonAdmin, body: {} });
  verifier('un dépôt REJETÉ ne peut plus être validé (409)', validerRejete.statut === 409, `statut ${validerRejete.statut}`);
  const annonce2 = await Job.findById(besoin2?.id);
  verifier('aucun contact n’a été débloqué par un dépôt rejeté', (annonce2?.contactDebloquePar || []).length === 0);

  const fileRejetes = await appel('GET', '/api/admin/depots?statut=rejete', { token: jetonAdmin });
  verifier(
    'le dépôt rejeté apparaît dans le filtre « rejetés »',
    (fileRejetes.donnees?.items || []).some((d) => d.id === idDepot2),
    `total rejetés : ${fileRejetes.donnees?.compteurs?.rejetes}`
  );

  const depotInconnu = await appel('POST', '/api/admin/depots/000000000000000000000000/valider', {
    token: jetonAdmin,
    body: {},
  });
  verifier('dépôt inconnu → 404 (aucune erreur 500)', depotInconnu.statut === 404, `statut ${depotInconnu.statut}`);

  // ── 7. Le back-office reste fermé à qui n'est pas administrateur ─────────────
  titre('7. Accès : le back-office reste fermé aux comptes ordinaires');
  const sansJeton = await appel('GET', '/api/admin/depots');
  verifier('sans jeton → 401', sansJeton.statut === 401, `statut ${sansJeton.statut}`);

  const avecJetonUtilisateur = await appel('GET', '/api/admin/depots', { token: jetonUtilisateur });
  verifier('avec un jeton UTILISATEUR → 403', avecJetonUtilisateur.statut === 403, `statut ${avecJetonUtilisateur.statut}`);

  const reinitParUtilisateur = await appel('POST', `/api/admin/utilisateurs/${idCible}/mot-de-passe`, {
    token: jetonUtilisateur,
    body: { motDePasse: 'Pirate-2026' },
  });
  verifier(
    'un utilisateur ne peut pas réinitialiser un mot de passe (403)',
    reinitParUtilisateur.statut === 403,
    `statut ${reinitParUtilisateur.statut}`
  );
  const validationParUtilisateur = await appel('POST', `/api/admin/depots/${idDepot2}/valider`, {
    token: jetonUtilisateur,
    body: {},
  });
  verifier(
    'un utilisateur ne peut pas valider un dépôt (403)',
    validationParUtilisateur.statut === 403,
    `statut ${validationParUtilisateur.statut}`
  );

  // Un compte ORDINAIRE ne doit pas pouvoir ouvrir le back-office, même avec ses vrais
  // identifiants : /api/admin/login ne cherche que parmi les comptes administrateurs.
  const connexionUtilisateurOrdinaire = await appel('POST', '/api/admin/login', {
    body: { identifiant: compteCible.telephone, motDePasse: motDePasseReinit },
  });
  verifier(
    'un compte ordinaire ne peut pas se connecter au back-office (401)',
    connexionUtilisateurOrdinaire.statut === 401,
    `statut ${connexionUtilisateurOrdinaire.statut}`
  );
  verifier(
    'le mot de passe réel de l’utilisateur n’a pas été altéré par cette tentative',
    (await appel('POST', '/api/users/login', {
      body: { telephone: compteCible.telephone, motDePasse: motDePasseReinit },
    })).statut === 200
  );

  // ── 8. Non-intrusion : la production doit être intacte ──────────────────────
  titre('8. Vérification de non-intrusion sur les données réelles');
  const apres = await instantaneProduction();
  verifier(
    'le mot de passe du VRAI administrateur est inchangé',
    Boolean(avant.adminHash) && apres.adminHash === avant.adminHash
  );
  verifier(
    'sa dernière connexion est inchangée (aucune connexion de sa part)',
    apres.adminDerniereConnexion === avant.adminDerniereConnexion,
    `${apres.adminDerniereConnexion} vs ${avant.adminDerniereConnexion}`
  );
  verifier(
    'le dépôt historique est dans le même état qu’au départ',
    apres.depotStatut === avant.depotStatut,
    `${apres.depotStatut} vs ${avant.depotStatut}`
  );
  verifier(
    'aucun contact n’a été débloqué sur l’annonce historique',
    apres.depotContactsDebloques === avant.depotContactsDebloques,
    `${apres.depotContactsDebloques} vs ${avant.depotContactsDebloques}`
  );

  // ── 9. Nettoyage des données de test ────────────────────────────────────────
  titre('9. Nettoyage des données de test');
  if (GARDER) {
    console.log('  ℹ Données conservées (option --garder) :');
    console.log(`     posteur : ${posteur.telephone} · ouvrier : ${ouvrier.telephone}`);
    console.log(`     annonces : ${[besoin?.id, besoin2?.id].filter(Boolean).join(', ')}`);
  } else {
    const bilan = await nettoyer();
    console.log(`  ${bilan.depots} dépôt(s), ${bilan.jobs} annonce(s), ${bilan.utilisateurs} compte(s) supprimé(s).`);
    const restes = await Promise.all([
      Depot.countDocuments({ _id: { $in: aNettoyer.depots.filter(Boolean) } }),
      Job.countDocuments({ _id: { $in: aNettoyer.jobs.filter(Boolean) } }),
      User.countDocuments({ _id: { $in: aNettoyer.utilisateurs.filter(Boolean) } }),
    ]);
    verifier('dépôts, annonces et comptes de test supprimés', restes.every((n) => n === 0), `restes : ${restes.join(' / ')}`);

    const fin = await instantaneProduction();
    verifier(
      'les compteurs de la base sont revenus à l’état initial',
      fin.utilisateurs === avant.utilisateurs && fin.jobs === avant.jobs && fin.depots === avant.depots,
      `comptes ${fin.utilisateurs}/${avant.utilisateurs} · annonces ${fin.jobs}/${avant.jobs} · dépôts ${fin.depots}/${avant.depots}`
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
    console.log(`✅ Complément back-office : ${reussis}/${reussis} vérifications réussies.`);
  } else {
    console.log(`❌ Complément back-office : ${echecs.length} échec(s) sur ${reussis + echecs.length} vérifications :`);
    for (const echec of echecs) console.log(`   • ${echec}`);
  }
  if (constats.length) {
    console.log(`\n⚠ ${constats.length} point(s) à arbitrer (mesuré, pas bloquant) :`);
    for (const point of constats) console.log(`   • ${point}`);
  }
  console.log(`\n⚠ L’administrateur de TEST « ${ADMIN_IDENTIFIANT} » existe toujours. À supprimer ensuite :`);
  console.log(`   npm run admin:supprimer -- --cible=${ADMIN_IDENTIFIANT} --oui\n`);

  await mongoose.disconnect().catch(() => {});
  process.exit(echecs.length === 0 ? 0 : 1);
}

principal();
