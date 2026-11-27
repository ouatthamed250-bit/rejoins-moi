// auth.js — Middleware d'authentification JWT (auth par numéro de téléphone)
//
// Décision produit : l'authentification se fait par numéro de téléphone + mot de
// passe (pas d'e-mail), cohérent avec les usages locaux et le mobile money
// (§2, §10). Un futur passage à l'OTP par SMS se fera sans changer les routes :
// il suffira d'émettre le même JWT après validation du code.

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Agent from '../models/Agent.js';

const FALLBACK_SECRET = 'rejoins-moi-dev-secret-non-securise';

/**
 * Durée de vie du jeton du BACK-OFFICE (bloc F du 12/10) : 12 heures.
 * Un jeton admin ouvre TOUT (valider un dépôt = révéler un contact payé, suspendre un
 * compte, lire les numéros de tout le monde). Il n'a aucune raison de vivre 30 jours
 * comme celui d'un utilisateur : la session du back-office est courte, une journée de
 * travail suffit. À échéance, l'administrateur se reconnecte (10 secondes).
 * Surchargeable par ADMIN_JWT_EXPIRES_IN dans backend/.env.
 */
export const DUREE_JETON_ADMIN = process.env.ADMIN_JWT_EXPIRES_IN || '12h';

export function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET obligatoire en production (voir .env.example).');
    }
    console.warn('[auth] JWT_SECRET absent : utilisation du secret de développement. À corriger avant déploiement.');
    return FALLBACK_SECRET;
  }
  return process.env.JWT_SECRET;
}

/**
 * Génère un JWT pour un utilisateur donné.
 * @param {{_id: any, telephone?: string}} user
 * @param {{expiresIn?: string}} [options] durée de vie ; par défaut JWT_EXPIRES_IN
 *   (30 jours — un utilisateur de l'app ne doit pas se reconnecter sans arrêt sur son
 *   téléphone). Le back-office passe `DUREE_JETON_ADMIN` (12 h).
 */
export function signToken(user, { expiresIn } = {}) {
  // Le jeton ne porte aucune notion de rôle : le compte est UNIFIÉ (ajout du 29/09).
  // Les capacités (estArtisan, chercheTravail) sont relues en base à chaque requête
  // via `protect`, donc toujours à jour — un jeton émis il y a 20 jours ne peut pas
  // prétendre qu'un utilisateur est encore artisan.
  return jwt.sign(
    { sub: String(user._id), telephone: user.telephone },
    getJwtSecret(),
    { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '30d' }
  );
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Jeton d'un AGENT DE TERRAIN (espace /agent, 26/11).
 *
 * Volontairement DISTINCT de celui d'un utilisateur : le jeton porte
 * `role: 'agent'`, et `protect`/`protectAdmin` refusent ce rôle. Sans ce marqueur,
 * un identifiant d'agent et un identifiant d'utilisateur vivent dans deux
 * collections différentes : une collision d'ObjectId (très improbable, mais pas
 * impossible à écrire dans un test) ouvrirait un espace pour l'autre.
 *
 * Durée courte (12 h par défaut) : un agent travaille une journée, et son jeton
 * ouvre la création de comptes gérants — le laisser vivre 30 jours sur un
 * téléphone partagé pendant une tournée serait inutilement risqué.
 */
export function signAgentToken(agent) {
  return jwt.sign(
    { sub: String(agent._id), role: 'agent', code: agent.code },
    getJwtSecret(),
    { expiresIn: process.env.AGENT_JWT_EXPIRES_IN || '12h' }
  );
}

/**
 * Authentification OBLIGATOIRE d'un agent de terrain.
 * Injecte `req.agent` (document Mongoose, avec le hash chargé pour que les
 * routes puissent vérifier un mot de passe) ou répond 401/403.
 *
 * Le statut est RELU EN BASE à chaque requête : une suspension décidée par
 * l'administrateur coupe l'accès immédiatement, sans attendre l'expiration du
 * jeton (même raisonnement que pour les comptes utilisateurs suspendus).
 */
export async function protectAgent(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Authentification agent requise.' });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.role !== 'agent') {
      return res.status(401).json({ error: 'Jeton agent invalide.' });
    }
    const agent = await Agent.findById(payload.sub).select('+motDePasseHash');
    if (!agent) return res.status(401).json({ error: 'Compte agent introuvable.' });

    const statut = agent.statutEffectif();
    if (statut === 'suspendu') {
      return res.status(403).json({
        error: 'Compte agent suspendu. Contactez l’équipe Rejoins’Moi.',
        details: { code: 'AGENT_SUSPENDU' },
      });
    }
    if (statut !== 'actif') {
      return res.status(403).json({
        error: 'Compte agent en attente d’activation : saisissez le code fourni par l’administrateur.',
        details: { code: 'AGENT_EN_ATTENTE' },
      });
    }

    req.agent = agent;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session agent expirée, reconnectez-vous.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Jeton agent invalide.' });
  }
}

