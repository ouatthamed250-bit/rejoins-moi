// Subscription.js — Schéma Mongoose d'un ABONNEMENT (cahier des charges, ajout
// du 29/09 : « système d'abonnement en plus du paiement à l'unité de 500 FCFA »).
//
// Un abonnement ACTIF débloque, pour un même utilisateur :
//   1. l'accès complet à la page Jobs (offres de boulot + demandes de main-d'œuvre)
//      sans payer 500 FCFA à chaque contact ;
//   2. pour un compte artisan : la mise en avant du profil dans le feed/recherche.
//
// Règles de conception :
//  - Le prix et la périodicité viennent de config/abonnement.js (JAMAIS en dur ici).
//  - DEUX FORMULES cohabitent (semaine 7 j / mois 30 j, prix provisoires) : le champ
//    `formule` enregistre celle qui a été achetée, `periodicite` sa périodicité. La
//    durée en jours n'est JAMAIS recopiée ici : elle vient de `calculerFinPeriode()`.
//  - L'activité se déduit de `finAt` et `statut` : aucune tâche planifiée n'est
//    nécessaire pour « expirer » un abonnement, la lecture suffit. Un cron pourra
//    plus tard passer les statuts à 'expire' pour l'historique comptable.
//  - `statut: 'annule'` (résiliation) laisse l'accès courir jusqu'à `finAt` :
//    l'utilisateur a payé la période, on ne lui coupe pas l'accès en cours de mois
//    (choix produit à valider).
//  - Paiement mobile money : `historiquePaiements` conserve chaque encaissement
//    CinetPay (audit identique à celui des déblocages de contact, voir Job.js).

import mongoose from 'mongoose';
import {
  CLES_FORMULES,
  CLES_HERITEES,
  FORMULE_PAR_DEFAUT,
  PERIODICITES,
  calculerFinPeriode,
  getDeviseAbonnement,
  getFormule,
} from '../config/abonnement.js';

/** Clés acceptées en base : les formules actuelles + les anciennes clés lisibles. */
const CLES_EN_BASE = [...CLES_FORMULES, ...Object.keys(CLES_HERITEES)];

/** Encaissement tracé (un abonnement peut être payé plusieurs fois : renouvellements). */
const paiementAbonnementSchema = new mongoose.Schema(
  {
    montant: { type: Number, default: 0, min: 0 },
    devise: { type: String, default: 'XOF' },
    moyenPaiement: {
      type: String,
      enum: ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY'],
      default: 'WAVE',
    },
    transactionId: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    formule: { type: String, enum: CLES_EN_BASE, default: FORMULE_PAR_DEFAUT.cle, index: true },

    // 'actif'   -> accès ouvert (voir estActifMaintenant)
    // 'annule'  -> résilié : plus de renouvellement, accès jusqu'à finAt
    // 'expire'  -> échéance dépassée
    statut: { type: String, enum: ['actif', 'annule', 'expire'], default: 'actif', index: true },

    montantFcfa: { type: Number, default: 0, min: 0 },
    devise: { type: String, default: 'XOF' },
    periodicite: { type: String, enum: PERIODICITES, default: FORMULE_PAR_DEFAUT.periodicite },

    debutAt: { type: Date, default: Date.now },
    finAt: { type: Date, required: true, index: true },

    // Renouvellement automatique : NON activé à la souscription (aucun mandat de
    // prélèvement n'est mis en place avec CinetPay à ce stade) — à valider.
    renouvellementAuto: { type: Boolean, default: false },

    moyenPaiement: { type: String, default: 'WAVE' },
    transactionId: { type: String, trim: true, default: '' },

    historiquePaiements: [paiementAbonnementSchema],
  },
  { timestamps: true }
);

/** Un abonnement est actif si le statut l'autorise ET que l'échéance n'est pas passée. */
subscriptionSchema.methods.estActifMaintenant = function estActifMaintenant(reference = new Date()) {
  if (this.statut === 'expire') return false;
  return new Date(this.finAt).getTime() > new Date(reference).getTime();
};

