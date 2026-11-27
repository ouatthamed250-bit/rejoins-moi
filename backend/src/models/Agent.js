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

/** Un code agent : exactement 6 caractères A-Z / 0-9. */
export const MOTIF_CODE_AGENT = /^[A-Z0-9]{6}$/;

/**
 * Alphabet de tirage SANS I, O, 0 ni 1 : « O » et « 0 » se confondent sur un
 * clavier de téléphone, et un code mal recopié est une fiche non payée.
 */
const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

/** Forme publique : le back-office est le seul lecteur (aucun autre écran n'en a besoin). */
agentSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    code: this.code,
    nom: this.nom,
    actif: Boolean(this.actif),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Agent', agentSchema);
