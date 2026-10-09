// supprimer-parcours-test.js — supprime ce qu'un essai de parcours a créé.
//
// Le parcours « nouveau venu » (bloc E) crée un COMPTE et une FICHE réels : c'est le seul
// moyen de vérifier que la publication fonctionne vraiment. Ce script retire ensuite
// exactement ce que l'essai a laissé, à partir du numéro de téléphone utilisé :
//   - le compte (users), et la fiche dont il est propriétaire (createdByUserId) ;
//   - les interactions/visites que ce compte a pu laisser sur les fiches.
//
// Refus de sécurité : sans argument valide, ou si le compte n'est PAS un compte de test
// (« ZZ TEST » dans le nom d'une fiche, ou numéro du bloc 0700000000-0700000009), le script
// s'arrête SANS RIEN SUPPRIMER.
//
// Usage (depuis /backend) :
//   node scripts/supprimer-parcours-test.js --telephone=0700000001
//   node scripts/supprimer-parcours-test.js --telephone=0700000001 --oui

import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import Establishment from '../src/models/Establishment.js';
import User from '../src/models/User.js';
import { normalizePhone } from '../src/utils/validators.js';

const args = process.argv.slice(2);
const valeur = (nom) => {
  const trouve = args.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : null;
};
const TELEPHONE = valeur('telephone');
const CONFIRMER = args.includes('--oui');

/**
 * Un numéro du bloc 0700000000-0700000009 est un numéro d'essai (aucun abonné réel).
 * ATTENTION : l'API stocke le numéro SANS le zéro de tête (« 0700000011 » devient
 * « +225700000011 »). On compare donc sur les chiffres, indicatif et zéro retirés.
 */
function estNumeroDEssai(telephone) {
  const local = String(telephone)
    .replace(/\D/g, '')
    .replace(/^225/, '')
    .replace(/^0/, '');
  return /^7000000\d\d$/.test(local);
}

/** Retrouve le compte de test quelles que soient la casse et la mise en forme du numéro. */
async function trouverCompteDEssai(telephone) {
  const cible = String(telephone)
    .replace(/\D/g, '')
    .replace(/^225/, '')
    .replace(/^0/, '');
  const candidats = await User.find({ telephone: { $regex: '7000' } }).select('_id telephone').lean();
  return candidats.filter((u) => String(u.telephone).replace(/\D/g, '').replace(/^225/, '').replace(/^0/, '') === cible);
}

async function principal() {
  if (!TELEPHONE) {
    console.error('Usage : node scripts/supprimer-parcours-test.js --telephone=0700000001 [--oui]');
    process.exitCode = 1;
    return;
  }
  const enregistre = normalizePhone(TELEPHONE);
  if (!enregistre || !estNumeroDEssai(enregistre)) {
    console.error(`Refus : « ${TELEPHONE} » n'est pas un numéro d'essai (bloc 0700000000-0700000009).`);
    process.exitCode = 1;
    return;
  }

  const connecte = await connectDB({ reessais: false, silencieux: true });
  if (!connecte) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exitCode = 1;
    return;
  }

  const comptes = await trouverCompteDEssai(enregistre);
  const idsComptes = comptes.map((c) => c._id);
  const fiches = await Establishment.find({
    $or: [{ nom: /^ZZ TEST/i }, { createdByUserId: { $in: idsComptes } }],
  })
    .select('nom quartier commune')
    .lean();

  console.log(
    `Compte(s) : ${comptes.length ? comptes.map((c) => c.telephone).join(', ') : 'aucun'} | ` +
      `Fiche(s) : ${fiches.length ? fiches.map((f) => f.nom).join(', ') : 'aucune'}`
  );

  if (!CONFIRMER) {
    console.log('Aucune suppression (relancer avec --oui).');
  } else {
    const { deletedCount: fichesSupprimees } = await Establishment.deleteMany({ _id: { $in: fiches.map((f) => f._id) } });
    const { deletedCount: comptesSupprimes } = await User.deleteMany({ _id: { $in: idsComptes } });
    // Interactions laissées par ces comptes de test sur d'autres fiches.
    for (const id of idsComptes) {
      await Establishment.updateMany({}, { $pull: { contactDebloquePar: { userId: id } } }).catch(() => {});
      await User.updateOne({ _id: id }, { $set: { favoris: [] } }).catch(() => {});
    }
    console.log(`Supprimés : ${fichesSupprimees} fiche(s), ${comptesSupprimes} compte(s).`);
    console.log(`Fiches « ZZ TEST » restantes en base : ${await Establishment.countDocuments({ nom: /^ZZ TEST/i })}.`);
  }

  await mongoose.disconnect().catch(() => {});
}

principal().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
});
