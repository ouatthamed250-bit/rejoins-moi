/* sw.js — Service worker de Rejoins'Moi (PWA installable, sans APK natif).
 *
 * Objectif : l'app s'ouvre même quand le réseau 3G est mauvais ou coupé, sans
 * jamais mentir à l'utilisateur sur l'état de son argent. Trois règles :
 *
 *  1. APP SHELL (HTML, CSS, JS, icônes) -> mis en cache à l'installation, puis
 *     rafraîchi en tâche de fond (« stale-while-revalidate »). L'app démarre
 *     instantanément et se met à jour à la visite suivante.
 *  2. DONNÉES DYNAMIQUES (GET /api/... publics) -> « network first » : le réseau
 *     d'abord, la dernière copie connue seulement en secours (mode démo existant).
 *  3. PAIEMENTS / COMPTE -> JAMAIS de cache, jamais de lecture depuis le cache :
 *     tout ce qui touche à l'argent (CinetPay, abonnement, déblocage de contact)
 *     et tout ce qui touche à l'identité (connexion, inscription, profil privé)
 *     traverse toujours le réseau, et toute méthode non-GET est laissée telle
 *     quelle. Le serveur reste seul juge du paiement (règle de sécurité du projet).
 */

// v3 : passage aux icônes DÉFINITIVES (logo du fondateur, jeu PNG).
// Changer la version est indispensable : les icônes sont servies « cache d'abord »,
// donc sans nouveau nom de cache un téléphone déjà installé garderait indéfiniment
// l'ancien logo provisoire. `activate` supprime les caches des versions passées.
const VERSION = 'v3';
const CACHE_APP = `rejoinsmoi-app-${VERSION}`;
const CACHE_DONNEES = `rejoinsmoi-donnees-${VERSION}`;
const CACHES_ACTUELS = [CACHE_APP, CACHE_DONNEES];

/* Base d'installation, déduite de l'emplacement du worker lui-même :
 *  - « / » si l'app est à la racine d'un domaine (Vercel, Netlify) ;
 *  - « /rejoins-moi/ » si l'app est dans un sous-dossier (GitHub Pages).
 * Sans cela, la coquille serait préchargée à la racine du domaine : sur Pages,
 * les 7 fichiers répondraient 404 et le mode hors ligne serait inopérant. */
const BASE_APPLICATION = new URL(self.location.href).pathname.replace(/[^/]*$/, '');

/* Fichiers strictement nécessaires au premier écran (l'app shell). */
const APP_SHELL = [
  BASE_APPLICATION,
  `${BASE_APPLICATION}index.html`,
  `${BASE_APPLICATION}manifest.json`,
  `${BASE_APPLICATION}icons/icon-192.png`,
  `${BASE_APPLICATION}icons/icon-512.png`,
  `${BASE_APPLICATION}icons/apple-touch-icon-180.png`,
];

/* Zones interdites au cache : on ne touche même pas à la requête. */
const CHEMINS_SENSIBLES = [
  /^\/api\/subscriptions/, // formules, souscrire, résilier, webhook CinetPay
  /unlock-contact/, // déblocage d'un contact (argent)
  /^\/api\/jobs\/[^/]+\/(unlock|pay)/,
  /^\/api\/users\/(login|register|me|mot-de-passe|token)/, // identité
  /^\/api\/auth/,
];

/** Hôtes de la passerelle de paiement : le service worker ne s'en mêle jamais. */
const HOTES_PAIEMENT = ['cinetpay.com', 'cinetpay.net', 'paytech'];