/**
 * Authentification ADMINISTRATEUR (back-office).
 * Vérifie le JWT PUIS que le compte porte `estAdmin: true` (relu en base à chaque
 * requête : retirer le rôle d'un compte coupe l'accès immédiatement). Répond 403 — et
 * non 401 — quand le jeton est valide mais que le compte n'est pas administrateur.
 * Un compte suspendu par le back-office perd aussi l'accès (garde-fou : le compte
 * admin ne devrait jamais l'être — la route de suspension le refuse — mais une
 * donnée héritée ne doit pas ouvrir la porte).
 */
export async function protectAdmin(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Authentification administrateur requise.' });

    const payload = jwt.verify(token, getJwtSecret());
    // Un jeton d'AGENT DE TERRAIN n'ouvre jamais le back-office, même si son
    // porteur connaît un ObjectId de compte administrateur.
    if (payload.role === 'agent') {
      return res.status(401).json({ error: 'Jeton agent refusé sur le back-office.' });
    }
    const user = await User.findById(payload.sub);
    // `supprimeAt` = compte anonymisé (droit à l'effacement). Le document existe
    // encore pour les paiements, mais il ne doit plus rien ouvrir.
    if (!user || user.supprimeAt) {
      return res.status(401).json({ error: 'Compte introuvable ou supprimé.' });
    }
    if ((user.statutCompte || 'actif') === 'suspendu') {
      return res
        .status(403)
        .json({ error: 'Compte administrateur suspendu.', details: { code: 'COMPTE_SUSPENDU' } });
    }
    if (!user.estAdmin) return res.status(403).json({ error: 'Accès administrateur requis.' });

    req.user = user;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session admin expirée, reconnectez-vous.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Jeton invalide.' });
  }
}

/**
 * Authentification obligatoire.
 * Injecte `req.user` (document Mongoose) ou répond 401.
 *
 * Depuis le 01/10, un compte SUSPENDU par le back-office est refusé ici — et non
 * seulement à la connexion : le JWT vit 30 jours, un simple blocage du login
 * laisserait l'utilisateur travailler avec son ancien jeton. Le champ est relu en
 * base à chaque requête, donc la suspension prend effet immédiatement.
 */
export async function protect(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Authentification requise.' });

    const payload = jwt.verify(token, getJwtSecret());
    // Un jeton d'agent de terrain n'ouvre pas une session utilisateur : les deux
    // espaces restent étanches (voir signAgentToken ci-dessus).
    if (payload.role === 'agent') {
      return res.status(401).json({ error: 'Jeton agent refusé : espace utilisateur.' });
    }
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Compte introuvable ou supprimé.' });
    // Compte anonymisé (droit à l'effacement) : le jeton émis avant la
    // suppression, s'il traîne encore sur un téléphone, ne doit plus rien ouvrir.
    // C'est le seul « vidage de session » possible avec des JWT sans état.
    if (user.supprimeAt) {
      return res.status(401).json({
        error: 'Ce compte a été supprimé.',
        details: { code: 'COMPTE_SUPPRIME' },
      });
    }
    if ((user.statutCompte || 'actif') === 'suspendu') {
      return res.status(403).json({
        error: user.motifSuspension
          ? `Compte suspendu : ${user.motifSuspension}`
          : 'Compte suspendu. Contactez l’équipe Rejoins’Moi pour le réactiver.',
        // Même forme que POST /api/users/login (voir routes/users.js) : le client lit
        // toujours le code métier dans `details.code`, jamais à la racine.
        details: { code: 'COMPTE_SUSPENDU' },
      });
    }

    req.user = user;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée, reconnectez-vous.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Jeton invalide.' });
  }
}

/**
 * Authentification optionnelle : si un token valide est présent, `req.user` est
 * renseigné, sinon on continue en anonyme. Utilisé par les routes de lecture
 * publiques (feed, recherche, besoins main-d'œuvre) qui s'enrichissent quand on
 * connaît l'utilisateur (déjà débloqué ? favoris ?).
 */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const payload = jwt.verify(token, getJwtSecret());
    // Jeton d'agent : traité comme un visiteur anonyme sur les routes publiques.
    if (payload.role === 'agent') return next();
    req.user = await User.findById(payload.sub);
    // Un compte anonymisé est traité comme un visiteur : ses favoris et son
    // carnet de visites n'existent plus, il n'a rien à personnaliser.
    if (req.user?.supprimeAt) req.user = undefined;
    return next();
  } catch {
    // Token invalide -> on ignore simplement, la route reste accessible.
    return next();
  }
}

/**
 * `requireTypeCompte` a été SUPPRIMÉ avec le compte unifié (ajout du 29/09) : il
 * n'existe plus de type de compte. Les autorisations se font désormais sur la
 * propriété réelle de la ressource (ex. `doc.createdByUserId === req.user._id`)
 * ou sur la présence d'un abonnement (voir routes/subscriptions.js).
 */

export default {
  protect,
  optionalAuth,
  protectAdmin,
  protectAgent,
  signToken,
  signAgentToken,
  getJwtSecret,
  DUREE_JETON_ADMIN,
};
