// DemandeRevendication.js — Demandes « c'est MON établissement » (sécurité, 27/11).
//
// POURQUOI CETTE COLLECTION EXISTE
// ---------------------------------
// Avant le 27/11, `POST /api/establishments/:id/reclamer` ACCEPTAIT la demande
// automatiquement dès que les coordonnées GPS ENVOYÉES PAR LE CLIENT étaient à
// moins de 150 m de la fiche. Ces coordonnées sont publiques (`GET
// /api/establishments` les sert) et un client peut envoyer celles qu'il veut :
// n'importe quel compte pouvait donc revendiquer n'importe quelle fiche importée
// non réclamée, puis en modifier le nom, le téléphone et les photos.
//
// Désormais AUCUNE revendication n'est automatique : chaque demande devient une
// ligne de cette collection, à l'état `en_attente`, et seule une décision
// d'administrateur (`PATCH /api/admin/demandes-revendication/:id/valider`)
// rattache la fiche au compte.
//
// CYCLE DE VIE :
//   en_attente → l'admin tranche dans le back-office (onglet « Revendications ») ;
//   validee    → la fiche est rattachée au demandeur (reclame = true, createdByUserId,
//                user.etablissementId) — aucune copie de fiche n'est créée ;
//   rejetee    → la fiche reste réclamable par un autre gérant.
//
// Rien n'est jamais supprimé : une demande rejetée reste consultable (audit).

import mongoose from 'mongoose';

const demandeRevendicationSchema = new mongoose.Schema(
  {
    // Demandeur. `required` : une demande vient toujours d'un compte identifié.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Fiche visée (elle existe forcément : la route répond 404 sinon).
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Establishment',
      required: true,
      index: true,
    },

    // Le cahier des charges demande un champ `date` explicite (distinct de createdAt).
    date: { type: Date, default: Date.now, index: true },

    statut: {
      type: String,
      enum: ['en_attente', 'validee', 'rejetee'],
      default: 'en_attente',
      index: true,
    },

    // Nom que le demandeur déclare pour la fiche (« Chez Tantie Awa »). Nettoyé par
    // le middleware sanitize : c'est un texte libre affiché dans le back-office.
    nomDeclare: { type: String, trim: true, maxlength: 120, default: '' },

    // Distance entre la position DÉCLARÉE par le client et la fiche, en mètres.
    // ⚠️ INDICATIVE UNIQUEMENT (valeur fournie par le client, donc falsifiable) :
    // elle aide l'admin à prioriser, elle ne décide JAMAIS de l'attribution.
    distanceDeclareeMetres: { type: Number, default: null, min: 0 },

    // Décision de l'équipe.
    traiteLe: { type: Date, default: null },
    traiteParUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Motif libre d'un rejet (jamais publié : voir toPublicJSON).
    noteAdmin: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

// Un compte ne peut avoir qu'UNE demande en attente par fiche : la route
// répond de façon idempotente au lieu d'empiler des doublons.
demandeRevendicationSchema.index({ userId: 1, etablissementId: 1, statut: 1 });

/** Sérialisation utilisée par le back-office : aucun champ technique inutile. */
demandeRevendicationSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: String(this._id),
    userId: this.userId ? String(this.userId) : null,
    etablissementId: this.etablissementId ? String(this.etablissementId) : null,
    date: this.date,
    statut: this.statut,
    nomDeclare: this.nomDeclare || '',
    distanceDeclareeMetres: this.distanceDeclareeMetres ?? null,
    traiteLe: this.traiteLe || null,
    noteAdmin: this.noteAdmin || '',
  };
};

export default mongoose.model('DemandeRevendication', demandeRevendicationSchema);
