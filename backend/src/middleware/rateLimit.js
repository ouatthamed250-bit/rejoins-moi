// rateLimit.js — Limiteur de débit pour les routes SENSIBLES (connexion, inscription, avis).
//
// Objectif : freiner le bourrage d'identifiants (brute-force) sur /login, la
// pulvérisation de mots de passe et le spam d'inscriptions sur /register.
// Implémentation SANS dépendance externe (le projet tient à rester léger) :
// fenêtre GLISSANTE en mémoire.
//
// DEUX PLAFONDS CUMULÉS (correctif du 27/11, faille « rate limiting instable ») :
//   1. PAR IP : `maxParIp` requêtes par fenêtre, TOUS NUMÉROS CONFONDUS. C'est le
//      plafond qui manquait : le limiteur ne comptait que « IP + numéro », donc un
//      attaquant bloqué sur un numéro passait simplement au numéro suivant
//      (pulvérisation de mots de passe sur tout l'annuaire).
//   2. PAR IP + NUMÉRO : `max` requêtes sur un même compte — protège un compte
//      précis sans pénaliser les autres personnes du même cybercafé.
//
// IP FIABLE : derrière Cloudflare + Render, `req.ip` dépend de l'arête CDN qui a
// reçu la connexion et peut donc varier d'une requête à l'autre (c'est ce qui
// rendait le blocage intermittent : 11 requêtes acceptées sur 24 mesurées lors du
// pentest). On lit donc d'abord `cf-connecting-ip`, l'en-tête que Cloudflare
// ÉCRASE lui-même avec l'IP réelle du client (contrairement à `X-Forwarded-For`,
// que le client peut falsifier). À défaut, on retombe sur `req.ip` (déjà résolu
// par `trust proxy`).
//
// ⚠️ En mémoire = PAR INSTANCE. L'API tourne sur une seule instance (plan Render
// gratuit) : la limite est donc globale en pratique. En cas de passage à plusieurs
// instances, il faudra un store partagé (Redis) — à faire à ce moment-là.
//
// Réglage par variables d'environnement :
//   AUTH_RATE_MAX        (défaut 8)      : requêtes autorisées par fenêtre et par numéro
//   AUTH_RATE_IP_MAX     (défaut 20)     : requêtes autorisées par fenêtre et par IP
//   AUTH_RATE_WINDOW_MS  (défaut 60000)  : taille de la fenêtre en millisecondes

import { normalizePhone } from '../utils/validators.js';

const MAX_DEFAUT = Number(process.env.AUTH_RATE_MAX) || 8;
const MAX_IP_DEFAUT = Number(process.env.AUTH_RATE_IP_MAX) || 20;
const FENETRE_DEFAUT_MS = Number(process.env.AUTH_RATE_WINDOW_MS) || 60000;
// Garde-fou mémoire : au-delà, on élague les entrées expirées.
const ENTREES_MAX = 10000;

/** clé -> tableau d'horodatages (ms) des requêtes encore dans la fenêtre. */
const compteurs = new Map();

/**
 * IP de l'appelant, telle qu'un proxy de confiance la publie.
 *
 * `cf-connecting-ip` est prioritaire : Cloudflare le réécrit à chaque requête, un
 * client ne peut donc pas le choisir. L'en-tête peut être un tableau (requêtes
 * dupliquées) ou une liste : on ne garde que la première valeur.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function ipFiable(req) {
  const entete = req.headers?.['cf-connecting-ip'];
  const brut = Array.isArray(entete) ? entete[0] : entete;
  const cf = String(brut || '').split(',')[0].trim();
  if (cf) return cf;
  return req.ip || req.socket?.remoteAddress || 'inconnue';
}

/** Numéro normalisé de la tentative (routes publiques et connexion admin). */
function numeroDe(req) {
  // Le numéro arrive sous « telephone » (routes publiques) ou « identifiant »
  // (connexion admin du back-office, qui se fait aussi par numéro) : les deux
  // désignent le même compte, on les traite donc pareil.
  const saisi = req.body?.telephone ?? req.body?.identifiant;
  return normalizePhone(saisi) || String(saisi || '').trim() || 'sans-numero';
}

