// verifier-effacement.js — PREUVE du « droit à l'effacement » (20/11).
//
// Le script interroge le VRAI serveur (src/index.js) et vérifie les DEUX chemins
// de suppression, sur des comptes qu'il CRÉE lui-même et supprime à la fin :
//
//   1. LIBRE-SERVICE — DELETE /api/users/me
//      • refus si le mot de passe est faux, et la session reste valide ;
//      • succès : nom, numéro, photo, métier, bio, favoris vidés ; numéro remplacé
//        par un jeton `supprime_…` (non connectable) et mot de passe remplacé ;
//      • l'ancien jeton ne vaut plus rien (401) et l'ancien numéro ne permet plus
//        de se connecter : la révocation est IMMÉDIATE, sans table de sessions ;
//      • le profil public du compte disparaît (404).
//
//   2. BACK-OFFICE — DELETE /api/admin/utilisateurs/:id
//      • refus sans confirmation, refus si la confirmation ne correspond pas
//        (et le compte reste intact), refus sur son propre compte (409) ;
//      • succès : même anonymisation, réponse qui dit ce qui est conservé ;
//      • second appel : idempotent (`dejaSupprime`), les compteurs ne bougent plus.
//
//   3. CE QUI EST CONSERVÉ (obligations comptables) et ce qui est anonymisé :
//      • dépôt mobile money : ligne et montant gardés, `telephonePayeur` vidé ;
//      • abonnement : gardé ; annonce : gardée mais signée « Utilisateur
//        supprimé », contact effacé et annonce ouverte ANNULÉE ;
//      • avis laissé sur une fiche : commentaire et note gardés, auteur anonymisé ;
//      • fiche créée par la personne : réellement supprimée.
//
//   4. Les listes du back-office : les comptes effacés sortent des listes
//      courantes et ne réapparaissent que dans `filtre=effaces`.
//
// Règle de sécurité : aucune donnée réelle n'est modifiée. Tout est créé par le
// script (comptes 07…, fiche marquée `test: true`, annonce, dépôt, abonnement) et
// supprimé à la fin — `--garder` conserve les lignes pour le débogage.
//
// Lancement (depuis /backend) :
//   npm run verifier:effacement
//   npm run verifier:effacement -- --garder
//
// Le volet back-office utilise l'administrateur de TEST indiqué par les variables
// d'environnement, comme verifier-admin-complement.js :
//   $env:ADMIN_IDENTIFIANT='0700000001'; $env:ADMIN_MOT_DE_PASSE='Test-Audit-2026-x9'
// S'il n'existe pas dans la base, le script crée un administrateur TEMPORAIRE
// (`test: true`, mot de passe aléatoire) et le supprime au nettoyage : la preuve
// ne dépend d'aucun compte d'exploitation et n'en modifie aucun.


import 'dotenv/config';
import { randomBytes, randomInt } from 'node:crypto';

import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Establishment from '../src/models/Establishment.js';
import Job from '../src/models/Job.js';
import Depot from '../src/models/Depot.js';
import Subscription from '../src/models/Subscription.js';
import {
  NOM_COMPTE_SUPPRIME,
  PREFIXE_TELEPHONE_SUPPRIME,
} from '../src/services/suppressionCompte.js';
import { normalizePhone } from '../src/utils/validators.js';

const PORT = Number(process.env.PORT_VERIFICATION_EFFACEMENT) || 4106;
const BASE = `http://127.0.0.1:${PORT}`;
const GARDER = process.argv.includes('--garder');
const ADMIN_IDENTIFIANT = process.env.ADMIN_IDENTIFIANT || '0700000001';
const ADMIN_MOT_DE_PASSE = process.env.ADMIN_MOT_DE_PASSE || 'Test-Audit-2026-x9';
const MOT_DE_PASSE = 'Effacement-Test-2026-x9';

let reussis = 0;
const echecs = [];
const constats = [];
const aNettoyer = {
  utilisateurs: [],
  etablissements: [],
  jobs: [],
  depots: [],
  abonnements: [],
};

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
  return { statut: reponse.status, donnees };
}

