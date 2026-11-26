// DemandeCategorie.js — Catégories PROPOSÉES par les utilisateurs (« Autre (précisez) »).
//
// Pourquoi : la taxonomie locale (maquis, koutoukoudrom, garbadrom, clé minute…) ne
// peut pas être devinée depuis un bureau. Quand un gérant ne trouve pas sa catégorie
// à l'inscription, il écrit la sienne : on l'enregistre ICI, en attente, au lieu de
// la refuser ou de la laisser entrer en base sans contrôle.
//
// CYCLE DE VIE :
//   en_attente → l'admin tranche dans le back-office (tuile « Catégories proposées ») ;
//   validee    → la catégorie est servie par GET /api/establishments/categories et
//                apparaît dans « Autre (précisez) » pour les inscriptions SUIVANTES ;
//   refusee    → elle reste consultable (audit) mais n'est plus proposée.
//
// Une seule demande EN ATTENTE par libellé : si trois gérants proposent « Poissonnerie »,
// on garde une ligne et on incrémente `demandes` — le back-office voit la demande
// réelle du terrain, pas trois doublons à valider.
//
// Aucune donnée personnelle n'est publiée : `toPublicJSON` ne renvoie que le libellé.

import mongoose from 'mongoose';

const demandeCategorieSchema = new mongoose.Schema(
  {
    // Libellé proposé, tel que saisi (nettoyé) : « Poissonnerie », « Atelier de couture ».
    nom: { type: String, trim: true, maxlength: 60, required: true },

    // Clé stable de comparaison/affichage (« poissonnerie »). Calculée par la route
    // (slugifier), jamais par le client : deux orthographes retombent sur la même clé.
    slug: { type: String, trim: true, maxlength: 80, required: true, index: true },

    // Famille de rattachement, telle que choisie par l'auteur (« restauration »,
    // « proximite »…). Elle ne crée AUCUNE famille nouvelle — l'enum des familles reste
    // fermé, voir Establishment.categorie : une catégorie validée est une SOUS-CATÉGORIE
    // de cette famille. « autre » par défaut (proposition sans famille / script de reprise).
    famille: { type: String, trim: true, default: 'autre' },

    // Auteur de la proposition. `null` accepté : une demande peut venir d'un script
    // de reprise (import) ou d'un compte supprimé depuis (droit à l'oubli).
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    // Fiche en cours d'inscription, quand la demande naît du formulaire.
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Establishment',
      default: null,
    },

    // Le cahier des charges demande un champ `date` explicite (distinct de createdAt).
    date: { type: Date, default: Date.now, index: true },

    statut: {
      type: String,
      enum: ['en_attente', 'validee', 'refusee'],
      default: 'en_attente',
      index: true,
    },

    // Nombre de fois où ce libellé a été proposé (dédoublonnage par slug).
    demandes: { type: Number, default: 1, min: 1 },

    traiteLe: { type: Date, default: null },
    traiteParUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Motif libre laissé par l'admin lors d'un refus (jamais publié : voir toPublicJSON).
    // Sans ce champ déclaré, Mongoose en mode strict ignorait silencieusement la valeur
    // écrite par POST /api/admin/demandes-categories/:id/refuser.
    noteAdmin: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

/** Une seule ligne EN ATTENTE par slug : la route incrémente au lieu de dupliquer. */
demandeCategorieSchema.index({ slug: 1, statut: 1 });

/** Sérialisation publique : le libellé et son état, rien d'autre. */
demandeCategorieSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    nom: this.nom,
    label: this.nom,
    slug: this.slug,
    famille: this.famille || 'autre',
    statut: this.statut,
    date: this.date,
  };
};

export default mongoose.model('DemandeCategorie', demandeCategorieSchema);
