// Conversation.js — fil de discussion PRIVÉ entre deux comptes.
//
// Remplace le renvoi vers WhatsApp (prompt B) : quand une personne n'a pas publié
// son numéro (`contactPublic: false`), la fiche artisan n'a plus de bouton muet —
// on ouvre une conversation interne. Ce qui est écrit ici est donc aussi
// confidentiel qu'un SMS : aucun index de recherche plein texte, aucun champ
// téléphone, aucune donnée dupliquée depuis les comptes.
//
// DEUX participants, jamais plus : c'est un face-à-face (client ↔ artisan,
// client ↔ gérant). Le back-office, lui, ne participe pas — il LIT et EXPORTE
// (routes/admin.js) avec un jeton administrateur.
//
// ── Pourquoi `cleParticipants` et pas un index unique sur `participants` ──
// Un index `unique` sur un champ TABLEAU est un index multi-clé : Mongo
// interdirait alors qu'un même utilisateur apparaisse dans deux documents, donc
// chaque personne n'aurait droit qu'à UNE conversation au total. Ce n'est pas ce
// qu'on veut. La clé de binôme (`idLePlusPetit_idLePlusGrand`, toujours triée)
// donne exactement la garantie demandée : une seule conversation par paire
// d'utilisateurs, quel que soit l'ordre dans lequel on a cliqué.
//
// Champs : participants[2], cleParticipants (unique), dernierMessage (aperçu),
// derniereActivite (tri de la liste).

import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    // Exactement deux identifiants de comptes, distincts. La validation est au
    // niveau du schéma (et pas seulement de la route) : une écriture faite plus
    // tard par un script ne doit pas pouvoir créer un groupe de trois.
    participants: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
      ],
      validate: [
        {
          validator: (valeur) => Array.isArray(valeur) && valeur.length === 2,
          message: 'Une conversation réunit exactement deux participants.',
        },
        {
          validator: (valeur) =>
            new Set((valeur || []).map((id) => String(id))).size === (valeur || []).length,
          message: 'Les deux participants d’une conversation doivent être différents.',
        },
      ],
    },

    // Clé technique du binôme (voir l'en-tête). Jamais renvoyée au client : c'est
    // un détail de stockage, pas une information de discussion.
    cleParticipants: { type: String, required: true, unique: true, select: false },

    // Aperçu du dernier message (tronqué) : la liste des conversations ne doit pas
    // transporter des messages entiers ni déclencher une requête par ligne.
    dernierMessage: { type: String, default: '', maxlength: 140 },

    // Tri de la boîte de réception. Mis à jour à chaque message (voir
    // routes/messages.js) : indexé en descendant pour que le tri ne scanne pas.
    derniereActivite: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Liste « mes conversations, la plus récente en haut ».
conversationSchema.index({ participants: 1, derniereActivite: -1 });

/**
 * Clé de binôme déterministe : les deux identifiants triés puis joints.
 * `a`/`b` peuvent être des ObjectId, des chaînes ou des documents User.
 */
conversationSchema.statics.cleDe = function cleDe(a, b) {
  const gauche = String(a?._id || a);
  const droite = String(b?._id || b);
  return [gauche, droite].sort().join('_');
};

/**
 * Normalise les participants AVANT validation :
 *   • ordre trié → deux appels `cleDe(a, b)` et `cleDe(b, a)` produisent la même
 *     clé, donc la même conversation ;
 *   • la clé est recalculée à chaque écriture : impossible de la désynchroniser
 *     des participants (le genre d'incohérence qu'on ne découvre qu'en production).
 */
conversationSchema.pre('validate', function normaliserParticipants(next) {
  if (Array.isArray(this.participants) && this.participants.length) {
    const tries = this.participants.map((p) => String(p?._id || p)).sort();
    this.participants = tries;
    if (tries.length === 2) this.cleParticipants = tries.join('_');
  }
  next();
});

/**
 * Forme publique d'une conversation pour SON participant.
 * @param {{ moi: any, interlocuteur?: object|null, nonLus?: number }} options
 *   `moi` = identifiant du lecteur (pour marquer `moi: true` côté message, jamais ici) ;
 *   `interlocuteur` = document User déjà peuplé, ou objet réduit à l'essentiel.
 */
conversationSchema.methods.toJSONFor = function toJSONFor({ moi, interlocuteur = null, nonLus = 0 } = {}) {
  const autre = interlocuteur || null;
  return {
    id: this._id,
    participants: (this.participants || []).map((p) => String(p?._id || p)),
    moi: String(moi || ''),
    interlocuteur: autre
      ? {
          id: String(autre._id || autre.id || ''),
          // `nom` peut être vide (compte sans prénom/nom) : le frontend affiche
          // alors « Utilisateur » — on n'invente jamais un nom côté serveur.
          nom: String(autre.nomComplet ?? [autre.prenom, autre.nom].filter(Boolean).join(' ')).trim(),
          photoProfil: autre.photoProfil || '',
          estArtisan: Boolean(autre.estArtisan),
          metier: autre.metier || '',
          // Compte anonymisé (droit à l'effacement) : la discussion reste lisible
          // pour l'autre partie, mais on ne prétend pas que la personne existe
          // encore. Aucune donnée personnelle n'est resservie.
          supprime: Boolean(autre.supprimeAt),
        }
      : null,
    dernierMessage: this.dernierMessage || '',
    derniereActivite: this.derniereActivite,
    createdAt: this.createdAt,
    nonLus: Number(nonLus) || 0,
  };
};

export default mongoose.model('Conversation', conversationSchema);
