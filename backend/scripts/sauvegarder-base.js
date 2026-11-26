// sauvegarder-base.js — Sauvegarde COMPLÈTE et CHIFFRÉE de la base MongoDB.
//
// Problème résolu : la production (cluster Atlas M0, base « rejoins-moi ») ne
// contient que des données vivantes — artisans, fiches revendiquées, avis,
// abonnements. Une erreur d'exploitation ou un effacement (droit à l'oubli mal
// ciblé, `seed` lancé par distraction) serait définitive. Ce script produit une
// archive restaurable, hors du dépôt Git.
//
// Chaîne de traitement, dans cet ordre (important) :
//   1. lecture de TOUTES les collections et de TOUS leurs documents ;
//   2. sérialisation EJSON (les ObjectId et les Date gardent leur type, sinon la
//      restauration casserait les références et les index) ;
//   3. compression GZIP (le JSON d'Atlas se compresse ~4×) ;
//   4. chiffrement AES-256-GCM avec une clé dérivée par scrypt du mot de passe.
//
// Format du fichier `backups/backup-rejoins-moi-<date>.json.gz.enc` :
//   « RMBK1 » (5 o) | sel scrypt (16 o) | IV (12 o) | tag GCM (16 o) | données
// Le tag d'authentification rend toute altération détectable : un fichier
// tronqué ou un mauvais mot de passe échouent AVANT d'écrire quoi que ce soit.
//
// Usage (depuis /backend) :
//   npm run sauvegarder:base
//   BACKUP_PASSWORD="…" npm run sauvegarder:base     (script, CI, tâche planifiée)
//
// Le mot de passe n'est jamais écrit sur le disque ni dans le dépôt. Sans lui,
// la sauvegarde est définitivement illisible : c'est le but, mais cela veut dire
// qu'il doit être conservé dans un gestionnaire de mots de passe (voir
// docs/SAUVEGARDE.md).

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { connectDB, disconnectDB, getMongoDbName, getMongoUri, masquerUri } from '../src/config/db.js';

// `.env` du dossier backend, quel que soit le dossier d'où la commande part.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

/** Signature du format, en tête de chaque fichier chiffré. */
export const MAGIC = Buffer.from('RMBK1', 'utf8');
/** Version du schéma de l'archive (à incrémenter si la structure change). */
export const VERSION_FORMAT = 1;

const TAILLE_SEL = 16;
const TAILLE_IV = 12;
const TAILLE_TAG = 16;
const TAILLE_CLE = 32;
const TETE = MAGIC.length + TAILLE_SEL + TAILLE_IV + TAILLE_TAG;

/** Dossier `backups/` à la RACINE du dépôt (ignoré par Git). */
export function dossierSauvegardes() {
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)), 'backups');
}

/** Nom horodaté : le jour ET l'heure, pour ne jamais écraser une bonne sauvegarde. */
export function nomFichierSauvegarde(date = new Date()) {
  const deux = (n) => String(n).padStart(2, '0');
  const horodatage =
    `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}` +
    `_${deux(date.getHours())}-${deux(date.getMinutes())}-${deux(date.getSeconds())}`;
  return `backup-rejoins-moi-${horodatage}.json.gz.enc`;
}

/** Chiffre un tampon : AES-256-GCM, clé scrypt(mot de passe, sel aléatoire). */
export function chiffrer(donnees, motDePasse) {
  const sel = randomBytes(TAILLE_SEL);
  const iv = randomBytes(TAILLE_IV);
  const cle = scryptSync(motDePasse, sel, TAILLE_CLE);
  const cipher = createCipheriv('aes-256-gcm', cle, iv);
  const chiffre = Buffer.concat([cipher.update(donnees), cipher.final()]);
  return Buffer.concat([MAGIC, sel, iv, cipher.getAuthTag(), chiffre]);
}

/** Vrai si le fichier commence par la signature attendue. */
export function estFichierSauvegarde(tampon) {
  return Buffer.isBuffer(tampon) && tampon.length > TETE && tampon.subarray(0, MAGIC.length).equals(MAGIC);
}

/**
 * Déchiffre un fichier de sauvegarde.
 * @throws si la signature est absente, le fichier tronqué ou le mot de passe faux
 *         (GCM refuse alors de rendre le moindre octet en clair).
 */
