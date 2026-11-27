// Agent.js — code d'AGENT DE TERRAIN (prompt 9).
//
// Un agent parcourt les quartiers et aide des commerçants à inscrire leur fiche.
// Son code à 6 caractères (« AG42X1 ») est recopié sur chaque fiche créée
// (Establishment.codeAgent) : c'est la seule chose qui permette de le PAYER à la
// fin du mois (GET /api/admin/agents/export-csv) et de repérer un agent qui
// « produit » des fiches douteuses (anti-fraude, voir routes/establishments.js).
//
// Pourquoi le code est-il GÉNÉRÉ et non choisi : un agent ne doit pas pouvoir
// prendre le code d'un collègue (ou « ADMIN1 ») pour lui attribuer ses fiches.
// Le tirage évite en plus les caractères ambigus (O/0, I/1) : ces codes sont
// recopiés à la main sur un carnet, puis saisis sur un téléphone au soleil.
//
// `actif: false` ne supprime RIEN : les fiches déjà créées restent rattachées
// (la paie passée doit rester juste), mais l'inscription marque la fiche
// `aVerifier` si le code d'un agent désactivé est encore utilisé.

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/** Un code agent : exactement 6 caractères A-Z / 0-9. */
export const MOTIF_CODE_AGENT = /^[A-Z0-9]{6}$/;

/**
 * Statuts d'un COMPTE agent (espace /agent, ajout du 26/11).
 *
 *   • `en_attente` : le recrutement est saisi, mais l'agent n'a pas encore reçu
 *     (ni saisi) son CODE D'ACTIVATION. Aucune connexion possible : c'est ce qui
 *     empêche quelqu'un de se déclarer agent tout seul et de créer des fiches au
 *     nom de l'équipe.
 *   • `actif`      : compte validé, connexion autorisée, pointage GPS autorisé.
 *   • `suspendu`   : accès coupé immédiatement (relu en base à chaque requête,
 *     comme pour les comptes utilisateurs — voir middleware/auth.js).
 *
 * `actif` (booléen historique) est CONSERVÉ et tenu à jour en même temps que
 * `statut` : les écrans de paie/anti-fraude s'appuient dessus depuis le prompt 9,
 * et un agent suspendu ne doit plus voir ses nouvelles fiches payées.
 */
export const STATUTS_AGENT = Object.freeze(['en_attente', 'actif', 'suspendu']);

/**
 * Alphabet de tirage SANS I, O, 0 ni 1 : « O » et « 0 » se confondent sur un
 * clavier de téléphone, et un code mal recopié est une fiche non payée.
 */
const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Code d'ACTIVATION : 8 caractères, même alphabet lisible. Il est remis de la
 * main à la main par l'administrateur (au téléphone, sur un carnet) : il doit
 * donc se dicter sans ambiguïté, et ne jamais être confondu avec le code agent
 * à 6 caractères qui, lui, est recopié sur les fiches.
 */
const LONGUEUR_CODE_ACTIVATION = 8;

