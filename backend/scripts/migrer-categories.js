// migrer-categories.js — Migration des sous-catégories importées vers la taxonomie locale.
//
// Usage :
//   node scripts/migrer-categories.js            -> DRY-RUN (par défaut, n'écrit RIEN)
//   node scripts/migrer-categories.js --apply    -> écrit réellement en base
//   node scripts/migrer-categories.js --limit 50 -> limite le nombre de fiches traitées
//
// POURQUOI CE SCRIPT
// Les 6 719 fiches importées (data.gouv.ci + OpenStreetMap) portent une sous-catégorie
// « source » : Restaurant, Coiffeurs(ses), Toilettes, Nettoyage a sec… Ces libellés ne
// disent rien à un habitant d'Abidjan qui cherche « un garbadrom » ou « une clé minute ».
// Le prompt 6 introduit des familles locales (restauration, commerces, proximite,
// cultes) et des sous-catégories utiles ; ce script y RANGE les fiches existantes.
//
// CE QUE LE SCRIPT ÉCRIT — ET RIEN D'AUTRE
//   • categorie          (nouvelle famille)
//   • sousCategorie      (libellé lisible, ex. « WC publique »)
//   • sousCategorieSlug  (clé de filtre stable, ex. « wc-publique »)
// La position GPS, les tags, les photos, les horaires et l'identité du gérant ne sont
// JAMAIS touchés : une migration de vocabulaire ne doit pas déplacer un commerce sur la
// carte. Les fiches dont la sous-catégorie n'est pas dans la table sont LAISSÉES TELLES
// QUELLES et listées dans le rapport (on ne devine pas un métier).
//
// La correspondance vit dans src/config/categories.js (MIGRATION_SOUS_CATEGORIES) :
// source unique, relue par les tests, et non un mapping caché dans ce script.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, getMongoDbName } from '../src/config/db.js';
import Establishment from '../src/models/Establishment.js';
import {
  CATEGORIES_FILTRABLES,
  MIGRATION_PAR_ANCIENNE,
  normaliserTexte,
  resoudreSousCategorie,
  slugifier,
  libelleFamille,
} from '../src/config/categories.js';

