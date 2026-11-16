// marquer-tests.js — Marquage batch des échantillons de test (comptes + fiches).
//
// Usage :
//   node scripts/marquer-tests.js              -> mode DRY-RUN (affiche uniquement)
//   node scripts/marquer-tests.js --apply      -> marque réellement test: true
//
// Seuls les éléments DEJA identifiés dans auditer-tests.js (lot 1) et
// auditer-tests-2.js (lot 2) sont concernés : 14 comptes (User) + 2 fiches.
//   - 8 comptes du lot 1 :
//       6abecc5ff046f29f037e87d2
//       6abecc6af046f29f037e87e4
//       6abee5fccd81c2d898ef30ff
//       6abee60cbbc8b2c30c6152c2
//       6abee61e1a2b9ceeafb21d52
//       6abee63603ff0334157141cd
//       6abeed5ca9261ac1101cdb56
//       6abeed5fa9261ac1101cdb59
//   - 6 comptes du lot 2 :
//       6afb3d9a8e1dc35bc3e805d8
//       6afb3db49b4470861bc9a227
//       6afb3dda72cefa461e6afa81
//       6afb3df5d23bfb4d546f12d1
//       6afb3f31f40bc442965fe927
//       6afb3f36f40bc442965fe938
//   - 2 fiches (Establishment) :
//       6abecc6af046f29f037e87e6
//       6afb3f36f40bc442965fe93a
//
// Aucun critère automatique : on ne marque que les IDs explicitement listés
// ci-dessous. Si un ID n'existe pas en base, le script s'arrête avec une erreur.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, getMongoDbName } from '../src/config/db.js';
import User from '../src/models/User.js';
import Establishment from '../src/models/Establishment.js';

const APPLY = process.argv.includes('--apply');
if (!APPLY && process.argv.includes('--apply')) {
  // Désactivé volontairement : on exécute toujours --dry-run par défaut.
}

// ── IDs FACTUELS (extraits de auditer-tests.js + auditer-tests-2.js) ──

const USER_IDS = [
  '6abecc5ff046f29f037e87d2', // TestCompteur1
  '6abecc6af046f29f037e87e4', // TestCompteur2
  '6abee5fccd81c2d898ef30ff', // ZOGBO Vérification
  '6abee60cbbc8b2c30c6152c2', // ZOGBO Vérification
  '6abee61e1a2b9ceeafb21d52', // ZOGBO Vérification
  '6abee63603ff0334157141cd', // ZOGBO Vérification
  '6abeed5ca9261ac1101cdb56', // Suivi Admin076
  '6abeed5fa9261ac1101cdb59', // Suivi Admin286
  // ── Lot 2 (audit complémentaire du 16/11, liste validée) ──
  '6afb3d9a8e1dc35bc3e805d8', // ZOGBO Vérification
  '6afb3db49b4470861bc9a227', // ZOGBO Vérification
  '6afb3dda72cefa461e6afa81', // ZOGBO Vérification
  '6afb3df5d23bfb4d546f12d1', // ZOGBO Vérification
  '6afb3f31f40bc442965fe927', // TestCompteur1
  '6afb3f36f40bc442965fe938', // TestCompteur2
];

const ESTABLISHMENT_IDS = [
  '6abecc6af046f29f037e87e6', // "ZZ-TEST-COMPTEURS-1790889066557" (fiche non importée)
  '6afb3f36f40bc442965fe93a', // "ZZ-TEST-COMPTEURS-1794850614357" (lot 2)
  // NOTE : 6ac8aceb7b978da051e9e069 ("Hhhh") est EXPLCITEMENT exclu : on ne le
  // touche pas pour l'instant (voir demande de l'utilisateur).
  // NOTE : 6abcdc9ad7bc403c51f6daf2 ("Sahore zogbo") est EXCLU : vrai utilisateur.
];

// ── Helpers ──

async function connect() {
  const ok = await connectDB({ reessais: false, silencieux: true });
  if (!ok) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exitCode = 1;
    process.exit(1);
  }
  console.log(`Base : ${getMongoDbName()} | hôte : ${mongoose.connection.host}`);
  console.log(APPLY ? 'MODE APPLY (modifications réelles)' : 'MODE DRY-RUN (aucune modification)');
  console.log('');
}

function afficherErreur(id, type, msg) {
  console.error(`ERREUR : ${type} ${id} - ${msg}`);
}

function afficherCompte(user) {
  console.log(`  - +${user.telephone.replace(/^\+/, '')} | ${user.nom || '(nom absent)'} | créé le ${user.createdAt ? new Date(user.createdAt).toISOString().slice(0, 19).replace('T', ' ') : '—'}`);
}

function afficherFiche(est) {
  console.log(`  - « ${est.nom || '(nom absent)'} » | id: ${est._id} | créé le ${est.createdAt ? new Date(est.createdAt).toISOString().slice(0, 19).replace('T', ' ') : '—'}`);
}

// ── Dry-run ──

async function dryRun() {
  console.log('=== Mode DRY-RUN (aucune modification) ===');
  console.log('Comptes à marquer (', USER_IDS.length, ') :');
  for (const id of USER_IDS) {
    const user = await User.findById(id).select('nom telephone createdAt');
    if (!user) {
      console.error(`  !! ID utilisateur introuvable : ${id}`);
      process.exitCode = 1;
      return;
    }
    afficherCompte(user);
  }
  console.log('');
  console.log('Fiches à marquer (', ESTABLISHMENT_IDS.length, ') :');
  for (const id of ESTABLISHMENT_IDS) {
    const est = await Establishment.findById(id).select('nom telephone createdAt');
    if (!est) {
      console.error(`  !! ID fiche introuvable : ${id}`);
      process.exitCode = 1;
      return;
    }
    afficherFiche(est);
  }
  console.log('');
  console.log('Pour appliquer : node scripts/marquer-tests.js --apply');
}

// ── Apply ──

async function apply() {
  console.log('=== Mode APPLY (modification réelle) ===');
  let ok = true;

  // Users
  for (const id of USER_IDS) {
    const user = await User.findById(id);
    if (!user) {
      afficherErreur(id, 'USER', 'introuvable');
      ok = false;
      continue;
    }
    user.test = true;
    await user.save();
    console.log(`OK : utilisateur ${id} marqué test=true (nom : ${user.nom})`);
  }

  // Establishments
  for (const id of ESTABLISHMENT_IDS) {
    const est = await Establishment.findById(id);
    if (!est) {
      afficherErreur(id, 'ESTABLISHMENT', 'introuvable');
      ok = false;
      continue;
    }
    est.test = true;
    await est.save();
    console.log(`OK : fiche ${id} marquée test=true (nom : ${est.nom})`);
  }

  if (!ok) {
    console.error('Marchage partiel : certains IDs introuvables.');
    process.exitCode = 1;
    return;
  }

  const users = await User.countDocuments({ test: true });
  const ests = await Establishment.countDocuments({ test: true });
  console.log('');
  console.log(`Comptages finaux : ${users} utilisateur(s) test:true, ${ests} établissement(s) test:true`);
}

// ── Entrée ──

async function main() {
  await connect();
  if (APPLY) {
    await apply();
  } else {
    await dryRun();
  }
  await mongoose.disconnect().catch(() => {});
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
});