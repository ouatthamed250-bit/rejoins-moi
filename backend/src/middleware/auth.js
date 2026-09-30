// auth.js — Middleware d'authentification JWT (auth par numéro de téléphone)
//
// Décision produit : l'authentification se fait par numéro de téléphone + mot de
// passe (pas d'e-mail), cohérent avec les usages locaux et le mobile money
// (§2, §10). Un futur passage à l'OTP par SMS se fera sans changer les routes :
// il suffira d'émettre le même JWT après validation du code.

import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const FALLBACK_SECRET = 'rejoins-moi-dev-secret-non-securise';

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

/** Génère un JWT pour un utilisateur donné. */
export function signToken(user) {
  // Le jeton ne porte aucune notion de rôle : le compte est UNIFIÉ (ajout du 29/09).
  // Les capacités (estArtisan, chercheTravail) sont relues en base à chaque requête
  // via `protect`, donc toujours à jour — un jeton émis il y a 20 jours ne peut pas
  // prétendre qu'un utilisateur est encore artisan.
  return jwt.sign(
    { sub: String(user._id), telephone: user.telephone },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Authentification obligatoire.
 * Injecte `req.user` (document Mongoose) ou répond 401.
 */
export async function protect(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Authentification requise.' });

    const payload = jwt.verify(token, getJwtSecret());
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Compte introuvable ou supprimé.' });

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
    req.user = await User.findById(payload.sub);
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

export default { protect, optionalAuth, signToken, getJwtSecret };
