// creer-admin.js — Crée (ou met à jour) le compte ADMINISTRATEUR du back-office.
//
// L'admin se connecte comme tout le monde : par NUMÉRO DE TÉLÉPHONE. Le compte
// créé ici porte `estAdmin: true`, le numéro demandé (par défaut « 0102030405 »,
// soit le numéro de démonstration) et le mot de passe fourni
// (valeur de ADMIN_MOT_DE_PASSE : aucun défaut en dur). Idempotent : relancer le script met à jour le
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
//     « Mon profil » → mot de passe, ou en relançant ce script) ;
//   • ADMIN_MOT_DE_PASSE est OBLIGATOIRE : aucun mot de passe par défaut n’est écrit
//     dans le code — ce dépôt est PUBLIC, un défaut serait une clé donnée à tous.
//
// Lancement (depuis /backend) :
//   $env:ADMIN_IDENTIFIANT='0102030405'
//   $env:ADMIN_MOT_DE_PASSE='MonMotDePasseSolide'
//   npm run admin:creer
//   (invite cmd.exe : set ADMIN_MOT_DE_PASSE=MonMotDePasseSolide puis npm run admin:creer)

import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { normalizePhone } from '../src/utils/validators.js';

const IDENTIFIANT = process.env.ADMIN_IDENTIFIANT || '0102030405';
const MOT_DE_PASSE = process.env.ADMIN_MOT_DE_PASSE;

// AUCUN mot de passe par défaut : ce dépôt est PUBLIC, donc un défaut écrit ici
// ouvrirait le back-office à n’importe qui — et écraserait en silence un mot de passe
// déjà changé. On refuse de continuer AVANT d’ouvrir MongoDB : la base n’est jamais
// touchée, et le mot de passe en place reste valable.
function exigerMotDePasse() {
  if (typeof MOT_DE_PASSE === 'string' && MOT_DE_PASSE.trim() !== '') {
    if (MOT_DE_PASSE.trim().length < 6) {
      console.warn('⚠️  Moins de 6 caractères : le back-office impose ce minimum pour changer');
      console.warn('   le mot de passe depuis « Mon profil ». Préférez un mot de passe long.');
    }
    return;
  }
  console.error('❌ ADMIN_MOT_DE_PASSE est absent : aucun mot de passe par défaut n’est fourni.');
  console.error('   (Un défaut publié dans ce dépôt PUBLIC ouvrirait le back-office à tout le monde.)');
  console.error('');
  console.error('   PowerShell, depuis /backend :');
  console.error("     $env:ADMIN_IDENTIFIANT='0102030405'");
  console.error("     $env:ADMIN_MOT_DE_PASSE='MonMotDePasseSolide'");
  console.error('     npm run admin:creer');
  console.error('');
  process.exit(1);
}

// Forme canonique en base : « 0102030405 » -> « +225102030405 ». Si l'identifiant
// n'est pas un numéro (ancien compte de test à identifiant texte), on le garde tel quel.
const TELEPHONE = normalizePhone(IDENTIFIANT) || IDENTIFIANT;

async function main() {
  exigerMotDePasse();

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
  console.log('   Mot de passe : (défini par ADMIN_MOT_DE_PASSE — jamais affiché)');
  console.log("   Connexion : ouvrez l'app sur /admin");
  console.log('');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('❌ Échec :', err.message);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});