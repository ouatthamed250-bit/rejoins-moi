// AbonnementPush.js — Abonnement Web Push d'un utilisateur (notifications réelles,
// même quand l'application est fermée).
//
// Un utilisateur peut s'abonner depuis son téléphone (le navigateur génère un
// PushSubscription). Ce document stocke l'objet d'abonnement pour que le
// serveur puisse lui envoyer des notifications via la bibliothèque `web-push`
// (clés VAPID). Un seul abonnement par utilisateur : une nouvelle souscription
// remplace l'ancienne (même téléphone, même navigateur).

import mongoose from 'mongoose';

const abonnementPushSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    // Objet PushSubscription tel que renvoyé par le navigateur :
    // { endpoint, keys: { p256dh, auth } }. Stocké tel quel, sans interprétation,
    // car web-push en a besoin exactement pour appeler le service de push du
    // navigateur (Chrome, Firefox, Safari…).
    subscription: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true, versionKey: false }
);

export default mongoose.model('AbonnementPush', abonnementPushSchema);
