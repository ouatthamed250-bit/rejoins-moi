// notifications.js — Envoi de notifications Web Push (standard Web Push, bibliothèque
// `web-push`, aucune dépendance payante).
//
// Le service s'initialise avec les clés VAPID (backend/.env). Une fonction unique,
// `envoyerNotification`, permet d'alerter un utilisateur sur son téléphone même quand
// l'application est fermée (ex. nouveau message dans la messagerie).
//
// Le push utilise le service de push du navigateur (Chrome/Firefox/Safari) : le
// serveur signe la requête avec la clé privée VAPID, et le navigateur du destinataire
// la vérifie avec la clé publique. Aucun numéro de téléphone ni aucune donnée
// personnelle ne circule dans la notification elle-même — seulement le titre, le corps
// et une URL de destination.

import webpush from 'web-push';
import AbonnementPush from '../models/AbonnementPush.js';

const VAPID_DETAILS = {
  subject: process.env.VAPID_MAILTO || 'mailto:admin@rejoins-moi.example',
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};

if (VAPID_DETAILS.publicKey && VAPID_DETAILS.privateKey) {
  webpush.setVapidDetails(
    VAPID_DETAILS.subject,
    VAPID_DETAILS.publicKey,
    VAPID_DETAILS.privateKey
  );
} else {
  // En développement, les clés peuvent manquer : on désactive silencieusement
  // l'envoi plutôt que de faire planter le serveur au chargement.
  console.warn(
    '[notifications] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes : les notifications push ne seront pas envoyées.'
  );
}

/**
 * Envoie une notification push à un utilisateur.
 *
 * @param {string|ObjectId} userId identifiant du destinataire
 * @param {string} titre titre de la notification
 * @param {string} corps corps de la notification
 * @param {string} [url] URL ouverte quand l'utilisateur clique sur la notification
 * @returns {Promise<{ok: boolean, abonnementSupprime?: boolean}>}
 */
export async function envoyerNotification(userId, titre, corps, url = '/') {
  if (!VAPID_DETAILS.publicKey || !VAPID_DETAILS.privateKey) {
    return { ok: false, reason: 'cles-vapid-manquantes' };
  }

  const abonnement = await AbonnementPush.findOne({ user: userId }).lean();
  if (!abonnement || !abonnement.subscription) {
    return { ok: false, reason: 'pas-dabonnement' };
  }

  const payload = JSON.stringify({
    titre,
    corps,
    url: url || '/',
    date: new Date().toISOString(),
  });

  try {
    await webpush.sendNotification(abonnement.subscription, payload);
    return { ok: true };
  } catch (err) {
    // 410 Gone = l'abonnement a expiré (désinstallation, révocation, navigateur
    // vidé) : on le supprime pour ne pas retententer inutilement.
    if (err.statusCode === 410) {
      await AbonnementPush.deleteOne({ user: userId });
      return { ok: false, abonnementSupprime: true, reason: 'abonnement-expire' };
    }
    // Autres erreurs (400, 403, réseau) : on garde l'abonnement, on peut réessayer
    // plus tard. On ne fait pas planter l'appelant (notification non critique).
    console.warn('[notifications] echec envoi push:', err.message);
    return { ok: false, reason: err.message };
  }
}
