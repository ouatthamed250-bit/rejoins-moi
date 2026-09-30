// pwa.js — Tout ce qui touche à l'installation de Rejoins'Moi sur l'écran
// d'accueil (PWA installable, sans APK ni Play Store).
//
// Pourquoi ce fichier séparé plutôt que tout dans le composant ?
//  - L'événement `beforeinstallprompt` peut arriver AVANT que React ait monté le
//    bouton (et il n'est émis qu'UNE fois par chargement). S'il n'est pas capturé
//    au tout premier instant, l'installation ne peut plus être proposée d'un clic.
//    On l'enregistre donc ici, au chargement du module, et on le garde de côté.
//  - Ce que le navigateur a décidé (app déjà installée, iOS, invite disponible)
//    ne dépend pas de React : c'est une petite source de vérité unique.
//  - Toutes les lectures sont protégées pour ne jamais casser un rendu hors
//    navigateur (les tests montent l'app sans DOM complet).
//
// Rappel de la charte : ce module ne touche JAMAIS aux règles de paiement ; il ne
// fait que proposer l'installation (voir sw.js pour « jamais de cache sur les
// paiements »).

/** Clé localStorage comptant les fois où l'invitation a été ignorée. */
export const CLE_INVITATIONS_IGNOREES = 'rejoinsmoi.installationIgnoree';

/** Au-delà de ce nombre d'ignorances, l'invitation ne s'affiche plus. */
export const IGNORANCES_MAX = 3;

/**
 * Base d'installation de l'application, telle que Vite l'a compilée :
 *  - « / » si l'app est à la racine d'un domaine (Vercel, Netlify, mutualisé) ;
 *  - « /rejoins-moi/ » si l'app est dans un sous-dossier (GitHub Pages).
 *  Hors build Vite (essai hors navigateur, rendu serveur), on retombe sur « / ».
 */
function baseApplication() {
  try {
    return import.meta.env?.BASE_URL || '/';
  } catch {
    return '/';
  }
}

/**
 * Emplacement du service worker : à la base de l'app (jamais « /sw.js » en dur,
 * sinon GitHub Pages — qui sert l'app depuis /rejoins-moi/ — renverrait 404 et
 * l'installation sur l'écran d'accueil deviendrait impossible).
 */
export const CHEMIN_SERVICE_WORKER = `${baseApplication()}sw.js`;

/* ────────────────────────── État capturé au chargement ─────────────────────── */

/** L'invite d'installation mise de côté par le navigateur (`beforeinstallprompt`). */
let inviteDifferee = null;

/** Passée à true si l'installation a abouti pendant la session en cours. */
let installeePendantSession = false;

/** Abonnés (le composant) à prévenir dès que l'état change. */
const abonnes = new Set();

/** L'app tourne-t-elle déjà en mode « installée » (écran d'accueil) ? */
export function estApplicationInstallee() {
  if (installeePendantSession) return true;
  if (typeof window === 'undefined') return false;
  try {
    // Android / Chrome : le manifeste impose `display: standalone`.
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
  } catch {
    /* matchMedia indisponible : on continue */
  }
  // iOS : Apple n'expose pas display-mode, mais une propriété dédiée.
  return window.navigator?.standalone === true;
}

/** iPhone / iPad (y compris iPad récent qui se présente comme un Mac tactile). */
export function estNavigateurIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
  );
}

/**
 * État à afficher par le bouton d'installation :
 *  - 'installee'  : l'app est déjà ouverte depuis l'écran d'accueil ;
 *  - 'disponible' : le navigateur a une invite prête, le clic lance l'installation ;
 *  - 'ios'        : Safari n'a pas d'invite -> « Partager → écran d'accueil » ;
 *  - 'manuel'     : aucune invite possible (déjà refusée, navigateur ancien,
 *                   site pas encore éligible) -> on explique où cliquer.
 */
export function etatInvitation() {
  if (estApplicationInstallee()) return 'installee';
  if (inviteDifferee) return 'disponible';
  if (estNavigateurIOS()) return 'ios';
  return 'manuel';
}

/** Prévient immédiatement l'abonné, puis à chaque changement. Renvoie le désabonnement. */
export function ecouterInvitation(rappel) {
  if (typeof rappel !== 'function') return () => {};
  abonnes.add(rappel);
  rappel(etatInvitation());
  return () => abonnes.delete(rappel);
}

function prevenir() {
  const etat = etatInvitation();
  for (const rappel of abonnes) {
    try {
      rappel(etat);
    } catch {
      /* un abonné fautif ne doit pas bloquer les autres */
    }
  }
}

/**
 * Déclenche l'installation. Ne fait JAMAIS semblant : sans invite du navigateur,
 * elle renvoie 'indisponible' et l'interface explique alors la marche à suivre.
 *
 * @returns {Promise<'acceptee'|'refusee'|'indisponible'>}
 */
export async function demanderInstallation() {
  const invite = inviteDifferee;
  if (!invite) return 'indisponible';
  // Une invite ne sert qu'une fois : on la consomme avant d'afficher le prompt.
  inviteDifferee = null;
  try {
    invite.prompt();
    const { outcome } = (await invite.userChoice) || {};
    if (outcome === 'accepted') installeePendantSession = true;
    prevenir();
    return outcome === 'accepted' ? 'acceptee' : 'refusee';
  } catch {
    prevenir();
    return 'indisponible';
  }
}

