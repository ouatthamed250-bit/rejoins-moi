// supprimer-admin.js — Supprime un compte ADMINISTRATEUR (nettoyage d'un compte obsolète).
//
// Pourquoi ce script existe : la connexion au back-office se fait désormais par
// NUMÉRO DE TÉLÉPHONE (voir creer-admin.js, « 0102030405 »). Les comptes de test
// créés avec un identifiant texte (« 00admin-fix ») traînent alors dans la base
// avec un mot de passe faible : ils doivent être SUPPRIMÉS, pas laissés dormir.
//
// Sécurité :
//   • par défaut le script ne fait RIEN : il affiche ce qu'il supprimerait
//     (« mode vérification ») — il faut ajouter --oui pour exécuter ;
//   • il REFUSE de supprimer le dernier administrateur restant (impossible de se
//     verrouiller dehors) ;
//   • il liste les comptes visés (téléphone + nom) avant de toucher à quoi que ce soit.
//
// Lancement (depuis /backend) :
//   npm run admin:supprimer                     -> affiche le compte « 00admin-fix » visé
//   npm run admin:supprimer -- --oui            -> le supprime réellement
//   node scripts/supprimer-admin.js --cible=00admin-fix --oui
//   node scripts/supprimer-admin.js --cible=+225102030405 --oui

import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { normalizePhone } from '../src/utils/validators.js';

// Compte visé par défaut : l'ancien identifiant texte du back-office.
const CIBLE =
  (process.argv.find((a) => a.startsWith('--cible=')) || '').slice('--cible='.length) ||
  process.env.ADMIN_A_SUPPRIMER ||
  '00admin-fix';
const OUI = process.argv.includes('--oui') || process.env.CONFIRMER === '1';

async function main() {
  const ok = await connectDB({ reessais: false });
  if (!ok) throw new Error('Connexion MongoDB impossible — vérifiez MONGODB_URI (backend/.env).');

  // Le numéro peut avoir été enregistré avant ou après normalisation : on cherche les deux.
  const normalise = normalizePhone(CIBLE);
  const candidats = [...new Set([CIBLE, normalise].filter(Boolean))];
  const comptes = await User.find({ telephone: { $in: candidats } }).select('telephone nom prenom estAdmin');

  if (comptes.length === 0) {
    console.log(`ℹ Aucun compte « ${CIBLE} » en base — rien à supprimer.`);
    await disconnectDB();
    return;
  }

  console.log(`Compte(s) trouvé(s) pour « ${CIBLE} » :`);
  for (const c of comptes) {
    console.log(`   • ${c.telephone} — ${c.prenom} ${c.nom}`.trimEnd() + (c.estAdmin ? '  [administrateur]' : '  [utilisateur simple]'));
  }

  const ids = comptes.map((c) => c._id);
  const adminsRestants = await User.countDocuments({ estAdmin: true, _id: { $nin: ids } });
  if (adminsRestants < 1) {
    throw new Error(
      'Refus : ce compte est le DERNIER administrateur. Créez-en un autre avec « npm run admin:creer » avant de le supprimer.'
    );
  }

  if (!OUI) {
    console.log(`\n⚠️  Mode vérification : AUCUNE suppression effectuée.`);
    console.log(`   Pour supprimer réellement : npm run admin:supprimer -- --oui\n`);
    await disconnectDB();
    return;
  }

  await User.deleteMany({ _id: { $in: ids } });
  const restants = await User.find({ estAdmin: true }).select('telephone');
  console.log(`\n✅ ${comptes.length} compte(s) supprimé(s) : ${candidats.join(' / ')}`);
  console.log(`   Administrateurs restants (${restants.length}) : ${restants.map((a) => a.telephone).join(', ')}`);
  console.log('');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error(`❌ Échec : ${err.message}`);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});