/** Historique encore dans la fenêtre pour une clé (et purge de la clé au passage). */
function historiqueRecent(cle, fenetreMs, maintenant) {
  const historique = (compteurs.get(cle) || []).filter((t) => maintenant - t < fenetreMs);
  if (historique.length) compteurs.set(cle, historique);
  else compteurs.delete(cle);
  return historique;
}

/**
 * Secondes à attendre avant qu'une place se libère.
 * L'horodatage qui libère la place est le `max`-ième plus ancien encore présent :
 * pour `length === max`, c'est le plus ancien de tous.
 */
function delaiAvantLiberation(historique, max, fenetreMs, maintenant) {
  const liberateur = historique[historique.length - max] ?? historique[0] ?? maintenant;
  return Math.max(1, Math.ceil((fenetreMs - (maintenant - liberateur)) / 1000));
}

/** Réponse 429 commune aux deux plafonds. */
function refuser(res, secondes, max, portee) {
  res.set('Retry-After', String(secondes));
  const detail =
    portee === 'ip'
      ? `limite : ${max} requêtes/minute par connexion, tous numéros confondus`
      : `limite : ${max} requêtes/minute par numéro`;
  return res.status(429).json({
    error: `Trop de tentatives. Patientez ${secondes} seconde(s) avant de réessayer (${detail}).`,
    retryAfterSeconds: secondes,
    portee,
  });
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
 *
 * Les deux plafonds sont vérifiés AVANT d'être consommés : une requête refusée ne
 * prolonge pas elle-même le blocage (sinon une boucle d'attaquant repousserait
 * indéfiniment la fin de la fenêtre).
 *
 * @param {{ max?: number, maxParIp?: number, fenetreMs?: number }} [options]
 *   - `max` : requêtes autorisées par numéro et par fenêtre (défaut 8) ;
 *   - `maxParIp` : requêtes autorisées par IP, tous numéros confondus (défaut 20) ;
 *     `0` désactive le plafond par IP ;
 *   - `fenetreMs` : taille de la fenêtre glissante (défaut 60 000 ms).
 * @returns {import('express').RequestHandler}
 */
export function limiteurAuth({
  max = MAX_DEFAUT,
  maxParIp = MAX_IP_DEFAUT,
  fenetreMs = FENETRE_DEFAUT_MS,
} = {}) {
  return function limiteur(req, res, next) {
    const maintenant = Date.now();
    const ip = ipFiable(req);
    const cleIp = `ip:${ip}`;
    const cleNumero = `num:${ip}|${numeroDe(req)}`;

    // 1) Plafond PAR IP : c'est lui qui bloque la pulvérisation de mots de passe
    //    (beaucoup de numéros différents essayés depuis la même connexion).
    if (maxParIp > 0) {
      const historiqueIp = historiqueRecent(cleIp, fenetreMs, maintenant);
      if (historiqueIp.length >= maxParIp) {
        return refuser(
          res,
          delaiAvantLiberation(historiqueIp, maxParIp, fenetreMs, maintenant),
          maxParIp,
          'ip'
        );
      }
    }

    // 2) Plafond PAR NUMÉRO : protège un compte précis (bourrage d'identifiants)
    //    sans pénaliser les autres personnes qui partagent la même IP.
    const historiqueNumero = historiqueRecent(cleNumero, fenetreMs, maintenant);
    if (historiqueNumero.length >= max) {
      return refuser(
        res,
        delaiAvantLiberation(historiqueNumero, max, fenetreMs, maintenant),
        max,
        'numero'
      );
    }

    // Les deux compteurs avancent ensemble : la tentative est bien « consommée »
    // au titre des deux plafonds.
    if (maxParIp > 0) {
      const historiqueIp = historiqueRecent(cleIp, fenetreMs, maintenant);
      historiqueIp.push(maintenant);
      compteurs.set(cleIp, historiqueIp);
    }
    historiqueNumero.push(maintenant);
    compteurs.set(cleNumero, historiqueNumero);

    if (compteurs.size > ENTREES_MAX) elaguer(fenetreMs, maintenant);

    return next();
  };
}

export default { limiteurAuth, ipFiable };

