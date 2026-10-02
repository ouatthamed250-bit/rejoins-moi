// verifier-depot.js — Vérification de BOUT EN BOUT du PAIEMENT MANUEL par dépôt
// mobile money (le mode de secours utilisé tant que CinetPay n'est pas branché).
//
// Répond à la question la plus sensible du produit : « quand un utilisateur déclare
// avoir envoyé les 500 FCFA, le contact est-il débloqué AU BON MOMENT — ni avant, ni
// jamais ? »
//
// Scénario complet, avec MongoDB :
//   1. le VRAI serveur démarre sur un port dédié ;
//   2. deux comptes de test sont créés par l'API (un posteur, un ouvrier) ;
//   3. l'ouvrier déclare un dépôt Wave sur le besoin : statut « en_attente »,
//      et SURTOUT le contact reste masqué (aucun faux succès) ;
//   4. l'admin se connecte, retrouve le dépôt dans /api/admin/depots ;
//   5. l'admin VALIDE : le contact devient visible pour l'ouvrier ;
//   6. la validation est IDEMPOTENTE (un double clic ne casse rien) ;
//   7. un second besoin + un rejet : le contact reste masqué, le motif est lisible ;
//   8. back-office comptes : recherche, fiche, modification, mot de passe ;
//   9. un jeton NON admin ne peut PAS ouvrir /api/admin/* (403) ;
//  10. nettoyage des lignes créées (sauf --garder).
//
// Lancement (depuis /backend) :
//   npm run verifier:depot                 -> crée puis nettoie les données de test
//   npm run verifier:depot -- --garder     -> conserve les lignes créées
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

const PORT = Number(process.env.PORT_VERIFICATION_DEPOT) || 4102;
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

/** Crée un compte de test par l'API et renvoie le téléphone, le mot de passe et la réponse. */
async function creerCompte(suffixe, motDePasse) {
  const telephone = `+2250702${suffixe}`;
  const reponse = await appel('POST', '/api/users/register', {
    body: {
      telephone,
      motDePasse,
      nom: 'Verif',
      prenom: `Depot${suffixe.slice(-3)}`,
      metier: 'Maçon',
      quartier: 'Angré 8e tranche',
      commune: 'Cocody',
      localisation: { lat: 5.4045, lng: -3.9765 },
      estArtisan: true,
      chercheTravail: true,
    },
  });
  return { statut: reponse.statut, donnees: reponse.donnees, telephone, motDePasse };
}

