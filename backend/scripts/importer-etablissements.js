// importer-etablissements.js — Import de la base publique pré-remplie dans MongoDB.
//
// Contexte : la base « petits commerces / hôtels & restauration d'Abidjan »
// (data.gouv.ci + OpenStreetMap) a été nettoyée hors de ce dépôt et livrée dans
// backend/data/etablissements_seed.json, au format du modèle Establishment.
//
// Pourquoi des LOTS et pas un `insertOne` par fiche : sur un cluster Atlas M0
// (gratuit, débit et connexions limités), 6 719 insertions unitaires saturent la
// connexion et prennent des heures depuis une connexion mobile. On écrit donc par
// paquets de 500 avec une pause entre chaque (`insertMany` + `ordered: false`),
// ce qui laisse Mongo respirer et rend l'import interruptible sans casse.
//
// Usage (depuis /backend) :
//   npm run importer:etablissements -- --simulation   → contrôle tout, n'écrit RIEN
//   npm run importer:etablissements                   → import réel
//   npm run importer:etablissements -- --remplacer    → supprime les fiches
//                                                       importées puis réimporte
//   npm run importer:etablissements -- --ajouter      → accepte les doublons
//   npm run importer:etablissements -- --lot=250 --pause=600
//
// Options : --fichier=<chemin> --lot=<n> (défaut 500) --pause=<ms> (défaut 250)
//
// Garde-fou volontaire : sans `--remplacer` ni `--ajouter`, le script REFUSE de
// tourner si la base contient déjà des fiches `estImporte: true`. Une exécution
// distraite ne peut donc pas dupliquer 6 719 fiches.
//
// Normalisations appliquées à la source (sinon le schéma rejetterait tout) :
//   • `categorie` est un LIBELLÉ (« Beauté ») → converti en slug ('beaute'),
//     seule valeur acceptée par l'enum du modèle ;
//   • `tags` ne contient qu'une sous-catégorie (minimum de 3 exigé pour une fiche
//     créée dans l'app, tolérance pour les fiches importées — voir le modèle) ;
//   • `ville`/`rue` → `commune`/`adresse` (colonnes du modèle) ;
//   • `slugRecherche` recalculé s'il manque ; notes/avis/compteurs remis à zéro
//     (on n'importe jamais un avis ou une note inventés) ;
//   • `position` (point GeoJSON) dérivé de `localisation` : `insertMany` ne
//     déclenche pas les hooks du modèle, l'index 2dsphere ne verrait sinon
//     aucune des 6 719 fiches importées.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import Establishment from '../src/models/Establishment.js';
import { sanitizeTags } from '../src/utils/validators.js';
import { connectDB, disconnectDB, getMongoDbName, getMongoUri, masquerUri } from '../src/config/db.js';

// `.env` du dossier backend, quel que soit le dossier d'où la commande est lancée :
// une URI de production ne doit pas être cherchée au petit bonheur par dotenv.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

/* ── Options de ligne de commande ─────────────────────────────────────────── */
const ARGS = process.argv.slice(2);
const valeurOption = (nom) => {
  const prefixe = `--${nom}=`;
  const trouve = ARGS.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : null;
};
const drapeau = (nom) => ARGS.includes(`--${nom}`);

const FICHIER = valeurOption('fichier') || fileURLToPath(new URL('../data/etablissements_seed.json', import.meta.url));
const TAILLE_LOT = Math.max(50, Number(valeurOption('lot')) || 500);
// Attention : `Number(null)` vaut 0 et passerait un simple `isFinite`. On teste donc
// explicitement l'absence d'option, sinon la pause par défaut serait de 0 ms — et
// 14 `insertMany` collés matraqueraient le cluster M0.
const pauseDemandee = valeurOption('pause');
const PAUSE_MS = pauseDemandee === null || pauseDemandee === '' ? 250 : Math.max(0, Number(pauseDemandee) || 0);
const SIMULATION = drapeau('simulation');
const REMPLACER = drapeau('remplacer');
const AJOUTER = drapeau('ajouter');
const ESSAIS_MAX = 4;
const SOURCE_DEFAUT = 'Base publique pré-remplie (data.gouv.ci / OSM)';

