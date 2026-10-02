// User.js — Schéma Mongoose utilisateur
//
// COMPTE UNIFIÉ (cahier des charges, ajout du 29/09) : il n'y a PLUS de types de
// comptes séparés (« client » / « ouvrier » / « etablissement »). Une même personne,
// avec le même profil et le même numéro, peut :
//   • être trouvée comme artisan / prestataire   -> `estArtisan: true` + `metier`
//   • chercher du travail                        -> `chercheTravail: true`
//   • poster une offre de boulot ou un besoin    -> droit implicite de tout compte
// La distinction se fait donc par CAPACITÉS déclarées (deux booléens modifiables à
// tout moment), jamais par un rôle figé à l'inscription.
//
// Champs principaux : telephone, nom, motDePasseHash, solde (FCFA), segment,
// historiqueInteractions[] (alimente useFeedAlgorithm côté frontend).
// L'abonnement éventuel vit dans sa propre collection (models/Subscription.js) :
// il a une durée, un montant et un historique de paiement, donc sa place est
// ailleurs que dans le document utilisateur.

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Interaction utilisateur — alimente l'apprentissage progressif du feed (§3).
 * On ne stocke que des signaux explicables (vue, recherche, clic, favori).
 */
const interactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['vue', 'recherche', 'clic', 'favori', 'contact', 'itineraire'],
      required: true,
    },
    establishmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Establishment' },
    categorie: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    terme: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** Avis reçu par un ouvrier/artisan (réputation, §1). */