async function principal() {
  console.log('\n▶ Vérification du paiement manuel par dépôt (back-office inclus)');

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

  const sante = await appel('GET', '/api/health');
  verifier(
    'MongoDB est connecté (baseDonnees = « connectée »)',
    sante.donnees?.baseDonnees === 'connectée',
    `vu : ${sante.donnees?.baseDonnees}`
  );
  if (sante.donnees?.baseDonnees !== 'connectée') {
    console.error('\n❌ Sans base de données, la vérification est impossible : arrêt.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }

  // ── 1. Les numéros de dépôt sont bien publiés par l'API ────────────────────
  titre('1. Numéros de dépôt exposés (Wave / Orange / MTN)');
  const metiers = await appel('GET', '/api/jobs/metiers');
  verifier('GET /api/jobs/metiers → 200', metiers.statut === 200, `statut ${metiers.statut}`);
  const canaux = (metiers.donnees?.depots || []).map((d) => d.canal);
  verifier(
    'les trois opérateurs de dépôt sont configurés',
    canaux.length >= 3 && canaux.includes('WAVE'),
    `vu : ${canaux.join(', ') || 'aucun'}`
  );
  verifier(
    'le support WhatsApp est joignable (secours)',
    Boolean(metiers.donnees?.support?.numero),
    `support : ${metiers.donnees?.support?.numero || 'absent'}`
  );

  // ── 2. Deux comptes de test : le posteur et l'ouvrier ─────────────────────
  titre('2. Comptes de test (posteur + ouvrier)');
  const motDePasse = 'MotDePasseTest2026';
  const posteur = await creerCompte(String(randomInt(100000, 999999)), motDePasse);
  const ouvrier = await creerCompte(String(randomInt(100000, 999999)), motDePasse);
  verifier('le compte du posteur est créé (201)', posteur.statut === 201, `statut ${posteur.statut}`);
  verifier('le compte de l’ouvrier est créé (201)', ouvrier.statut === 201, `statut ${ouvrier.statut}`);
  if (posteur.statut !== 201 || ouvrier.statut !== 201) {
    console.error('\n❌ Impossible de créer les comptes de test : arrêt.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
  const jetonPosteur = posteur.donnees?.token;
  const jetonOuvrier = ouvrier.donnees?.token;
  const idPosteur = posteur.donnees?.user?.id;
  const idOuvrier = ouvrier.donnees?.user?.id;
  aNettoyer.utilisateurs.push(idPosteur, idOuvrier);

  // ── 3. Le posteur publie un besoin ────────────────────────────────────────
  titre('3. Publication d’un besoin (le contact doit rester masqué)');
  const creation = await appel('POST', '/api/jobs', {
    token: jetonPosteur,
    body: {
      typeAnnonce: 'demande',
      metier: 'Maçon',
      intitule: 'Réparation d’un mur de clôture',
      description: 'Mur de 6 mètres à refaire, prévoir ciment et sable.',
      localisation: { lat: 5.4045, lng: -3.9765 },
      commune: 'Cocody',
      quartier: 'Angré 7e tranche',
      telephoneContact: posteur.telephone,
      budgetFcfa: 25000,
      segment: 'specialise',
    },
  });
  verifier('POST /api/jobs → 201', creation.statut === 201, `statut ${creation.statut}`);
  const besoin = creation.donnees?.job;
  if (!besoin?.id) {
    console.error('\n❌ Le besoin n’a pas pu être créé : arrêt.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
  aNettoyer.jobs.push(besoin.id);
  verifier('le contact reste masqué dans la réponse', !besoin.telephoneContact);


  // ── 4. L'ouvrier DÉCLARE son dépôt : rien ne doit se débloquer ─────────────
  titre('4. Déclaration d’un dépôt Wave (aucun déblocage automatique)');
  const declaration = await appel('POST', `/api/jobs/${besoin.id}/demande-deblocage`, {
    token: jetonOuvrier,
    body: { operateur: 'WAVE', telephonePayeur: ouvrier.telephone, reference: 'REF-VERIF-1' },
  });
  verifier('la déclaration est acceptée (202)', declaration.statut === 202, `statut ${declaration.statut}`);
  verifier(
    'le statut renvoyé est « en_attente »',
    declaration.donnees?.statut === 'en_attente',
    `vu : ${declaration.donnees?.statut}`
  );
  const idDepot = declaration.donnees?.depot?.id;
  if (idDepot) aNettoyer.depots.push(idDepot);
  verifier('le dépôt est enregistré en base', Boolean(idDepot));

  const etatAvant = await appel('GET', `/api/jobs/${besoin.id}/demande-deblocage`, { token: jetonOuvrier });
  verifier(
    '⚠ le contact reste MASQUÉ tant que l’admin n’a pas validé',
    etatAvant.donnees?.debloque === false && !etatAvant.donnees?.telephoneContact,
    `debloque : ${etatAvant.donnees?.debloque}, contact : ${etatAvant.donnees?.telephoneContact}`
  );
  verifier(
    'le numéro de dépôt est rappelé à l’utilisateur',
    (etatAvant.donnees?.depots || []).some((d) => d.canal === 'WAVE'),
    `depots : ${(etatAvant.donnees?.depots || []).map((d) => d.canal).join(', ')}`
  );

  // Une déclaration avec un opérateur inconnu est refusée.
  const canalBidon = await appel('POST', `/api/jobs/${besoin.id}/demande-deblocage`, {
    token: jetonOuvrier,
    body: { operateur: 'PAYPAL' },
  });
  verifier('un opérateur inconnu est refusé (400)', canalBidon.statut === 400, `statut ${canalBidon.statut}`);

  // ── 5. Back-office : connexion admin + file des dépôts ────────────────────
  titre('5. Back-office — file des dépôts');
  const connexion = await appel('POST', '/api/admin/login', {
    body: { identifiant: ADMIN_IDENTIFIANT, motDePasse: ADMIN_MOT_DE_PASSE },
  });
  verifier(
    `connexion admin « ${ADMIN_IDENTIFIANT} » → 200`,
    connexion.statut === 200,
    `statut ${connexion.statut} — créez le compte avec « npm run admin:creer »`
  );
  const jetonAdmin = connexion.donnees?.token;
  if (!jetonAdmin) {
    console.error('\n❌ Sans jeton admin, la suite ne peut pas être vérifiée : arrêt.\n');
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
  verifier('le jeton est accompagné du profil admin (user.estAdmin)', connexion.donnees?.user?.estAdmin === true);

  // Le compte est stocké avec le numéro NORMALISÉ (« +225102030405 ») mais l'admin
  // le tape en local (« 0102030405 ») : les deux formes doivent ouvrir le back-office.
  const chiffresAdmin = ADMIN_IDENTIFIANT.replace(/\D/g, '');
  if (chiffresAdmin.length >= 8) {
    const international = `+225${ADMIN_IDENTIFIANT.replace(/^\+?225/, '').replace(/^0+/, '')}`;
    const variante = await appel('POST', '/api/admin/login', {
      body: { identifiant: international, motDePasse: ADMIN_MOT_DE_PASSE },
    });
    verifier(
      `connexion admin « ${international} » (forme internationale) → 200`,
      variante.statut === 200,
      `statut ${variante.statut}`
    );
  }

  const moi = await appel('GET', '/api/admin/moi', { token: jetonAdmin });
  verifier('GET /api/admin/moi → 200', moi.statut === 200, `statut ${moi.statut}`);

  const file = await appel('GET', '/api/admin/depots?statut=en_attente', { token: jetonAdmin });
  verifier('GET /api/admin/depots?statut=en_attente → 200', file.statut === 200, `statut ${file.statut}`);
  const ligneDepot = (file.donnees?.items || []).find((d) => String(d.id) === String(idDepot));
  verifier('le dépôt de test apparaît dans la file', Boolean(ligneDepot));
  verifier(
    'la ligne porte le payeur et l’annonce concernée',
    Boolean(ligneDepot?.utilisateur?.telephone) && Boolean(ligneDepot?.job?.titre),
    `utilisateur : ${ligneDepot?.utilisateur?.telephone || '?'} / annonce : ${ligneDepot?.job?.titre || '?'}`
  );
  verifier(
    'les compteurs de la file sont renvoyés',
    typeof file.donnees?.compteurs?.enAttente === 'number' && file.donnees.compteurs.enAttente >= 1,
    `compteurs : ${JSON.stringify(file.donnees?.compteurs)}`
  );

  // ── 6. Validation : c'est CE geste qui révèle le contact ──────────────────
  titre('6. Validation du dépôt par l’admin');
  const validation = await appel('POST', `/api/admin/depots/${idDepot}/valider`, { token: jetonAdmin, body: {} });
  verifier('POST /api/admin/depots/:id/valider → 200', validation.statut === 200, `statut ${validation.statut}`);
  verifier('le dépôt passe au statut « valide »', validation.donnees?.depot?.statut === 'valide');
  verifier(
    'le numéro de contact est renvoyé à l’admin',
    validation.donnees?.telephoneContact === posteur.telephone,
    `vu : ${validation.donnees?.telephoneContact}`
  );

  const etatApres = await appel('GET', `/api/jobs/${besoin.id}/demande-deblocage`, { token: jetonOuvrier });
  verifier(
    '✅ l’ouvrier voit enfin le contact',
    etatApres.donnees?.debloque === true && etatApres.donnees?.telephoneContact === posteur.telephone,
    `debloque : ${etatApres.donnees?.debloque}, contact : ${etatApres.donnees?.telephoneContact}`
  );
  verifier(
    'le dépôt validé est visible côté utilisateur',
    etatApres.donnees?.depot?.statut === 'valide',
    `statut dépôt : ${etatApres.donnees?.depot?.statut}`
  );

  const secondeValidation = await appel('POST', `/api/admin/depots/${idDepot}/valider`, {
    token: jetonAdmin,
    body: {},
  });
  verifier(
    'une double validation ne casse rien (idempotence)',
    secondeValidation.statut === 200 && secondeValidation.donnees?.depot?.statut === 'valide',
    `statut ${secondeValidation.statut}`
  );


  // ── 7. Rejet : le contact doit rester masqué, le motif est lisible ────────
  titre('7. Rejet d’un dépôt (le contact reste masqué)');
  const creation2 = await appel('POST', '/api/jobs', {
    token: jetonPosteur,
    body: {
      typeAnnonce: 'demande',
      metier: 'Plombier',
      description: 'Fuite sous l’évier de la cuisine, intervention rapide souhaitée.',
      localisation: { lat: 5.4045, lng: -3.9765 },
      commune: 'Cocody',
      telephoneContact: posteur.telephone,
      segment: 'specialise',
    },
  });
  const besoin2 = creation2.donnees?.job;
  aNettoyer.jobs.push(besoin2?.id);
  verifier('le second besoin est créé (201)', creation2.statut === 201, `statut ${creation2.statut}`);

  const declaration2 = await appel('POST', `/api/jobs/${besoin2?.id}/demande-deblocage`, {
    token: jetonOuvrier,
    body: { operateur: 'ORANGE_MONEY' },
  });
  const idDepot2 = declaration2.donnees?.depot?.id;
  aNettoyer.depots.push(idDepot2);
  verifier('le second dépôt est déclaré (202)', declaration2.statut === 202, `statut ${declaration2.statut}`);

  const rejet = await appel('POST', `/api/admin/depots/${idDepot2}/rejeter`, {
    token: jetonAdmin,
    body: { noteAdmin: 'Montant non reçu sur le numéro Orange Money.' },
  });
  verifier('POST /api/admin/depots/:id/rejeter → 200', rejet.statut === 200, `statut ${rejet.statut}`);
  verifier('le dépôt passe au statut « rejete »', rejet.donnees?.depot?.statut === 'rejete');

  const etatRejete = await appel('GET', `/api/jobs/${besoin2.id}/demande-deblocage`, { token: jetonOuvrier });
  verifier(
    '⚠ un dépôt rejeté ne débloque RIEN',
    etatRejete.donnees?.debloque === false && !etatRejete.donnees?.telephoneContact
  );
  verifier(
    'l’utilisateur lit le motif du rejet',
    etatRejete.donnees?.depot?.statut === 'rejete' && Boolean(etatRejete.donnees?.depot?.noteAdmin),
    `note : ${etatRejete.donnees?.depot?.noteAdmin || 'aucune'}`
  );

  // ── 8. Back-office : comptes inscrits ─────────────────────────────────────
  titre('8. Back-office — gestion des comptes');
  const recherche = await appel('GET', `/api/admin/utilisateurs?q=${encodeURIComponent(ouvrier.telephone)}`, {
    token: jetonAdmin,
  });
  verifier('GET /api/admin/utilisateurs (recherche) → 200', recherche.statut === 200, `statut ${recherche.statut}`);
  verifier(
    'la recherche par numéro retrouve le compte de test',
    (recherche.donnees?.items || []).some((u) => String(u.id) === String(idOuvrier)),
    `${recherche.donnees?.items?.length ?? 0} résultat(s)`
  );

  const fiche = await appel('GET', `/api/admin/utilisateurs/${idOuvrier}`, { token: jetonAdmin });
  verifier('GET /api/admin/utilisateurs/:id → 200', fiche.statut === 200, `statut ${fiche.statut}`);
  verifier('la fiche expose l’historique de dépôts', Array.isArray(fiche.donnees?.depots));

  const modification = await appel('PATCH', `/api/admin/utilisateurs/${idOuvrier}`, {
    token: jetonAdmin,
    body: { metier: 'Plombier', quartier: 'Angré 7e tranche' },
  });
  verifier('PATCH /api/admin/utilisateurs/:id → 200', modification.statut === 200, `statut ${modification.statut}`);
  verifier(
    'la correction du profil est bien appliquée',
    modification.donnees?.user?.metier === 'Plombier',
    `vu : ${modification.donnees?.user?.metier}`
  );

  const nouveauMotDePasse = 'MotDePasseReinitialise2026';
  const reinit = await appel('POST', `/api/admin/utilisateurs/${idOuvrier}/mot-de-passe`, {
    token: jetonAdmin,
    body: { motDePasse: nouveauMotDePasse },
  });
  verifier('réinitialisation du mot de passe → 200', reinit.statut === 200, `statut ${reinit.statut}`);

  const reconnexion = await appel('POST', '/api/users/login', {
    body: { telephone: ouvrier.telephone, motDePasse: nouveauMotDePasse },
  });
  verifier(
    'l’utilisateur peut se connecter avec son nouveau mot de passe',
    reconnexion.statut === 200 && Boolean(reconnexion.donnees?.token),
    `statut ${reconnexion.statut}`
  );


  const stats = await appel('GET', '/api/admin/statistiques', { token: jetonAdmin });
  verifier('GET /api/admin/statistiques → 200', stats.statut === 200, `statut ${stats.statut}`);
  verifier(
    'les compteurs de dépôts sont cohérents (validés ≥ 1, rejetés ≥ 1)',
    Number(stats.donnees?.depots?.valides) >= 1 && Number(stats.donnees?.depots?.rejetes) >= 1,
    `dépôts : ${JSON.stringify(stats.donnees?.depots)}`
  );
  verifier(
    'les numéros de dépôt et le support sont publiés dans le back-office',
    (stats.donnees?.depotsConfig || []).length >= 3 && Boolean(stats.donnees?.support?.numero)
  );

  // ── 9. Sécurité : un compte normal ne rentre pas dans le back-office ─────
  titre('9. Sécurité du back-office');
  const intrusion = await appel('GET', '/api/admin/statistiques', { token: jetonOuvrier });
  verifier('un jeton NON admin est refusé (403)', intrusion.statut === 403, `statut ${intrusion.statut}`);
  const sansJeton = await appel('GET', '/api/admin/depots');
  verifier('sans jeton, la file des dépôts est refusée (401)', sansJeton.statut === 401, `statut ${sansJeton.statut}`);
  const depotParUtilisateur = await appel('POST', `/api/admin/depots/${idDepot}/valider`, {
    token: jetonOuvrier,
    body: {},
  });
  verifier(
    'un utilisateur ne peut PAS valider son propre dépôt',
    depotParUtilisateur.statut === 403,
    `statut ${depotParUtilisateur.statut}`
  );

  // ── 10. Nettoyage ─────────────────────────────────────────────────────────
  titre('10. Nettoyage des données de test');
  if (GARDER) {
    console.log('  ℹ Données conservées (option --garder) :');
    console.log(`     posteur : ${posteur.telephone} / ${motDePasse}`);
    console.log(`     ouvrier : ${ouvrier.telephone} / ${nouveauMotDePasse}`);
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

  // ── Bilan ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(64)}`);
  console.log('Journal des requêtes :');
  for (const ligne of journal) {
    console.log(`  ${String(ligne.statut).padStart(4)}  ${ligne.methode.padEnd(6)} ${ligne.chemin}`);
  }
  console.log('─'.repeat(64));
  if (echecs.length === 0) {
    console.log(`✅ Dépôt manuel : ${reussis}/${reussis} vérifications réussies.`);
    console.log('   Le contact n’est révélé QUE par la validation admin — jamais avant, jamais après un rejet.\n');
  } else {
    console.log(`❌ Dépôt manuel : ${echecs.length} échec(s) sur ${reussis + echecs.length} vérifications :`);
    for (const echec of echecs) console.log(`   • ${echec}`);
    console.log('');
  }

  await mongoose.disconnect().catch(() => {});
  process.exit(echecs.length === 0 ? 0 : 1);
}

principal();

