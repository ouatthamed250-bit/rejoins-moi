// Message.js — un message d'une conversation interne (voir models/Conversation.js).
//
// Volontairement minimal : pas d'édition, pas de pièce jointe, pas de suppression
// « pour moi ». Un message écrit dans une conversation privée est une pièce
// (l'administration peut devoir l'extraire sur réquisition — routes/admin.js) :
// il ne doit donc pas pouvoir être modifié après coup.
//
// Champs : conversationId, expediteurId, contenu (1000 caractères max), luPar[],
// createdAt (via timestamps).
//
// `luPar` est un tableau d'identifiants plutôt qu'un booléen : la conversation a
// deux participants, et savoir QUI a lu permet d'afficher « lu » à l'expéditeur
// sans mentir sur l'état de l'autre partie.

import mongoose from 'mongoose';

/** Longueur maximale d'un message — reprise par la route (validation explicite). */
export const LONGUEUR_MAX_MESSAGE = 1000;

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    expediteurId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contenu: {
      type: String,
      required: [true, 'Le message ne peut pas être vide'],
      trim: true,
      maxlength: [LONGUEUR_MAX_MESSAGE, 'Le message ne peut pas dépasser 1000 caractères'],
    },
    // Expéditeur toujours présent ; l'autre participant est ajouté à la lecture
    // (POST /api/messages/conversations/:id le fait en une seule écriture).
    luPar: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
    // Un message ne bouge plus après envoi (voir l'en-tête). Les seules
    // modifications autorisées côté code concernent `luPar`.
    versionKey: false,
  }
);

// Historique d'une conversation, du plus ancien au plus récent (pagination par
// date dans la route).
messageSchema.index({ conversationId: 1, createdAt: 1 });

/**
 * Forme publique d'un message pour SON participant.
 * @param {{ moi: any }} options `moi` = identifiant du lecteur.
 *   `moi: true` évite au frontend de comparer des identifiants (et donc de se
 *   tromper de côté de bulle quand les ids sont sérialisés différemment).
 */
messageSchema.methods.toJSONFor = function toJSONFor({ moi } = {}) {
  const lecteur = String(moi || '');
  const luPar = (this.luPar || []).map(String);
  return {
    id: this._id,
    conversationId: this.conversationId,
    expediteurId: this.expediteurId,
    moi: Boolean(lecteur) && String(this.expediteurId) === lecteur,
    contenu: this.contenu,
    luPar,
    // On ne calcule « lu par l'autre » que si le lecteur est bien l'expéditeur :
    // un destinataire n'a pas à savoir ce qu'il est censé avoir lu.
    lu: luPar.length > 1 || (luPar.length === 1 && luPar[0] !== String(this.expediteurId)),
    createdAt: this.createdAt,
  };
};

export default mongoose.model('Message', messageSchema);
