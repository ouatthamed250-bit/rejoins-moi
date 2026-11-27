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
 * Champs STRICTEMENT PRIVÉS d'un compte — jamais exposés par une réponse publique.
 *
 * Cette liste est la référence du modèle (finitions de sécurité) :
 *   • `toPublicJSON()` ne les sert QUE si l'appelant prouve son contexte avec
 *     `{ prive: true }` — c'est le cas de `/api/users/me` et du back-office ;
 *   • `toJSON()`, utilisé dès qu'un document Mongoose est sérialisé sans passer par
 *     une route explicite (`res.json(doc)`, populate renvoyé tel quel, script de
 *     debug…), ne les sert JAMAIS.
 *
 * `suspendu` n'est pas stocké : c'est un drapeau dérivé de `statutCompte` que le
 * back-office reçoit pour ne pas avoir à recalculer l'état.
 */
export const CHAMPS_PRIVES_UTILISATEUR = Object.freeze([
  'solde',
  'favoris',
  'dernierLoginAt',
  'statutCompte',
  'motifSuspension',
  'suspendu',
  'suspenduAt',
]);

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

    // CE QUE L'ON TESTE EN AMBIENTE D'ÉVALUATION (bloc d'audit préventif).
    // Un compte ou une fiche marquée `test: true` est automatiquement exclue
    // des réponses aux requêtes publiques (routes GET des routes ci-dessous) :
    // elle ne sera visible QUE dans l'espace d'administration (back-office).
    // Valeur par défaut false : aucun changement pour les documents existants.
    test: { type: Boolean, default: false, index: true },

    // Volet main-d'œuvre : métier déclaré par l'ouvrier/artisan
    metier: { type: String, trim: true, default: '' },
    bio: { type: String, trim: true, maxlength: 400, default: '' },

    // CONSENTEMENT DE CONTACT (prompt 7) : l'artisan accepte (ou non) que son numéro
    // soit affiché publiquement sur sa carte, dans l'annuaire et dans le feed. Défaut
    // false : l'annuaire ne sert JAMAIS un numéro par accident, seulement sur accord.
    contactPublic: { type: Boolean, default: false },

    // Localisation approximative du compte (quartier / commune d'Abidjan)
    quartier: { type: String, trim: true, default: '' },
    commune: { type: String, trim: true, default: '' },
    // Bornes obligatoires : sans elles, un client pouvait enregistrer `lat: 999`
    // (aucun `min`/`max` n'était déclaré) et fausser ensuite toutes les distances
    // calculées depuis ce compte — la Haversine accepte n'importe quel nombre fini.
    localisation: {
      lat: { type: Number, default: null, min: -90, max: 90 },
      lng: { type: Number, default: null, min: -180, max: 180 },
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

    // Carnet de visites PRIVÉ (ajout du 17/11) : fiches que l'utilisateur a
    // marquées « déjà visité ». C'est un repère PERSONNEL (ai-je déjà été chez ce
    // coiffeur ?), pas une statistique : il ne doit donc jamais être visible par
    // les autres. Le tableau ne sort que par `toPublicJSON`, c'est-à-dire dans
    // GET /api/users/me et dans les réponses de connexion — toujours pour le
    // compte lui-même, jamais dans une fiche ni dans une liste publique.
    // (À ne pas confondre avec `compteurVisites` de l'Establishment, qui est le
    // nombre PUBLIC de visites de la fiche.)
    visites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Establishment' }],

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

    // ── Droit à l'effacement (ajout du 20/11) ────────────────────────────────
    // Date d'anonymisation du compte (voir services/suppressionCompte.js). Le
    // document survit pour ne pas casser dépôts, abonnements, annonces et avis
    // (obligations comptables + preuves d'achat), mais il ne contient alors plus
    // AUCUNE donnée personnelle : c'est un identifiant technique.
    // Ce champ sert de verrou : `protect`/`protectAdmin` refusent tout jeton
    // émis sur ce compte, et les routes publiques le traitent comme introuvable.
    supprimeAt: { type: Date, default: null, index: true },
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
 * Représentation d'un compte, sans hash de mot de passe ni historique brut lourd.
 *
 * ⚠️ Depuis le 17/11 (nettoyage des données exposées), cette forme est STRICTEMENT
 * PUBLIQUE par défaut. Elle sert des routes ouvertes à tous — `GET /api/users/artisans`
 * (annuaire) et `GET /api/users/:id` (réputation) — donc un visiteur non connecté la lit.
 * Les données privées (portefeuille, préférences, carnet de visites, état de modération,
 * dernière connexion) n'y figurent PLUS : n'importe qui pouvait lire le solde d'un artisan,
 * la liste de ses favoris ou un motif de suspension en appelant l'annuaire public.
 *
 * Ces champs restent disponibles, mais seulement si l'appelant passe `{ prive: true }` :
 * c'est le cas UNIQUEMENT du compte lui-même (`POST /users/register`, `POST /users/login`,
 * `GET|PATCH /users/me`) et du back-office (jeton admin). Aucune route publique ne le fait.
 *
 * @param {{ abonnement?: object|null, abonnementActif?: boolean|null, prive?: boolean }} [options]
 *   - `abonnement` : document Subscription actif (quand l'appelant l'a chargé) ;
 *   - `abonnementActif` : booléen explicite, pratique quand on sait déjà qu'un
 *     abonnement est actif sans avoir chargé le document (annuaire des artisans) ;
 *   - `prive` : true pour le propriétaire du compte ou l'admin, jamais pour le public.
 *   On en déduit `abonnementActif` (accès Jobs inclus) et `misEnAvant` (profil
 *   artisan poussé dans le feed et la recherche).
 */
