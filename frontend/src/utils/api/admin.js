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

async function requeteAdmin(chemin, { method = 'GET', body, token, brut = false } = {}) {
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

  if (!reponse.ok) {
    // 401/403 : session admin invalide ou compte non admin -> on nettoie le jeton local.
    if (reponse.status === 401 || reponse.status === 403) setAdminToken(null);
    throw new AdminError(reponse.status, donnees?.error || `Erreur ${reponse.status}`, donnees?.details);
  }
  // Réponse BRUTE (fichier CSV de paie) : on renvoie le texte tel quel. Le parser
  // en JSON ferait perdre le fichier — la route ne répond pas du JSON, exprès.
  if (brut) return texte;
  if (!donnees) throw new AdminError(reponse.status, `Erreur ${reponse.status}`);
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
  // Droit à l'effacement côté back-office (20/11) : anonymise le compte (nom, numéro,
  // photo, avis, annonces) au lieu de le supprimer — les dépôts/abonnements payés
  // restent pour la comptabilité. Le serveur EXIGE `confirmation` (le nom affiché du
  // compte, ou son numéro tel qu'affiché) : une faute de frappe dans le tiroir ne doit
  // jamais effacer la mauvaise personne. `motif` est facultatif (journalisé).
  supprimerUtilisateur: (id, confirmation, motif = '') =>
    requeteAdmin(`/utilisateurs/${id}`, { method: 'DELETE', body: { confirmation, motif } }),
  depots: (statut = 'en_attente') => requeteAdmin(`/depots${chaineParametres({ statut })}`),
  validerDepot: (id) => requeteAdmin(`/depots/${id}/valider`, { method: 'POST', body: {} }),
  rejeterDepot: (id, noteAdmin) => requeteAdmin(`/depots/${id}/rejeter`, { method: 'POST', body: { noteAdmin } }),
  // Réclamations de fiches importées (bloc D) : « c'est mon établissement » à trancher.
  reclamations: (statut = 'en_attente') => requeteAdmin(`/reclamations${chaineParametres({ statut })}`),
  deciderReclamation: (etablissementId, decision) =>
    requeteAdmin(`/reclamations/${etablissementId}`, { method: 'POST', body: { decision } }),
  // Revendications de fiche (correctif du 27/11) : la demande n'est plus jamais
  // acceptée automatiquement sur la foi de coordonnées GPS envoyées par le client.
  // L'admin tranche ici, à la main.
  demandesRevendication: (statut = 'en_attente') =>
    requeteAdmin(`/demandes-revendication${chaineParametres({ statut })}`),
  validerRevendication: (id) =>
    requeteAdmin(`/demandes-revendication/${id}/valider`, { method: 'PATCH' }),
  rejeterRevendication: (id, noteAdmin = '') =>
    requeteAdmin(`/demandes-revendication/${id}/rejeter`, { method: 'PATCH', body: { noteAdmin } }),
  // Catégories PROPOSÉES par les gérants (« Autre (précisez) ») : file de modération.
  // La taxonomie locale ne peut pas être inventée depuis un bureau — on valide ce que
  // le terrain demande, famille par famille (prompt 6).
  demandesCategories: (statut = 'en_attente') =>
    requeteAdmin(`/demandes-categories${chaineParametres({ statut })}`),
  validerDemandeCategorie: (id, famille = '') =>
    requeteAdmin(`/demandes-categories/${id}/valider`, { method: 'POST', body: { famille } }),
  refuserDemandeCategorie: (id, noteAdmin = '') =>
    requeteAdmin(`/demandes-categories/${id}/refuser`, { method: 'POST', body: { noteAdmin } }),
  // Annonces signalées (prompt 7) : file de modération, les plus signalées d'abord.
  // Retirer une annonce est une SUPPRESSION réelle côté serveur (une annonce
  // frauduleuse ne doit pas rester « en pause »).
  annoncesSignalees: () => requeteAdmin('/annonces-signalees'),
  supprimerAnnonce: (id) => requeteAdmin(`/jobs/${id}`, { method: 'DELETE' }),
  // ── Messagerie interne (prompt B) ─────────────────────────────────────────
  // Retrouver les conversations d'un compte : par nom, prénom, numéro, ou en
  // collant directement un identifiant de conversation.
  conversations: (params = {}) =>
    requeteAdmin(`/conversations${typeof params === 'string' ? params : chaineParametres(params)}`),
  // Extraction d'une conversation (réquisition légale) : le serveur renvoie un
  // objet JSON complet (métadonnées, participants avec numéros, messages datés).
  // Le téléchargement du fichier est fait par l'écran, pas par ce client.
  exportConversation: (id) => requeteAdmin(`/conversations/${id}/export`),
  // ── Agents de terrain (prompt 9) ──────────────────────────────────────────
  // Le code de l'agent est TIRÉ AU SORT côté serveur : il n'est jamais choisi ici
  // (un agent ne doit pas pouvoir s'attribuer le code d'un collègue).
  agents: () => requeteAdmin('/agents'),
  creerAgent: (nom) => requeteAdmin('/agents', { method: 'POST', body: { nom } }),
  modifierAgent: (id, patch) => requeteAdmin(`/agents/${id}`, { method: 'PATCH', body: patch }),
  // Qui travaille en ce moment (agents `enService` + statut `actif`), avec la
  // dernière position GPS. La carte du back-office s'appuie dessus.
  carteAgents: () => requeteAdmin('/agents/carte'),
  // Code d'activation à 8 caractères, renvoyé UNE SEULE FOIS (il vit sur un champ
  // `select: false`) : l'écran doit l'afficher tout de suite, jamais le remettre en
  // cache. `{ agentId }` = compte déjà inscrit ; `{ nom, telephone }` = recrutement
  // saisi directement par l'administrateur (le code agent est tiré au sort).
  genererCodeAgent: ({ agentId = '', nom = '', telephone = '' } = {}) =>
    requeteAdmin('/agents/generer-code', {
      method: 'POST',
      body: agentId ? { agentId } : { nom, telephone },
    }),
  // « actif » | « suspendu » | « en_attente ». La suspension coupe la connexion ET
  // le pointage au prochain appel (le serveur relit le statut en base).
  changerStatutAgent: (id, statut) =>
    requeteAdmin(`/agents/${id}/statut`, { method: 'PATCH', body: { statut } }),
  // Les fiches déjà créées gardent leur `codeAgent` : la paie passée reste vérifiable.
  supprimerAgent: (id) => requeteAdmin(`/agents/${id}`, { method: 'DELETE' }),
  // Fiches créées par agent et par jour (30 jours par défaut) : c'est la vue de paie.
  rapportAgents: (jours = 30) => requeteAdmin(`/agents/rapport${chaineParametres({ jours })}`),
  // CSV de paie : la route répond un FICHIER (text/csv), pas du JSON — d'où `brut`.
  exportAgentsCsv: () => requeteAdmin('/agents/export-csv', { brut: true }),
  // Anti-fraude : fiches marquées `aVerifier` et levée de doute depuis le back-office.
  fichesAVerifier: (limit = 100) =>
    requeteAdmin(`/fiches-a-verifier${chaineParametres({ limit })}`),
  validerFiche: (id) =>
    requeteAdmin(`/etablissements/${id}/verification`, {
      method: 'PATCH',
      body: { aVerifier: false },
    }),
};

export default adminApi;