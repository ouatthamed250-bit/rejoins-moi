// comptes-test.js — CONVENTION UNIQUE pour les comptes créés par les scripts.
//
// POURQUOI CE FICHIER
// Les scripts de vérification (verifier-base, verifier-compteurs, verifier-admin…)
// créaient des comptes avec des noms et des numéros quelconques : « Vérification
// ZOGBO », « TestCompteur1 », « Chat ChatAlpha… », ou un numéro aléatoire
// `+22507XXXXXXXX`. Quand un script s'arrêtait avant son bloc de nettoyage
// (Ctrl+C, échec réseau, base lente), le compte restait en production et devenait
// impossible à distinguer d'un vrai utilisateur lors d'un audit.
//
// RÈGLE (une seule, applicable partout) :
//   • NOM    : commence TOUJOURS par « TEST-AUTO- »        -> nomTest('DEPOT')
//   • NUMÉRO : toujours dans le bloc réservé 07 00 00 00 01 … 07 00 00 00 99
//                                                          -> telephoneTest(7)
//   • FIN    : chaque script appelle `purgerComptesTest()` dans son `finally`,
//              ce qui supprime les comptes TEST-AUTO- ET leurs données liées.
//
// Le bloc 07 00 00 00 NN est un numéro ivoirien VALIDE au sens du validateur (il
// faut 8 à 10 chiffres après normalisation, impossible d'utiliser 0000…), mais il
// n'est attribué à aucun abonné : c'est la plage laissée libre en tête de la
// tranche 07. Un compte qui porte ce préfixe est donc, par construction, un
// artefact de test — même si le nom a été changé à la main.
//
// Ce module ne contient AUCUNE décision destructive implicite : il ne supprime
// que ce qu'il a lui-même identifié par la convention ci-dessus (nom TEST-AUTO-
// ou numéro du bloc réservé), jamais un compte « qui ressemble à » un test.

import mongoose from 'mongoose';

import User from '../../src/models/User.js';
import Establishment from '../../src/models/Establishment.js';
import Job from '../../src/models/Job.js';
import Message from '../../src/models/Message.js';
import Conversation from '../../src/models/Conversation.js';
import Subscription from '../../src/models/Subscription.js';
import Depot from '../../src/models/Depot.js';
import DemandeRevendication from '../../src/models/DemandeRevendication.js';
import ListeAttente from '../../src/models/ListeAttente.js';
import AbonnementPush from '../../src/models/AbonnementPush.js';
import Agent from '../../src/models/Agent.js';

/** Préfixe obligatoire du nom de tout compte créé par un script. */
export const PREFIXE_TEST = 'TEST-AUTO-';

/** Bloc de numéros réservé aux scripts : 07 00 00 00 01 à 07 00 00 00 99. */
export const BLOC_TELEPHONE_TEST = '07000000';

/** Nom de compte conforme : `nomTest('COMPTEUR-1')` -> « TEST-AUTO-COMPTEUR-1 ». */
export const nomTest = (suffixe) => `${PREFIXE_TEST}${String(suffixe).toUpperCase()}`.slice(0, 80);

/**
 * Numéro réservé : `telephoneTest(3)` -> « 0700000003 » (forme nationale saisie).
 * La base ne stocke aucune de ces lignes en double : le serveur normalise en
 * « +225700000003 » (zéro de tête retiré), forme que couvre le filtre ci-dessous.
 */
export const telephoneTest = (n) => `${BLOC_TELEPHONE_TEST}${String(n).padStart(2, '0').slice(-2)}`;

/**
 * Filtre Mongo des seuls comptes que la convention autorise à supprimer :
 *   • nom ou prénom commençant par TEST-AUTO- (insensible à la casse) ;
 *   • numéro du bloc réservé, quelle que soit sa forme écrite :
 *       0700000001 · +2250700000001 · +225700000001 (forme stockée).
 *     Le bloc fait 100 numéros (01 à 99) : aucun abonné réel ne s'y trouve, et il
 *     ne peut pas non plus capturer un vrai 07 xx xx xx xx par simple préfixe.
 */
export const filtreComptesTest = () => ({
  $or: [
    { nom: { $regex: `^${PREFIXE_TEST}`, $options: 'i' } },
    { prenom: { $regex: `^${PREFIXE_TEST}`, $options: 'i' } },
    { telephone: { $regex: '^\\+?0?2250?7000000\\d{2}$' } },
    { telephone: { $regex: '^0?7000000\\d{2}$' } },
  ],
});

