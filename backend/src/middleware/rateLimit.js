// rateLimit.js — Limiteur de débit minimal pour les routes SENSIBLES (connexion, inscription).
//
// Objectif : freiner le bourrage d'identifiants (brute-force) sur /login et le spam
// d'inscriptions sur /register. Implémentation SANS dépendance externe (le projet tient
// à rester léger) : fenêtre GLISSANTE en mémoire, clé = « IP + numéro normalisé ». Un
// attaquant ne peut donc pas contourner la limite en changeant de numéro, ni saturer un
// même numéro depuis une seule machine.
//
// ⚠️ En mémoire = PAR INSTANCE. L'API tourne sur une seule instance (plan Render gratuit)
// : la limite est donc globale en pratique. En cas de passage à plusieurs instances, il
// faudra un store partagé (Redis) — à faire à ce moment-là.
//
// Réglage par variables d'environnement :
//   AUTH_RATE_MAX        (défaut 8)      : requêtes autorisées par fenêtre
//   AUTH_RATE_WINDOW_MS  (défaut 60000)  : taille de la fenêtre en millisecondes

import { normalizePhone } from '../utils/validators.js';

const MAX_DEFAUT = Number(process.env.AUTH_RATE_MAX) || 8;
const FENETRE_DEFAUT_MS = Number(process.env.AUTH_RATE_WINDOW_MS) || 60000;
// Garde-fou mémoire : au-delà, on élague les entrées expirées.
const ENTREES_MAX = 10000;

/** clé -> tableau d'horodatages (ms) des requêtes encore dans la fenêtre. */
const compteurs = new Map();

/** Clé d'identification : IP d'origine + numéro normalisé (sinon l'IP seule). */
function cleDe(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'inconnue';
  // Le numéro arrive sous « telephone » (routes publiques) ou « identifiant »
  // (connexion admin du back-office, qui se fait aussi par numéro) : les deux
  // désignent le même compte, on les traite donc pareil.
  const saisi = req.body?.telephone ?? req.body?.identifiant;
  const telephone = normalizePhone(saisi) || String(saisi || '').trim() || 'sans-numero';
  return `${ip}|${telephone}`;
}

/** Supprime les entrées dont la fenêtre est totalement écoulée (mémoire bornée). */
function elaguer(fenetreMs, maintenant) {
  for (const [cle, historique] of compteurs) {
    const recent = historique.filter((t) => maintenant - t < fenetreMs);
    if (recent.length) compteurs.set(cle, recent);
    else compteurs.delete(cle);
  }
}

/**
 * Fabrique un middleware Express de limitation de débit.
 * @param {{ max?: number, fenetreMs?: number }} [options]
 * @returns {import('express').RequestHandler}
 */
export function limiteurAuth({ max = MAX_DEFAUT, fenetreMs = FENETRE_DEFAUT_MS } = {}) {
  return function limiteur(req, res, next) {
    const maintenant = Date.now();
    const cle = cleDe(req);

    const historique = (compteurs.get(cle) || []).filter((t) => maintenant - t < fenetreMs);

    if (historique.length >= max) {
      const retryAfterSecondes = Math.max(
        1,
        Math.ceil((fenetreMs - (maintenant - historique[0])) / 1000)
      );
      res.set('Retry-After', String(retryAfterSecondes));
      return res.status(429).json({
        error:
          'Trop de tentatives. Patientez un instant avant de réessayer (limite : ' +
          max +
          ' requêtes/minute).',
        retryAfterSeconds: retryAfterSecondes,
      });
    }

    historique.push(maintenant);
    compteurs.set(cle, historique);
    if (compteurs.size > ENTREES_MAX) elaguer(fenetreMs, maintenant);

    return next();
  };
}

export default { limiteurAuth };