userSchema.methods.toPublicJSON = function toPublicJSON({
  abonnement = null,
  abonnementActif = null,
  prive = false,
} = {}) {
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
    // `estAdmin` n'est PLUS dans la partie publique (correctif du 27/11) : le pentest
    // a montré que `GET /api/users/artisans` et `GET /api/users/:id` permettaient
    // d'identifier nominativement les comptes administrateur. Le drapeau est
    // désormais servi uniquement avec `{ prive: true }` (le compte lui-même et le
    // back-office), voir plus bas.
    roles: this.roles,
    metier: this.metier,
    bio: this.bio,
    // Le téléphone n'est servi à l'annuaire que si `contactPublic` est vrai (la route
    // /artisans masque explicitement le numéro dans le cas contraire) : le drapeau
    // voyage donc avec le profil, pour que le frontend sache quoi afficher.
    contactPublic: Boolean(this.contactPublic),
    quartier: this.quartier,
    commune: this.commune,
    noteMoyenne: this.noteMoyenne,
    nombreAvis: this.nombreAvis,
    segment: this.segment,
    etablissementId: this.etablissementId || null,
    // ── Données PRIVÉES (jamais dans une réponse publique) ────────────────────
    // Portefeuille, préférences, carnet de visites, état de modération et dernière
    // connexion : réservés au compte lui-même et au back-office. Un seul verrou,
    // `prive`, pour que l'oubli soit impossible côté routeur : une route publique
    // qui appelle `toPublicJSON()` sans option ne peut PAS les laisser fuir.
    ...(prive
      ? {
          // Rôle administrateur : nécessaire au propriétaire du compte (menu
          // « Back-office ») et au back-office lui-même (badges, filtres), jamais au
          // public — c'était une fuite d'information relevée par le pentest.
          estAdmin: Boolean(this.estAdmin),
          statutCompte: this.statutCompte || 'actif',
          suspendu: (this.statutCompte || 'actif') === 'suspendu',
          motifSuspension: this.motifSuspension || '',
          suspenduAt: this.suspenduAt || null,
          // Droit à l'effacement : le back-office voit qu'un compte a été
          // anonymisé (et quand), sans pouvoir retrouver son identité.
          supprime: Boolean(this.supprimeAt),
          supprimeAt: this.supprimeAt || null,
          dernierLoginAt: this.dernierLoginAt || null,
          solde: this.solde,
          favoris: (this.favoris || []).map(String),
          visites: (this.visites || []).map(String),
        }
      : {}),
    // Abonnement (cahier des charges, ajout du 29/09) : deux drapeaux dérivés,
    // jamais stockés, pour que le frontend n'ait rien à recalculer.
    abonnementActif: actif,
    abonnement: abonnement ? abonnement.toPublicJSON() : null,
    misEnAvant: Boolean(actif && this.estArtisan),
    createdAt: this.createdAt,
  };
};

/**
 * Filet de sécurité (finitions de sécurité).
 *
 * Mongoose sérialise un document via `toJSON()` dès qu'il passe par `res.json()`,
 * y compris lorsqu'il est imbriqué dans un `populate`. Par défaut, Mongo aurait
 * alors renvoyé TOUT le document — solde, favoris, dernière connexion, motif de
 * suspension compris. En branchant `toJSON` sur la forme PUBLIQUE, un oubli de
 * routeur ne peut plus faire fuiter de données privées : c'est le comportement
 * par défaut qui est sûr.
 *
 * Les écrans qui ont besoin des champs privés (compte lui-même, back-office)
 * n'appellent pas cette méthode : ils appellent explicitement
 * `toPublicJSON({ prive: true })`. Les deux chemins restent donc indépendants.
 */
userSchema.methods.toJSON = function toJSON() {
  return this.toPublicJSON();
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

