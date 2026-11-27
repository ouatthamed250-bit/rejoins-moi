// audit-comptes.js — AUDIT (lecture seule) de TOUS les comptes de la base.
//
// Répond à une seule question : « qui sont ces ~30 comptes que je ne reconnais pas,
// et quelles données leur sont rattachées ? » Aucun document n'est modifié ni
// supprimé : uniquement des `find` et des `aggregate` en lecture.
//
// CE QU'IL AFFICHE
//   1. Le tableau COMPLET des comptes (aucune exception) : _id, nom, prénom,
//      téléphone, date de création, `test`, `estAdmin`, et le nombre d'annonces,
//      de fiches, d'avis, de messages (plus abonnements / dépôts / demandes de
//      revendication, qui sont les données à nettoyer si un compte part).
//   2. Groupe A — comptes déjà marqués `test: true`.
//   3. Groupe B — nom contenant Test / Chat / Beta / Alpha / PENTEST / ZZ- /
//      Compteur, ou téléphone dans le bloc d'essai des scripts
//      (07 00 00 00 01 … 07 00 00 00 99, stocké +2257000000xx).
//   4. Groupe C — comptes SANS activité (0 annonce, 0 message, 0 fiche) créés
//      dans les N derniers jours (30 par défaut).
//   5. Ce qui reste : les comptes qui ressemblent à de VRAIS utilisateurs, à
//      préserver, et la répartition des créations par jour (pour repérer les
//      lots créés par un même script).
//
// MOTS DE PASSE : le champ `motDePasseHash` est déclaré `select: false` dans le
// modèle — il n'est JAMAIS lu par ce script, donc jamais affiché. Aucune requête
// ci-dessous ne demande `+motDePasseHash`.
//
// Usage (depuis /backend) :
//   node scripts/audit-comptes.js                 -> audit complet (30 derniers jours)
//   node scripts/audit-comptes.js --jours=90      -> fenêtre « récent » de 90 jours
//   node scripts/audit-comptes.js --csv=audit.csv -> écrit AUSSI un CSV (facultatif)

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

import { connectDB, getMongoDbName } from '../src/config/db.js';
import User from '../src/models/User.js';
import Establishment from '../src/models/Establishment.js';
import Job from '../src/models/Job.js';
import Message from '../src/models/Message.js';
import Conversation from '../src/models/Conversation.js';
import Subscription from '../src/models/Subscription.js';
import Depot from '../src/models/Depot.js';
import DemandeRevendication from '../src/models/DemandeRevendication.js';

// ── Options ──────────────────────────────────────────────────────────────────
const argument = (nom, defaut = null) => {
  const trouve = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : defaut;
};
const JOURS = Math.max(1, Number(argument('jours', 30)) || 30);
const FICHIER_CSV = argument('csv', null);
const JOUR_MS = 86400000;

