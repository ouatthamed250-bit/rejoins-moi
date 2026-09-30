// client.js — Client HTTP minimal vers l'API Rejoins'Moi.
//
// Décisions :
//  - Aucune dépendance ajoutée (pas d'axios) : `fetch` natif suffit et garde le
//    bundle léger, ce qui compte sur un smartphone d'entrée de gamme en 3G.
//  - L'URL de base est VIDE par défaut : en développement le proxy Vite
//    (vite.config.js) redirige `/api` vers http://localhost:4000. En production,
//    définir VITE_API_URL.
//  - Le JWT est conservé dans localStorage et envoyé en en-tête `Authorization`.
//  - Un backend indisponible (503, erreur réseau, ou réponse non-JSON servie par
//    un hébergeur statique) lève une ApiError marquée `offline: true` : les
//    écrans basculent alors sur les données de démonstration
//    (src/data/demoData.js) au lieu d'afficher un écran vide — indispensable
//    pendant la phase de tournée terrain où le réseau est instable.

const BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const CLE_TOKEN = 'rejoinsmoi.token';
const CLE_PROFIL = 'rejoinsmoi.profil';

export class ApiError extends Error {
  constructor(status, message, details, offline = false) {
    super(message || 'Erreur inconnue');
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.offline = offline;
  }
}

// ── Gestion du jeton ─────────────────────────────────────────────────────────

export function getToken() {
  try {
    return localStorage.getItem(CLE_TOKEN) || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(CLE_TOKEN, token);
    else localStorage.removeItem(CLE_TOKEN);
  } catch {
    /* navigation privée : on continue sans persistance */
  }
}

export function getProfilLocal() {
  try {
    const brut = localStorage.getItem(CLE_PROFIL);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

export function setProfilLocal(profil) {
  try {
    if (profil) localStorage.setItem(CLE_PROFIL, JSON.stringify(profil));
    else localStorage.removeItem(CLE_PROFIL);
  } catch {
    /* idem */
  }
}

export function deconnexion() {
  setToken(null);
  setProfilLocal(null);
}

// ── Requête générique ────────────────────────────────────────────────────────

/**
 * @param {string} chemin  ex. '/establishments?categorie=beaute'
 * @param {object} [options]
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} [options.method]
 * @param {object} [options.body]
 * @param {boolean} [options.auth=true]  envoyer le JWT s'il existe
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs=20000]  au-delà, on considère le réseau perdu
 * @returns {Promise<any>} le JSON désérialisé
 * @throws {ApiError}
 */
export async function requete(chemin, { method = 'GET', body, auth = true, signal, timeoutMs = 20000 } = {}) {
  const url = `${BASE}/api${chemin.startsWith('/') ? chemin : `/${chemin}`}`;
  const headers = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  // Timeout maîtrisé : sans cela, un réseau 3G qui "pend" bloque l'écran à vie.
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controleur.abort(), { once: true });

  let reponse;
  try {
    reponse = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controleur.signal,
    });
  } catch (err) {
    throw new ApiError(0, 'Serveur injoignable. Vérifiez votre connexion internet.', null, true);
  } finally {
    clearTimeout(minuteur);
  }

  let donnees = null;
  const texte = await reponse.text();
  if (texte) {
    try {
      donnees = JSON.parse(texte);
    } catch {
      donnees = { error: texte.slice(0, 300) };
    }
  }

  // Notre API répond TOUJOURS du JSON, y compris pour ses erreurs (errorHandler
  // côté backend). Une réponse non-JSON ne vient donc pas d'elle : c'est la page
  // d'erreur d'un hébergeur, l'index.html d'un site statique (GitHub Pages), ou
  // un portail Wi-Fi captif. On la classe « serveur injoignable », comme une
  // panne réseau : les écrans affichent alors les données d'exemple au lieu
  // d'une erreur incompréhensible, et la connexion en mode démonstration reste
  // possible. Sans cette règle, un site statique renvoyant du HTML sur /api
  // ferait passer un 200 HTML pour une réponse valide (données absurdes) et un
  // 404 HTML pour un refus métier (connexion impossible).
  // ⚠️ Aucun risque côté argent : utils/abonnement.js et utils/payment.js
  // traduisent « injoignable » par « réessayez », jamais par un faux abonnement.
  const contenuJson = (reponse.headers.get('content-type') || '').includes('json');
  const sansCorps = reponse.status === 204 || texte.trim() === '';
  const repondueParApi = contenuJson || sansCorps;

  if (!reponse.ok || !repondueParApi) {
    // 503 = base indisponible (backend en mode démo) : on marque `offline`.
    const offline = reponse.status === 503 || donnees?.offline === true || !repondueParApi;
    throw new ApiError(
      reponse.status,
      offline
        ? 'Serveur injoignable. Vérifiez votre connexion internet.'
        : donnees?.error || `Erreur ${reponse.status}`,
      donnees?.details,
      offline
    );
  }

  return donnees;
}

export const api = {
  get: (chemin, options) => requete(chemin, { ...options, method: 'GET' }),
  post: (chemin, body, options) => requete(chemin, { ...options, method: 'POST', body }),
  patch: (chemin, body, options) => requete(chemin, { ...options, method: 'PATCH', body }),
  delete: (chemin, options) => requete(chemin, { ...options, method: 'DELETE' }),
};

export default api;
