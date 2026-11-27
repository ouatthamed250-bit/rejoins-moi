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

// `web-push` 4.x est un module ESM qui n'expose AUCUN export par défaut : un
// `import webpush from 'web-push'` fait planter le serveur au chargement
// (« does not provide an export named 'default' »), et l'hébergeur conserve
// alors silencieusement l'ancienne version. On importe donc l'espace de noms.
import * as webpush from 'web-push';
import { createECDH } from 'node:crypto';
import AbonnementPush from '../models/AbonnementPush.js';

/**
 * Nettoie une valeur copiée depuis un tableau de bord d'hébergeur.
 *
 * Cause la plus fréquente d'un refus de `web-push` alors que la clé est bonne :
 * des guillemets englobants (« "BONV…" »), un espace final ou un retour à la
 * ligne ajouté par le copier-coller. On retire donc ces parasites, sans jamais
 * modifier les caractères base64 eux-mêmes.
 */
function nettoyerCle(valeur, retirerEspacesInternes = false) {
  if (valeur == null) return '';
  let propre = String(valeur).trim().replace(/^["']|["']$/g, '').trim();
  if (retirerEspacesInternes) propre = propre.replace(/\s+/g, '');
  return propre;
}

/**
 * Déduit la clé publique VAPID de la clé privée.
 *
 * Une clé VAPID est une paire sur la courbe P-256 : la clé publique n'est rien
 * d'autre que le point obtenu en multipliant la clé privée par le point de base.
 * La calculer ici évite deux pannes très réelles :
 *   • `VAPID_PUBLIC_KEY` oubliée dans l'hébergeur alors que la clé privée est bien
 *     là (le cas constaté sur Render) — sans elle, `web-push` refuse de signer ;
 *   • clé publique recopiée d'une AUTRE paire que la clé privée, qui produirait
 *     des abonnements silencieusement rejetés (403 du service de push).
 * Aucun secret n'est exposé : la clé publique est, par définition, publique.
 *
 * @param {string} clePrivee clé privée VAPID (base64url)
 * @returns {string} clé publique base64url, ou '' si la clé privée est illisible
 */
export function deduireClePublique(clePrivee) {
  if (!clePrivee) return '';
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(clePrivee, 'base64url'));
    return ecdh.getPublicKey().toString('base64url');
  } catch {
    return '';
  }
}

const CLE_PUBLIQUE_FOURNIE = nettoyerCle(process.env.VAPID_PUBLIC_KEY, true);
const CLE_PRIVEE = nettoyerCle(process.env.VAPID_PRIVATE_KEY, true);
const CLE_PUBLIQUE_DEDUITE = CLE_PRIVEE ? deduireClePublique(CLE_PRIVEE) : '';

/** D'où vient la clé publique retenue : 'fournie', 'deduite' ou 'absente'. */
let sourcePublique = 'absente';
let clePubliqueRetenue = '';

if (CLE_PUBLIQUE_FOURNIE && CLE_PUBLIQUE_DEDUITE) {
  if (CLE_PUBLIQUE_FOURNIE === CLE_PUBLIQUE_DEDUITE) {
    sourcePublique = 'fournie';
    clePubliqueRetenue = CLE_PUBLIQUE_FOURNIE;
  } else {
    // Les deux clés ne forment PAS une paire : on garde celle qui correspond à la
    // clé privée, seule à pouvoir signer des abonnements acceptés.
    sourcePublique = 'deduite';
    clePubliqueRetenue = CLE_PUBLIQUE_DEDUITE;
    console.warn(
      '[notifications] VAPID_PUBLIC_KEY ne correspond pas à VAPID_PRIVATE_KEY : ' +
        'la clé publique déduite de la clé privée est utilisée à la place.'
    );
  }
} else if (CLE_PUBLIQUE_FOURNIE) {
  sourcePublique = 'fournie';
  clePubliqueRetenue = CLE_PUBLIQUE_FOURNIE;
} else if (CLE_PUBLIQUE_DEDUITE) {
  sourcePublique = 'deduite';
  clePubliqueRetenue = CLE_PUBLIQUE_DEDUITE;
  console.warn(
    '[notifications] VAPID_PUBLIC_KEY absente : clé publique déduite de VAPID_PRIVATE_KEY.'
  );
}

