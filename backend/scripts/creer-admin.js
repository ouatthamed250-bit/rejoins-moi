// creer-admin.js — Crée (ou met à jour) le compte ADMINISTRATEUR du back-office.
//
// L'admin se connecte comme tout le monde : par NUMÉRO DE TÉLÉPHONE. Le compte
// créé ici porte `estAdmin: true`, le numéro demandé (par défaut « 0102030405 »,
// soit le numéro de démonstration) et le mot de passe fourni
// (« 00admin-fix » par défaut). Idempotent : relancer le script met à jour le
// mot de passe et remet le rôle admin sans créer de doublon.
//
// Le numéro est stocké sous sa forme NORMALISÉE (« +225102030405 »), comme tous
// les comptes de l'app (voir utils/validators.js normalizePhone) : la saisie
// « 0102030405 », « 102030405 » ou « +225102030405 » fonctionne donc à la
// connexion (POST /api/admin/login cherche les deux formes).
//
// Sécurité :
//   • le mot de passe est HACHÉ (bcrypt) — jamais stocké en clair ;
//   • CHANGEZ ce mot de passe après la première connexion (depuis le back-office,
//     « Mon mot de passe », ou en relançant ce script avec ADMIN_MOT_DE_PASSE) ;
//   • pour la production, définissez ADMIN_IDENTIFIANT / ADMIN_MOT_DE_PASSE dans
//     l'environnement au lieu d'utiliser les valeurs par défaut.
//
// Lancement (depuis /backend) :
//   npm run admin:creer
//   $env:ADMIN_MOT_DE_PASSE='MonMotDePasseSolide'; npm run admin:creer   (PowerShell)

import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { normalizePhone } from '../src/utils/validators.js';

const IDENTIFIANT = process.env.ADMIN_IDENTIFIANT || '0102030405';
const MOT_DE_PASSE = process.env.ADMIN_MOT_DE_PASSE || '00admin-fix';

// Forme canonique en base : « 0102030405 » -> « +225102030405 ». Si l'identifiant
// n'est pas un numéro (ancien compte de test « 00admin-fix »), on le garde tel quel.
const TELEPHONE = normalizePhone(IDENTIFIANT) || IDENTIFIANT;

async function main() {
  const ok = await connectDB({ reessais: false });
  if (!ok) throw new Error('Connexion MongoDB impossible — vérifiez MONGODB_URI (backend/.env).');

  const hash = await User.hashMotDePasse(MOT_DE_PASSE);

  // On cherche d'abord la forme canonique, puis l'identifiant saisi tel quel
  // (rattrape un ancien compte enregistré avant normalisation, ex. « 0102030405 »).
  let admin = await User.findOne({ telephone: TELEPHONE }).select('+motDePasseHash');
  if (!admin && IDENTIFIANT !== TELEPHONE) {
    admin = await User.findOne({ telephone: IDENTIFIANT }).select('+motDePasseHash');
  }

  if (!admin) {
    admin = await User.create({
      telephone: TELEPHONE,
      nom: 'Admin',
      prenom: 'Rejoins',
      motDePasseHash: hash,
      estAdmin: true,
      chercheTravail: false,
      estArtisan: false,
    });
    console.log(`✅ Compte admin créé : ${TELEPHONE}`);
  } else {
    admin.telephone = TELEPHONE;
    admin.motDePasseHash = hash;
    admin.estAdmin = true;
    await admin.save();
    console.log(`♻️  Compte admin mis à jour : ${TELEPHONE}`);
  }

  console.log(`   Numéro de téléphone : ${IDENTIFIANT}  (stocké : ${TELEPHONE})`);
  console.log(`   Mot de passe : ${MOT_DE_PASSE === '00admin-fix' ? '00admin-fix (CHANGEZ-LE !)' : '(défini par variable d’environnement)'}`);
  console.log("   Connexion : ouvrez l'app sur /admin");
  console.log('');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('❌ Échec :', err.message);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});