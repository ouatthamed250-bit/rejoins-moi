// verifier-abonnement.js — Vérification des DEUX FORMULES d'abonnement, SANS base de
// données ni paiement.
//
// Pourquoi ce script existe : le tarif n'est pas tranché et les deux formules (semaine
// 7 j / mois 30 j) sont vendues EN PARALLÈLE. Une erreur sur une durée, c'est un artisan
// qui paie une semaine et en reçoit trente (ou l'inverse) : on le vérifie donc
// automatiquement, et on re-vérifie après CHAQUE changement de prix.
//
// Lancement (depuis /backend) : npm run verifier:abonnement
//
// Ce qui est contrôlé :
//   1. les deux formules, leurs clés, prix (provisoires) et durées ;
//   2. la résolution des clés : alias héritée « artisan », clé inconnue refusée ;
//   3. l'arithmétique des périodes (7 j / 30 j) et la PROLONGATION (les jours déjà
//      payés ne doivent jamais être perdus) ;
//   4. le schéma Mongoose de l'abonnement (enum, valeurs par défaut, sérialisation) ;
//   5. le filtrage par SUBSCRIPTION_PERIODICITY (liste CSV) et les surcharges de prix,
//      testés dans un processus séparé pour ne pas polluer cet environnement.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import mongoose from 'mongoose';
import Subscription from '../src/models/Subscription.js';
import {
  ABONNEMENT,
  CATALOGUE,
  CLES_FORMULES,
  FORMULES,
  FORMULES_ACTIVES,
  FORMULE_HEBDOMADAIRE,
  FORMULE_MENSUELLE,
  PERIODICITES,
  PERIODICITES_ACTIVES,
  calculerFinPeriode,
  dureeJoursFormule,
  estFormuleActive,
  getDeviseAbonnement,
  getFormule,
  getFormuleStricte,
  getFormules,
  getFormulesInactives,
} from '../src/config/abonnement.js';

const JOUR_MS = 86400000;
let reussis = 0;
const echecs = [];

/** Assertion : journalise OK/KO et mémorise les échecs. */
function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ✓ ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

function titre(texte) {
  console.log(`\n${texte}`);
}

/** Exécute un scénario de configuration dans un processus Node séparé. */
function scenario(env, expression) {
  const url = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config', 'abonnement.js')
  ).href;
  const base = { ...process.env };
  for (const cle of Object.keys(base)) {
    if (cle.startsWith('SUBSCRIPTION_')) delete base[cle];
  }
  const sortie = execFileSync(
    process.execPath,
    ['-e', `import(${JSON.stringify(url)}).then((m) => console.log(JSON.stringify(${expression})))`],
    { env: { ...base, ...env }, encoding: 'utf8' }
  );
  return JSON.parse(sortie.trim().split('\n').pop());
}

function surFormules(env) {
  return scenario(env, 'm.getFormules().map((f) => f.cle)');
}

