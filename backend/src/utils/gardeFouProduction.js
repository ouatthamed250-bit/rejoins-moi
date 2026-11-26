// gardeFouProduction.js — Garde-fou commun aux scripts qui ÉCRASENT la base.
//
// Pourquoi ce fichier : `npm run seed` et `npm run importer:etablissements --
// --remplacer` suppriment des collections entières. Or le `.env` de ce dépôt
// pointe sur le cluster Atlas de PRODUCTION (mongodb.net, base « rejoins-moi ») :
// une commande lancée « pour tester » effacerait les vraies données des artisans.
//
// Deux verrous, dans cet ordre :
//   1. détection automatique de la cible (NODE_ENV=production, hôte Atlas,
//      base nommée « rejoins-moi » hors MongoDB local) ;
//   2. confirmation MANUELLE par la phrase exacte « OUI JE VEUX EFFACER LA
//      PRODUCTION », tapée dans le terminal. Aucune variable d'environnement ne
//      permet de la contourner : un script automatisé ne peut pas effacer la
//      production, il doit passer par un humain.
//
// Utilisation (dans une fonction `async`) :
//   import { exigerConfirmationProduction } from './utils/gardeFouProduction.js';
//   if (!(await exigerConfirmationProduction({ action: 'npm run seed' }))) return;

import readline from 'node:readline/promises';

import { getMongoDbName, getMongoUri, masquerUri } from '../config/db.js';

/** Phrase exacte à taper pour autoriser une écriture destructive en production. */
export const PHRASE_CONFIRMATION = 'OUI JE VEUX EFFACER LA PRODUCTION';

/** Message imposé par la procédure de sécurité (repris tel quel dans les scripts). */
export const MESSAGE_DANGER =
  'DANGER : Tentative de modification de la base de production. Action annulée.';

const HOTES_LOCAUX = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', 'mongodb', 'mongo']);

/**
 * Extrait les hôtes d'une URI MongoDB (sans identifiants, sans port).
 * Gère les URI multi-hôtes des clusters Atlas (`host1:27017,host2:27017`).
 * @returns {string[]}
 */
function hotesDeUri(uri) {
  const brute = String(uri || '').trim();
  const correspondance = brute.match(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i);
  if (!correspondance) return [];
  return correspondance[2].
    split(',').
    map((hote) => hote.trim().replace(/:\d+$/, '').toLowerCase()).
    filter(Boolean);
}

/**
 * La cible de MONGODB_URI est-elle la base de PRODUCTION ?
 * Trois signaux, volontairement larges (mieux vaut une fausse alerte qu'un
 * effacement) :
 *   • NODE_ENV=production ;
 *   • nom d'hôte Atlas (`*.mongodb.net`), y compris les URI multi-shards ;
 *   • base nommée « rejoins-moi » sur autre chose que la boucle locale.
 * Un MongoDB local `mongodb://127.0.0.1:27017/rejoins-moi` reste donc autorisé
 * sans confirmation : c'est l'environnement de développement.
 *
 * @param {{uri?: string, nomBase?: string, env?: string}} [options]
 * @returns {{production: boolean, raisons: string[], uri: string, nomBase: string, hotes: string[]}}
 */
export function cibleProduction({ uri = getMongoUri(), nomBase = getMongoDbName(), env = process.env.NODE_ENV } = {}) {
  const hotes = hotesDeUri(uri);
  const raisons = [];

  if (String(env || '').toLowerCase() === 'production') {
    raisons.push('NODE_ENV=production');
  }
  const hoteAtlas = hotes.find((hote) => /(^|\.)mongodb\.net$/.test(hote));
  if (hoteAtlas) raisons.push(`cluster Atlas (${hoteAtlas})`);

  const tousLocaux = hotes.length > 0 && hotes.every((hote) => HOTES_LOCAUX.has(hote));
  if (nomBase === 'rejoins-moi' && !tousLocaux) {
    raisons.push(`base nommée « ${nomBase} »`);
  }

  return { production: raisons.length > 0, raisons, uri, nomBase, hotes };
}

/** Raccourci : true si l'URI courante vise la production. */
export function estProduction(options) {
  return cibleProduction(options).production;
}

/**
 * Demande la phrase de confirmation dans le terminal, saisie VISIBLE (c'est une
 * phrase, pas un secret) et comparée à l'identique (casse et espaces compris).
 * @returns {Promise<boolean>}
 */
async function demanderPhrase() {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const reponse = await terminal.question(`  → Tapez « ${PHRASE_CONFIRMATION} » pour continuer : `);
    return reponse.trim() === PHRASE_CONFIRMATION;
  } finally {
    terminal.close();
  }
}

/**
 * Applique le garde-fou avant une opération destructive.
 *
 * @param {{action?: string, details?: string[]}} [options]
 *   `action` décrit ce que le script s'apprête à faire (affiché à l'écran).
 * @returns {Promise<boolean>} true si l'opération peut continuer.
 */
export async function exigerConfirmationProduction({ action = 'Opération destructive', details = [] } = {}) {
  const cible = cibleProduction();
  if (!cible.production) return true;

  // Tout est écrit sur stderr : un script qui capture stdout ne peut pas
  // confondre l'alerte avec ses propres résultats.
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════════╗');
  console.error('║  GARDE-FOU PRODUCTION                                            ║');
  console.error('╚══════════════════════════════════════════════════════════════════╝');
  console.error(`  ${MESSAGE_DANGER}`);
  console.error(`  • Action demandée : ${action}`);
  console.error(`  • Base visée      : « ${cible.nomBase} » via ${masquerUri(cible.uri)}`);
  console.error(`  • Motif détecté   : ${cible.raisons.join(' + ')}`);
  for (const ligne of details) console.error(`  • ${ligne}`);

  if (!process.stdin.isTTY) {
    console.error('  • Entrée standard non interactive : aucune confirmation possible.');
    console.error("  • Rien n'a été modifié. Pour une maintenance réelle, relancez la");
    console.error('    commande DANS UN TERMINAL et tapez la phrase de confirmation.');
    console.error('');
    return false;
  }

  console.error('');
  console.error('  Une sauvegarde chiffrée existe ? `npm run sauvegarder:base` (voir docs/SAUVEGARDE.md).');
  console.error('  Cette action est IRRÉVERSIBLE sans restauration.');
  console.error('');

  const confirme = await demanderPhrase();
  if (!confirme) {
    console.error('');
    console.error("  Confirmation incorrecte : action annulée, rien n'a été modifié.");
    console.error('');
    return false;
  }

  console.warn('');
  console.warn('  ⚠ Confirmation reçue : opération autorisée sur la PRODUCTION.');
  console.warn('');
  return true;
}

export default exigerConfirmationProduction;
