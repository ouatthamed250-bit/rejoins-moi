// lister-inactifs.js — Repérage des comptes DORMANTS (politique de conservation).
//
// POURQUOI CE SCRIPT : le droit à l'effacement a une contrepartie — on ne garde pas
// indéfiniment les données de gens qui ne viennent plus. Cet outil LISTE (il ne
// modifie RIEN) les comptes dont la dernière connexion remonte à plus de 24 mois
// par défaut, pour que l'équipe les relance puis, si la personne ne répond pas,
// applique l'effacement (`DELETE /api/admin/utilisateurs/:id`).
//
// RÈGLES DE SÉLECTION :
//   • `dernierLoginAt` plus vieux que le seuil → dormant ;
//   • JAMAIS connecté (`dernierLoginAt: null`) et compte créé avant le seuil →
//     dormant aussi : un compte jamais utilisé depuis deux ans ne sert plus à rien ;
//   • comptes ADMINISTRATEURS exclus (l'équipe doit garder son accès) ;
//   • comptes DÉJÀ effacés exclus (`supprimeAt` renseigné) : ils ne contiennent plus
//     de données personnelles, il n'y a plus rien à décider.
//
// CONFIDENTIALITÉ DE LA SORTIE : par défaut les numéros sont MASQUÉS (« +225 07 ** ** 62 »).
// Un journal de terminal se copie vite dans un chat d'équipe ; pour relancer
// quelqu'un il faut son numéro complet, on l'affiche donc seulement avec `--complet`.
//
// Lancement (depuis /backend) :
//   npm run lister:inactifs                 → seuil 24 mois, numéros masqués
//   npm run lister:inactifs -- --mois=18    → seuil personnalisé
//   npm run lister:inactifs -- --complet    → numéros complets (usage interne)
//   npm run lister:inactifs -- --json       → sortie JSON (traitement par un autre outil)
//   npm run lister:inactifs -- --limite=50  → n'afficher que les 50 plus anciens
//
// Le script est en LECTURE SEULE : aucune écriture, aucun index, aucune migration.

import 'dotenv/config';

import { connectDB, disconnectDB, getMongoDbName } from '../src/config/db.js';
import User from '../src/models/User.js';

const JOUR_MS = 24 * 3600 * 1000;

/** Lit `--cle=valeur` dans les arguments ; renvoie `defaut` si absent. */
function option(nom, defaut = null) {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.slice(2).find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : defaut;
}

const drapeau = (nom) => process.argv.slice(2).includes(`--${nom}`);

/** Masque un numéro normalisé (« +2250702311162 ») → « +225 07 ** ** 62 ». */
function masquerTelephone(telephone) {
  const brut = String(telephone || '');
  if (!brut) return '—';
  const chiffres = brut.replace(/\D/g, '');
  if (chiffres.length < 6) return '***';
  return `+${chiffres.slice(0, 4)} ${chiffres.slice(4, 6)} ** ** ${chiffres.slice(-2)}`;
}

/** Nombre de mois entiers écoulés depuis une date. */
function moisDepuis(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (JOUR_MS * 30.44));
}

function formaterDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

async function principal() {
  const mois = Math.max(1, Number(option('mois', 24)) || 24);
  const limite = Number(option('limite', 0)) || 0;
  const complet = drapeau('complet');
  const enJson = drapeau('json');

  const seuil = new Date(Date.now() - mois * 30.44 * JOUR_MS);

  console.log(`\nBase « ${getMongoDbName()} » — comptes sans connexion depuis plus de ${mois} mois.`);
  console.log(`Seuil : avant le ${formaterDate(seuil)} (lecture seule, aucune modification).\n`);

  await connectDB({ silencieux: true });

  const filtre = {
    estAdmin: { $ne: true },
    supprimeAt: null,
    $or: [
      { dernierLoginAt: { $lt: seuil } },
      { dernierLoginAt: null, createdAt: { $lt: seuil } },
      // Documents très anciens où le champ n'existe pas du tout.
      { dernierLoginAt: { $exists: false }, createdAt: { $lt: seuil } },
    ],
  };

  const total = await User.countDocuments(filtre);
  let requete = User.find(filtre)
    .select('nom prenom telephone createdAt dernierLoginAt estArtisan')
    .sort({ dernierLoginAt: 1, createdAt: 1 });
  if (limite > 0) requete = requete.limit(limite);

  const comptes = await requete.lean();

  const lignes = comptes.map((u) => {
    const reference = u.dernierLoginAt || u.createdAt;
    const jamaisConnecte = !u.dernierLoginAt;
    return {
      id: String(u._id),
      nom: [u.prenom, u.nom].filter(Boolean).join(' ').trim() || '(sans nom)',
      telephone: complet ? u.telephone : masquerTelephone(u.telephone),
      // « jamais » plutôt qu'une date : c'est l'information qui décide de l'action.
      derniereConnexion: jamaisConnecte ? 'jamais' : formaterDate(u.dernierLoginAt),
      inscription: formaterDate(u.createdAt),
      moisInactivite: moisDepuis(reference),
      estArtisan: Boolean(u.estArtisan),
    };
  });

  if (enJson) {
    console.log(
      JSON.stringify({ seuilMois: mois, total, affiches: lignes.length, comptes: lignes }, null, 2)
    );
  } else if (lignes.length === 0) {
    console.log('  ✓ Aucun compte dormant sur ce seuil : rien à relancer.\n');
  } else {
    const idLargeur = 26;
    // Largeur calculée sur le contenu réel, bornée pour ne pas exploser en terminal mobile.
    const nomLargeur = Math.min(28, Math.max(12, ...lignes.map((l) => l.nom.length + 2)));
    console.log(
      `  ${'ID'.padEnd(idLargeur)}${'NOM'.padEnd(nomLargeur)}${'TÉLÉPHONE'.padEnd(20)}` +
        `${'DERN. CONNEXION'.padEnd(18)}${'INSCRIPTION'.padEnd(13)}INACTIF`
    );
    console.log(`  ${'─'.repeat(idLargeur + nomLargeur + 20 + 18 + 13 + 12)}`);
    for (const l of lignes) {
      console.log(
        `  ${l.id.padEnd(idLargeur)}${l.nom.slice(0, nomLargeur - 1).padEnd(nomLargeur)}` +
          `${l.telephone.padEnd(20)}${l.derniereConnexion.padEnd(18)}` +
          `${l.inscription.padEnd(13)}${String(l.moisInactivite).padStart(4)} mois` +
          `${l.estArtisan ? '  · artisan' : ''}`
      );
    }
  }

  if (lignes.length > 0 && !enJson) {
    const jamais = lignes.filter((l) => l.derniereConnexion === 'jamais').length;
    console.log(`\n  ${lignes.length} compte(s) affiché(s) sur ${total} au total.`);
    console.log(`  Dont ${jamais} jamais connecté(s) depuis l'inscription.`);
    console.log('\n  Rappel (politique de conservation) :');
    console.log('   1. relancer la personne sur WhatsApp (une seule fois, trace au dossier) ;');
    console.log('   2. sans réponse, effacer : back-office → Utilisateurs → « Effacer le compte »');
    console.log('      (équivalent API : DELETE /api/admin/utilisateurs/:id) ;');
    console.log('   3. l’effacement anonymise le compte et conserve uniquement les paiements.\n');
  }

  await disconnectDB();
}

principal().catch(async (err) => {
  console.error('❌ Échec du script :', err.message);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});
