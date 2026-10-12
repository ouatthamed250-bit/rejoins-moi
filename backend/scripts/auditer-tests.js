// auditer-tests.js — LECTURE SEULE : quelles données de production ressemblent à des tests ?
//
// Ce script ne supprime RIEN. Il liste, avec leur numéro et leur date, ce qui a l'air
// d'un artefact d'essai — comptes, fiches, annonces, dépôts — pour décider au cas par
// cas. Il liste AUSSI ce qui doit être préservé (le compte administrateur réel et le
// dépôt existant), afin qu'aucune suppression ne puisse les viser par erreur.
//
// Usage (depuis /backend) :
//   node scripts/auditer-tests.js            -> liste les suspects + comptage global
//   node scripts/auditer-tests.js --tout     -> liste AUSSI tous les comptes/fiches
//
// Rejouable après un nettoyage : c'est le moyen de vérifier que « le reste est intact »
// (les comptages du bas doivent rester stables, hors éléments supprimés).

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, getMongoDbName } from '../src/config/db.js';
import User from '../src/models/User.js';
import Establishment from '../src/models/Establishment.js';
import Job from '../src/models/Job.js';
import Depot from '../src/models/Depot.js';
import HealthFacility from '../src/models/HealthFacility.js';
import Subscription from '../src/models/Subscription.js';
import CompteurJournalier from '../src/models/CompteurJournalier.js';

const TOUT = process.argv.includes('--tout');

/** Numéro du compte administrateur RÉEL : hors liste, jamais proposé à la suppression. */
const TELEPHONE_ADMIN_REEL = '+225102030405';

const date = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—');
const chiffres = (v) => String(v || '').replace(/\D/g, '');

/** Motifs qui, dans un NOM ou un TITRE, trahissent un essai. */
const MOTIFS = [
  /test/i,
  /v[ée]rification/i,
  /zz[- _]?test/i,
  /hhh/i,
  /\bsuivi\b/i,
  /d[ée]mo/i,
  /exemple/i,
  /temporaire/i,
  /[àa] supprimer/i,
  /essai/i,
];

/** Numéros d'essai connus : bloc 0700000000-0700000099 et les numéros cités comme tels. */
function telephoneDEssai(telephone) {
  const d = chiffres(telephone).replace(/^225/, '').replace(/^0/, '');
  if (/^7\d{8}$/.test(d) || /^0?\d{9}$/.test(d)) {
    // 0700000000 -> 700000000 (bloc d'essai historique)
    if (/^7000000\d\d$/.test(d)) return true;
  }
  const local = chiffres(telephone);
  return ['0707987654', '0707123456', '0700000000'].includes(local);
}

/** Pourquoi cet élément est-il suspect ? (liste de raisons, vide = rien de suspect) */
function raisonsDe(nom, telephone) {
  const raisons = [];
  const texte = String(nom || '');
  for (const motif of MOTIFS) if (motif.test(texte)) raisons.push(`nom/titre « ${texte.trim()} »`);
  if (telephone && telephoneDEssai(telephone)) raisons.push(`numéro d'essai ${telephone}`);
  return [...new Set(raisons)];
}