const VAPID_DETAILS = {
  subject:
    nettoyerCle(process.env.VAPID_MAILTO) || 'mailto:admin@rejoins-moi.example',
  publicKey: clePubliqueRetenue,
  privateKey: CLE_PRIVEE,
};

/** Vrai seulement si `web-push` a accepté les clés : sans cela, aucun envoi. */
let vapidPret = false;
/** Raison courte du refus (`cles-absentes` ou message de web-push), pour le diagnostic. */
let vapidErreur = '';

if (VAPID_DETAILS.publicKey && VAPID_DETAILS.privateKey) {
  try {
    webpush.setVapidDetails(
      VAPID_DETAILS.subject,
      VAPID_DETAILS.publicKey,
      VAPID_DETAILS.privateKey
    );
    vapidPret = true;
  } catch (err) {
    // Clé tronquée, caractère parasite, paire incohérente… : on le DIT dans les
    // journaux et le serveur démarre quand même (une notification manquée ne doit
    // pas empêcher l'application de fonctionner).
    vapidErreur = err.message;
    console.warn('[notifications] clés VAPID refusées par web-push :', err.message);
  }
} else {
  // En développement, les clés peuvent manquer : on désactive silencieusement
  // l'envoi plutôt que de faire planter le serveur au chargement.
  vapidErreur = 'cles-absentes';
  console.warn(
    '[notifications] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes : les notifications push ne seront pas envoyées.'
  );
}

/**
 * État public du service de notifications, exposé par GET /api/health.
 *
 * Permet de vérifier APRÈS DÉPLOIEMENT que les clés VAPID de l'hébergeur ont
 * bien été lues et acceptées, sans jamais transmettre la clé privée : seuls des
 * booléens, le sujet `mailto:` et un message d'erreur générique sont renvoyés.
 *
 * @returns {{pret: boolean, publiqueDefinie: boolean, priveeDefinie: boolean,
 *            sujet: string, erreur: string|null}}
 */
export function etatNotifications() {
  return {
    pret: vapidPret,
    publiqueDisponible: Boolean(VAPID_DETAILS.publicKey),
    // 'fournie' (variable de l'hébergeur), 'deduite' (calculée depuis la clé
    // privée) ou 'absente' : indique sur quoi le serveur s'appuie réellement.
    publiqueSource: sourcePublique,
    priveeDefinie: Boolean(VAPID_DETAILS.privateKey),
    sujet: VAPID_DETAILS.subject,
    erreur: vapidErreur || null,
  };
}

/**
 * Clé publique VAPID à servir au navigateur (GET /api/push/public-key).
 * C'est exactement celle qui correspond à la clé privée utilisée pour signer :
 * un abonnement créé avec elle sera donc accepté par le service de push.
 *
 * @returns {string} clé base64url, ou '' si aucune clé n'est configurée
 */
export function cleVapidPublique() {
  return VAPID_DETAILS.publicKey || '';
}

/**
 * Envoie une notification push à un utilisateur.
 *
 * @param {string|ObjectId} userId identifiant du destinataire
 * @param {string} titre titre de la notification
 * @param {string} corps corps de la notification
 * @param {string} [url] Page à ouvrir au clic sur la notification, écrite comme un
 *   chemin relatif à la RACINE du domaine (ex. « /messages ») : le backend ne
 *   connaît pas le dossier de déploiement du front. C'est le service worker
 *   (frontend/public/sw.js, `urlDansApplication`) qui rattache ce chemin à sa
 *   propre portée, par exemple « /rejoins-moi/messages » sur GitHub Pages.
 * @returns {Promise<{ok: boolean, abonnementSupprime?: boolean}>}
 */
export async function envoyerNotification(userId, titre, corps, url = '/') {
  if (!vapidPret) {
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
