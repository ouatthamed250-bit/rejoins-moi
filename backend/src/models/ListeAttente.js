// ListeAttente.js — Demandes « Je veux être mis en avant » (mode 100 % gratuit).
//
// Pendant les six mois gratuits, il n'y a plus rien à vendre : la mise en avant
// d'un profil est OFFERTE. On enregistre donc seulement l'INTÉRÊT des artisans et
// des gérants de fiche pour les futures options de visibilité payantes, afin de
// savoir qui rappeler le jour venu.
//
// Une seule demande EN ATTENTE par utilisateur et par fiche : un second clic met à
// jour la demande existante au lieu d'en créer une deuxième (la file du back-office
// reste lisible). Voir routes/users.js (POST /api/users/mise-en-avant) et
// routes/admin.js (compteur + dernières demandes dans /statistiques).

import mongoose from 'mongoose';

const listeAttenteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Fiche concernée, quand l'utilisateur en gère une. `null` = profil artisan
    // simple (pas d'établissement) : la demande reste valable.
    etablissementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Establishment',
      default: null,
      index: true,
    },
    // Date de la demande, distincte de `createdAt` pour rester explicite côté API
    // (le cahier des charges demande un champ `date`).
    date: { type: Date, default: Date.now, index: true },
    statut: {
      type: String,
      enum: ['en_attente', 'traitee', 'annulee'],
      default: 'en_attente',
      index: true,
    },
    // Message libre éventuel (« je vends des légumes », « je suis disponible le
    // samedi »…) : utile au rappel, jamais affiché publiquement.
    note: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

/** Une demande en attente au maximum pour un couple (utilisateur, fiche). */
listeAttenteSchema.index({ userId: 1, etablissementId: 1, statut: 1 });

/** Sérialisation publique : aucun champ interne, aucune donnée d'un autre compte. */
listeAttenteSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    userId: this.userId,
    etablissementId: this.etablissementId || null,
    date: this.date,
    statut: this.statut,
    note: this.note || '',
    createdAt: this.createdAt,
  };
};

export default mongoose.model('ListeAttente', listeAttenteSchema);