function titre(t) {
  console.log(`\n=== ${t} ===`);
}
async function principal() {
  const ok = await connectDB({ reessais: false, silencieux: true });
  if (!ok) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exitCode = 1;
    return;
  }
  console.log(`Base : ${getMongoDbName()} | hôte : ${mongoose.connection.host}`);
  console.log('MODE LECTURE SEULE : aucune suppression, aucune écriture.');

  const [utilisateurs, fiches, annonces, depots, sante, abonnements, compteurs] = await Promise.all([
    User.find({}).select('nom prenom telephone metier estAdmin statutCompte createdAt dernierLoginAt email').sort({ createdAt: 1 }).lean(),
    Establishment.find({}).select('nom categorie commune quartier telephone estImporte createdAt createdByUserId').lean(),
    Job.find({}).select('intitule metier typeAnnonce telephoneContact createdAt createdByUserId statut').lean(),
    Depot.find({}).select('montant operateur telephonePayeur reference statut createdAt userId jobId').lean(),
    HealthFacility.countDocuments({}),
    Subscription.countDocuments({}),
    CompteurJournalier.countDocuments({}),
  ]);

  titre('COMPTAGE GLOBAL (à comparer après un éventuel nettoyage)');
  console.log(
    `comptes=${utilisateurs.length} | fiches=${fiches.length} (importées=${fiches.filter((f) => f.estImporte !== false).length}, ` +
      `non importées=${fiches.filter((f) => f.estImporte === false).length}) | annonces=${annonces.length} | ` +
      `dépôts=${depots.length} | santé=${sante} | abonnements=${abonnements} | compteurs journaliers=${compteurs}`
  );

  // ── 1. Comptes ──
  titre('1. COMPTES — suspects');
  const comptesSuspects = utilisateurs.filter((u) => {
    const raisons = raisonsDe(`${u.nom || ''} ${u.prenom || ''}`, u.telephone);
    return raisons.length > 0;
  });
  const horsListe = utilisateurs.filter(
    (u) => u.estAdmin || chiffres(u.telephone) === chiffres(TELEPHONE_ADMIN_REEL)
  );
  for (const u of comptesSuspects) {
    const raisons = raisonsDe(`${u.nom || ''} ${u.prenom || ''}`, u.telephone);
    console.log(
      `  ⚠ ${String(u._id)} | ${u.nom || ''} ${u.prenom || ''} | ${u.telephone || '—'} | métier : ${u.metier || '—'} | ` +
        `créé : ${date(u.createdAt)} | dernier login : ${date(u.dernierLoginAt)} | motif : ${raisons.join(' + ')}`
    );
  }
  if (comptesSuspects.length === 0) console.log('  (aucun)');

  titre('1bis. COMPTES — hors liste (administrateurs réels, à NE PAS toucher)');
  for (const u of horsListe) {
    console.log(`  🔒 ${String(u._id)} | ${u.nom || ''} ${u.prenom || ''} | ${u.telephone} | admin : ${Boolean(u.estAdmin)} | créé : ${date(u.createdAt)}`);
  }
  if (horsListe.length === 0) console.log('  (aucun compte administrateur)');

  if (TOUT) {
    titre('1ter. TOUS les comptes (--tout)');
    for (const u of utilisateurs) {
      console.log(
        `  - ${String(u._id)} | ${u.nom || ''} ${u.prenom || ''} | ${u.telephone || '—'} | admin : ${Boolean(u.estAdmin)} | ` +
          `statut : ${u.statutCompte || 'actif'} | créé : ${date(u.createdAt)}`
      );
    }
  }

  // ── 2. Fiches ──
  titre('2. FICHES — non importées (estImporte=false) : créées par un humain ou un script');
  const nonImportees = fiches.filter((f) => f.estImporte === false);
  for (const f of nonImportees) {
    const raisons = raisonsDe(f.nom, f.telephone);
    console.log(
      `  ${raisons.length ? '⚠' : '·'} ${String(f._id)} | « ${f.nom} » | ${f.categorie || '—'} | ${f.commune || '—'} ${f.quartier || ''} | ` +
        `tél : ${f.telephone || '—'} | créée : ${date(f.createdAt)} | auteur : ${f.createdByUserId ? String(f.createdByUserId) : '—'}` +
        (raisons.length ? ` | motif : ${raisons.join(' + ')}` : '')
    );
  }
  if (nonImportees.length === 0) console.log('  (aucune)');

  titre('2bis. FICHES — importées dont le nom évoque un essai (à examiner)');
  const fichesSuspectes = fiches.filter((f) => f.estImporte !== false && raisonsDe(f.nom, f.telephone).length > 0);
  for (const f of fichesSuspectes) {
    console.log(
      `  ⚠ « ${f.nom} » | ${f.categorie || '—'} | ${f.commune || '—'} | tél : ${f.telephone || '—'} | créée : ${date(f.createdAt)} | ` +
        `motif : ${raisonsDe(f.nom, f.telephone).join(' + ')}`
    );
  }
  if (fichesSuspectes.length === 0) console.log('  (aucune)');

  // ── 3. Annonces ──
  titre('3. ANNONCES (jobs) — suspects');
  const annoncesSuspectes = annonces.filter((j) => raisonsDe(`${j.intitule || ''} ${j.metier || ''}`, j.telephoneContact).length > 0);
  for (const j of annoncesSuspectes) {
    console.log(
      `  ⚠ ${String(j._id)} | « ${j.intitule || j.metier || '—'} » | ${j.typeAnnonce || '—'} | tél : ${j.telephoneContact || '—'} | ` +
        `créée : ${date(j.createdAt)} | auteur : ${j.createdByUserId ? String(j.createdByUserId) : '—'} | statut : ${j.statut || '—'} | ` +
        `motif : ${raisonsDe(`${j.intitule || ''} ${j.metier || ''}`, j.telephoneContact).join(' + ')}`
    );
  }
  if (annoncesSuspectes.length === 0) console.log('  (aucune)');
  if (TOUT) {
    titre('3bis. TOUTES les annonces (--tout)');
    for (const j of annonces) {
      console.log(
        `  - ${String(j._id)} | « ${j.intitule || j.metier || '—'} » | ${j.typeAnnonce || '—'} | tél : ${j.telephoneContact || '—'} | ` +
          `créée : ${date(j.createdAt)} | statut : ${j.statut || '—'}`
      );
    }
  }

  // ── 4. Dépôts ──
  titre('4. DÉPÔTS — suspects (le dépôt existant est signalé à part)');
  const depotsSuspects = depots.filter((d) => raisonsDe(d.reference, d.telephonePayeur).length > 0);
  for (const d of depotsSuspects) {
    console.log(
      `  ⚠ ${String(d._id)} | ${d.montant} FCFA | ${d.operateur} | payeur : ${d.telephonePayeur || '—'} | réf : ${d.reference || '—'} | ` +
        `statut : ${d.statut} | créé : ${date(d.createdAt)} | motif : ${raisonsDe(d.reference, d.telephonePayeur).join(' + ')}`
    );
  }
  if (depotsSuspects.length === 0) console.log('  (aucun)');
  titre('4bis. DÉPÔTS — hors liste (à NE PAS toucher)');
  const depotsHorsListe = depots.filter((d) => raisonsDe(d.reference, d.telephonePayeur).length === 0);
  for (const d of depotsHorsListe) {
    console.log(
      `  🔒 ${String(d._id)} | ${d.montant} FCFA | ${d.operateur} | payeur : ${d.telephonePayeur || '—'} | réf : ${d.reference || '—'} | ` +
        `statut : ${d.statut} | créé : ${date(d.createdAt)}`
    );
  }
  if (depotsHorsListe.length === 0) console.log('  (aucun)');

  // ── 5. Récapitulatif ──
  titre('RÉCAPITULATIF (RIEN n’a été supprimé)');
  console.log(
    `  suspects : ${comptesSuspects.length} compte(s), ${nonImportees.length} fiche(s) non importée(s), ` +
      `${fichesSuspectes.length} fiche(s) importée(s) au nom douteux, ${annoncesSuspectes.length} annonce(s), ${depotsSuspects.length} dépôt(s)`
  );
  console.log('  En attente de la décision, élément par élément. Relancer ce script après nettoyage pour prouver que le reste est intact.');
  console.log('');

  await mongoose.disconnect().catch(() => {});
}

principal().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
});