function principal() {
  console.log("\n▶ Vérification de l'abonnement Rejoins'Moi (deux formules, tarifs provisoires)");

  // ── 1. Les deux formules ───────────────────────────────────────────────────
  titre('1. Catalogue');
  verifier('deux périodicités connues (hebdomadaire, mensuel)', PERIODICITES.join(',') === 'hebdomadaire,mensuel', PERIODICITES.join(','));
  verifier('deux formules déclarées', FORMULES.length === 2, `vu ${FORMULES.length}`);
  verifier(
    'clés canoniques attendues',
    CLES_FORMULES.join(',') === 'artisan_hebdo,artisan_mensuel',
    CLES_FORMULES.join(',')
  );
  verifier(
    'formule semaine : 7 jours / 700 FCFA (provisoire)',
    FORMULE_HEBDOMADAIRE.dureeJours === 7 && FORMULE_HEBDOMADAIRE.prixFcfa === 700,
    `${FORMULE_HEBDOMADAIRE.dureeJours} j / ${FORMULE_HEBDOMADAIRE.prixFcfa} FCFA`
  );
  verifier(
    'formule mois : 30 jours / 2 500 FCFA (provisoire)',
    FORMULE_MENSUELLE.dureeJours === 30 && FORMULE_MENSUELLE.prixFcfa === 2500,
    `${FORMULE_MENSUELLE.dureeJours} j / ${FORMULE_MENSUELLE.prixFcfa} FCFA`
  );
  verifier(
    'les deux formules restent marquées « à confirmer » (mention tarif provisoire)',
    FORMULE_HEBDOMADAIRE.aConfirmer === true && FORMULE_MENSUELLE.aConfirmer === true
  );
  verifier(
    'chaque formule affiche les 3 avantages (boulot, main-d’œuvre, mise en avant)',
    FORMULE_HEBDOMADAIRE.avantages.length === 3 && FORMULE_MENSUELLE.avantages.length === 3
  );
  verifier('devise XOF', getDeviseAbonnement() === 'XOF', getDeviseAbonnement());
  verifier(
    'en-tête du bloc abonnement renseigné',
    Boolean(CATALOGUE.titre && CATALOGUE.sousTitre && CATALOGUE.mentionProvisoire)
  );

  // ── 2. Résolution des clés ────────────────────────────────────────────────
  titre('2. Résolution des clés (aucun repli silencieux sur un autre tarif)');
  verifier('les deux formules sont actives par défaut', PERIODICITES_ACTIVES.length === 2 && FORMULES_ACTIVES.length === 2);
  verifier('getFormules() renvoie les deux formules', getFormules().length === 2);
  verifier('getFormulesInactives() est vide par défaut', getFormulesInactives().length === 0);
  verifier("getFormuleStricte('artisan_hebdo')", getFormuleStricte('artisan_hebdo')?.cle === 'artisan_hebdo');
  verifier("getFormuleStricte('artisan_mensuel')", getFormuleStricte('artisan_mensuel')?.cle === 'artisan_mensuel');
  verifier('clé héritée « artisan » → formule mensuelle (anciens clients)', getFormuleStricte('artisan')?.cle === 'artisan_mensuel');
  verifier('clé inconnue → null (la route répondra 400)', getFormuleStricte('formule-bidon') === null);
  verifier('clé vide → null', getFormuleStricte('') === null && getFormuleStricte(undefined) === null);
  verifier('estFormuleActive() vrai pour les deux formules', estFormuleActive('artisan_hebdo') && estFormuleActive('artisan_mensuel'));
  verifier('estFormuleActive() faux pour une clé inconnue', estFormuleActive('formule-bidon') === false);
  verifier('getFormule() reste tolérant et ne renvoie jamais null', getFormule('formule-bidon')?.cle === ABONNEMENT.cle);

  // ── 3. Arithmétique des périodes ──────────────────────────────────────────
  titre('3. Durées et prolongation');
  const depart = new Date('2026-01-01T10:00:00.000Z');
  verifier('durée 7 jours pour la semaine', dureeJoursFormule('artisan_hebdo') === 7);
  verifier('durée 30 jours pour le mois', dureeJoursFormule('artisan_mensuel') === 30);
  verifier('clé héritée → 30 jours', dureeJoursFormule('artisan') === 30);
  verifier(
    'fin de période semaine = départ + 7 jours',
    calculerFinPeriode(depart, 'artisan_hebdo').getTime() === depart.getTime() + 7 * JOUR_MS
  );
  verifier(
    'fin de période mois = départ + 30 jours',
    calculerFinPeriode(depart, 'artisan_mensuel').getTime() === depart.getTime() + 30 * JOUR_MS
  );
  const finExistante = new Date('2026-02-01T00:00:00.000Z');
  verifier(
    'prolongation : la nouvelle période s’AJOUTE à l’échéance (aucun jour payé perdu)',
    calculerFinPeriode(finExistante, 'artisan_hebdo').getTime() === finExistante.getTime() + 7 * JOUR_MS
  );
  verifier(
    'changement de formule : semaine puis mois (30 j ajoutés à la suite)',
    calculerFinPeriode(calculerFinPeriode(depart, 'artisan_hebdo'), 'artisan_mensuel').getTime() ===
      depart.getTime() + 37 * JOUR_MS
  );

  // ── 4. Modèle Mongoose ────────────────────────────────────────────────────
  titre('4. Schéma Mongoose de l’abonnement');
  const enumFormule = Subscription.schema.path('formule').enumValues;
  verifier(
    'les deux clés sont acceptées en base',
    enumFormule.includes('artisan_hebdo') && enumFormule.includes('artisan_mensuel'),
    enumFormule.join(',')
  );
  verifier('l’ancienne clé « artisan » reste lisible (sans migration)', enumFormule.includes('artisan'));
  verifier('formule par défaut = formule semaine', Subscription.schema.path('formule').defaultValue === 'artisan_hebdo');
  verifier(
    'périodicités du modèle = hebdomadaire / mensuel',
    Subscription.schema.path('periodicite').enumValues.join(',') === 'hebdomadaire,mensuel'
  );
  verifier(
    'le modèle calcule la durée via calculerFinPeriode()',
    Subscription.activerOuProlonger.toString().includes('calculerFinPeriode')
  );

  const doc = new Subscription({
    userId: new mongoose.Types.ObjectId(),
    formule: 'artisan_hebdo',
    finAt: new Date(Date.now() + 7 * JOUR_MS),
  });
  const serialise = doc.toPublicJSON();
  verifier(
    'sérialisation : clé et prix de la formule',
    serialise.formule === 'artisan_hebdo' && serialise.prixFcfaFormule === 700,
    JSON.stringify({ formule: serialise.formule, prix: serialise.prixFcfaFormule })
  );
  verifier('sérialisation : périodicité hebdomadaire', serialise.periodicite === 'hebdomadaire', serialise.periodicite);
  verifier(
    'sérialisation : abonnement actif avec jours restants',
    serialise.actif === true && serialise.joursRestants === 7,
    `${serialise.actif} / ${serialise.joursRestants} j`
  );
  const docMois = new Subscription({
    userId: new mongoose.Types.ObjectId(),
    formule: 'artisan_mensuel',
    finAt: new Date(Date.now() + 30 * JOUR_MS),
  });
  verifier(
    'sérialisation mensuelle : 2 500 FCFA / 30 jours',
    docMois.toPublicJSON().prixFcfaFormule === 2500 && docMois.toPublicJSON().joursRestants === 30
  );
  const docEchu = new Subscription({
    userId: new mongoose.Types.ObjectId(),
    formule: 'artisan_hebdo',
    finAt: new Date(Date.now() - JOUR_MS),
  });
  verifier(
    'un abonnement échu n’est plus actif (0 jour restant)',
    docEchu.toPublicJSON().actif === false && docEchu.toPublicJSON().joursRestants === 0
  );
  verifier(
    'une clé inconnue est refusée par la validation Mongoose',
    Boolean(new Subscription({ formule: 'formule-bidon' }).validateSync())
  );

  // ── 5. Configuration par variables d'environnement ────────────────────────
  titre('5. SUBSCRIPTION_PERIODICITY (liste) et surcharges de prix');
  verifier('par défaut : les deux formules sont proposées', surFormules({}).join(',') === 'artisan_hebdo,artisan_mensuel');
  verifier(
    '« hebdomadaire » seul : une seule formule proposée',
    surFormules({ SUBSCRIPTION_PERIODICITY: 'hebdomadaire' }).join(',') === 'artisan_hebdo'
  );
  verifier(
    '« mensuel » seul : une seule formule proposée',
    surFormules({ SUBSCRIPTION_PERIODICITY: 'mensuel' }).join(',') === 'artisan_mensuel'
  );
  verifier(
    'liste explicite (avec espaces) : les deux formules',
    surFormules({ SUBSCRIPTION_PERIODICITY: 'hebdomadaire , mensuel' }).join(',') === 'artisan_hebdo,artisan_mensuel'
  );
  verifier(
    'liste invalide : on retombe sur les deux (jamais de catalogue vide)',
    surFormules({ SUBSCRIPTION_PERIODICITY: 'nawak' }).join(',') === 'artisan_hebdo,artisan_mensuel'
  );
  verifier(
    'choix unique possible : mensuel + prix surchargé à 3 000 FCFA',
    (() => {
      const resultat = scenario(
        { SUBSCRIPTION_PERIODICITY: 'mensuel', SUBSCRIPTION_PRICE_MONTHLY_FCFA: '3000' },
        'm.getFormules().map((f) => [f.cle, f.prixFcfa])'
      );
      return resultat.length === 1 && resultat[0][0] === 'artisan_mensuel' && resultat[0][1] === 3000;
    })()
  );
  verifier(
    'prix semaine surchargé à 1 000 FCFA',
    scenario(
      { SUBSCRIPTION_PRICE_WEEKLY_FCFA: '1000' },
      "m.getFormules().find((f) => f.cle === 'artisan_hebdo').prixFcfa"
    ) === 1000
  );
  verifier(
    'durée du mois surchargée à 25 jours',
    scenario(
      { SUBSCRIPTION_DURATION_MONTHLY_DAYS: '25' },
      "m.getFormules().find((f) => f.cle === 'artisan_mensuel').dureeJours"
    ) === 25
  );
  verifier(
    'formule par défaut surchargeable (et cohérente avec la liste active)',
    scenario(
      { SUBSCRIPTION_PERIODICITY: 'mensuel', SUBSCRIPTION_FORMULA_DEFAULT: 'artisan_hebdo' },
      'm.FORMULE_PAR_DEFAUT.cle'
    ) === 'artisan_mensuel'
  );

  // ── Bilan ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(64)}`);
  if (echecs.length === 0) {
    console.log(`✅ Abonnement : ${reussis}/${reussis} vérifications réussies.`);
    console.log('   Deux formules actives, durées et prolongations conformes, tarifs provisoires affichés.\n');
    process.exitCode = 0;
  } else {
    console.log(`❌ Abonnement : ${echecs.length} échec(s) sur ${reussis + echecs.length} vérifications :`);
    for (const echec of echecs) console.log(`   • ${echec}`);
    console.log('');
    process.exitCode = 1;
  }
}

principal();
