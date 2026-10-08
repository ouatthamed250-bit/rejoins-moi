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
 * DÉMARRAGE À FROID (bloc A, correction de lancement).
 *
 * Mesuré en production : une fois l'instance réveillée, `GET /api/establishments`
 * répond en moins de 2 s. Mais l'hébergement endort l'instance après quelques
 * minutes d'inactivité : le TOUT PREMIER appel de la journée traverse un
 * démarrage à froid qui peut dépasser 20 s. Avec l'ancien délai unique de 20 s,
 * la page d'accueil abandonnait, et l'écran basculait sur les données d'EXEMPLE :
 * l'utilisateur croyait l'annuaire vide.
 *
 * Trois règles compensent cela, sans jamais bloquer l'écran :
 *   1. le PREMIER appel d'une session attend plus longtemps (60 s au lieu de 20 s) ;
 *   2. cet appel est RETENTÉ une fois — il a justement servi à réveiller l'instance ;
 *   3. les appels suivants gardent le délai court : une fois l'instance éveillée,
 *      inutile de faire patienter l'utilisateur une minute sur un réseau lent.
 * Le tout est BORNÉ : 90 s au maximum (60 s + 30 s), jamais plus. Mesure réelle du
 * 08/10 : 23,7 s à froid, 0,5–0,8 s à chaud — l'attente est donc rare ET expliquée.
 * Aucun écran n'est laissé sans information : les écrans affichent un message
 * « réveil du service » tant que l'attente dure (voir Feed.jsx).
 */
export const REVEIL_TIMEOUT_MS = 60000;
/** Budget TOTAL d'un premier appel, second essai compris : il ne dépasse jamais 90 s. */
export const BUDGET_REVEIL_MS = 90000;
export const TIMEOUT_DEFAUT_MS = 20000;
/** Au-delà de ce silence, l'API est probablement endormie. */
const INACTIVITE_REVEIL_MS = 5 * 60 * 1000;

let dernierSuccesAt = 0;

/** Vrai si l'API n'a encore jamais répondu dans cette session, ou plus depuis longtemps. */
export function apiProbablementEndormie() {
  return dernierSuccesAt === 0 || Date.now() - dernierSuccesAt > INACTIVITE_REVEIL_MS;
}

/**
 * @param {string} chemin  ex. '/establishments?categorie=beaute'
 * @param {object} [options]
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} [options.method]
 * @param {object} [options.body]
 * @param {boolean} [options.auth=true]  envoyer le JWT s'il existe
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]  au-delà, on considère le réseau perdu
 *                                      (défaut : 60 s au 1er appel, 20 s ensuite)
 * @returns {Promise<any>} le JSON désérialisé
 * @throws {ApiError}
 */
export async function requete(chemin, { method = 'GET', body, auth = true, signal, timeoutMs } = {}) {
  const url = `${BASE}/api${chemin.startsWith('/') ? chemin : `/${chemin}`}`;
  const headers = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const reveilPossible = apiProbablementEndormie();
  // Une LECTURE peut être retentée sans risque ; une écriture jamais (un paiement
  // ou une inscription rejoué créerait un doublon). Et on ne retente pas si
  // l'écran a été quitté (`signal`).
  const peutRetenter = method === 'GET' && !signal && reveilPossible;

  /** Délai de l'essai n° `essai` : 60 s puis 30 s au réveil (budget total borné). */
  function limiteDeLEssai(essai) {
    if (timeoutMs != null) return timeoutMs;
    if (!reveilPossible) return TIMEOUT_DEFAUT_MS;
    return essai === 0 ? REVEIL_TIMEOUT_MS : BUDGET_REVEIL_MS - REVEIL_TIMEOUT_MS;
  }

  /** Un essai. `AbortController` maîtrisé : sans lui, un réseau 3G « pend » à vie. */
  async function tenter(limiteMs) {
    const controleur = new AbortController();
    // Distingue « le serveur est lent » (notre minuteur a coupé) de « le réseau est
    // mort » (échec immédiat de fetch). Seul le premier justifie un nouvel essai.
    let delaiDepasse = false;
    const minuteur = setTimeout(() => {
      delaiDepasse = true;
      controleur.abort();
    }, limiteMs);
    if (signal) signal.addEventListener('abort', () => controleur.abort(), { once: true });

    try {
      return await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controleur.signal,
      });
    } catch {
      const erreur = new ApiError(0, 'Serveur injoignable. Vérifiez votre connexion internet.', null, true);
      /** Vrai si c'est NOTRE délai qui a coupé : indicatif, ne pas exposer à l'UI. */
      erreur.delaiDepasse = delaiDepasse;
      throw erreur;
    } finally {
      clearTimeout(minuteur);
    }
  }

  const essaisMax = peutRetenter ? 2 : 1;
  let reponse = null;
  for (let essai = 0; essai < essaisMax; essai += 1) {
    const dernierEssai = essai + 1 >= essaisMax;
    try {
      reponse = await tenter(limiteDeLEssai(essai));
    } catch (err) {
      // Délai dépassé : l'instance se réveille encore et le premier appel l'a
      // justement réveillée — un second essai aboutit presque toujours. Un échec
      // réseau franc, lui, échoue tout de suite : inutile de faire patienter.
      if (!dernierEssai && err.delaiDepasse) continue;
      throw err;
    }
    // 502/503 : l'hébergeur annonce lui-même une instance en cours de démarrage.
    if (!dernierEssai && (reponse.status === 502 || reponse.status === 503)) continue;
    break;
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

  // L'API a répondu : les prochains appels repassent au délai court.
  dernierSuccesAt = Date.now();
  return donnees;
}

export const api = {
  get: (chemin, options) => requete(chemin, { ...options, method: 'GET' }),
  post: (chemin, body, options) => requete(chemin, { ...options, method: 'POST', body }),
  patch: (chemin, body, options) => requete(chemin, { ...options, method: 'PATCH', body }),
  delete: (chemin, options) => requete(chemin, { ...options, method: 'DELETE' }),
};

export default api;
