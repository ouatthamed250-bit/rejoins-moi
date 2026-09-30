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

    // Sous-catégorie issue de la source publique (ex. « Restaurant », « Coiffeurs(ses) »).
    // Sert au filtrage fin ; reste vide pour les fiches créées dans l'application.
    sousCategorie: { type: String, trim: true, maxlength: 60, default: '' },

    description: { type: String, trim: true, maxlength: 500, default: '' },

    // §5 — DEUX photos distinctes (devanture + vendeur/gérant), RECOMMANDÉES mais
    // facultatives depuis le 30/09 : une fiche publiée sans photo reste valide et
    // se complète plus tard. La route POST/PATCH ne refuse qu'une image invalide
    // ou deux photos identiques (validateEstablishmentPhotos).
    photoDevanture: { type: String, trim: true, default: '' },
    photoVendeur: { type: String, trim: true, default: '' },

    // Tags produits/services choisis en bulles cliquables, minimum 3 (§5).
    //
    // EXCEPTION (30/09) — fiches importées de la base publique (data.gouv.ci/OSM) :
    // la source ne fournit qu'UNE sous-catégorie comme tag. Exiger 3 tags
    // rejetterait les 6 719 fiches et empêcherait le gérant de réenregistrer la
    // fiche qu'il vient de réclamer. Dès qu'il prend la fiche en main, il complète
    // ses 3 tags depuis /profil (la route POST/PATCH exige bien 3 tags côté API).
    tags: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      validate: {
        // `function` (et non flèche) : seul un function voit `this.estImporte`.
        validator: function tagsSelonOrigine(v) {
          const minimum = this.estImporte ? 1 : 3;
          return Array.isArray(v) && v.length >= minimum;
        },
        message: 'Sélectionnez au moins 3 produits/services.',
      },
      default: undefined,
    },

    localisation: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },

    // Miroir GeoJSON de `localisation` — voir utils/geo.js et le hook de
    // synchronisation plus bas.
    //
    // POURQUOI DEUX CHAMPS plutôt qu'un seul : `localisation {lat, lng}` reste le
    // format stocké, renvoyé par l'API et attendu par le frontend (aucun changement
    // pour les autres routes : offres d'emploi, santé, inscription). Mais MongoDB
    // n'utilise un index géographique qu'avec un point GeoJSON : c'est `position`
    // qui porte l'index 2dsphere et permet le `$geoNear` de GET /api/establishments.
    // Résultat : le tri par proximité est calculé par la base sur les 6 719 fiches,
    // au lieu d'être trié en mémoire sur 400 candidats seulement.
    //
    // Volontairement SANS valeur par défaut : un document dont la position n'a pas
    // été renseignée ne doit pas contenir un point vide (index géographique
    // inexploitable). Ne jamais écrire ce champ à la main : il est dérivé.
    position: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] }, // [lng, lat] — ordre imposé par GeoJSON
    },

    commune: { type: String, trim: true, default: '' }, // ex. Cocody, Yopougon...
    quartier: { type: String, trim: true, default: '' }, // ex. Angré 8e tranche
    adresse: { type: String, trim: true, default: '' },

    // §5 — texte du bouton d'action dynamique ("Aller chez Chez Fatou")
    texteBoutonAction: { type: String, trim: true, maxlength: 80, default: '' },

    telephone: {
      type: String,
      // Obligatoire pour une fiche créée dans l'application. Une fiche IMPORTÉE
      // (données publiques) n'a presque jamais de numéro : exiger le téléphone
      // ferait échouer tout l'import. C'est `telephoneAVerifier` qui porte alors le
      // numéro à contrôler sur le terrain avant de le publier.
      required: [
        function telephoneObligatoireHorsImport() {
          return !this.estImporte;
        },
        'Le numéro de téléphone / WhatsApp est obligatoire',
      ],
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

    // ── Traçabilité des fiches pré-remplies (base publique nettoyée) ──────────
    // Distinguer ce qui vient de la base publique (OSM / data.gouv.ci) de ce qui a
    // été créé par un vrai gérant, et permettre à celui-ci de « réclamer » sa
    // fiche pour la compléter (photos, tags, horaires, numéro vérifié).
    estImporte: { type: Boolean, default: false, index: true },
    reclame: { type: Boolean, default: false, index: true },
    // Numéro relevé dans la source, à confirmer avant publication (usage interne :
    // volontairement ABSENT de toCardJSON, on n'affiche pas un contact non vérifié).
    telephoneAVerifier: { type: String, trim: true, default: '' },
    // Clé de recherche normalisée (« abiba-coiffure ») : retrouve une fiche sans se
    // soucier des accents, de la casse ou de la ponctuation.
    slugRecherche: { type: String, trim: true, maxlength: 90, default: '', index: true },
    // Provenance exacte : attribution OSM (ODbL) + jeu de données d'origine.
    sourceImport: { type: String, trim: true, maxlength: 160, default: '' },
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

// Index GÉOGRAPHIQUE (2dsphere) sur le miroir `position`.
// C'est LUI qui rend `$geoNear` possible dans GET /api/establishments : sans cet
// index, MongoDB refuse l'étape `$geoNear` (« unable to find index for
// $geoNear »). Créé automatiquement par Mongoose au démarrage du serveur.
establishmentSchema.index({ position: '2dsphere' });

/**
 * Copie `localisation` vers le point GeoJSON `position` (voir le champ `position`).
 * Tolérant : une localisation absente ou hors bornes laisse `position` vide
 * (le schéma impose déjà lat/lng, c'est une ceinture de sécurité pour les mises à jour).
 */
function synchroniserPosition(doc) {
  const lat = Number(doc?.localisation?.lat);
  const lng = Number(doc?.localisation?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
  doc.position = { type: 'Point', coordinates: [lng, lat] };
}

// Texte du bouton d'action : généré à la création si non fourni (§5).
// Le même hook maintient `position` (lat/lng déplacés en cours de correction de fiche).
establishmentSchema.pre('validate', function preValidate(next) {
  if (!this.texteBoutonAction && this.nom) {
    this.texteBoutonAction = `Aller chez ${this.nom}`;
  }
  synchroniserPosition(this);
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
    sousCategorie: this.sousCategorie || '',
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
    // Traçabilité (fiches pré-remplies) : l'app pourra afficher « fiche non
    // réclamée » et proposer au gérant de la reprendre. `telephoneAVerifier` est
    // volontairement absent : un numéro non vérifié ne doit pas être publié.
    estImporte: Boolean(this.estImporte),
    reclame: Boolean(this.reclame),
    slugRecherche: this.slugRecherche || '',
    sourceImport: this.sourceImport || '',
    distanceKm: distanceKm == null ? null : Math.round(distanceKm * 100) / 100,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Establishment', establishmentSchema);