/* ───────────────────────── Ignorances (localStorage) ───────────────────────── */

/** Nombre de fois où l'utilisateur a fermé l'invitation. */
export function lireIgnorances() {
  try {
    return Number(localStorage.getItem(CLE_INVITATIONS_IGNOREES)) || 0;
  } catch {
    return 0;
  }
}

/** Le bouton doit-il rester caché après trop d'ignorances ? */
export function invitationMasquee() {
  return lireIgnorances() >= IGNORANCES_MAX;
}

/** L'utilisateur ferme l'invitation : on compte, et on cache au 3e refus. */
export function ignorerInvitation() {
  const total = lireIgnorances() + 1;
  try {
    localStorage.setItem(CLE_INVITATIONS_IGNOREES, String(total));
  } catch {
    /* navigation privée : l'invitation reviendra, ce n'est pas grave */
  }
  return total;
}

/** Réaffiche l'invitation (utile si l'on change d'avis sur la politique d'affichage). */
export function reinitialiserInvitation() {
  try {
    localStorage.removeItem(CLE_INVITATIONS_IGNOREES);
  } catch {
    /* rien à faire */
  }
}

/* ────────────────────────────── Service worker ─────────────────────────────── */

/**
 * Enregistre le service worker (app shell en cache + réseau d'abord pour les
 * données). Volontairement DÉSACTIVÉ en développement : un worker garderait en
 * cache les fichiers servis par Vite et masquerait les corrections en cours
 * (rechargement à chaud figé). En production il démarre seul ; pour tester le
 * hors-ligne sur le réseau Wi-Fi pendant la tournée terrain, ouvrir l'app avec
 * `?sw=1`.
 */
export function enregistrerServiceWorker() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const forcer = new URL(window.location.href).searchParams.get('sw') === '1';
  // `import.meta.env` n'existe que dans un bundle Vite : hors build (tests, rendu
  // serveur), on se considère en développement et on ne touche à rien.
  const env = import.meta.env || {};
  if (env.PROD !== true && !forcer) return;

  const enregistrer = () => {
    navigator.serviceWorker.register(CHEMIN_SERVICE_WORKER).catch(() => {
      /* HTTP sans HTTPS, ou navigateur sans support : l'app fonctionne sans */
    });
  };

  if (document.readyState === 'complete') enregistrer();
  else window.addEventListener('load', enregistrer, { once: true });
}

/* ───────────────────── Capture immédiate des événements ────────────────────── */

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (evenement) => {
    // Sans preventDefault, Chrome affiche sa propre mini-infobar : on veut la
    // nôtre, dans la charte orange de l'app.
    evenement.preventDefault();
    inviteDifferee = evenement;
    prevenir();
  });

  // L'installation a abouti.
  window.addEventListener('appinstalled', () => {
    installeePendantSession = true;
    inviteDifferee = null;
    reinitialiserInvitation();
    prevenir();
  });

  // L'utilisateur ferme l'app installée et revient dans l'onglet : le bouton suit.
  try {
    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', prevenir);
  } catch {
    /* navigateur sans addEventListener sur MediaQueryList : sans conséquence */
  }
}

/* ───────────────────────────── Diagnostic (support) ───────────────────────── */

/**
 * Affichage forcé + diagnostic : il suffit d'ouvrir l'app avec `?pwa=1`.
 *
 * Pourquoi c'est là : sur un téléphone où l'invitation a été fermée trois fois (ou
 * pendant un test terrain), on ne sait plus si le bandeau manque parce que le
 * navigateur ne propose pas l'installation, parce que le service worker n'est pas
 * enregistré, ou parce que l'invitation a été masquée volontairement. `?pwa=1`
 * répond aux trois questions à l'écran, et remet le compteur à zéro.
 */
export function invitationForcee() {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(window.location.href).searchParams.get('pwa') === '1';
  } catch {
    return false;
  }
}

/**
 * État réel du service worker, affiché par le diagnostic `?pwa=1`.
 * L'installation sur l'écran d'accueil dépend de trois choses côté navigateur :
 * HTTPS, un manifeste valide, et un service worker ACTIF (avec gestionnaire
 * `fetch`). Savoir lequel manque évite de deviner. Renvoie une phrase lisible.
 */
export async function etatServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'non supporté';
  try {
    const enregistrement = await navigator.serviceWorker.getRegistration();
    if (!enregistrement) return 'non enregistré';
    if (enregistrement.active) return `actif (${enregistrement.scope})`;
    if (enregistrement.installing) return 'installation en cours';
    return 'en attente d’activation';
  } catch {
    return 'indisponible';
  }
}

export default {
  CLE_INVITATIONS_IGNOREES,
  IGNORANCES_MAX,
  CHEMIN_SERVICE_WORKER,
  estApplicationInstallee,
  estNavigateurIOS,
  etatInvitation,
  ecouterInvitation,
  demanderInstallation,
  lireIgnorances,
  invitationMasquee,
  ignorerInvitation,
  reinitialiserInvitation,
  enregistrerServiceWorker,
  invitationForcee,
  etatServiceWorker,
};