/* ── Correspondance libellé de la source → slug du modèle ─────────────────── */
const SLUG_PAR_LIBELLE = {
  alimentation: 'alimentation',
  beaute: 'beaute',
  services: 'services',
  artisanat: 'artisanat',
  commerce: 'commerce',
  sante: 'sante',
  spiritualite: 'spiritualite',
  autre: 'autre',
};

/* ── Petits utilitaires de nettoyage ─────────────────────────────────────── */
const texte = (v) => (v == null ? '' : String(v).trim());
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sansAccents = (txt) => String(txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** « Chez Fatou Services » → « chez-fatou-services » (clé de recherche). */
function slugifier(txt) {
  return sansAccents(txt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Transforme une fiche de la source en document conforme au modèle Establishment.
 * @returns {{doc?: object, rejet?: string}}
 */
function normaliser(brut) {
  const nom = texte(brut?.nom);
  if (!nom) return { rejet: 'nom vide' };

  const lat = Number(brut?.localisation?.lat);
  const lng = Number(brut?.localisation?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { rejet: 'localisation invalide' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { rejet: 'coordonnées hors bornes' };

  const cleCategorie = sansAccents(texte(brut.categorie)).toLowerCase().replace(/[^a-z]/g, '');
  const categorie = SLUG_PAR_LIBELLE[cleCategorie] || 'autre';
  const sousCategorie = texte(brut.sousCategorie).slice(0, 60);
  // La source ne fournit qu'un tag ; s'il manque, la sous-catégorie prend le relais
  // (une fiche importée sans aucun tag serait refusée par le modèle).
  const tags = sanitizeTags(brut.tags);
  if (!tags.length && sousCategorie) tags.push(sousCategorie);

  const telephone = texte(brut.telephone);

  return {
    doc: {
      nom,
      categorie,
      sousCategorie,
      description: texte(brut.description).slice(0, 500),
      photoDevanture: texte(brut.photoDevanture),
      photoVendeur: texte(brut.photoVendeur),
      tags,
      localisation: { lat, lng },
      // Miroir GeoJSON attendu par l'index 2dsphere (voir le modèle) : `insertMany`
      // ne déclenche AUCUN hook `pre('validate')`, donc le point doit être écrit
      // ici — sinon les fiches importées seraient absentes du tri par proximité.
      position: { type: 'Point', coordinates: [lng, lat] },
      commune: texte(brut.commune || brut.ville).slice(0, 80),
      quartier: texte(brut.quartier).slice(0, 80),
      adresse: texte(brut.adresse || brut.rue).slice(0, 160),
      texteBoutonAction: texte(brut.texteBoutonAction) || `Aller chez ${nom}`,
      telephone,
      whatsapp: texte(brut.whatsapp) || telephone,
      horaires: texte(brut.horaires).slice(0, 120),
      // Avis, notes et compteurs de la source ne sont JAMAIS repris : un avis ou une
      // note inventés fausseraient le classement et la confiance des clients.
      noteMoyenne: 0,
      nombreAvis: 0,
      avis: [],
      compteurVisites: 0,
      compteurUtilisateurs: 0,
      verifie: false,
      estImporte: true,
      reclame: false,
      telephoneAVerifier: texte(brut.telephoneAVerifier).slice(0, 40),
      slugRecherche: texte(brut.slugRecherche) || slugifier(nom),
      sourceImport: texte(brut.sourceImport) || SOURCE_DEFAUT,
    },
  };
}

/* ── Écriture par lots ───────────────────────────────────────────────────── */

/**
 * Écrit un lot en une seule requête.
 *
 * `ordered: false` : si un document du lot est refusé, Mongo écrit quand même les
 * autres et renvoie la liste des échecs, au lieu de tout annuler — un import de
 * plusieurs milliers de fiches ne doit jamais être perdu pour une ligne douteuse.
 *
 * Sur erreur réseau (Atlas M0 qui se met en veille, 4G qui saute en tournée), on
 * réessaie avec un délai doublé au lieu d'abandonner l'import.
 */
async function insererLot(lot, numero, totalLots) {
  for (let essai = 1; essai <= ESSAIS_MAX; essai += 1) {
    try {
      const ecrits = await Establishment.insertMany(lot, { ordered: false });
      return { inseres: ecrits.length, echecs: [] };
    } catch (err) {
      const erreursEcriture = err?.writeErrors;
      if (Array.isArray(erreursEcriture) && erreursEcriture.length) {
        const inseres = Array.isArray(err.insertedDocs) ? err.insertedDocs.length : lot.length - erreursEcriture.length;
        return {
          inseres,
          echecs: erreursEcriture.map((e) => `fiche ${e.index} : ${e.errmsg || e.message || 'refusée'}`),
        };
      }
      if (essai === ESSAIS_MAX) throw err;
      const delai = 1000 * 2 ** (essai - 1);
      console.warn(`  lot ${numero}/${totalLots} : ${err.message} → nouvel essai dans ${delai / 1000} s`);
      await attendre(delai);
    }
  }
  return { inseres: 0, echecs: ['échec sans détail'] };
}

/* ── Programme principal ─────────────────────────────────────────────────── */

async function main() {
  console.log('=== Import des établissements pré-remplis ===');
  console.log(`Fichier : ${FICHIER}`);
  console.log(`Mode    : ${SIMULATION ? 'SIMULATION (aucune écriture)' : REMPLACER ? 'IMPORT avec remplacement' : 'IMPORT'}`);
  console.log(`Lots    : ${TAILLE_LOT} fiches, pause ${PAUSE_MS} ms\n`);

  // 1. Lecture, normalisation et contrôle contre le schéma Mongoose — sans écrire.
  const brut = JSON.parse(readFileSync(FICHIER, 'utf8'));
  const liste = Array.isArray(brut) ? brut : brut.etablissements || brut.items || brut.data;
  if (!Array.isArray(liste)) {
    throw new Error('Format inattendu : le JSON doit être un tableau (ou avoir une clé « etablissements »).');
  }
  console.log(`${liste.length} fiche(s) lue(s) dans le fichier.`);

  const documents = [];
  const rejets = [];
  const parCategorie = {};
  const parNombreDeTags = {};

  for (const fiche of liste) {
    const { doc, rejet } = normaliser(fiche);
    if (rejet) {
      rejets.push({ nom: texte(fiche?.nom), motif: rejet });
      continue;
    }
    const erreur = new Establishment(doc).validateSync();
    if (erreur) {
      rejets.push({ nom: doc.nom, motif: Object.values(erreur.errors).map((e) => e.message).join(' ; ') });
      continue;
    }
    parCategorie[doc.categorie] = (parCategorie[doc.categorie] || 0) + 1;
    parNombreDeTags[doc.tags.length] = (parNombreDeTags[doc.tags.length] || 0) + 1;
    documents.push(doc);
  }

  console.log(`  ${documents.length} document(s) valide(s) pour le modèle, ${rejets.length} rejeté(s).`);
  console.log('  catégories     :', parCategorie);
  console.log('  tags par fiche :', parNombreDeTags);
  for (const r of rejets.slice(0, 10)) console.log(`  ✗ ${r.nom || '(sans nom)'} : ${r.motif}`);
  if (rejets.length > 10) console.log(`  … et ${rejets.length - 10} autre(s) rejet(s).`);

  if (!documents.length) throw new Error('Aucun document valide : rien à importer (vérifiez le fichier source).');
  if (SIMULATION) {
    console.log('\nSimulation terminée : rien n’a été écrit en base.');
    return;
  }

  // 2. Connexion. On refuse de tourner sans MONGODB_URI explicite : l'import vise la
  //    base de production, il ne doit pas partir sur un MongoDB local par défaut
  //    à cause d'un `.env` manquant.
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI est absent : renseignez backend/.env (URI Atlas de production) avant un import réel.');
  }
  const connecte = await connectDB({ reessais: false });
  if (!connecte) throw new Error('Connexion MongoDB impossible — voir les pistes ci-dessus.');
  console.log(`\nBase visée : « ${getMongoDbName()} » via ${masquerUri(getMongoUri())}`);

  // 3. Garde-fou anti-doublons.
  const totalAvant = await Establishment.countDocuments({});
  const importesAvant = await Establishment.countDocuments({ estImporte: true });
  console.log(`Avant import : ${totalAvant} fiche(s) au total, dont ${importesAvant} importée(s).`);

  if (importesAvant > 0 && !REMPLACER && !AJOUTER) {
    throw new Error(
      `${importesAvant} fiche(s) « estImporte » sont déjà en base : relancez avec --remplacer (supprime puis ` +
        'réimporte) ou --ajouter (doublons assumés).'
    );
  }
  if (REMPLACER && importesAvant > 0) {
    const supprimees = await Establishment.deleteMany({ estImporte: true });
    console.log(`${supprimees.deletedCount} ancienne(s) fiche(s) importée(s) supprimée(s) avant réimport.`);
  }

  // 4. Insertion par lots, avec une pause entre chaque pour laisser respirer Atlas M0.
  const totalLots = Math.ceil(documents.length / TAILLE_LOT);
  const debut = Date.now();
  let inseres = 0;
  const echecs = [];

  for (let index = 0; index < documents.length; index += TAILLE_LOT) {
    const numero = Math.floor(index / TAILLE_LOT) + 1;
    const lot = documents.slice(index, index + TAILLE_LOT);
    const { inseres: ecrits, echecs: refuses } = await insererLot(lot, numero, totalLots);
    inseres += ecrits;
    echecs.push(...refuses);
    console.log(
      `  lot ${numero}/${totalLots} : ${ecrits}/${lot.length} fiche(s) écrite(s)` +
        (refuses.length ? ` — ${refuses.length} refus` : '')
    );
    if (index + TAILLE_LOT < documents.length) await attendre(PAUSE_MS);
  }

  // 5. Contrôle final : on ne se contente pas du compteur du script, on RÉINTERROGE
  //    la base — c'est la seule preuve que les documents y sont réellement.
  const totalApres = await Establishment.countDocuments({});
  const importesApres = await Establishment.countDocuments({ estImporte: true });
  const attendu = REMPLACER ? documents.length : importesAvant + documents.length;
  const duree = Math.round((Date.now() - debut) / 1000);

  console.log('\n=== Résultat ===');
  console.log(`Fiches écrites par ce script   : ${inseres}`);
  console.log(`Fiches « estImporte » en base  : ${importesApres}`);
  console.log(`Total collection establishments: ${totalApres}`);
  console.log(`Durée                          : ${duree} s (${totalLots} lot(s) de ${TAILLE_LOT})`);
  if (echecs.length) {
    console.log(`\n${echecs.length} fiche(s) refusée(s) :`);
    for (const e of echecs.slice(0, 10)) console.log(`  ✗ ${e}`);
  }

  if (importesApres !== attendu) {
    throw new Error(
      `Contrôle final incohérent : ${importesApres} fiche(s) importée(s) en base, ${attendu} attendue(s).`
    );
  }
  console.log(
    `\n✓ Import terminé : ${documents.length} fiche(s) pré-remplie(s) présente(s) dans la collection establishments.`
  );
}

/* ── Lancement ───────────────────────────────────────────────────────────── */

main()
  .catch((err) => {
    console.error(`\n✗ Échec de l’import : ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Déconnexion indispensable : sans elle, le script reste accroché à Atlas.
    await disconnectDB().catch(() => {});
  });