export function dechiffrer(tampon, motDePasse) {
  if (!estFichierSauvegarde(tampon)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Rejoins'Moi (signature « RMBK1 » absente).");
  }
  const sel = tampon.subarray(MAGIC.length, MAGIC.length + TAILLE_SEL);
  const iv = tampon.subarray(MAGIC.length + TAILLE_SEL, MAGIC.length + TAILLE_SEL + TAILLE_IV);
  const tag = tampon.subarray(MAGIC.length + TAILLE_SEL + TAILLE_IV, TETE);
  const chiffre = tampon.subarray(TETE);
  const cle = scryptSync(motDePasse, sel, TAILLE_CLE);
  const decipher = createDecipheriv('aes-256-gcm', cle, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(chiffre), decipher.final()]);
  } catch {
    throw new Error(
      'Déchiffrement impossible : mot de passe incorrect ou fichier altéré ' +
        '(le tag d’authentification GCM ne correspond pas).'
    );
  }
}

/** Liste les sauvegardes d'un dossier, la plus récente en premier. */
export function listerSauvegardes(dossier = dossierSauvegardes()) {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).
    filter((nom) => nom.startsWith('backup-rejoins-moi-') && nom.endsWith('.json.gz.enc')).
    sort().
    reverse().
    map((nom) => path.join(dossier, nom));
}

/* ── Saisie du mot de passe ───────────────────────────────────────────────── */

/** Lit une ligne sans l'afficher (le terminal n'affiche pas les caractères tapés). */
function lireMasque(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');

    let saisie = '';
    const terminer = (erreur, valeur) => {
      stdin.removeListener('data', surDonnees);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stdout.write('\n');
      erreur ? reject(erreur) : resolve(valeur);
    };
    const surDonnees = (morceau) => {
      for (const caractere of morceau) {
        if (caractere === '\u0003') return terminer(new Error('Saisie interrompue (Ctrl+C).'));
        if (caractere === '\r' || caractere === '\n') return terminer(null, saisie);
        if (caractere === '\u007f' || caractere === '\b') {
          saisie = saisie.slice(0, -1);
          continue;
        }
        // On ignore les séquences d'échappement (flèches, etc.).
        if (caractere < ' ') continue;
        saisie += caractere;
      }
    };
    stdin.on('data', surDonnees);
  });
}

/**
 * Mot de passe de sauvegarde : `BACKUP_PASSWORD` d'abord (scripts, tâches
 * planifiées), sinon saisie masquée dans le terminal.
 * @param {{question?: string, confirmation?: boolean, longueurMin?: number}} [options]
 * @returns {Promise<string>}
 */
export async function lireMotDePasse({
  question = 'Mot de passe de sauvegarde : ',
  confirmation = false,
  longueurMin = 8,
} = {}) {
  const depuisEnv = process.env.BACKUP_PASSWORD;
  if (depuisEnv) return depuisEnv;

  if (!process.stdin.isTTY) {
    throw new Error(
      'Mot de passe absent : définissez BACKUP_PASSWORD (variable d’environnement) ' +
        'ou lancez la commande dans un terminal interactif.'
    );
  }

  const premier = await lireMasque(question);
  if (premier.length < longueurMin) {
    throw new Error(`Mot de passe trop court : ${longueurMin} caractères minimum.`);
  }
  if (!confirmation) return premier;

  const second = await lireMasque('Confirmez le mot de passe      : ');
  if (premier !== second) {
    throw new Error('Les deux saisies diffèrent : aucune sauvegarde n’a été créée.');
  }
  return premier;
}

/* ── Collecte et écriture ─────────────────────────────────────────────────── */

const formaterNombre = (valeur) => new Intl.NumberFormat('fr-FR').format(valeur);
const formaterOctets = (octets) =>
  octets >= 1024 * 1024 ? `${(octets / (1024 * 1024)).toFixed(2)} Mo` : `${(octets / 1024).toFixed(1)} Ko`;

