// mesurer-capacite.js — LECTURE SEULE : combien de fiches tiennent dans les 512 Mo du
// cluster Atlas gratuit (M0), avec le plafond photo de 300 Ko décidé au bloc F.
//
// Pourquoi ce script existe : la capacité de l'application est décidée par DEUX
// chiffres qui doivent rester alignés — le plafond de poids d'une photo (client et
// serveur) et l'espace restant sur le cluster. Ce script les mesure réellement, au
// lieu de les estimer à vue. Il n'écrit RIEN : uniquement countDocuments / find /
// collStats / dbStats.
//
// Lancement (depuis /backend) : npm run mesurer:capacite

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, getMongoDbName } from '../src/config/db.js';
import Establishment from '../src/models/Establishment.js';

const MO = 1024 * 1024;
const PLAFOND_CLUSTER_MO = 512; // offre gratuite Atlas M0
const PLAFOND_PHOTO_OCTETS = 300 * 1024; // plafond client du bloc F

function titre(t) {
  console.log(`\n=== ${t} ===`);
}

/** Taille réelle d'un document une fois stocké en BSON. */
async function tailleBson(doc) {
  try {
    const { BSON } = await import('bson');
    return BSON.serialize(doc).byteLength;
  } catch {
    return Buffer.byteLength(JSON.stringify(doc), 'utf8');
  }
}

/** Une photo au plafond client, telle qu'elle part dans le JSON (data-URI base64). */
function photosAuPlafond() {
  const base64 = Math.ceil(PLAFOND_PHOTO_OCTETS / 3) * 4;
  const entete = 'data:image/jpeg;base64,'.length;
  return { base64, longueurDataUri: base64 + entete };
}

async function principal() {
  const ok = await connectDB({ reessais: false, silencieux: true });
  if (!ok) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exitCode = 1;
    return;
  }
  const db = mongoose.connection.db;
  console.log(`Base : ${getMongoDbName()} | hôte : ${mongoose.connection.host}`);

  const stats = await db.command({ dbStats: 1 });
  const collEtab = await db.command({ collStats: 'establishments' }).catch(() => null);
  const totalFiches = await Establishment.countDocuments({});
  const { base64, longueurDataUri } = photosAuPlafond();

  titre('Espace occupé aujourd’hui');
  console.log(
    `dbStats : dataSize=${(stats.dataSize / MO).toFixed(2)} Mo | storageSize=${(stats.storageSize / MO).toFixed(2)} Mo | ` +
      `indexSize=${(stats.indexSize / MO).toFixed(2)} Mo | collections=${stats.collections} | objets=${stats.objects}`
  );
  console.log(
    `establishments : ${totalFiches} fiches | avgObjSize=${collEtab ? (collEtab.avgObjSize / 1024).toFixed(2) : '?'} Ko | ` +
      `taille=${collEtab ? (collEtab.size / MO).toFixed(2) : '?'} Mo | index=${collEtab ? (collEtab.totalIndexSize / MO).toFixed(2) : '?'} Mo`
  );

  titre('Poids d’une fiche réelle, avec et sans photos');
  const temoin = (await Establishment.findOne({}).lean()) || {};
  const sansPhotos = { ...temoin };
  delete sansPhotos.photoDevanture;
  delete sansPhotos.photoVendeur;
  const tailleSans = await tailleBson(sansPhotos);
  const tailleAvec = await tailleBson({
    ...sansPhotos,
    photoDevanture: 'X'.repeat(longueurDataUri),
    photoVendeur: 'Y'.repeat(longueurDataUri),
  });

  console.log(`Une photo au plafond client (300 Ko) = ${base64} octets de base64 (+ en-tête) -> ${longueurDataUri} caractères`);
  console.log(`Fiche témoin (${String(temoin?.nom || '').slice(0, 40)}) sans photo : ${tailleSans} octets (${(tailleSans / 1024).toFixed(1)} Ko)`);
  console.log(`La même avec DEUX photos au plafond : ${tailleAvec} octets (${(tailleAvec / 1024).toFixed(1)} Ko)`);

  titre(`Capacité du cluster gratuit (${PLAFOND_CLUSTER_MO} Mo)`);
  const moyOctets = collEtab?.avgObjSize || tailleSans;
  const utilise = (stats.dataSize || 0) + (stats.indexSize || 0);
  const reste = PLAFOND_CLUSTER_MO * MO - utilise;
  console.log(
    `Occupé aujourd'hui (données + index de la base) : ${(utilise / MO).toFixed(2)} Mo -> reste ≈ ${(reste / MO).toFixed(1)} Mo`
  );
  console.log(`  • fiches AVEC 2 photos au plafond : ${Math.floor(reste / tailleAvec)}`);
  console.log(`  • fiches SANS photo (fiches importées) : ${Math.floor(reste / moyOctets)}`);
  console.log(`  • fiches à 2 photos, cluster entièrement vide : ${Math.floor((PLAFOND_CLUSTER_MO * MO) / tailleAvec)}`);
  console.log(
    `Repère utile : si TOUTES les ${totalFiches} fiches actuelles passaient à 2 photos, elles occuperaient ${(
      (totalFiches * tailleAvec) /
      MO
    ).toFixed(1)} Mo.`
  );

  await mongoose.disconnect().catch(() => {});
}

principal().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
});