const agentSchema = new mongoose.Schema(
  {
    // Identifiant public de l'agent : c'est LUI qui est recopié sur les fiches.
    code: {
      type: String,
      required: [true, 'Le code agent est obligatoire'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [MOTIF_CODE_AGENT, 'Le code agent doit faire 6 caractères (A-Z, 0-9).'],
    },
    nom: {
      type: String,
      required: [true, 'Le nom de l’agent est obligatoire'],
      trim: true,
      maxlength: [80, 'Le nom de l’agent est trop long (80 caractères maximum)'],
    },

    // ── Compte de connexion (espace /agent, 26/11) ─────────────────────────────
    // Le numéro est l'identifiant de connexion, comme partout dans l'application.
    // `sparse` : les agents créés avant cette évolution (code seul, sans compte)
    // n'ont pas de téléphone et ne doivent pas se gêner entre eux sur l'index.
    telephone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
      default: undefined,
    },
    // Jamais renvoyé par défaut (select: false) : il faut .select('+motDePasseHash').
    motDePasseHash: { type: String, select: false, default: '' },
    statut: {
      type: String,
      enum: { values: STATUTS_AGENT, message: 'Statut d’agent inconnu : {VALUE}' },
      default: 'en_attente',
      index: true,
    },
    // Code remis par l'administrateur. `select: false` : il n'est renvoyé QU'UNE
    // FOIS, au moment où l'admin le génère — jamais dans une liste d'agents.
    codeActivation: { type: String, select: false, default: null, uppercase: true, trim: true },

    // ── Suivi GPS (TÂCHE 1) ───────────────────────────────────────────────────
    // `enService` est piloté par l'agent (bouton « Prendre / Terminer mon
    // service ») : la carte admin ne montre QUE les agents en service, pour ne
    // pas surveiller quelqu'un pendant son repos.
    enService: { type: Boolean, default: false, index: true },
    dernierePosition: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },

    // Un agent qui quitte l'équipe est DÉSACTIVÉ, jamais supprimé : les fiches
    // qu'il a créées doivent rester rattachées à son code pour la paie.
    actif: { type: Boolean, default: true },
    // Qui l'a créé (traçabilité du back-office).
    creeParUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/** Code aléatoire de 6 caractères, sans caractère ambigu (voir ALPHABET_CODE). */
agentSchema.statics.genererCode = function genererCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET_CODE[Math.floor(Math.random() * ALPHABET_CODE.length)];
  }
  return code;
};

/**
 * Code d'activation à 8 caractères, remis par l'administrateur au nouvel agent.
 * Il n'est jamais devinable (32^8 combinaisons) et n'est stocké qu'en clair sur
 * un champ `select: false` : une liste d'agents ne peut pas le laisser fuiter.
 */
agentSchema.statics.genererCodeActivation = function genererCodeActivation() {
  let code = '';
  for (let i = 0; i < LONGUEUR_CODE_ACTIVATION; i += 1) {
    code += ALPHABET_CODE[Math.floor(Math.random() * ALPHABET_CODE.length)];
  }
  return code;
};

/** Hachage bcrypt du mot de passe d'un agent (même coût que les comptes User). */
agentSchema.statics.hashMotDePasse = function hashMotDePasse(motDePasse) {
  return bcrypt.hash(String(motDePasse ?? ''), 10);
};

/**
 * Vérifie un mot de passe d'agent.
 * Un agent sans mot de passe (compte créé par l'administrateur, mot de passe
 * défini à l'activation) ne peut PAS se connecter : on ne compare donc jamais
 * une chaîne vide à un hash absent.
 */
agentSchema.methods.verifierMotDePasse = function verifierMotDePasse(motDePasse) {
  if (!this.motDePasseHash) return Promise.resolve(false);
  return bcrypt.compare(String(motDePasse ?? ''), this.motDePasseHash).catch(() => false);
};

/** Statut effectif : les agents créés avant l'ajout du champ n'en ont pas. */
agentSchema.methods.statutEffectif = function statutEffectif() {
  return STATUTS_AGENT.includes(this.statut) ? this.statut : 'en_attente';
};

/**
 * Forme publique : le back-office ET l'agent lui-même sont les seuls lecteurs.
 *
 * Ne sortent JAMAIS d'ici : `motDePasseHash` et `codeActivation` (select: false,
 * donc absents du document sauf demande explicite — et jamais recopiés ici).
 */
agentSchema.methods.toPublicJSON = function toPublicJSON() {
  const lat = Number(this.dernierePosition?.lat);
  const lng = Number(this.dernierePosition?.lng);
  const positionValide = Number.isFinite(lat) && Number.isFinite(lng);
  return {
    id: this._id,
    code: this.code,
    nom: this.nom,
    telephone: this.telephone || '',
    statut: this.statutEffectif(),
    // Témoin de compatibilité pour les écrans de paie (prompt 9).
    actif: this.statutEffectif() === 'actif',
    // Un compte sans mot de passe existe (créé par l'admin) mais ne peut pas
    // encore se connecter : l'écran admin doit pouvoir l'expliquer.
    aCompte: Boolean(this.motDePasseHash),
    enService: Boolean(this.enService),
    dernierePosition: positionValide
      ? { lat, lng, updatedAt: this.dernierePosition?.updatedAt || null }
      : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Agent', agentSchema);