/** Lit toutes les collections (hors `system.*`) et tous leurs documents. */
async function collecterCollections(db) {
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  const noms = infos.
    map((info) => info.name).
    filter((nom) => !nom.startsWith('system.')).
    sort();

  const collections = {};
  const compteurs = {};
  for (const nom of noms) {
    const documents = await db.collection(nom).find({}).batchSize(1000).toArray();
    collections[nom] = documents;
    compteurs[nom] = documents.length;
    console.log(`  • ${nom.padEnd(22)} ${formaterNombre(documents.length).padStart(8)} document(s)`);
  }
  if (!noms.length) throw new Error('Aucune collection trouvée : la base visée est vide.');
  return { collections, compteurs };
}

async function lancer() {
  const dossier = dossierSauvegardes();

  console.log('🗄  Sauvegarde chiffrée de la base MongoDB');
  console.log(`   Base : « ${getMongoDbName()} » via ${masquerUri(getMongoUri())}`);
  console.log('');
  console.log('Le mot de passe n’est ni enregistré ni transmis : sans lui, le fichier');
  console.log('produit est illisible, y compris pour nous (voir docs/SAUVEGARDE.md).');
  console.log('');

  // 1. Mot de passe (saisi masqué, saisi deux fois pour éviter la faute de frappe).
  const motDePasse = await lireMotDePasse({ confirmation: true });

  // 2. Connexion.
  const connecte = await connectDB({ reessais: false });
  if (!connecte) throw new Error('MongoDB injoignable — aucun fichier n’a été créé.');

  try {
    const db = mongoose.connection.db;
    console.log('');
    console.log('Lecture des collections :');
    const { collections, compteurs } = await collecterCollections(db);
    const totalDocuments = Object.values(compteurs).reduce((somme, n) => somme + n, 0);

    // 3. Sérialisation EJSON → GZIP → chiffrement AES-256-GCM.
    const archive = {
      format: 'rejoins-moi-backup',
      version: VERSION_FORMAT,
      creeLe: new Date().toISOString(),
      base: getMongoDbName(),
      cluster: mongoose.connection.host || 'inconnu',
      compression: 'gzip',
      chiffrement: 'aes-256-gcm',
      collections,
      compteurs,
      totalDocuments,
    };
    const json = Buffer.from(mongoose.mongo.BSON.EJSON.stringify(archive, { relaxed: true }), 'utf8');
    const compresse = gzipSync(json, { level: 9 });
    const chiffre = chiffrer(compresse, motDePasse);

    // 4. Écriture dans backups/ (à la racine du dépôt, ignoré par Git).
    mkdirSync(dossier, { recursive: true });
    const chemin = path.join(dossier, nomFichierSauvegarde());
    writeFileSync(chemin, chiffre, { mode: 0o600 });

    // 5. Contre-vérification : on relit et on déchiffre avec le mot de passe
    //    saisi. Une sauvegarde que l'on ne sait pas relire n'est pas une preuve.
    const relu = dechiffrer(readFileSync(chemin), motDePasse);
    if (!relu.equals(compresse)) {
      throw new Error('Contre-vérification échouée : le fichier relu diffère de l’original.');
    }

    console.log('');
    console.log('✅ Sauvegarde chiffrée terminée');
    console.log(`   Fichier           : ${path.relative(process.cwd(), chemin)}`);
    console.log(`   Taille sur disque : ${formaterOctets(chiffre.length)}`);
    console.log(
      `   JSON ${formaterOctets(json.length)} → GZIP ${formaterOctets(compresse.length)}` +
        ` → chiffré ${formaterOctets(chiffre.length)}`
    );
    console.log(`   Collections       : ${Object.keys(compteurs).length}`);
    console.log(`   Documents         : ${formaterNombre(totalDocuments)} au total`);
    console.log('   Contre-vérification : fichier relu et déchiffré avec succès.');
    console.log('');
    console.log('⚠ Conservez le mot de passe dans un gestionnaire de mots de passe :');
    console.log('  il n’est stocké NI dans le fichier, NI dans le dépôt.');
    console.log('  Restauration : voir docs/SAUVEGARDE.md');
  } finally {
    await disconnectDB().catch(() => {});
  }
}

/* ── Lancement (uniquement si le fichier est exécuté, pas s'il est importé) ── */

const scriptCourant = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptCourant === fileURLToPath(import.meta.url)) {
  lancer().catch((err) => {
    console.error(`\n✗ Échec de la sauvegarde : ${err.message}`);
    process.exitCode = 1;
  });
}
