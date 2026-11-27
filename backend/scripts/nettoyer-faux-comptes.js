// nettoyer-faux-comptes.js — Retire de l'annuaire public les comptes fabriqués par
// nos recettes (« Chat ChatBeta… », « Chat ChatAlpha… », « TestCompteur… »).
//
// Usage :
//   node scripts/nettoyer-faux-comptes.js             -> mode DRY-RUN (aucune écriture)
//   node scripts/nettoyer-faux-comptes.js --apply     -> pose réellement test: true
//
// POURQUOI CE SCRIPT
// Les tests d'inscription/abonnement ont créé des comptes artisans fictifs. Ils étaient
// visibles dans « Artisans mis en avant » (accueil) et dans l'annuaire, avec un métier
// et un quartier inventés : sur un annuaire réel, c'est inacceptable.
//
// CE QU'IL FAIT — ET CE QU'IL NE FAIT PAS
//   • Il ne SUPPRIME rien. Il pose `test: true`, drapeau déjà respecté par
//     GET /api/users/artisans (filtre `test: { $ne: true }`) : ces comptes disparaissent
//     des listes publiques et restent consultables dans l'espace d'administration.
//   • Il cible uniquement les comptes dont le NOM ou le PRÉNOM commence par « Chat » ou
//     « TestCompteur » (insensible à la casse). Aucun autre critère automatique : un
//     compte réel n'est jamais marqué « par ressemblance ».
//   • Il indique, pour chaque compte, les données qui lui sont rattachées (fiches,
//     annonces, abonnements) — pour information : un compte marqué `test` n'est pas
//     effacé, ses données restent intactes.
//
// REJOUABLE : relancer le script ne change rien aux comptes déjà marqués.
//
// PRÉCÉDENT ASSUMÉ : scripts/migrer-categories.js et scripts/marquer-tests.js écrivent
// eux aussi en `--apply` sans garde-fou de production, car l'opération est ADDITIVE et
// réversible (un booléen), à la différence d'un effacement ou d'un remplacement.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, getMongoDbName } from '../src/config/db.js';
import User from '../src/models/User.js';
import Establishment from '../src/models/Establishment.js';
import Job from '../src/models/Job.js';
import Subscription from '../src/models/Subscription.js';

const APPLY = process.argv.includes('--apply');

// Motifs des faux comptes. `^` : le nom COMMENCE par le motif (pas « contient »),
// pour ne jamais attraper un vrai patronyme au milieu d'une chaîne.
const MOTIFS = [/^chat/i, /^testcompteur/i];

const debutCorrespond = (valeur = '') => MOTIFS.some((motif) => motif.test(String(valeur).trim()));

async function connect() {
  const ok = await connectDB({ reessais: false, silencieux: true });
  if (!ok) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exit(1);
  }
  console.log(`Base : ${getMongoDbName()} | hôte : ${mongoose.connection.host}`);
  console.log(APPLY ? 'MODE APPLY (écriture réelle)' : 'MODE DRY-RUN (aucune écriture)');
  console.log('');
}

/** Comptes candidats : nom ou prénom commençant par un motif. */
async function trouverCandidats() {
  // Filtre large côté serveur (préfixes), puis vérification exacte en JS : on ne se fie
  // pas à une expression régulière Mongo pour une décision qui touche des comptes.
  const docs = await User.find({
    $or: [
      { nom: /^chat/i },
      { prenom: /^chat/i },
      { nom: /^testcompteur/i },
      { prenom: /^testcompteur/i },
    ],
  })
    .select('nom prenom telephone email estArtisan test role createdAt supprimeAt')
    .sort({ createdAt: 1 });

  return docs.filter((u) => debutCorrespond(u.nom) || debutCorrespond(u.prenom));
}

/** Données rattachées : informatif, rien n'est supprimé. */
async function donneesLiees(userId) {
  const [fiches, annonces, abonnements] = await Promise.all([
    Establishment.countDocuments({ createdByUserId: userId }),
    Job.countDocuments({ posteParUserId: userId }),
    Subscription.countDocuments({ userId }),
  ]);
  return { fiches, annonces, abonnements };
}

function afficher(compte, donnees) {
  const nomComplet = [compte.prenom, compte.nom].filter(Boolean).join(' ') || '(sans nom)';
  const tel = compte.telephone ? `+${String(compte.telephone).replace(/^\+/, '')}` : '(sans téléphone)';
  const cree = compte.createdAt ? new Date(compte.createdAt).toISOString().slice(0, 10) : '—';
  const etat = compte.test ? 'déjà test:true' : 'À MARQUER';
  console.log(`  - ${nomComplet} | ${tel} | ${compte.email || '(sans e-mail)'} | créé le ${cree} | ${etat}`);
  console.log(
    `    données liées : ${donnees.fiches} fiche(s), ${donnees.annonces} annonce(s), ${donnees.abonnements} abonnement(s)` +
      (compte.supprimeAt ? ' | compte déjà anonymisé' : '')
  );
}

async function main() {
  await connect();

  const candidats = await trouverCandidats();

  console.log(`Comptes visés : ${candidats.length}`);
  if (candidats.length === 0) {
    console.log('Aucun compte à nettoyer : l’annuaire ne contient plus de faux compte de test.');
    await mongoose.disconnect().catch(() => {});
    return;
  }

  const avecDonnees = [];
  for (const compte of candidats) {
    const donnees = await donneesLiees(compte._id);
    avecDonnees.push({ compte, donnees });
    afficher(compte, donnees);
  }

  const aMarquer = avecDonnees.filter(({ compte }) => !compte.test);
  console.log('');
  console.log(`Déjà marqués : ${candidats.length - aMarquer.length} | à marquer : ${aMarquer.length}`);

  const avecRattachement = aMarquer.filter(
    ({ donnees }) => donnees.fiches + donnees.annonces + donnees.abonnements > 0
  );
  if (avecRattachement.length > 0) {
    console.log(
      `Note : ${avecRattachement.length} compte(s) à marquer ont des données rattachées — elles sont CONSERVÉES, rien n’est effacé.`
    );
  }

  if (!APPLY) {
    console.log('');
    console.log(
      'DRY-RUN terminé : AUCUNE écriture. Relancer avec --apply pour marquer ces comptes test: true.'
    );
    await mongoose.disconnect().catch(() => {});
    return;
  }

  if (aMarquer.length > 0) {
    // updateMany : écriture du seul drapeau, sans rejouer les hooks de sauvegarde du
    // modèle (mot de passe, index de recherche…). Opération additive et réversible.
    const res = await User.updateMany(
      { _id: { $in: aMarquer.map(({ compte }) => compte._id) } },
      { $set: { test: true } }
    );
    console.log('');
    console.log(`OK : ${res.modifiedCount} compte(s) marqué(s) test: true.`);
  }

  // Contrôle final : plus aucun compte visé ne doit rester visible dans l'annuaire.
  const restants = await User.countDocuments({
    estArtisan: true,
    test: { $ne: true },
    supprimeAt: null,
    $or: [
      { nom: /^chat/i },
      { prenom: /^chat/i },
      { nom: /^testcompteur/i },
      { prenom: /^testcompteur/i },
    ],
  });
  console.log(
    `Contrôle : ${restants} faux compte(s) encore visible(s) dans GET /api/users/artisans (attendu : 0).`
  );
  if (restants > 0) process.exitCode = 1;

  await mongoose.disconnect().catch(() => {});
}

main().catch(async (err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