/** Liste des identifiants ObjectId, en ignorant les valeurs vides. */
const identifiants = (ids) =>
  (ids || [])
    .filter(Boolean)
    .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))));

/**
 * Supprime des comptes ET toutes leurs données liées (aucun orphelin).
 * Utilisé à la fois par le nettoyage de fin de script et par la commande de
 * suppression manuelle. Ne reçoit que des identifiants DÉJÀ identifiés.
 *
 * Renvoie un bilan chiffré par collection, pour le journal du script.
 */
export async function supprimerComptesEtDonnees(ids, { silencieux = false } = {}) {
  const cibles = identifiants(ids);
  if (cibles.length === 0) return { comptes: 0 };

  const filtre = { $in: cibles };
  const bilan = {};

  // 1) Données rattachées, par propriétaire explicite.
  bilan.annonces = (await Job.deleteMany({ posteParUserId: filtre })).deletedCount;
  bilan.fiches = (await Establishment.deleteMany({ createdByUserId: filtre })).deletedCount;
  bilan.messages = (await Message.deleteMany({ expediteurId: filtre })).deletedCount;
  bilan.conversations = (await Conversation.deleteMany({ participants: filtre })).deletedCount;
  bilan.abonnements = (await Subscription.deleteMany({ userId: filtre })).deletedCount;
  bilan.depots = (await Depot.deleteMany({ userId: filtre })).deletedCount;
  bilan.demandes = (await DemandeRevendication.deleteMany({ userId: filtre })).deletedCount;
  bilan.listesAttente = (await ListeAttente.deleteMany({ userId: filtre })).deletedCount;
  bilan.notifications = (await AbonnementPush.deleteMany({ user: filtre })).deletedCount;
  bilan.agents = (await Agent.deleteMany({ creeParUserId: filtre })).deletedCount;

  // 2) Traces laissées DANS d'autres documents (avis écrits par le compte).
  //    On retire l'avis : il n'a plus d'auteur, donc plus de sens.
  await Establishment.updateMany({}, { $pull: { avis: { auteurId: filtre } } });
  await User.updateMany({}, { $pull: { avisRecu: { auteurId: filtre } } });

  // 3) Le compte lui-même, en dernier.
  bilan.comptes = (await User.deleteMany({ _id: filtre })).deletedCount;

  if (!silencieux) {
    console.log(
      `  Nettoyage : ${bilan.comptes} compte(s), ${bilan.annonces} annonce(s), ${bilan.fiches} fiche(s), ` +
        `${bilan.messages} message(s), ${bilan.conversations} conversation(s), ` +
        `${bilan.abonnements} abonnement(s), ${bilan.depots} dépôt(s).`
    );
  }
  return bilan;
}

/**
 * Filet de sécurité à appeler dans le `finally` de chaque script de vérification :
 * supprime TOUS les comptes TEST-AUTO- (et leurs données) restés en base, y
 * compris ceux d'un passage précédent interrompu.
 *
 * Ne touche jamais un compte réel : le filtre est celui de `filtreComptesTest()`
 * (nom qui commence par TEST-AUTO- ou numéro du bloc réservé).
 *
 * EXCEPTION VOLONTAIRE : un compte `estAdmin: true` n'est JAMAIS purgé
 * automatiquement. Certains scripts exigent un administrateur de test créé à la
 * main (`npm run admin:creer`) et le supprimer dans leur dos casserait la campagne ;
 * surtout, une suppression d'administrateur doit rester une décision explicite
 * (voir scripts/supprimer-comptes.js --avec-admins).
 */
export async function purgerComptesTest({ silencieux = false } = {}) {
  const restants = await User.find({ ...filtreComptesTest(), estAdmin: { $ne: true } })
    .select('_id nom prenom telephone')
    .lean();
  if (restants.length === 0) {
    if (!silencieux) console.log('  Nettoyage : aucun compte TEST-AUTO- en base.');
    return { comptes: 0 };
  }
  if (!silencieux) {
    console.log(`  Nettoyage : ${restants.length} compte(s) TEST-AUTO- détecté(s), suppression…`);
  }
  return supprimerComptesEtDonnees(
    restants.map((c) => c._id),
    { silencieux }
  );
}

export default { PREFIXE_TEST, BLOC_TELEPHONE_TEST, nomTest, telephoneTest, filtreComptesTest, purgerComptesTest, supprimerComptesEtDonnees };

