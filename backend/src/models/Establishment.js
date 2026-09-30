// Establishment.js — Schéma Mongoose
// Champs attendus (voir cahier-des-charges §5) :
//   nom, categorie, photoDevanture, photoVendeur, tags[], localisation {lat, lng},
//   texteBoutonAction (ex: "Aller chez Chez Fatou"), telephone,
//   noteMoyenne, avis[], compteurVisites, compteurUtilisateurs,
//   createdAt, updatedAt
//
// RÈGLE CRITIQUE (§3, §5) : `compteurVisites` et `compteurUtilisateurs` sont deux
// compteurs INDÉPENDANTS. Ils ne doivent jamais être additionnés côté API ni
// côté UI. Ils sont incrémentés par deux endpoints distincts :
//   POST /api/establishments/:id/visit   -> +1 visites
//   POST /api/establishments/:id/action  -> +1 utilisateurs (clic bouton d'action)

import mongoose from 'mongoose';

const avisSchema = new mongoose.Schema(
  {
    auteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    auteurNom: { type: String, trim: true, default: 'Client' },
    auteurPhoto: { type: String, default: '' },
    note: { type: Number, min: 1, max: 5, required: true },
    commentaire: { type: String, trim: true, maxlength: 600, default: '' },
    tags: [{ type: String, trim: true }],
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const establishmentSchema = new mongoose.Schema(
  {
    nom: { type: String, required: [true, 'Le nom est obligatoire'], trim: true, maxlength: 120 },

    categorie: {
      type: String,
      required: [true, 'La catégorie est obligatoire'],
      enum: {
        values: [
          'alimentation',
          'beaute',
          'services',
          'artisanat',
          'commerce',
          'sante',
          'spiritualite',
          'autre',
        ],
        message: 'Catégorie inconnue : {VALUE}',
      },
      index: true,
    },

    description: { type: String, trim: true, maxlength: 500, default: '' },

    // §5 — DEUX photos distinctes et obligatoires, validées dans la route POST
    photoDevanture: { type: String, required: true },
    photoVendeur: { type: String, required: true },

    // Tags produits/services choisis en bulles cliquables, minimum 3 (§5)
    tags: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 3,
        message: 'Sélectionnez au moins 3 produits/services.',
      },
      default: undefined,
    },

    localisation: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },

    commune: { type: String, trim: true, default: '' }, // ex. Cocody, Yopougon...
    quartier: { type: String, trim: true, default: '' }, // ex. Angré 8e tranche
    adresse: { type: String, trim: true, default: '' },

    // §5 — texte du bouton d'action dynamique ("Aller chez Chez Fatou")
    texteBoutonAction: { type: String, trim: true, maxlength: 80, default: '' },

    telephone: {
      type: String,
      required: [true, 'Le numéro de téléphone / WhatsApp est obligatoire'],
      trim: true,
    },
    whatsapp: { type: String, trim: true, default: '' },

    horaires: { type: String, trim: true, default: '' }, // texte libre : "Lun-Sam 7h-21h"

    noteMoyenne: { type: Number, default: 0, min: 0, max: 5, index: true },
    nombreAvis: { type: Number, default: 0, min: 0 },
    avis: [avisSchema],

    compteurVisites: { type: Number, default: 0, min: 0 },
    compteurUtilisateurs: { type: Number, default: 0, min: 0 },

    verifie: { type: Boolean, default: false },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Recherche mot-clé (nom, tags, description, quartier) — §4
establishmentSchema.index({
  nom: 'text',
  description: 'text',
  tags: 'text',
  quartier: 'text',
  commune: 'text',
});

// Texte du bouton d'action : généré à la création si non fourni (§5)
establishmentSchema.pre('validate', function preValidate(next) {
  if (!this.texteBoutonAction && this.nom) {
    this.texteBoutonAction = `Aller chez ${this.nom}`;
  }
  next();
});

/** Recalcule noteMoyenne / nombreAvis. */
establishmentSchema.methods.recalculerNote = function recalculerNote() {
  const avis = this.avis || [];
  this.nombreAvis = avis.length;
  this.noteMoyenne = avis.length
    ? Math.round((avis.reduce((s, a) => s + a.note, 0) / avis.length) * 10) / 10
    : 0;
};

/**
 * Sérialisation pour l'API : expose toujours les DEUX compteurs séparément.
 * (On n'ajoute volontairement aucun champ "total" qui les fusionnerait.)
 */
establishmentSchema.methods.toCardJSON = function toCardJSON({ distanceKm } = {}) {
  return {
    id: this._id,
    nom: this.nom,
    categorie: this.categorie,
    description: this.description,
    photoDevanture: this.photoDevanture,
    photoVendeur: this.photoVendeur,
    tags: this.tags || [],
    localisation: this.localisation,
    commune: this.commune,
    quartier: this.quartier,
    adresse: this.adresse,
    horaires: this.horaires,
    telephone: this.telephone,
    whatsapp: this.whatsapp,
    texteBoutonAction: this.texteBoutonAction || `Aller chez ${this.nom}`,
    noteMoyenne: this.noteMoyenne,
    nombreAvis: this.nombreAvis,
    compteurVisites: this.compteurVisites,
    compteurUtilisateurs: this.compteurUtilisateurs,
    verifie: this.verifie,
    distanceKm: distanceKm == null ? null : Math.round(distanceKm * 100) / 100,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Establishment', establishmentSchema);

