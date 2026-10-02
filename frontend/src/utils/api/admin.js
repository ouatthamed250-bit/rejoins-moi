// admin.js — Client HTTP du BACK-OFFICE administrateur.
//
// Le jeton admin est CONSERVÉ À PART de celui de l'utilisateur (clé localStorage
// distincte) : un administrateur peut ainsi ouvrir /admin sur son téléphone sans
// écraser la session du compte « normal ». Toutes les requêtes portent ce jeton.

const BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const CLE_ADMIN = 'rejoinsmoi.adminToken';

export class AdminError extends Error {
  constructor(status, message, details) {
    super(message || 'Erreur administrateur');
    this.name = 'AdminError';
    this.status = status;
    this.details = details;
  }
}

export function getAdminToken() {
  try {
    return localStorage.getItem(CLE_ADMIN) || null;
  } catch {
    return null;
  }
}

export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(CLE_ADMIN, token);
    else localStorage.removeItem(CLE_ADMIN);
  } catch {
    /* navigation privée : on continue sans persistance */
  }
}

async function requeteAdmin(chemin, { method = 'GET', body, token } = {}) {
  const url = `${BASE}/api/admin${chemin.startsWith('/') ? chemin : `/${chemin}`}`;
  const entetes = { Accept: 'application/json' };
  if (body !== undefined) entetes['Content-Type'] = 'application/json';
  const jeton = token === undefined ? getAdminToken() : token;
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 20000);

  let reponse;
  try {
    reponse = await fetch(url, {
      method,
      headers: entetes,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controleur.signal,
    });
  } catch {
    clearTimeout(minuteur);
    throw new AdminError(0, 'Serveur injoignable. Vérifiez votre connexion internet.');
  } finally {
    clearTimeout(minuteur);
  }

  let donnees = null;
  const texte = await reponse.text();
  if (texte) {
    try {
      donnees = JSON.parse(texte);
    } catch {
      donnees = null;
    }
  }

  if (!reponse.ok || !donnees) {
    // 401/403 : session admin invalide ou compte non admin -> on nettoie le jeton local.
    if (reponse.status === 401 || reponse.status === 403) setAdminToken(null);
    throw new AdminError(reponse.status, donnees?.error || `Erreur ${reponse.status}`, donnees?.details);
  }
  return donnees;
}

/**
 * Construit une chaîne de requête `?a=1&b=2` en ignorant les valeurs vides.
 * Utilisé par les listes du back-office (recherche, filtres, tri, pagination) : on passe
 * un objet, jamais une chaîne concaténée à la main — une valeur oubliée devient une URL
 * cassée au lieu d'un filtre.
 */
export function chaineParametres(params = {}) {
  const morceaux = Object.entries(params)
    .filter(([, valeur]) => valeur !== undefined && valeur !== null && valeur !== '')
    .map(([cle, valeur]) => `${encodeURIComponent(cle)}=${encodeURIComponent(valeur)}`);
  return morceaux.length ? `?${morceaux.join('&')}` : '';
}

export const adminApi = {
  login: (identifiant, motDePasse) =>
    requeteAdmin('/login', { method: 'POST', body: { identifiant, motDePasse }, token: null }),
  moi: () => requeteAdmin('/moi'),
  changerMonMotDePasse: (ancienMotDePasse, nouveauMotDePasse) =>
    requeteAdmin('/moi/mot-de-passe', { method: 'PATCH', body: { ancienMotDePasse, nouveauMotDePasse } }),
  statistiques: () => requeteAdmin('/statistiques'),
  // Journal d'activité : inscriptions + connexions + paiements fusionnés, du plus récent
  // au plus ancien (GET /api/admin/activite).
  activite: (params = {}) => requeteAdmin(`/activite${chaineParametres(params)}`),
  // Accepte un objet (recommandé) ou, pour compatibilité, une chaîne déjà encodée.
  utilisateurs: (params = {}) =>
    requeteAdmin(`/utilisateurs${typeof params === 'string' ? params : chaineParametres(params)}`),
  utilisateur: (id) => requeteAdmin(`/utilisateurs/${id}`),
  modifierUtilisateur: (id, patch) => requeteAdmin(`/utilisateurs/${id}`, { method: 'PATCH', body: patch }),
  // Validation / suspension d'un compte (PATCH /utilisateurs/:id/statut) : la suspension
  // coupe la connexion ET les jetons déjà émis (voir middleware/auth.js côté serveur).
  changerStatut: (id, statut, motif = '') =>
    requeteAdmin(`/utilisateurs/${id}/statut`, { method: 'PATCH', body: { statut, motif } }),
  reinitialiserMotDePasse: (id, motDePasse) =>
    requeteAdmin(`/utilisateurs/${id}/mot-de-passe`, { method: 'POST', body: { motDePasse } }),
  depots: (statut = 'en_attente') => requeteAdmin(`/depots${chaineParametres({ statut })}`),
  validerDepot: (id) => requeteAdmin(`/depots/${id}/valider`, { method: 'POST', body: {} }),
  rejeterDepot: (id, noteAdmin) => requeteAdmin(`/depots/${id}/rejeter`, { method: 'POST', body: { noteAdmin } }),
};

export default adminApi;