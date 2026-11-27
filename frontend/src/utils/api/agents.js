// agents.js — Client HTTP de l'ESPACE AGENT DE TERRAIN (/api/agents).
//
// Le jeton de l'agent est conservé À PART de celui de l'utilisateur et de celui
// de l'administrateur (clé localStorage distincte). Un agent qui ouvre /agent
// sur son téléphone ne déconnecte donc personne, et surtout : une session agent
// ne peut PAS ouvrir l'application utilisateur (le serveur refuse un jeton
// `role: 'agent'` sur /api/users — voir middleware/auth.js).
//
// Même parti pris que utils/api/client.js : `fetch` natif, aucun paquet ajouté,
// et un délai borné pour ne jamais laisser un écran bloqué sur un réseau 3G.

const BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const CLE_TOKEN = 'rejoinsmoi.agentToken';
const CLE_PROFIL = 'rejoinsmoi.agentProfil';

/** Erreur d'API côté agent, avec le code métier (`details.code`). */
export class AgentError extends Error {
  constructor(status, message, details) {
    super(message || 'Erreur agent');
    this.name = 'AgentError';
    this.status = status;
    this.details = details;
    /** Code métier : AGENT_EN_ATTENTE, AGENT_SUSPENDU, AGENT_SANS_CODE… */
    this.code = details?.code || '';
  }
}

// ── Session de l'agent (localStorage) ────────────────────────────────────────

export function getAgentToken() {
  try {
    return localStorage.getItem(CLE_TOKEN) || null;
  } catch {
    return null;
  }
}

export function setAgentToken(token) {
  try {
    if (token) localStorage.setItem(CLE_TOKEN, token);
    else localStorage.removeItem(CLE_TOKEN);
  } catch {
    /* navigation privée : on continue sans persistance */
  }
}

export function getAgentProfil() {
  try {
    const brut = localStorage.getItem(CLE_PROFIL);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

export function setAgentProfil(profil) {
  try {
    if (profil) localStorage.setItem(CLE_PROFIL, JSON.stringify(profil));
    else localStorage.removeItem(CLE_PROFIL);
  } catch {
    /* idem */
  }
}

/**
 * Déconnexion de l'AGENT uniquement.
 * On ne vide que les deux clés de l'espace agent : un éventuel compte
 * utilisateur ouvert dans le même navigateur (gérant, client) garde sa session.
 */
export function deconnexionAgent() {
  setAgentToken(null);
  setAgentProfil(null);
}

// ── Requête générique ────────────────────────────────────────────────────────

async function requeteAgent(chemin, { method = 'GET', body, token } = {}) {
  const url = `${BASE}/api/agents${chemin.startsWith('/') ? chemin : `/${chemin}`}`;
  const entetes = { Accept: 'application/json' };
  if (body !== undefined) entetes['Content-Type'] = 'application/json';
  const jeton = token === undefined ? getAgentToken() : token;
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
    throw new AgentError(0, 'Serveur injoignable. Vérifiez votre connexion internet.');
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

  if (!reponse.ok) {
    // 401 : session agent expirée ou invalide -> on nettoie pour ne pas boucler
    // sur un écran « connecté » qui ne peut plus rien enregistrer.
    if (reponse.status === 401) setAgentToken(null);
    throw new AgentError(
      reponse.status,
      donnees?.error || `Erreur ${reponse.status}`,
      donnees?.details
    );
  }
  return donnees;
}

export const agentsApi = {
  /** Inscription : crée un compte `en_attente` (aucun jeton renvoyé). */
  register: ({ nom, telephone, motDePasse }) =>
    requeteAgent('/register', { method: 'POST', body: { nom, telephone, motDePasse }, token: null }),

  /** Activation par code d'activation remis par l'administrateur. */
  activer: ({ telephone, motDePasse, codeActivation }) =>
    requeteAgent('/activer', {
      method: 'POST',
      body: { telephone, motDePasse, codeActivation },
      token: null,
    }),

  /** Connexion (échoue avec code AGENT_EN_ATTENTE si le compte n'est pas activé). */
  login: (telephone, motDePasse) =>
    requeteAgent('/login', { method: 'POST', body: { telephone, motDePasse }, token: null }),

  moi: () => requeteAgent('/me'),

  /** Pointage GPS : { lat, lng, enService }. */
  pointage: ({ lat, lng, enService }) =>
    requeteAgent('/pointage', { method: 'POST', body: { lat, lng, enService } }),

  mesFiches: () => requeteAgent('/mes-fiches'),

  /** Compte du gérant + fiche établissement, en un seul appel. */
  creerFiche: (payload) => requeteAgent('/creer-fiche', { method: 'POST', body: payload }),
};

export default agentsApi;