/** Attend que le serveur réponde ET que la base soit connectée. */
async function attendreServeur(maxMs = 40000) {
  const limite = Date.now() + maxMs;
  while (Date.now() < limite) {
    try {
      const reponse = await fetch(`${BASE}/api/health`);
      const donnees = await reponse.json().catch(() => null);
      if (reponse.status === 200 && donnees?.baseDonnees === 'connectée') return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((resoudre) => setTimeout(resoudre, 500));
  }
  return false;
}

/** Supprime TOUT ce que le script a créé (jamais autre chose : nos _id uniquement). */
async function nettoyer() {
  const bilan = {
    utilisateurs: aNettoyer.utilisateurs.length,
    etablissements: aNettoyer.etablissements.length,
    jobs: aNettoyer.jobs.length,
    depots: aNettoyer.depots.length,
    abonnements: aNettoyer.abonnements.length,
  };
  const filtre = (ids) => ({ _id: { $in: ids } });

  if (aNettoyer.depots.length) await Depot.deleteMany(filtre(aNettoyer.depots));
  if (aNettoyer.abonnements.length) await Subscription.deleteMany(filtre(aNettoyer.abonnements));
  if (aNettoyer.jobs.length) await Job.deleteMany(filtre(aNettoyer.jobs));
  if (aNettoyer.etablissements.length) {
    await Establishment.deleteMany(filtre(aNettoyer.etablissements));
  }
  if (aNettoyer.utilisateurs.length) await User.deleteMany(filtre(aNettoyer.utilisateurs));

  aNettoyer.utilisateurs = [];
  aNettoyer.etablissements = [];
  aNettoyer.jobs = [];
  aNettoyer.depots = [];
  aNettoyer.abonnements = [];
  return bilan;
}

/** Arrêt sur incident : on nettoie AVANT de sortir, pour ne rien laisser traîner en base. */
async function arreter(message) {
  console.error(`\n❌ ${message}`);
  const bilan = await nettoyer().catch(() => null);
  if (bilan) {
    console.error(
      `   Nettoyage de secours : ${bilan.utilisateurs} compte(s), ${bilan.etablissements} fiche(s), ` +
        `${bilan.jobs} annonce(s), ${bilan.depots} dépôt(s), ${bilan.abonnements} abonnement(s).\n`
    );
  }
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}

/**
 * Crée un compte de test par l'API, avec un numéro ivoirien VALIDE mais tiré au
 * hasard : `+22507XXXXXXXX`. En cas de collision (un run précédent interrompu),
 * on réessaie — jamais deux fois le même numéro.
 */
async function creerCompte(prenom) {
  for (let essai = 0; essai < 6; essai += 1) {
    const national = `07${String(randomInt(0, 100000000)).padStart(8, '0')}`;
    // Forme CANONIQUE (celle que la base stockera) : le serveur retire les zéros de
    // tête dès la normalisation, comparer avec la saisie brute ferait échouer à tort.
    const telephone = normalizePhone(national) || national;
    const reponse = await appel('POST', '/api/users/register', {
      body: {
        telephone,
        motDePasse: MOT_DE_PASSE,
        nom: 'Test Effacement',
        prenom,
        metier: 'Maçon',
        quartier: 'Cocody',
        commune: 'Abidjan',
        localisation: { lat: 5.3364, lng: -4.0744 },
        estArtisan: true,
        chercheTravail: true,
      },
    });
    if (reponse.statut === 201 || reponse.statut === 200) {
      const id = reponse.donnees?.user?.id;
      if (!id) return null;
      aNettoyer.utilisateurs.push(id);
      return { id, telephone, token: reponse.donnees?.token || null };
    }
    if (reponse.statut !== 409) {
      return { erreur: `${reponse.statut} ${reponse.donnees?.error || ''}`.trim() };
    }
  }
  return { erreur: 'aucun numéro libre après 6 essais' };
}

/** Connexion par numéro ; renvoie le jeton ou null. */
async function connecter(telephone) {
  const reponse = await appel('POST', '/api/users/login', {
    body: { telephone, motDePasse: MOT_DE_PASSE },
  });
  return { statut: reponse.statut, token: reponse.donnees?.token || null, donnees: reponse.donnees };
}

/**
 * Administrateur de TEST temporaire, créé seulement si ADMIN_IDENTIFIANT n'existe
 * pas dans la base. Il est marqué `test: true`, son mot de passe est tiré au hasard
 * à chaque exécution et il est supprimé au nettoyage : la preuve reste complète
 * sans jamais toucher à un compte d'exploitation.
 */
async function creerAdminTemporaire() {
  const motDePasse = randomBytes(24).toString('hex');
  const telephone = normalizePhone(`07${String(randomInt(0, 100000000)).padStart(8, '0')}`);
  const user = new User({
    telephone,
    nom: 'Test Effacement',
    prenom: 'AdminTemporaire',
    motDePasseHash: await User.hashMotDePasse(motDePasse),
    estAdmin: true,
    statutCompte: 'actif',
    test: true,
  });
  await user.save();
  aNettoyer.utilisateurs.push(user._id);
  const connexion = await appel('POST', '/api/admin/login', {
    body: { identifiant: telephone, motDePasse },
  });
  return {
    id: String(user._id),
    telephone,
    token: connexion.donnees?.token || null,
    statut: connexion.statut,
  };
}

/**
 * Crée une fiche « tiers » (jamais possédée par le compte testé) et, pour le
 * compte, un avis sur cette fiche, une annonce, un dépôt mobile money payé et un
 * abonnement. C'est le pire cas réel : la personne a laissé des traces payantes.
 */
async function creerJeuDEssai(compte, etiquette, ficheId = null) {
  const telephoneContact = compte.telephone;
  const commun = { test: true };

  let fiche = ficheId ? await Establishment.findById(ficheId) : null;
  if (!fiche) {
    fiche = await Establishment.create({
      nom: `ZZ-Test fiche ${etiquette}`,
      categorie: 'services',
      description: 'Fiche créée par verifier-effacement.js — supprimée en fin de script.',
      commune: 'Abidjan',
      quartier: 'Cocody',
      telephone: telephoneContact,
      localisation: { lat: 5.3364, lng: -4.0744 },
      tags: ['test', 'effacement', 'audit'],
      estImporte: false,
      createdByUserId: null,
      test: true,
    });
    aNettoyer.etablissements.push(fiche._id);
  }

  const avis = await appel('POST', `/api/establishments/${fiche._id}/reviews`, {
    token: compte.token,
    body: { note: 4, commentaire: `Avis de ${etiquette} — doit rester lisible, sans nom.` },
  });

  // Fiche CRÉÉE par le compte (jamais importée) : elle lui appartient, elle doit
  // donc être réellement supprimée — pas seulement anonymisée.
  const ficheCreee = await Establishment.create({
    nom: `ZZ-Test fiche possédée ${etiquette}`,
    categorie: 'artisanat',
    commune: 'Abidjan',
    quartier: 'Yopougon',
    telephone: telephoneContact,
    localisation: { lat: 5.35, lng: -4.08 },
    tags: ['test', 'effacement', 'audit'],
    estImporte: false,
    createdByUserId: compte.id,
    test: true,
  });
  aNettoyer.etablissements.push(ficheCreee._id);

  const annonce = await Job.create({
    ...commun,
    typeAnnonce: 'demande',
    metier: 'Maçon',
    description: 'Annonce créée par verifier-effacement.js — supprimée en fin de script.',
    commune: 'Abidjan',
    quartier: 'Cocody',
    posteParUserId: compte.id,
    nomPosteur: `${etiquette} NomPosteur`,
    telephoneContact,
    statut: 'ouvert',
  });
  aNettoyer.jobs.push(annonce._id);

  const depot = await Depot.create({
    userId: compte.id,
    jobId: annonce._id,
    montant: 500,
    operateur: 'WAVE',
    telephonePayeur: telephoneContact,
    reference: `TEST-EFFACEMENT-${etiquette}`,
    statut: 'valide',
    valideAt: new Date(),
  });
  aNettoyer.depots.push(depot._id);

  const abonnement = await Subscription.create({
    userId: compte.id,
    statut: 'actif',
    montantFcfa: 2000,
    finAt: new Date(Date.now() + 30 * 86400000),
  });
  aNettoyer.abonnements.push(abonnement._id);

  return { fiche, ficheCreee, avis, annonce, depot, abonnement };
}

/** Relit les lignes du jeu d'essai telles qu'elles sont EN BASE (pas la réponse HTTP). */
async function relire(compte, jeu) {
  const [user, fiche, annonce, depot, abonnement] = await Promise.all([
    User.findById(compte.id).select('+motDePasseHash'),
    Establishment.findById(jeu.fiche._id),
    Job.findById(jeu.annonce._id),
    Depot.findById(jeu.depot._id),
    Subscription.findById(jeu.abonnement._id),
  ]);
  return { user, fiche, annonce, depot, abonnement };
}


async function principal() {
  console.log("\n▶ Droit à l'effacement — vérification de bout en bout (serveur réel + base réelle)");

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI absente : le script a besoin de la base du serveur qu’il démarre.');
    process.exitCode = 2;
    return;
  }

  titre('0. Démarrage du serveur');
  process.env.PORT = String(PORT);
  await import('../src/index.js');
  const pret = await attendreServeur();
  verifier(`le serveur répond sur ${BASE} et la base est connectée`, pret);
  if (!pret) await arreter(`Serveur injoignable sur ${BASE} (port occupé ? variable PORT_VERIFICATION_EFFACEMENT ?)`);
  console.log(`  Base : ${mongoose.connection.name}`);

  titre('1. Comptes et traces de test (tout est créé par le script)');
  const libre = await creerCompte('EffacementLibre');
  const cible = await creerCompte('EffacementAdmin');
  if (libre.erreur || cible.erreur || !libre.token || !cible.token) {
    await arreter(`Création des comptes impossible (${libre.erreur || cible.erreur || 'jeton absent'}).`);
  }
  verifier(`compte libre-service créé et connecté (${libre.telephone})`, Boolean(libre.id && libre.token));
  verifier(`second compte créé et connecté (${cible.telephone})`, Boolean(cible.id && cible.token));

  const jeuLibre = await creerJeuDEssai(libre, 'libre');
  const jeuCible = await creerJeuDEssai(cible, 'admin', String(jeuLibre.fiche._id));
  verifier(
    'avis déposé sur la fiche par les deux comptes (état initial réel)',
    jeuLibre.avis.statut === 201 && jeuCible.avis.statut === 201,
    `statuts ${jeuLibre.avis.statut}/${jeuCible.avis.statut}`
  );

  const avant = await relire(libre, jeuLibre);
  verifier(
    'le compte testé a bien une identité, un dépôt payé et un abonnement',
    Boolean(avant.user?.nom === 'Test Effacement' && avant.depot?.montant === 500 && avant.abonnement)
  );

  titre('2. Libre-service : un mot de passe faux ne supprime RIEN');
  const refus = await appel('DELETE', '/api/users/me', {
    token: libre.token,
    body: { motDePasse: 'Ce-n-est-pas-le-bon-mot-de-passe' },
  });
  verifier('mot de passe faux → 401', refus.statut === 401, `statut ${refus.statut}`);
  const sessionVivante = await appel('GET', '/api/users/me', { token: libre.token });
  verifier(
    'la session reste valide après ce refus (GET /users/me → 200)',
    sessionVivante.statut === 200,
    `statut ${sessionVivante.statut}`
  );
  const intact = await User.findById(libre.id);
  verifier(
    'la base est intacte (nom, numéro d’origine, aucun supprimeAt)',
    intact?.nom === 'Test Effacement' && intact?.telephone === libre.telephone && !intact?.supprimeAt
  );

  titre('3. Libre-service : suppression réelle avec le bon mot de passe');
  const ancienHash = avant.user.motDePasseHash;
  const suppression = await appel('DELETE', '/api/users/me', {
    token: libre.token,
    body: { motDePasse: MOT_DE_PASSE },
  });
  verifier(
    'DELETE /users/me → 200',
    suppression.statut === 200,
    `statut ${suppression.statut} · ${suppression.donnees?.error || ''}`
  );
  verifier(
    'la réponse annonce ce qui est conservé pour la comptabilité',
    /comptabilit/i.test(suppression.donnees?.message || ''),
    suppression.donnees?.message || ''
  );
  verifier(
    'la réponse ne renvoie ni le nom ni le numéro d’origine',
    !JSON.stringify(suppression.donnees || {}).includes('Test Effacement') &&
      !JSON.stringify(suppression.donnees || {}).includes(libre.telephone)
  );

  const apres = await relire(libre, jeuLibre);
  const u = apres.user;
  verifier('le compte existe encore (les paiements restent rattachables)', Boolean(u));
  verifier('le nom est remplacé par « Utilisateur supprimé »', u?.nom === NOM_COMPTE_SUPPRIME, u?.nom);
  verifier(
    'prénom, photo, métier, bio, quartier et commune sont vidés',
    [u?.prenom, u?.photoProfil, u?.metier, u?.bio, u?.quartier, u?.commune].every((v) => !v)
  );
  verifier(
    'le numéro est remplacé par un jeton non connectable',
    Boolean(u?.telephone?.startsWith(PREFIXE_TELEPHONE_SUPPRIME)),
    u?.telephone
  );
  verifier(
    'favoris, visites, interactions et avis personnels sont vidés',
    (u?.favoris || []).length === 0 &&
      (u?.visites || []).length === 0 &&
      (u?.historiqueInteractions || []).length === 0 &&
      (u?.avis || []).length === 0
  );
  verifier('le mot de passe est remplacé (empreinte différente)', Boolean(u?.motDePasseHash) && u.motDePasseHash !== ancienHash);
  verifier('l’ancien mot de passe ne fonctionne plus', u ? !(await u.verifierMotDePasse(MOT_DE_PASSE)) : false);
  verifier('supprimeAt est renseigné (traçabilité de l’effacement)', Boolean(u?.supprimeAt));

  titre('4. Le compte effacé n’a plus aucun accès');
  const avecAncienJeton = await appel('GET', '/api/users/me', { token: libre.token });
  verifier('ancien jeton → 401 (révocation immédiate, sans table de sessions)', avecAncienJeton.statut === 401, `statut ${avecAncienJeton.statut}`);
  const reconnexion = await appel('POST', '/api/users/login', {
    body: { telephone: libre.telephone, motDePasse: MOT_DE_PASSE },
  });
  verifier('ancien numéro + ancien mot de passe → refus', reconnexion.statut === 401, `statut ${reconnexion.statut}`);
  const profilPublic = await appel('GET', `/api/users/${libre.id}`);
  verifier('profil public → 404 (la page du compte disparaît)', profilPublic.statut === 404, `statut ${profilPublic.statut}`);

  titre('5. Ce qui est conservé (comptabilité) et ce qui est anonymisé');
  const fiche = apres.fiche;
  const avisAnonyme = (fiche?.avis || []).find((a) => (a.commentaire || '').includes('Avis de libre'));
  verifier('la fiche notée par la personne existe toujours', Boolean(fiche));
  verifier(
    'son avis reste lisible mais signé « Utilisateur supprimé »',
    avisAnonyme?.auteurNom === NOM_COMPTE_SUPPRIME && avisAnonyme?.note === 4,
    avisAnonyme?.auteurNom
  );
  verifier('l’avis ne pointe plus vers aucun compte', Boolean(avisAnonyme) && !avisAnonyme.auteurId);
  verifier(
    'le dépôt mobile money est conservé (montant + référence intacts)',
    apres.depot?.montant === 500 && apres.depot?.reference === 'TEST-EFFACEMENT-libre'
  );
  verifier('le numéro du payeur est retiré du dépôt', apres.depot?.telephonePayeur === '', apres.depot?.telephonePayeur);
  verifier('l’abonnement payé est conservé', Boolean(apres.abonnement));
  verifier(
    'l’annonce reste visible mais signée « Utilisateur supprimé »',
    apres.annonce?.nomPosteur === NOM_COMPTE_SUPPRIME,
    apres.annonce?.nomPosteur
  );
  verifier(
    'le contact de l’annonce est effacé',
    Boolean(apres.annonce?.telephoneContact?.startsWith(PREFIXE_TELEPHONE_SUPPRIME)),
    apres.annonce?.telephoneContact
  );
  verifier('l’annonce ouverte est annulée (plus de mise en relation possible)', apres.annonce?.statut === 'annule', apres.annonce?.statut);
  const fichePossedee = await Establishment.findById(jeuLibre.ficheCreee._id);
  verifier('la fiche CRÉÉE par la personne est réellement supprimée', fichePossedee === null);

  titre('6. Back-office : les garde-fous avant d’effacer');
  const connexionAdmin = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: ADMIN_MOT_DE_PASSE },
  });
  let jetonAdmin = connexionAdmin.donnees?.token || null;
  let adminId = connexionAdmin.donnees?.user?.id || null;
  if (!jetonAdmin) {
    // Pas d'administrateur d'exploitation disponible : on en crée un POUR CE TEST
    // (jeton aléatoire, `test: true`, supprimé au nettoyage) plutôt que de sauter
    // la moitié de la preuve. Aucun compte réel n'est promu ni modifié.
    console.log(`  (compte ${ADMIN_IDENTIFIANT} absent → administrateur de test temporaire)`);
    const adminTest = await creerAdminTemporaire();
    jetonAdmin = adminTest.token;
    adminId = adminTest.id;
    verifier(
      'administrateur de test temporaire créé et connecté (supprimé en fin de script)',
      Boolean(jetonAdmin),
      `connexion ${adminTest.statut}`
    );
  }
  if (!jetonAdmin) {
    constat('aucun accès back-office : contrôles admin NON exécutés', 'vérifiez ADMIN_IDENTIFIANT / ADMIN_MOT_DE_PASSE');
  } else {
    const sansConfirmation = await appel('DELETE', `/api/admin/utilisateurs/${cible.id}`, {
      token: jetonAdmin,
      body: {},
    });
    verifier('sans confirmation → 400 (rien n’est effacé)', sansConfirmation.statut === 400, `statut ${sansConfirmation.statut}`);

    const mauvaise = await appel('DELETE', `/api/admin/utilisateurs/${cible.id}`, {
      token: jetonAdmin,
      body: { confirmation: 'Je-ne-connais-pas-ce-nom' },
    });
    verifier('confirmation erronée → 400', mauvaise.statut === 400, `statut ${mauvaise.statut}`);
    const toujoursLa = await User.findById(cible.id);
    verifier(
      'après ces refus le compte est intact (nom et numéro d’origine)',
      toujoursLa?.nom === 'Test Effacement' && toujoursLa?.telephone === cible.telephone && !toujoursLa?.supprimeAt
    );

    const jetonSimple = await appel('DELETE', `/api/admin/utilisateurs/${cible.id}`, {
      body: { confirmation: 'Test Effacement' },
    });
    verifier('sans jeton administrateur → 401', jetonSimple.statut === 401, `statut ${jetonSimple.statut}`);

    const inconnu = await appel('DELETE', '/api/admin/utilisateurs/000000000000000000000000', {
      token: jetonAdmin,
      body: { confirmation: 'Test Effacement' },
    });
    verifier('identifiant inconnu → 404', inconnu.statut === 404, `statut ${inconnu.statut}`);

    const soiMeme = await appel('DELETE', `/api/admin/utilisateurs/${adminId}`, {
      token: jetonAdmin,
      body: { confirmation: 'peu importe' },
    });
    verifier('effacer SON PROPRE compte est refusé → 409', soiMeme.statut === 409, `statut ${soiMeme.statut}`);

    titre('7. Back-office : effacement confirmé (par saisie du nom)');
    const nomAttendu = toujoursLa.nomComplet;
    const effacement = await appel('DELETE', `/api/admin/utilisateurs/${cible.id}`, {
      token: jetonAdmin,
      // Casse et espaces ignorés : c'est ce que fait le serveur, l'écran ne fait que
      // refléter la même règle (sinon un bouton actif pourrait être refusé).
      body: { confirmation: `  ${nomAttendu.toLowerCase()}  `, motif: 'Test automatisé (verifier-effacement)' },
    });
    verifier(
      'nom tapé en minuscules, avec des espaces → 200',
      effacement.statut === 200,
      `statut ${effacement.statut} · ${effacement.donnees?.error || ''}`
    );
    verifier(
      'la réponse dit ce qui est conservé et combien',
      /comptabilit/i.test(effacement.donnees?.message || '') &&
        effacement.donnees?.suppression?.depotsConserves === 1 &&
        effacement.donnees?.suppression?.abonnementsConserves === 1,
      JSON.stringify(effacement.donnees?.suppression || {})
    );
    verifier('la réponse ne renvoie aucune identité', effacement.donnees?.user?.nom === NOM_COMPTE_SUPPRIME);
    verifier('le motif d’effacement est tracé dans le rapport', effacement.donnees?.suppression?.motif?.startsWith('Test automatisé'));

    const cibleApres = await relire(cible, jeuCible);
    verifier(
      'le compte est anonymisé (nom et numéro remplacés)',
      cibleApres.user?.nom === NOM_COMPTE_SUPPRIME &&
        Boolean(cibleApres.user?.telephone?.startsWith(PREFIXE_TELEPHONE_SUPPRIME))
    );
    verifier(
      'son dépôt payé reste en base, sans numéro de payeur',
      cibleApres.depot?.montant === 500 && cibleApres.depot?.telephonePayeur === ''
    );
    verifier('son abonnement reste en base', Boolean(cibleApres.abonnement));
    verifier('sa fiche possédée est supprimée', (await Establishment.findById(jeuCible.ficheCreee._id)) === null);
    const avisCible = (cibleApres.fiche?.avis || []).find((a) => (a.commentaire || '').includes('Avis de admin'));
    verifier(
      'son avis sur la fiche tierce est anonymisé, le texte reste',
      avisCible?.auteurNom === NOM_COMPTE_SUPPRIME && !avisCible?.auteurId
    );
    const reconnexionCible = await appel('POST', '/api/users/login', {
      body: { telephone: cible.telephone, motDePasse: MOT_DE_PASSE },
    });
    verifier('il ne peut plus se connecter', reconnexionCible.statut === 401, `statut ${reconnexionCible.statut}`);

    const deuxieme = await appel('DELETE', `/api/admin/utilisateurs/${cible.id}`, {
      token: jetonAdmin,
      body: { confirmation: nomAttendu },
    });
    verifier(
      'second clic → idempotent (`dejaSupprime`, rien n’est retraité)',
      deuxieme.statut === 200 && deuxieme.donnees?.dejaSupprime === true,
      `statut ${deuxieme.statut}`
    );

    titre('8. Listes du back-office : les effacés sortent des listes courantes');
    const effaces = await appel('GET', '/api/admin/utilisateurs?filtre=effaces&limit=100', { token: jetonAdmin });
    const lignesEffacees = effaces.donnees?.items || [];
    const idsEffaces = lignesEffacees.map((l) => String(l.id ?? l._id));
    verifier(
      'les deux comptes effacés figurent dans l’onglet « Effacés »',
      idsEffaces.includes(String(libre.id)) && idsEffaces.includes(String(cible.id)),
      `statut ${effaces.statut} · ${idsEffaces.length} ligne(s)`
    );
    verifier(
      'chaque ligne y porte l’état « supprimé »',
      lignesEffacees.filter((l) => l.supprime).length >= 2
    );
    verifier(
      'le compteur global `effaces` est alimenté (tuile du tableau de bord)',
      (effaces.donnees?.compteurs?.effaces || 0) >= 2,
      String(effaces.donnees?.compteurs?.effaces)
    );
    const courante = await appel('GET', '/api/admin/utilisateurs?limit=100', { token: jetonAdmin });
    const idsCourants = (courante.donnees?.items || []).map((l) => String(l.id ?? l._id));
    verifier(
      'la liste par défaut ne les affiche plus',
      !idsCourants.includes(String(libre.id)) && !idsCourants.includes(String(cible.id)),
      `${idsCourants.length} ligne(s)`
    );
    const recherche = await appel(
      'GET',
      `/api/admin/utilisateurs?q=${encodeURIComponent(libre.telephone)}&limit=100`,
      { token: jetonAdmin }
    );
    verifier(
      'les chercher par leur ancien numéro ne les ressuscite pas',
      !(recherche.donnees?.items || []).some((l) => String(l.id ?? l._id) === String(libre.id)),
      `statut ${recherche.statut}`
    );
  }

  titre('9. Nettoyage des données de test');
  const idsCrees = {
    utilisateurs: [...aNettoyer.utilisateurs],
    etablissements: [...aNettoyer.etablissements],
    jobs: [...aNettoyer.jobs],
    depots: [...aNettoyer.depots],
    abonnements: [...aNettoyer.abonnements],
  };
  if (GARDER) {
    constat(
      '--garder : les lignes de test restent en base',
      `comptes à supprimer à la main : ${idsCrees.utilisateurs.join(', ') || '—'}`
    );
  } else {
    const bilan = await nettoyer();
    const restes = await Promise.all([
      User.countDocuments({ _id: { $in: idsCrees.utilisateurs } }),
      Establishment.countDocuments({ _id: { $in: idsCrees.etablissements } }),
      Job.countDocuments({ _id: { $in: idsCrees.jobs } }),
      Depot.countDocuments({ _id: { $in: idsCrees.depots } }),
      Subscription.countDocuments({ _id: { $in: idsCrees.abonnements } }),
    ]);
    verifier(
      'aucune ligne de test ne subsiste en base (comptes, fiches, annonces, dépôts, abonnements)',
      restes.every((n) => n === 0),
      `restes ${restes.join('/')} — créés ${bilan.utilisateurs}/${bilan.etablissements}/${bilan.jobs}/${bilan.depots}/${bilan.abonnements}`
    );
  }

  titre('Bilan de la preuve');
  console.log(`  ${reussis} contrôle(s) réussi(s), ${echecs.length} échec(s), ${constats.length} point(s) à arbitrer.`);
  if (echecs.length) {
    console.log('\n  ÉCHECS :');
    for (const e of echecs) console.log(`   ✗ ${e}`);
  }
  if (constats.length) {
    console.log('\n  À ARBITRER :');
    for (const c of constats) console.log(`   ⚠ ${c}`);
  }
  console.log(
    echecs.length === 0
      ? "\n✅ Droit à l'effacement : les données personnelles disparaissent, les traces comptables restent, l'accès est coupé immédiatement.\n"
      : "\n❌ Au moins un contrôle a échoué : voir la liste ci-dessus.\n"
  );

  await mongoose.disconnect().catch(() => {});
  process.exit(echecs.length ? 1 : 0);
}

principal().catch(async (erreur) => {
  await arreter(`Erreur inattendue : ${erreur?.stack || erreur}`);
});
