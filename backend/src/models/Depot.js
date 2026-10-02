// Depot.js — Demande de DÉBLOCAGE payée par dépôt mobile money, VALIDÉE par un admin.
//
// Pourquoi ce modèle : la passerelle CinetPay n'étant pas branchée au lancement, le
// paiement des 500 FCFA se fait par dépôt manuel (Wave / Orange Money / MTN MoMo) sur
// les numéros de config/paiement.js. L'utilisateur déclare « j'ai payé » (opérateur +
// référence), puis l'équipe confirme côté back-office. Le contact n'est révélé
// qu'après cette validation : aucun faux succès, aucune confiance aveugle au client.
//
// Le déblocage réel est inscrit dans Job.contactDebloquePar (voir routes/admin.js),
// donc la source de vérité « ce contact est-il débloqué ? » reste le Job.

import mongoose from 'mongoose';

const depotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },

    montant: { type: Number, default: 500, min: 0 },
    devise: { type: String, default: 'XOF' },

    // Canal de dépôt choisi par l'utilisateur.
    operateur: {
      type: String,
      enum: ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO'],
      required: true,
      index: true,
    },

    // Numéro depuis lequel le client dit avoir envoyé l'argent (utile à la vérification)
    // et référence/identifiant de transaction communiqué par l'opérateur (facultatif).
    telephonePayeur: { type: String, trim: true, default: '' },
    reference: { type: String, trim: true, default: '' },

    statut: {
      type: String,
      enum: ['en_attente', 'valide', 'rejete'],
      default: 'en_attente',
      index: true,
    },

    noteAdmin: { type: String, trim: true, default: '' },
    valideParUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    valideAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Un utilisateur ne peut pas avoir deux demandes EN ATTENTE pour le même besoin
// (l'index unique n'existe pas sur les statuts, on le vérifie dans la route).
depotSchema.index({ userId: 1, jobId: 1, statut: 1 });

/** Représentation pour l'API (back-office admin et suivi côté utilisateur). */
depotSchema.methods.toJSON = function toJSON() {
  return {
    id: this._id,
    userId: this.userId,
    jobId: this.jobId,
    montant: this.montant,
    devise: this.devise,
    operateur: this.operateur,
    telephonePayeur: this.telephonePayeur,
    reference: this.reference,
    statut: this.statut,
    noteAdmin: this.noteAdmin,
    valideAt: this.valideAt,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('Depot', depotSchema);