/** Nombre d'entrées maximum gardées dans le cache de données (téléphone modeste). */
const MAX_ENTREES_DONNEES = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP);
      // `addAll` échoue en bloc si UN fichier manque : on tolère les absents pour
      // ne jamais bloquer l'installation (les icônes de l'app peuvent changer).
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const noms = await caches.keys();
      await Promise.all(
        noms
          .filter((nom) => nom.startsWith('rejoinsmoi-') && !CACHES_ACTUELS.includes(nom))
          .map((nom) => caches.delete(nom))
      );
      // Navigation preload : le navigateur lance la requête en parallèle du
      // démarrage du worker (gain réel sur réseau lent). Ignoré si indisponible.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => null);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1) Toute méthode autre que GET : réseau pur, aucun cache (POST /souscrire...).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 2) Paiement : jamais d'interception, dans un sens comme dans l'autre.
  if (HOTES_PAIEMENT.some((hote) => url.hostname.includes(hote))) return;

  // 3) Origine différente (API déployée ailleurs, Google Fonts) : hors périmètre.
  if (url.origin !== self.location.origin) return;

  // 4) Argent / identité : le réseau décide, le cache n'existe pas pour ces URL.
  if (CHEMINS_SENSIBLES.some((motif) => motif.test(url.pathname))) return;

  // 5) Ouverture de l'app (navigation) : réseau d'abord, app shell en secours.
  if (request.mode === 'navigate') {
    event.respondWith(gererNavigation(event));
    return;
  }

  // 6) Données dynamiques de l'API : réseau d'abord, dernière copie en secours.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(gererDonnees(request));
    return;
  }

  // 7) Fichiers statiques de l'app : cache d'abord, rafraîchissement en fond.
  event.respondWith(gererStatique(request));
});

/** Navigation : on sert la page fraîche, sinon l'app shell mis en cache. */
async function gererNavigation(event) {
  try {
    const reponse = await (event.preloadResponse || fetch(event.request));
    if (reponse && reponse.ok) {
      const cache = await caches.open(CACHE_APP);
      cache.put(`${BASE_APPLICATION}index.html`, reponse.clone()).catch(() => null);
    }
    return reponse;
  } catch {
    const cache = await caches.open(CACHE_APP);
    return (
      (await cache.match(`${BASE_APPLICATION}index.html`)) ||
      (await cache.match(BASE_APPLICATION)) ||
      new Response('Rejoins’Moi est hors ligne.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

/**
 * Données : le réseau gagne toujours ; on ne garde la réponse que si elle est
 * vraiment bonne (200, réponse d'origine) et on s'en sert UNIQUEMENT si le réseau
 * est indisponible. Jamais de données périmées présentées comme fraîches.
 */
async function gererDonnees(request) {
  try {
    const reponse = await fetch(request);
    if (reponse && reponse.status === 200 && reponse.type === 'basic') {
      const cache = await caches.open(CACHE_DONNEES);
      await cache.put(request, reponse.clone());
      elaguer(cache);
    }
    return reponse;
  } catch (erreur) {
    const cache = await caches.open(CACHE_DONNEES);
    const secours = await cache.match(request);
    if (!secours) throw erreur;
    // En-tête informatif : le front peut signaler « données d'exemple »
    // (InfoBanner « Mode démonstration » déjà en place).
    const entetes = new Headers(secours.headers);
    entetes.set('X-RejoinsMoi-Cache', 'hors-ligne');
    return new Response(await secours.blob(), {
      status: 200,
      statusText: 'OK (cache hors ligne)',
      headers: entetes,
    });
  }
}

/** Statique : réponse immédiate depuis le cache, mise à jour en tâche de fond. */
async function gererStatique(request) {
  const cache = await caches.open(CACHE_APP);
  const enCache = await cache.match(request);
  const reseau = fetch(request)
    .then((reponse) => {
      if (reponse && reponse.status === 200 && reponse.type === 'basic') {
        cache.put(request, reponse.clone()).catch(() => null);
      }
      return reponse;
    })
    .catch(() => null);

  return enCache || (await reseau) || Response.error();
}

/** Garde le cache de données borné : on retire les entrées les plus anciennes. */
async function elaguer(cache) {
  const cles = await cache.keys();
  if (cles.length <= MAX_ENTREES_DONNEES) return;
  const enTrop = cles.slice(0, cles.length - MAX_ENTREES_DONNEES);
  await Promise.all(enTrop.map((cle) => cache.delete(cle)));
}

/* Message du front (« mise à jour disponible ») : on active tout de suite. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