const APPLY = process.argv.includes('--apply');
const LIMITE = (() => {
  const i = process.argv.indexOf('--limit');
  const n = i > -1 ? Number(process.argv[i + 1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

/** Petite barre de progression : 6 719 fiches, on veut voir que ça avance. */
let traitees = 0;
function point() {
  traitees += 1;
  if (traitees % 1000 === 0) process.stdout.write(`  … ${traitees} fiches examinées\n`);
}

const parFamille = new Map(); // famille -> nombre de fiches à déplacer
const parLigne = new Map(); // « ancienne → nouvelle » -> nombre
const nonReconnues = new Map(); // libellé inconnu -> nombre
const dejaAJour = { count: 0 };
let aMigrer = 0;
let ecrites = 0;
let slugsCompletees = 0;
const erreurs = [];

async function main() {
  await connectDB();
  console.log(`\n=== Migration des catégories — ${getMongoDbName()} ===`);
  console.log(
    APPLY
      ? '  Mode APPLY : les fiches vont être modifiées (categorie / sousCategorie / sousCategorieSlug).'
      : '  Mode DRY-RUN : aucune écriture. Relancer avec --apply pour appliquer.'
  );
  if (LIMITE) console.log(`  Limite : ${LIMITE} fiche(s).`);
  console.log('');

  const filtre = { sousCategorie: { $nin: ['', null] } };
  let requete = Establishment.find(filtre)
    .select('_id categorie sousCategorie sousCategorieSlug')
    .sort({ _id: 1 })
    .lean();
  if (LIMITE) requete = requete.limit(LIMITE);

  const fiches = await requete;
  console.log(`  ${fiches.length} fiche(s) avec une sous-catégorie à examiner.\n`);

  const operations = [];

  for (const fiche of fiches) {
    point();
    const ancienne = String(fiche.sousCategorie || '').trim();
    if (!ancienne) continue;

    const ligne = MIGRATION_PAR_ANCIENNE.get(normaliserTexte(ancienne));

    // Cas 1 : libellé source connu → nouvelle famille + libellé cible.
    // Cas 2 : libellé déjà « moderne » (ou proposé par un gérant) → on garde la famille
    //         et on se contente de remplir le slug de filtre s'il manque.
    let cible;
    if (ligne) {
      cible = { famille: ligne.famille, label: ligne.sousCategorie, slug: slugifier(ligne.sousCategorie) };
      parFamille.set(ligne.famille, (parFamille.get(ligne.famille) || 0) + 1);
      const cle = `${ancienne} → ${ligne.sousCategorie}`;
      parLigne.set(cle, (parLigne.get(cle) || 0) + 1);
    } else {
      const connue = resoudreSousCategorie(ancienne);
      if (!connue) {
        nonReconnues.set(ancienne, (nonReconnues.get(ancienne) || 0) + 1);
        continue;
      }
      cible = { famille: connue.famille, label: connue.label, slug: connue.slug };
    }

    if (!CATEGORIES_FILTRABLES.includes(cible.famille)) {
      erreurs.push(`${fiche._id} : famille « ${cible.famille} » absente de l'enum, fiche ignorée.`);
      continue;
    }

    const changement =
      fiche.categorie !== cible.famille ||
      fiche.sousCategorie !== cible.label ||
      fiche.sousCategorieSlug !== cible.slug;
    if (!changement) {
      dejaAJour.count += 1;
      continue;
    }

    aMigrer += 1;
    if (!ligne) slugsCompletees += 1;

    // $set STRICTEMENT limité aux trois champs de vocabulaire : pas de $unset, pas de
    // remplacement de document, donc aucune chance d'effacer GPS, tags ou photos.
    operations.push({
      updateOne: {
        filter: { _id: fiche._id },
        update: {
          $set: {
            categorie: cible.famille,
            sousCategorie: cible.label,
            sousCategorieSlug: cible.slug,
          },
        },
      },
    });
  }

  // ── Rapport ──────────────────────────────────────────────────────────────────
  console.log('\n--- Répartition par famille ---');
  for (const [famille, nombre] of [...parFamille.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(nombre).padStart(5)}  ${famille.padEnd(14)} ${libelleFamille(famille)}`);
  }

  console.log('\n--- Correspondances appliquées ---');
  for (const [cle, nombre] of [...parLigne.entries()].sort((a, b) => b[1] - a[1])) {
    const ligne = MIGRATION_PAR_ANCIENNE.get(normaliserTexte(cle.split(' → ')[0]));
    console.log(
      `  ${String(nombre).padStart(5)}  ${cle}${ligne?.propre ? '   (libellé conservé)' : ''}`
    );
  }

  if (nonReconnues.size) {
    console.log('\n--- Sous-catégories non reconnues (fiches laissées telles quelles) ---');
    for (const [libelle, nombre] of [...nonReconnues.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(nombre).padStart(5)}  « ${libelle} »`);
    }
    console.log(
      '  Ces libellés ne sont pas dans la table de correspondance : on ne devine pas un\n' +
        '  métier. Ajouter la ligne dans MIGRATION_SOUS_CATEGORIES puis relancer le script.'
    );
  }

  if (erreurs.length) {
    console.log('\n--- Fiches ignorées (garde-fou enum) ---');
    for (const e of erreurs.slice(0, 20)) console.log(`  ✗ ${e}`);
    if (erreurs.length > 20) console.log(`  … et ${erreurs.length - 20} autre(s).`);
  }

  console.log('\n--- Bilan ---');
  console.log(`  fiches examinées             : ${fiches.length}`);
  console.log(`  fiches à jour (rien à faire) : ${dejaAJour.count}`);
  console.log(`  fiches à modifier            : ${aMigrer}`);
  console.log(`   dont slug de filtre seul    : ${slugsCompletees}`);

  if (!APPLY) {
    console.log('\n  DRY-RUN terminé : AUCUNE écriture. Relancer avec --apply pour appliquer.');
    return;
  }

  // ── Écriture par lots ────────────────────────────────────────────────────────
  const TAILLE_LOT = 500;
  for (let i = 0; i < operations.length; i += TAILLE_LOT) {
    const lot = operations.slice(i, i + TAILLE_LOT);
    const resultat = await Establishment.bulkWrite(lot, { ordered: false });
    ecrites += resultat.modifiedCount || 0;
    console.log(`  lot écrit : ${ecrites}/${operations.length}`);
  }
  console.log(`\n  APPLY terminé : ${ecrites} fiche(s) modifiée(s).`);
}

main()
  .catch((err) => {
    console.error('\n✗ Migration interrompue :', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });

