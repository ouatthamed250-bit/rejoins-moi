// verifier-compteurs.js — PREUVE de la déduplication des compteurs (§3).
//
// Monte les VRAIS routeurs (users + establishments) sur une base MongoDB réelle, puis
// vérifie que POST /:id/visit et /:id/action n'incrémentent qu'UNE fois par jour et par
// identité :
//   • même utilisateur, 2 appels -> compteur +1 seulement (2e = dejaCompte) ;
//   • anonyme (même IP), 2 appels -> compteur +1 seulement ;
//   • un AUTRE utilisateur -> +1 de plus (identités distinctes).
//
// La base est nettoyée en fin d'exécution (fiche, marqueurs et comptes de test supprimés),
// même en cas d'échec. Prérequis : MONGODB_URI dans backend/.env.
// Lancement (depuis /backend) : node scripts/verifier-compteurs.js

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import usersRouter from '../src/routes/users.js';
import establishmentsRouter from '../src/routes/establishments.js';
import Establishment from '../src/models/Establishment.js';
import CompteurJournalier from '../src/models/CompteurJournalier.js';
import User from '../src/models/User.js';

let reussis = 0;
const echecs = [];

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ✓ ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Numéro ivoirien aléatoire (jamais deux fois le même). */
function telephoneAleatoire() {
  const n = Math.floor(100000 + Math.random() * 899999);
  return `+22507${n}0`;
}

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);
app.use('/api/establishments', establishmentsRouter);

const serveur = app.listen(0);

async function principal() {
  console.log("\n▶ Vérification de la déduplication des compteurs d'établissement");

  const connecte = await connectDB({ reessais: false });
  if (!connecte) {
    console.error('  ✗ MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    return;
  }

  const base = `http://127.0.0.1:${serveur.address().port}`;
  const appel = async (methode, chemin, { body, token } = {}) => {
    const entetes = { Accept: 'application/json' };
    if (body !== undefined) entetes['Content-Type'] = 'application/json';
    if (token) entetes.Authorization = `Bearer ${token}`;
    const r = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: entetes,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texte = await r.text();
    let donnees = null;
    try {
      donnees = texte ? JSON.parse(texte) : null;
    } catch {
      donnees = { brut: texte.slice(0, 200) };
    }
    return { statut: r.status, donnees };
  };

  let etab = null;
  const comptesTest = [];

try {
    // Deux comptes de test (l'un servira de « même utilisateur », l'autre d'« autre »).
    const u1 = await appel('POST', '/api/users/register', {
      body: { telephone: telephoneAleatoire(), motDePasse: 'motdepasse', nom: 'TestCompteur1' },
    });
    const u2 = await appel('POST', '/api/users/register', {
      body: { telephone: telephoneAleatoire(), motDePasse: 'motdepasse', nom: 'TestCompteur2' },
    });
    if (u1.donnees?.user?.id) comptesTest.push(u1.donnees.user.id);
    if (u2.donnees?.user?.id) comptesTest.push(u2.donnees.user.id);
    if (u1.statut !== 201 || u2.statut !== 201) {
      console.error(`  ✗ inscription des comptes de test impossible (${u1.statut}/${u2.statut}).`);
      return;
    }
    const token1 = u1.donnees.token;
    const token2 = u2.donnees.token;

    // Fiche de test (marquée « test » pour repérage/nettoyage).
    etab = await Establishment.create({
      nom: `ZZ-TEST-COMPTEURS-${Date.now()}`,
      categorie: 'autre',
      description: 'Fiche temporaire créée par verifier-compteurs.js.',
      tags: ['test', 'temporaire', 'audit'],
      telephone: '+2250700000000',
      localisation: { lat: 5.3242, lng: -4.0206 },
    });
    const cheminVisit = `/api/establishments/${etab._id}/visit`;
    const cheminAction = `/api/establishments/${etab._id}/action`;

    // ── 1. Visites : même utilisateur, deux appels ─────────────────────────────
    const v1 = await appel('POST', cheminVisit, { token: token1 });
    const v2 = await appel('POST', cheminVisit, { token: token1 });
    verifier(
      'visite n°1 : compteur incrémenté (dejaCompte=false, +1)',
      v1.donnees?.dejaCompte === false && v1.donnees?.compteurVisites === 1,
      JSON.stringify(v1.donnees)
    );
    verifier(
      'visite n°2 du MÊME utilisateur : AUCUN incrément (dejaCompte=true, toujours 1)',
      v2.donnees?.dejaCompte === true && v2.donnees?.compteurVisites === 1,
      JSON.stringify(v2.donnees)
    );

    // ── 2. Autre utilisateur : identité distincte -> +1 ────────────────────────
    const v3 = await appel('POST', cheminVisit, { token: token2 });
    verifier(
      'un AUTRE utilisateur incrémente bien (+1 -> 2)',
      v3.donnees?.dejaCompte === false && v3.donnees?.compteurVisites === 2,
      JSON.stringify(v3.donnees)
    );

    // ── 3. Action anonyme (même IP), deux appels ───────────────────────────────
    const a1 = await appel('POST', cheminAction);
    const a2 = await appel('POST', cheminAction);
    verifier(
      'action anonyme n°1 : compteur utilisateurs +1',
      a1.donnees?.dejaCompte === false && a1.donnees?.compteurUtilisateurs === 1,
      JSON.stringify(a1.donnees)
    );
    verifier(
      'action anonyme n°2 (même IP) : AUCUN incrément (toujours 1)',
      a2.donnees?.dejaCompte === true && a2.donnees?.compteurUtilisateurs === 1,
      JSON.stringify(a2.donnees)
    );

    // Contrôle final en base : l'état réel correspond bien à ce qui est renvoyé.
    const enBase = await Establishment.findById(etab._id).select(
      'compteurVisites compteurUtilisateurs'
    );
    verifier(
      'état en base cohérent (visites=2, utilisateurs=1)',
      enBase?.compteurVisites === 2 && enBase?.compteurUtilisateurs === 1,
      `visites=${enBase?.compteurVisites}, utilisateurs=${enBase?.compteurUtilisateurs}`
    );
  } finally {
    // Nettoyage systématique.
    if (etab) {
      await CompteurJournalier.deleteMany({ etablissement: etab._id }).catch(() => {});
      await Establishment.deleteOne({ _id: etab._id }).catch(() => {});
    }
    if (comptesTest.length) await User.deleteMany({ _id: { $in: comptesTest } }).catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }

console.log(`\n${'─'.repeat(64)}`);
  if (echecs.length === 0) {
    console.log(`✅ Déduplication des compteurs : ${reussis}/${reussis} vérifications réussies.`);
    console.log('   1 seul incrément par utilisateur/IP et par jour ; identités distinctes comptées.\n');
  } else {
    console.log(`❌ Déduplication des compteurs : ${echecs.length} échec(s) :`);
    for (const e of echecs) console.log(`   • ${e}`);
    console.log('');
  }
  process.exitCode = echecs.length === 0 ? 0 : 1;
}

principal()
  .catch((err) => {
    console.error('❌ Échec du script :', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    serveur.closeAllConnections?.();
    serveur.close();
  });