/** Sérialisation publique (utilisée par /api/subscriptions/moi et /api/users/...). */
subscriptionSchema.methods.toPublicJSON = function toPublicJSON(reference = new Date()) {
  const actif = this.estActifMaintenant(reference);
  const joursRestants = Math.max(
    0,
    Math.ceil((new Date(this.finAt).getTime() - new Date(reference).getTime()) / 86400000)
  );
  return {
    id: this._id,
    formule: this.formule,
    libelle: getFormule(this.formule).libelle,
    libelleCourt: getFormule(this.formule).libelleCourt || '',
    prixFcfaFormule: getFormule(this.formule).prixFcfa,
    statut: this.statut,
    actif,
    periodicite: this.periodicite,
    montantFcfa: this.montantFcfa,
    devise: this.devise,
    debutAt: this.debutAt,
    finAt: this.finAt,
    joursRestants: actif ? joursRestants : 0,
    renouvellementAuto: this.renouvellementAuto,
    avantages: getFormule(this.formule).avantagesCles,
  };
};

/** Abonnement en cours d'un utilisateur (le plus lointain si plusieurs lignes). */
subscriptionSchema.statics.trouverActif = function trouverActif(userId, reference = new Date()) {
  if (!userId) return Promise.resolve(null);
  return this.findOne({
    userId,
    statut: { $in: ['actif', 'annule'] },
    finAt: { $gt: reference },
  }).sort({ finAt: -1 });
};

/**
 * Sous-ensemble d'utilisateurs ayant un abonnement actif — sert au tri « mis en
 * avant » de l'annuaire des artisans (une seule requête, pas de N+1).
 *
 * @returns {Promise<Set<string>>} identifiants (en chaînes) des abonnés actifs
 */
subscriptionSchema.statics.utilisateursActifsParmi = async function utilisateursActifsParmi(
  userIds = [],
  reference = new Date()
) {
  if (!userIds.length) return new Set();
  const docs = await this.find({
    userId: { $in: userIds },
    statut: { $in: ['actif', 'annule'] },
    finAt: { $gt: reference },
  }).select('userId');
  return new Set(docs.map((d) => String(d.userId)));
};

/**
 * Active (ou PROLONGE) l'abonnement d'un utilisateur après confirmation du paiement.
 * - Aucun abonnement en cours : l'accès démarre maintenant.
 * - Abonnement en cours : la nouvelle période s'AJOUTE à l'échéance existante, pour
 *   ne jamais « perdre » les jours déjà payés.
 *
 * @returns {Promise<object>} le document abonnement enregistré
 */
subscriptionSchema.statics.activerOuProlonger = async function activerOuProlonger({
  userId,
  formule = FORMULE_PAR_DEFAUT.cle,
  montant = 0,
  devise = getDeviseAbonnement(),
  moyenPaiement = 'WAVE',
  transactionId = '',
  reference = new Date(),
}) {
  const modele = getFormule(formule);

  const existant = await this.trouverActif(userId, reference);
  const base = existant ? new Date(existant.finAt) : new Date(reference);

  const abonnement = existant || new this({ userId, debutAt: reference });
  abonnement.formule = modele.cle;
  abonnement.statut = 'actif';
  abonnement.periodicite = modele.periodicite;
  abonnement.montantFcfa = Number(montant) || modele.prixFcfa;
  abonnement.devise = devise;
  // Durée calculée par config/abonnement.js : 7 jours (semaine) ou 30 jours (mois).
  abonnement.finAt = calculerFinPeriode(base, modele.cle);
  abonnement.moyenPaiement = moyenPaiement;
  abonnement.transactionId = transactionId || abonnement.transactionId;
  if (transactionId) {
    abonnement.historiquePaiements.push({
      montant: Number(montant) || modele.prixFcfa,
      devise,
      moyenPaiement,
      transactionId,
      at: reference,
    });
  }
  await abonnement.save();
  return abonnement;
};

export default mongoose.model('Subscription', subscriptionSchema);