// ── Petits utilitaires d'affichage ───────────────────────────────────────────
const dateCourte = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');
const chiffres = (v) => String(v || '').replace(/\D/g, '');
const tronquer = (v, n) => {
  const s = String(v ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const cellule = (v, n) => tronquer(v, n).padEnd(n);
const nombre = (n) => String(n ?? 0).padStart(4);
const oui = (b) => (b ? ' oui' : '  — ');

/** Nom complet lisible (« Prénom NOM »), jamais vide. */
const nomComplet = (u) =>
  [u.prenom, u.nom].map((v) => String(v || '').trim()).filter(Boolean).join(' ') || '(sans nom)';

/**
 * Un motif « nom » est cherché dans le nom ET le prénom, sans tenir compte de la
 * casse. On renvoie la LISTE des motifs trouvés (pour expliquer chaque alerte).
 */
const MOTIFS_NOM = [
  { cle: 'Test', motif: /test/i },
  { cle: 'Chat', motif: /chat/i },
  { cle: 'Beta', motif: /beta/i },
  { cle: 'Alpha', motif: /alpha/i },
  { cle: 'PENTEST', motif: /pentest/i },
  { cle: 'ZZ-', motif: /zz[\s_-]?/i },
  { cle: 'Compteur', motif: /compteur/i },
  { cle: 'Vérification', motif: /v[ée]rification/i },
  { cle: 'Suivi', motif: /\bsuivi\b/i },
  { cle: 'Demo', motif: /d[ée]mo/i },
  { cle: 'Exemple', motif: /exemple/i },
];

const motifsDuNom = (u) => {
  const texte = `${u.nom || ''} ${u.prenom || ''}`;
  return MOTIFS_NOM.filter(({ motif }) => motif.test(texte)).map(({ cle }) => cle);
};

/**
 * Numéros d'essai : bloc réservé des scripts 07 00 00 00 01 … 07 00 00 00 99.
 * En base, le zéro de tête est retiré : 0700000003 -> « +225700000003 ».
 * `chiffres()` retire le « + » et les séparateurs.
 */
const blocTelephoneEssai = (telephone) => {
  const d = chiffres(telephone);
  if (!d) return null;
  if (/^2250?7000000\d{2}$/.test(d) || /^0?7000000\d{2}$/.test(d)) {
    return '+225 07 00 00 0x (bloc réservé des scripts)';
  }
  if (d.startsWith('2250000')) return '+225 00 00 00… (ancien bloc technique)';
  return null;
};

// ── Comptages groupés (une requête par type, pas une par compte) ─────────────
/** Map { idUtilisateur -> nombre } pour un champ simple. */
async function compterParChamp(Modele, champ) {
  const lignes = await Modele.aggregate([
    { $match: { [champ]: { $ne: null } } },
    { $group: { _id: `$${champ}`, n: { $sum: 1 } } },
  ]);
  return new Map(lignes.map((l) => [String(l._id), l.n]));
}

/** Map { idUtilisateur -> nombre } pour un tableau imbriqué (avis, participants). */
async function compterDansTableau(Modele, tableau, champ) {
  const lignes = await Modele.aggregate([
    { $unwind: `$${tableau}` },
    { $match: { [`${tableau}.${champ}`]: { $ne: null } } },
    { $group: { _id: `$${tableau}.${champ}`, n: { $sum: 1 } } },
  ]);
  return new Map(lignes.map((l) => [String(l._id), l.n]));
}

/** Conversations : `participants` est un tableau d'ObjectId (pas de sous-document). */
async function compterConversations() {
  const lignes = await Conversation.aggregate([
    { $unwind: '$participants' },
    { $group: { _id: '$participants', n: { $sum: 1 } } },
  ]);
  return new Map(lignes.map((l) => [String(l._id), l.n]));
}

/** Fusionne deux Maps en ADDITIONNANT les valeurs (avis donnés + avis reçus). */
function fusionner(a, b) {
  const sortie = new Map(a);
  for (const [cle, valeur] of b) sortie.set(cle, (sortie.get(cle) || 0) + valeur);
  return sortie;
}

async function principal() {
  const ok = await connectDB({ reessais: false, silencieux: true });
  if (!ok) {
    console.error('MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    process.exitCode = 1;
    return;
  }

  console.log(`Base   : ${getMongoDbName()} (hôte ${mongoose.connection.host})`);
  console.log('Mode   : LECTURE SEULE — aucune écriture, aucune suppression.');
  console.log('Mot de passe : jamais lu (motDePasseHash est en select:false) — rien à masquer.');
  console.log(`Fenêtre « compte récent » : ${JOURS} jour(s).`);

  // ── Lecture : tous les comptes, sans filtre ────────────────────────────────
  const comptes = await User.find({})
    .select('nom prenom telephone estAdmin test estArtisan createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  // ── Comptages liés, en une passe par collection ────────────────────────────
  const [annonces, annoncesLegacy, fiches, avisFiches, avisRecus, messages, conversations,
    abonnements, depots, demandes] = await Promise.all([
    compterParChamp(Job, 'posteParUserId'),
    // Certaines annonces très anciennes portent encore `createdByUserId`.
    compterParChamp(Job, 'createdByUserId'),
    compterParChamp(Establishment, 'createdByUserId'),
    compterDansTableau(Establishment, 'avis', 'auteurId'),
    compterDansTableau(User, 'avisRecu', 'auteurId'),
    compterParChamp(Message, 'expediteurId'),
    compterConversations(),
    compterParChamp(Subscription, 'userId'),
    compterParChamp(Depot, 'userId'),
    compterParChamp(DemandeRevendication, 'userId'),
  ]);

  const avis = fusionner(avisFiches, avisRecus);

  const lignes = comptes.map((u) => {
    const id = String(u._id);
    return {
      id,
      compte: u,
      nom: nomComplet(u),
      telephone: u.telephone || '—',
      cree: u.createdAt,
      test: Boolean(u.test),
      admin: Boolean(u.estAdmin),
      annonces: annonces.get(id) || annoncesLegacy.get(id) || 0,
      fiches: fiches.get(id) || 0,
      avis: avis.get(id) || 0,
      messages: messages.get(id) || 0,
      conversations: conversations.get(id) || 0,
      abonnements: abonnements.get(id) || 0,
      depots: depots.get(id) || 0,
      demandes: demandes.get(id) || 0,
    };
  });

  const detail = (l) =>
    `activité : ${l.annonces} annonce(s), ${l.fiches} fiche(s), ${l.avis} avis, ` +
    `${l.messages} message(s), ${l.conversations} conversation(s), ${l.abonnements} abonnement(s), ` +
    `${l.depots} dépôt(s), ${l.demandes} demande(s) de revendication`;

  // ── 1. Tableau complet ─────────────────────────────────────────────────────
  console.log(`\n=== 1. TOUS LES COMPTES (${lignes.length}) ===`);
  console.log(
    '  #    _id                      nom / prénom         téléphone        créé le          test admin ann fic avis msg abo dép rev'
  );
  lignes.forEach((l, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${cellule(l.id, 24)} ${cellule(l.nom, 20)} ${cellule(
        l.telephone,
        16
      )} ${cellule(dateCourte(l.cree), 16)} ${oui(l.test)} ${oui(l.admin)} ${nombre(l.annonces)} ` +
        `${nombre(l.fiches)} ${nombre(l.avis)} ${nombre(l.messages)} ${nombre(l.abonnements)} ` +
        `${nombre(l.depots)} ${nombre(l.demandes)}`
    );
  });
  console.log(
    '  Légende : test = drapeau `test`, admin = estAdmin, ann = annonces, fic = fiches créées,\n' +
      '            avis = avis donnés/reçus, msg = messages envoyés, abo = abonnements,\n' +
      '            dép = dépôts, rev = demandes de revendication.'
  );

  // ── 2. Groupe A : déjà marqués test ────────────────────────────────────────
  const groupeA = lignes.filter((l) => l.test);
  console.log(`\n=== 2. GROUPE A — déjà marqués « test: true » (${groupeA.length}) ===`);
  for (const l of groupeA) {
    console.log(`  ⚠ ${l.id} | ${l.nom} | ${l.telephone} | créé ${dateCourte(l.cree)}\n    ${detail(l)}`);
  }
  if (groupeA.length === 0) console.log('  (aucun)');

  // ── 3. Groupe B : nom ou téléphone qui trahit un essai ─────────────────────
  const suspects = lignes
    .map((l) => {
      const raisons = [];
      const motifs = motifsDuNom(l.compte);
      if (motifs.length) raisons.push(`nom « ${l.nom} » (${motifs.join(', ')})`);
      const bloc = blocTelephoneEssai(l.telephone);
      if (bloc) raisons.push(`téléphone ${l.telephone} — ${bloc}`);
      return { ...l, raisons };
    })
    .filter((l) => l.raisons.length > 0);

  console.log(`\n=== 3. GROUPE B — nom ou téléphone d’essai (${suspects.length}) ===`);
  for (const l of suspects) {
    console.log(
      `  ⚠ ${l.id} | ${l.nom} | ${l.telephone} | créé ${dateCourte(l.cree)} | ` +
        `test:${l.test} admin:${l.admin}\n    motifs : ${l.raisons.join(' + ')}\n    ${detail(l)}`
    );
  }
  if (suspects.length === 0) console.log('  (aucun)');

  // ── 4. Groupe C : aucun contenu, créé récemment ────────────────────────────
  const limite = Date.now() - JOURS * JOUR_MS;
  const recentsVides = lignes.filter(
    (l) =>
      l.annonces === 0 &&
      l.messages === 0 &&
      l.fiches === 0 &&
      l.cree &&
      new Date(l.cree).getTime() >= limite
  );
  console.log(
    `\n=== 4. GROUPE C — 0 annonce, 0 message, 0 fiche, créés depuis ${JOURS} jour(s) (${recentsVides.length}) ===`
  );
  for (const l of recentsVides) {
    const jours = Math.floor((Date.now() - new Date(l.cree).getTime()) / JOUR_MS);
    console.log(
      `  ⚠ ${l.id} | ${l.nom} | ${l.telephone} | créé ${dateCourte(l.cree)} (il y a ${jours} j) | ` +
        `test:${l.test} admin:${l.admin}`
    );
    console.log(`    ${detail(l)}`);
  }
  if (recentsVides.length === 0) console.log('  (aucun)');

  // ── 5. Ce qui reste : candidats « vrais utilisateurs » ─────────────────────
  const idsSuspects = new Set([...groupeA, ...suspects, ...recentsVides].map((l) => l.id));
  const aPreserver = lignes.filter((l) => !idsSuspects.has(l.id));
  console.log(
    `\n=== 5. À PRÉSERVER A PRIORI — ni test, ni nom d’essai, ni compte vide récent (${aPreserver.length}) ===`
  );
  for (const l of aPreserver) {
    console.log(
      `  🔒 ${l.id} | ${l.nom} | ${l.telephone} | créé ${dateCourte(l.cree)} | ` +
        `admin:${l.admin}\n    ${detail(l)}`
    );
  }
  if (aPreserver.length === 0) console.log('  (aucun)');

  // ── 6. Répartition par jour : repère les lots créés d'un coup ──────────────
  const parJour = new Map();
  for (const l of lignes) {
    const jour = l.cree ? new Date(l.cree).toISOString().slice(0, 10) : '—';
    parJour.set(jour, (parJour.get(jour) || 0) + 1);
  }
  console.log('\n=== 6. CRÉATIONS PAR JOUR (un pic = un lot de script) ===');
  for (const [jour, n] of [...parJour.entries()].sort()) {
    console.log(`  ${jour} : ${n} compte(s)`);
  }

  // ── 7. Récapitulatif chiffré ───────────────────────────────────────────────
  console.log('\n=== 7. RÉCAPITULATIF (RIEN n’a été supprimé) ===');
  console.log(`  comptes au total         : ${lignes.length}`);
  console.log(`  groupe A (test: true)    : ${groupeA.length}`);
  console.log(`  groupe B (nom/tél essai) : ${suspects.length}`);
  console.log(`  groupe C (vides récents) : ${recentsVides.length}`);
  console.log(`  union des 3 groupes      : ${idsSuspects.size}`);
  console.log(`  à préserver a priori     : ${aPreserver.length}`);
  console.log('  En attente de votre décision, compte par compte.');

  // ── 8. Export CSV facultatif ───────────────────────────────────────────────
  if (FICHIER_CSV) {
    const entetes = [
      '_id', 'nom', 'prenom', 'telephone', 'createdAt', 'test', 'estAdmin',
      'annonces', 'fiches', 'avis', 'messages', 'abonnements', 'depots', 'demandes', 'groupe',
    ];
    const echapper = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const groupeDe = (l) => {
      if (l.test) return 'A';
      if (suspects.some((s) => s.id === l.id)) return 'B';
      if (recentsVides.some((s) => s.id === l.id)) return 'C';
      return '';
    };
    const corps = lignes.map((l) =>
      [
        l.id, l.compte.nom || '', l.compte.prenom || '', l.telephone,
        l.cree ? new Date(l.cree).toISOString() : '', l.test, l.admin,
        l.annonces, l.fiches, l.avis, l.messages, l.abonnements, l.depots, l.demandes,
        groupeDe(l),
      ]
        .map(echapper)
        .join(',')
    );
    const cible = path.resolve(process.cwd(), FICHIER_CSV);
    await writeFile(cible, `${entetes.join(',')}\n${corps.join('\n')}\n`, 'utf8');
    console.log(`\n  CSV écrit : ${cible}`);
  }

  await mongoose.disconnect().catch(() => {});
}

principal().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exitCode = 1;
});


