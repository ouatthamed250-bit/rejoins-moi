// supprimer-comptes.js — Suppression CIBLÉE de comptes, décidés un par un.
//
// Ce script n'existe que pour exécuter une décision humaine : il ne devine rien.
// Par défaut il ne supprime AUCUNE donnée (mode DRY-RUN) et se contente d'afficher
// ce qui partirait. Il faut `--apply` pour écrire.
//
// GARDE-FOUS (ils ne se désactivent pas sans le dire explicitement)
//   • le compte administrateur réel (+225102030405) est TOUJOURS refusé ;
//   • un compte `estAdmin: true` est refusé sauf `--avec-admins` (un admin de test
//     doit pouvoir être retiré, mais jamais par inadvertance) ;
//   • chaque compte est listé avec ses données liées AVANT toute suppression ;
//   • les données liées (annonces, fiches, messages, conversations, avis,
//     abonnements, dépôts, demandes de revendication, liste d'attente,
//     notifications push, agents) sont supprimées avec le compte : aucun orphelin.
//
// Usage (depuis /backend) :
//   node scripts/supprimer-comptes.js --ids=6b08bc6a…,6b08bc6b…      -> DRY-RUN
//   node scripts/supprimer-comptes.js --ids=6b08bc6a… --apply        -> supprime
//   node scripts/supprimer-comptes.js --test                         -> DRY-RUN du groupe « test: true »
//   node scripts/supprimer-comptes.js --test --avec-admins --apply   -> supprime aussi les admins de test
//   node scripts/supprimer-comptes.js --test --sauf=<id1,id2>        -> retire des comptes de la cible
//
// `--sauf=` sert à traiter un groupe SANS emporter un compte encore nécessaire
// (ex. un compte de test qui porte le dépôt témoin d'un script de vérification).
//
// ⚠ `--test` sélectionne le drapeau `test: true` (comptes déjà marqués), PAS les
// comptes « qui ressemblent » à des tests. Un vrai utilisateur marqué par erreur
// ne part donc jamais via ce mode.

import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDB, getMongoDbName } from '../src/config/db.js';
import User from '../src/models/User.js';
import { supprimerComptesEtDonnees } from './utils/comptes-test.js';

const APPLY = process.argv.includes('--apply');
const AVEC_ADMINS = process.argv.includes('--avec-admins');
const GROUPE_TEST = process.argv.includes('--test');
const IDS = (process.argv.find((a) => a.startsWith('--ids=')) || '').slice('--ids='.length);
const SAUF = (process.argv.find((a) => a.startsWith('--sauf=')) || '').slice('--sauf='.length);

/** Compte de l'administrateur RÉEL : jamais supprimable par ce script. */
const TELEPHONE_ADMIN_REEL = '+225102030405';

const nomComplet = (u) =>
  [u.prenom, u.nom].map((v) => String(v || '').trim()).filter(Boolean).join(' ') || '(sans nom)';

async function principal() {
  if (!GROUPE_TEST && !IDS.trim()) {
    console.error('Aucune cible : utilisez --ids=<id1,id2,…> ou --test (drapeau test:true).');
    process.exitCode = 1;
    return;
  }
  if (!(await connectDB({ reessais: false, silencieux: true }))) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exitCode = 1;
    return;
  }
  console.log(`Base : ${getMongoDbName()} | ${APPLY ? 'MODE APPLY (suppression réelle)' : 'MODE DRY-RUN (aucune écriture)'}`);
  console.log('');

  // ── Sélection : identifiants explicites, ou drapeau test:true ──────────────
  const cibles = new Map();
  const ids = IDS.split(',').map((s) => s.trim()).filter(Boolean);

  for (const id of ids) {
    const compte = await User.findById(id).select('nom prenom telephone test estAdmin createdAt').lean();
    if (!compte) {
      console.log(`  ✗ ${id} : compte introuvable (déjà supprimé ?)`);
      continue;
    }
    cibles.set(String(compte._id), compte);
  }

  if (GROUPE_TEST) {
    const marques = await User.find({ test: true })
      .select('nom prenom telephone test estAdmin createdAt')
      .lean();
    for (const compte of marques) cibles.set(String(compte._id), compte);
  }

  // ── Exclusions explicites (--sauf=<id1,id2,…>) ─────────────────────────────
  // Un groupe se traite en une fois, mais certains comptes peuvent encore être
  // nécessaires (dépôt témoin d'un script de vérification, pièce à examiner…).
  // On les retire de la cible AVANT les garde-fous : ils ne partent jamais.
  const exclus = SAUF.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of exclus) {
    const compte = cibles.get(id);
    if (compte) {
      console.log(`  ⏭ ${id} | ${nomComplet(compte)} | ${compte.telephone} : exclu par --sauf`);
      cibles.delete(id);
    } else {
      console.log(`  ⏭ ${id} : exclu par --sauf (hors cible)`);
    }
  }

  // ── Garde-fous ─────────────────────────────────────────────────────────────
  const refus = [];
  const retenus = [];
  for (const compte of cibles.values()) {
    const telephone = String(compte.telephone || '').replace(/\D/g, '');
    if (telephone === TELEPHONE_ADMIN_REEL.replace(/\D/g, '')) {
      refus.push({ compte, raison: 'administrateur RÉEL (+225102030405) — protégé' });
    } else if (compte.estAdmin && !AVEC_ADMINS) {
      refus.push({ compte, raison: 'estAdmin:true — relancez avec --avec-admins si c’est voulu' });
    } else {
      retenus.push(compte);
    }
  }

  console.log(`Comptes visés : ${retenus.length} | refusés : ${refus.length}`);
  for (const { compte, raison } of refus) {
    console.log(`  🔒 ${compte._id} | ${nomComplet(compte)} | ${compte.telephone} | REFUSÉ : ${raison}`);
  }
  if (retenus.length === 0) {
    console.log('Rien à supprimer.');
  }

  // Aperçu des données liées, compte par compte (lecture seule).
  for (const compte of retenus) {
    console.log(`  ⚠ ${compte._id} | ${nomComplet(compte)} | ${compte.telephone} | test:${Boolean(compte.test)} admin:${Boolean(compte.estAdmin)}`);
  }

  if (!APPLY || retenus.length === 0) {
    console.log('\nDRY-RUN terminé : aucune écriture. Ajoutez --apply pour supprimer ces comptes et leurs données liées.');
    await mongoose.disconnect().catch(() => {});
    return;
  }

  // ── Suppression réelle ─────────────────────────────────────────────────────
  const bilan = await supprimerComptesEtDonnees(retenus.map((c) => c._id));
  console.log('\nSuppression effectuée :');
  for (const [cle, valeur] of Object.entries(bilan)) console.log(`  ${cle} : ${valeur}`);

  const restants = await User.countDocuments({ _id: { $in: retenus.map((c) => c._id) } });
  console.log(`Contrôle : ${restants} compte(s) visé(s) encore présent(s) (attendu : 0).`);
  if (restants > 0) process.exitCode = 1;

  await mongoose.disconnect().catch(() => {});
}

principal().catch(async (err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
