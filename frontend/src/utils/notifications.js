// notifications.js — Notifications push (Web Push) sur le téléphone de l'utilisateur.
//
// Le standard Web Push permet d'afficher une notification même quand l'application
// est fermée, comme WhatsApp. Le flux est :
//   1. `demanderPermissionNotification()` : demande l'autorisation d'afficher des
//      notifications (une fois).
//   2. `souscrireAuxNotifications(registration)` : crée un PushSubscription via le
//      service worker et l'envoie au backend (POST /api/users/push-subscribe).
// La clé publique VAPID est récupérée depuis la variable Vite `VITE_VAPID_PUBLIC_KEY`.

import { api } from './api/client.js';

const CLE_VAPID_PUBLIQUE = import.meta.env?.VITE_VAPID_PUBLIC_KEY || '';

/**
 * Convertit une clé VAPID encodée en base64 URL-safe en Uint8Array, comme l'exige
 * `PushManager.subscribe({ applicationServerKey })`.
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String) return null;
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const donneesBrut = atob(base64);
  const tableau = new Uint8Array(donneesBrut.length);
  for (let i = 0; i < donneesBrut.length; i++) {
    tableau[i] = donneesBrut.charCodeAt(i);
  }
  return tableau;
}

/**
 * Demande la permission d'afficher des notifications.
 * @returns {Promise<'granted'|'denied'|'default'>} l'état de permission.
 */
export async function demanderPermissionNotification() {
  if (typeof Notification === 'undefined') {
    console.warn('[notifications] l\'API Notification n\'est pas disponible.');
    return 'denied';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  // L'utilisateur n'a jamais répondu : le navigateur affiche la boîte de dialogue.
  return await Notification.requestPermission();
}

/**
 * Souscrit l'appareil aux notifications push et enregistre l'abonnement sur le
 * serveur. À appeler après obtention du ServiceWorkerRegistration.
 *
 * @param {ServiceWorkerRegistration} registration
 * @returns {Promise<{ok: boolean, abonnement?: PushSubscription|null}>}
 */
export async function souscrireAuxNotifications(registration) {
  if (!CLE_VAPID_PUBLIQUE) {
    console.warn(
      '[notifications] VITE_VAPID_PUBLIC_KEY manquante : impossible de s\'abonner aux notifications.'
    );
    return { ok: false, abonnement: null, reason: 'cle-vapid-manquante' };
  }

  const cleServeur = urlBase64ToUint8Array(CLE_VAPID_PUBLIQUE);
  if (!cleServeur) {
    return { ok: false, abonnement: null, reason: 'cle-vapid-invalide' };
  }

  let abonnement;
  try {
    // `userVisibleOnly: true` obligatoire : le serveur ne peut envoyer que des
    // notifications visibles par l'utilisateur (pas de push silencieux).
    abonnement = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: cleServeur,
    });
  } catch (err) {
    console.warn('[notifications] échec de l\'abonnement push:', err.message);
    return { ok: false, abonnement: null, reason: err.message };
  }

  // Envoie l'abonnement au backend (route protégée : requiert un jeton valide).
  try {
    await api.post('/users/push-subscribe', { subscription: abonnement });
    return { ok: true, abonnement };
  } catch (err) {
    console.warn('[notifications] échec de l\'enregistrement serveur:', err.message);
    // L'abonnement existe côté navigateur mais n'est pas enregistré côté serveur :
    // l'utilisateur pourra réessayer plus tard.
    return { ok: false, abonnement, reason: err.message };
  }
}