const avisRecuSchema = new mongoose.Schema(
  {
    auteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    auteurNom: { type: String, trim: true, default: 'Utilisateur' },
    note: { type: Number, min: 1, max: 5, required: true },
    commentaire: { type: String, trim: true, maxlength: 600 },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    telephone: {
      type: String,
      required: [true, 'Le numéro de téléphone est obligatoire'],
      unique: true,
      index: true,
      trim: true,
    },
    nom: { type: String, trim: true, maxlength: 80, default: '' },
    prenom: { type: String, trim: true, maxlength: 80, default: '' },

    // Jamais renvoyé par défaut (select: false) : il faut .select('+motDePasseHash')
    motDePasseHash: { type: String, select: false },

    photoProfil: { type: String, default: '' },

    // ── Capacités du compte unifié (remplace l'ancien `typeCompte`) ──
    // Artisan/prestataire : visible dans l'annuaire et le feed (au moins un métier).
    estArtisan: { type: Boolean, default: false, index: true },
    // Cherche du travail : reçoit les offres de boulot et les besoins du quartier.
    // Vrai par défaut : tout le monde peut chercher du travail, c'est le cœur de l'app.
    chercheTravail: { type: Boolean, default: true, index: true },

    // Compte ADMINISTRATEUR (back-office) : accès aux routes /api/admin (voir
    // middleware/auth.js protectAdmin). Créé par scripts/creer-admin.js. Jamais
    // attribuable via les routes publiques d'inscription.
    estAdmin: { type: Boolean, default: false, index: true },

    // Volet main-d'œuvre : métier déclaré par l'ouvrier/artisan
    metier: { type: String, trim: true, default: '' },
    bio: { type: String, trim: true, maxlength: 400, default: '' },

    // Localisation approximative du compte (quartier / commune d'Abidjan)
    quartier: { type: String, trim: true, default: '' },
    commune: { type: String, trim: true, default: '' },
    localisation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    // Compte de recharge mobile money (500 FCFA par déblocage de contact, §2)
    solde: { type: Number, default: 0, min: 0 },

    // Réputation ouvrier/artisan
    noteMoyenne: { type: Number, default: 0, min: 0, max: 5 },
    nombreAvis: { type: Number, default: 0, min: 0 },
    avis: [avisRecuSchema],

    // Segments : un journalier n'a pas le même parcours de paiement (§2, point ouvert)
    segment: {
      type: String,
      enum: ['journalier', 'specialise', ''],
      default: '',
    },

    historiqueInteractions: [interactionSchema],
    favoris: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Establishment' }],

    // Établissement rattaché (fiche créée ou gérée par cet utilisateur)
    etablissementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Establishment' },

    // Dernière connexion réussie (rempli par /api/users/login et /api/admin/login).
    // Sert au back-office : « qui s'est connecté récemment ? » (voir GET /api/admin/activite).
    dernierLoginAt: { type: Date, default: null },

    // ── État du compte, piloté par le BACK-OFFICE (ajout du 01/10) ──
    // « actif » (défaut) : le compte vit normalement.
    // « suspendu » : l'équipe a coupé l'accès (fraude, doublon, demande de l'utilisateur).
    // Une suspension bloque la CONNEXION **et** les jetons déjà émis
    // (voir middleware/auth.js protect / protectAdmin) : c'est réversible d'un clic
    // dans le back-office — PATCH /api/admin/utilisateurs/:id/statut.
    // Pourquoi un champ à part plutôt qu'une suppression : on veut garder l'historique
    // des dépôts et des annonces, et pouvoir revenir en arrière.
    statutCompte: {
      type: String,
      enum: ['actif', 'suspendu'],
      default: 'actif',
      index: true,
    },
    // Motif affiché à l'utilisateur bloqué (« Montant non reçu », « Doublon de compte »…).
    motifSuspension: { type: String, trim: true, maxlength: 300, default: '' },
    suspenduAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.virtual('nomComplet').get(function nomComplet() {
  return [this.prenom, this.nom].filter(Boolean).join(' ').trim();
});

/**
 * Rôles déduits des capacités (jamais stockés) : sert uniquement à l'affichage.
 * Tout compte est « employeur » — il peut poster une offre ou un besoin.
 */
userSchema.virtual('roles').get(function roles() {
  const liste = ['employeur'];
  if (this.estArtisan) liste.unshift('prestataire');
  if (this.chercheTravail) liste.push('travailleur');
  return liste;
});

/** Hash un mot de passe en clair (bcrypt, 10 rounds). */
userSchema.statics.hashMotDePasse = function hashMotDePasse(motDePasse) {
  return bcrypt.hash(String(motDePasse), 10);
};

/** Vérifie un mot de passe en clair contre le hash stocké. */
userSchema.methods.verifierMotDePasse = function verifierMotDePasse(motDePasse) {
  if (!this.motDePasseHash) return Promise.resolve(false);
  return bcrypt.compare(String(motDePasse), this.motDePasseHash);
};

/**
 * Représentation publique : jamais de hash ni d'historique brut lourd.
 *
 * @param {{ abonnement?: object|null, abonnementActif?: boolean|null }} [options]
 *   - `abonnement` : document Subscription actif (quand l'appelant l'a chargé) ;
 *   - `abonnementActif` : booléen explicite, pratique quand on sait déjà qu'un
 *     abonnement est actif sans avoir chargé le document (annuaire des artisans).
 *   On en déduit `abonnementActif` (accès Jobs inclus) et `misEnAvant` (profil
 *   artisan poussé dans le feed et la recherche).
 */
userSchema.methods.toPublicJSON = function toPublicJSON({ abonnement = null, abonnementActif = null } = {}) {
  const actif =
    abonnementActif !== null ? Boolean(abonnementActif) : Boolean(abonnement && abonnement.estActifMaintenant?.());
  return {
    id: this._id,
    telephone: this.telephone,
    nom: this.nom,
    prenom: this.prenom,
    nomComplet: this.nomComplet,
    photoProfil: this.photoProfil,
    estArtisan: Boolean(this.estArtisan),
    chercheTravail: Boolean(this.chercheTravail),
    estAdmin: Boolean(this.estAdmin),
    // État du compte : le back-office affiche/aiguille dessus, donc il doit être public
    // (le propriétaire du compte le voit aussi : on ne suspend jamais en secret).
    statutCompte: this.statutCompte || 'actif',
    suspendu: (this.statutCompte || 'actif') === 'suspendu',
    motifSuspension: this.motifSuspension || '',
    suspenduAt: this.suspenduAt || null,
    dernierLoginAt: this.dernierLoginAt || null,
    roles: this.roles,
    metier: this.metier,
    bio: this.bio,
    quartier: this.quartier,
    commune: this.commune,
    solde: this.solde,
    noteMoyenne: this.noteMoyenne,
    nombreAvis: this.nombreAvis,
    segment: this.segment,
    favoris: (this.favoris || []).map(String),
    etablissementId: this.etablissementId || null,
    // Abonnement (cahier des charges, ajout du 29/09) : deux drapeaux dérivés,
    // jamais stockés, pour que le frontend n'ait rien à recalculer.
    abonnementActif: actif,
    abonnement: abonnement ? abonnement.toPublicJSON() : null,
    misEnAvant: Boolean(actif && this.estArtisan),
    createdAt: this.createdAt,
  };
};

/** Ajoute une interaction et borne l'historique (les 300 dernières suffisent au scoring). */
userSchema.methods.ajouterInteraction = function ajouterInteraction(interaction) {
  this.historiqueInteractions.push(interaction);
  const max = 300;
  if (this.historiqueInteractions.length > max) {
    this.historiqueInteractions = this.historiqueInteractions.slice(-max);
  }
};

/** Recalcule noteMoyenne / nombreAvis à partir du tableau `avis`. */
userSchema.methods.recalculerReputation = function recalculerReputation() {
  const avis = this.avis || [];
  this.nombreAvis = avis.length;
  this.noteMoyenne = avis.length
    ? Math.round((avis.reduce((s, a) => s + a.note, 0) / avis.length) * 10) / 10
    : 0;
};

export default mongoose.model('User', userSchema);

