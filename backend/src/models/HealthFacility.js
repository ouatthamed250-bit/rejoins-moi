// HealthFacility.js — Schéma Mongoose (SÉPARÉ du modèle Establishment, pas de notes/avis)
// Champs : nom, type ("pharmacie" | "clinique"), localisation {lat, lng}, telephone,
//          deGarde (bool), deGardeUpdatedAt
//
// CONTRAINTE DE CONFORMITÉ (cahier des charges §6 et §7) :
// Ce modèle ne doit JAMAIS recevoir de champ de notation, d'avis, de commentaire,
// de "popularité" ou de mise en avant comparative d'actes médicaux.
// Aucun champ noteMoyenne / avis / compteur de clics n'est déclaré ici, et le
// schéma est en `strict: true` : Mongoose rejettera silencieusement ces champs
// même si un client mal intentionné les envoie. Ne pas l'étendre sans validation
// juridique explicite (déontologie médicale + ARTCI).

import mongoose from 'mongoose';

const healthFacilitySchema = new mongoose.Schema(
  {
    nom: { type: String, required: [true, 'Le nom est obligatoire'], trim: true, maxlength: 140 },

    type: {
      type: String,
      required: true,
      enum: { values: ['pharmacie', 'clinique'], message: 'Type inconnu : {VALUE}' },
      index: true,
    },

    localisation: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },

    commune: { type: String, trim: true, default: '' },
    quartier: { type: String, trim: true, default: '' },
    adresse: { type: String, trim: true, default: '' },

    telephone: { type: String, required: true, trim: true },
    horaires: { type: String, trim: true, default: '' },

    // Statut auto-déclaré par l'établissement (§6) + horodatage pour la mention
    // "statut mis à jour par l'établissement, à confirmer par téléphone en cas d'urgence".
    deGarde: { type: Boolean, default: false, index: true },
    deGardeUpdatedAt: { type: Date, default: null },

    // Code remis à l'établissement pour mettre à jour son statut de garde sans
    // créer de compte complet (option réaliste retenue au lancement, §6).
    // Stocké haché via bcrypt à la création — jamais renvoyé dans les réponses.
    codeAccesHash: { type: String, select: false },

    verifie: { type: Boolean, default: false },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, strict: true }
);

healthFacilitySchema.index({ nom: 'text', commune: 'text', quartier: 'text', adresse: 'text' });

/** Sérialisation volontairement minimale : nom, type, statut, distance, téléphone, localisation. */
healthFacilitySchema.methods.toListItemJSON = function toListItemJSON({ distanceKm } = {}) {
  return {
    id: this._id,
    nom: this.nom,
    type: this.type,
    deGarde: this.deGarde,
    deGardeUpdatedAt: this.deGardeUpdatedAt,
    distanceKm: distanceKm == null ? null : Math.round(distanceKm * 100) / 100,
    telephone: this.telephone,
    adresse: this.adresse,
    quartier: this.quartier,
    commune: this.commune,
    horaires: this.horaires,
    localisation: this.localisation,
    verifie: this.verifie,
  };
};

export default mongoose.model('HealthFacility', healthFacilitySchema);

