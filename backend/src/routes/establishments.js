// establishments.js — Endpoints pour les profils d'établissements (kiosque, boulangerie, artisan, église...)
// GET    /api/establishments               -> liste + filtres (catégorie, proximité)
// GET    /api/establishments/:id           -> détail complet
// POST   /api/establishments               -> création (inscription, 2 photos + tags, voir modèle)
// PATCH  /api/establishments/:id           -> modification par le gérant (dont les
//                                             horaires structurés et la fermeture temporaire)
// POST   /api/establishments/:id/visit     -> incrémente le compteur de VISITES
// POST   /api/establishments/:id/action    -> incrémente le compteur d'UTILISATEURS
//                                              (clic sur le bouton "Aller chez...")
// POST   /api/establishments/:id/reviews   -> ajouter un avis + note
//
// ⚠️ RÈGLE CRITIQUE (§3) : `compteurVisites` et `compteurUtilisateurs` sont deux
// compteurs INDÉPENDANTS, incrémentés par DEUX endpoints distincts, et toujours
// renvoyés séparément. On n'expose volontairement aucun champ agrégé.

import express from 'express';
// Empreinte de l'appareil (IP) : un hachage salé, jamais l'adresse en clair
// (voir `empreinteAppareilDe` plus bas et le champ du modèle).
import crypto from 'node:crypto';
import Establishment from '../models/Establishment.js';
import Agent from '../models/Agent.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { limiteurAuth } from '../middleware/rateLimit.js';
// Assainissement des textes libres (correctif XSS stocké du 27/11).
import { assainirChamps } from '../middleware/sanitize.js';
import {
  validateEstablishmentPhotos,
  sanitizeTags,
  clampNote,
  buildActionLabel,
  escapeRegex,
  normalizePhone,
} from '../utils/validators.js';
import { getDistanceKm, parseCoords } from '../utils/geo.js';
import {
  DISTANCE_DOUBLON_M,
  DISTANCE_RECLAMATION_M,
  distanceMetresEntre,
  nomsProches,
} from '../utils/rapprochement.js';
import { decoderPhoto, estImageIntegree, estUrlDistante } from '../utils/photos.js';
import CompteurJournalier from '../models/CompteurJournalier.js';
import DemandeCategorie from '../models/DemandeCategorie.js';
// Demandes de revendication : la fiche n'est plus jamais attribuée sur la seule
// déclaration GPS du client (voir POST /:id/reclamer).
import DemandeRevendication from '../models/DemandeRevendication.js';
import {
  CATEGORIES,
  CATEGORIES_FILTRABLES,
  SOUS_CATEGORIES,
  resoudreSousCategorie,
  slugifier,
} from '../config/categories.js';

const router = express.Router();
router.use(requireDb);

/**
 * Origine publique de l'API pour la requête en cours (« https://hote »).
 *
 * Indispensable pour les PHOTOS : le frontend est servi par un autre domaine, donc
 * une URL relative `/api/...` pointerait chez le frontend et non chez l'API. On
 * s'appuie sur l'en-tête `Host` de l'appelant, que Render transmet (l'app est
 * derrière un proxy, `trust proxy` est réglé dans index.js).
 */
function basePublique(req) {
  const hote = req.get('host');
  if (!hote) return '';
  return `${req.protocol}://${hote}`;
}

/** Clé d'identité du compteur : l'utilisateur connecté, sinon son adresse IP (anonyme). */
function cleIncrement(req) {
  return req.user ? `u:${req.user._id}` : `ip:${req.ip || req.socket?.remoteAddress || 'inconnue'}`;
}

/**
 * Contrôle de la GALERIE multi-photos (champ `photos`, ajout du 16/11).
 *
 * Les images sont hébergées chez Cloudinary et envoyées par l'application : le
 * serveur ne reçoit donc que des URL. On refuse tout ce qui n'est pas une URL
 * https absolue — en particulier les data-URI base64, qu'on ne veut plus voir
 * grossir la base ni les réponses de liste — et plus de 8 photos.
 *
 * L'ordre du tableau n'est jamais modifié ici : c'est l'ordre d'affichage choisi
 * par le gérant.
 *
 * @param {unknown} photos
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validerPhotos(photos) {
  if (!Array.isArray(photos)) return { ok: false, error: 'photos doit être un tableau.' };
  if (photos.length > 8) return { ok: false, error: 'Maximum 8 photos.' };
  for (const p of photos) {
    const s = String(p || '').trim();
    if (!s || !/^https:\/\//i.test(s)) return { ok: false, error: 'Chaque photo doit être une URL https valide.' };
  }
  return { ok: true };
}

/**
 * ── HORAIRES STRUCTURÉS (16/11) ──────────────────────────────────────────────
 * Les sept jours, dans l'ordre d'affichage français (lundi → dimanche). Toute clé
 * absente de cette liste est ignorée : un client ne peut pas inventer un huitième
 * jour, ni écrire un champ arbitraire dans la fiche.
 */
const JOURS_HORAIRES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Grille par défaut : lundi → samedi ouverts 08:00-18:00, dimanche fermé. */
function grilleParDefaut() {
  const grille = {};
  for (const jour of JOURS_HORAIRES) {
    grille[jour] = { ouvert: jour !== 'dimanche', debut: '08:00', fin: '18:00' };
  }
  return grille;
}

/**
 * « 8:00 », « 08:00 » → « 08:00 » (24 h, deux chiffres). `null` si l'heure est
 * illisible ou hors bornes (« 25:00 », « 08:75 »).
 *
 * On accepte la saisie sans zéro initial parce qu'un gérant tape « 8:00 » ; on
 * refuse tout le reste plutôt que de stocker une chaîne que le badge ne saurait
 * pas comparer.
 */
function heurePropre(valeur) {
  const trouve = /^(\d{1,2}):(\d{2})$/.exec(String(valeur ?? '').trim());
  if (!trouve) return null;
  const heures = Number(trouve[1]);
  const minutes = Number(trouve[2]);
  if (heures > 23 || minutes > 59) return null;
  return `${String(heures).padStart(2, '0')}:${trouve[2]}`;
}

/**
 * Valide et COMPLÈTE une grille d'horaires reçue du client.
 *
 * Toujours sept jours en sortie : un jour absent de l'envoi reprend la valeur
 * déjà en base (`base`) ou, à défaut, la valeur par défaut. C'est ce qui permet à
 * un PATCH de ne toucher qu'un seul jour sans effacer les autres — et à un POST
 * d'accepter une grille partielle sans casser l'affichage.
 *
 * @param {unknown} valeur  payload `horairesStructures`
 * @param {object|null} base  grille actuelle du document (PATCH)
 * @returns {{ ok: true, valeur: object } | { ok: false, error: string }}
 */
function horairesNormalises(valeur, base = null) {
  if (valeur == null) return { ok: true, valeur: grilleParDefaut() };
  if (typeof valeur !== 'object' || Array.isArray(valeur)) {
    return { ok: false, error: 'horairesStructures doit être un objet de sept jours.' };
  }

  const defaut = grilleParDefaut();
  const grille = {};
  for (const jour of JOURS_HORAIRES) {
    const recu = valeur[jour];
    if (recu != null && (typeof recu !== 'object' || Array.isArray(recu))) {
      return { ok: false, error: `Horaires de « ${jour} » : un objet { ouvert, debut, fin } est attendu.` };
    }
    const source = recu && typeof recu === 'object' ? { ...(base?.[jour] || {}), ...recu } : base?.[jour] || defaut[jour];

    // `ouvert` doit être un vrai booléen JSON : `Boolean('false')` vaudrait true,
    // on préfère ignorer une valeur d'un autre type que fermer un commerce à tort.
    const ouvert = typeof source.ouvert === 'boolean' ? source.ouvert : defaut[jour].ouvert;
    const debut = heurePropre(source.debut ?? defaut[jour].debut);
    const fin = heurePropre(source.fin ?? defaut[jour].fin);
    if (debut == null || fin == null) {
      return { ok: false, error: `Horaires de « ${jour} » : l’heure doit être au format HH:MM (ex. 08:00).` };
    }
    grille[jour] = { ouvert, debut, fin };
  }
  return { ok: true, valeur: grille };
}

/**
 * Fermeture temporaire (« Rupture de stock », panne, travaux…).
 * `undefined` = champ non transmis (on ne touche à rien) ; `null` = remise à zéro.
 *
 * @param {unknown} valeur
 * @returns {{ ok: true, valeur: { actif: boolean, raison: string } | null } | { ok: false, error: string }}
 */
function fermetureTemporaireNormalisee(valeur) {
  if (valeur === undefined) return { ok: true, valeur: null };
  if (valeur === null) return { ok: true, valeur: { actif: false, raison: '' } };
  if (typeof valeur !== 'object' || Array.isArray(valeur)) {
    return { ok: false, error: 'fermetureTemporaire doit être un objet { actif, raison }.' };
  }
  return {
    ok: true,
    valeur: {
      actif: valeur.actif === true,
      // 160 caractères : la raison s'affiche dans une pastille, jamais dans un pavé.
      raison: String(valeur.raison ?? '').trim().slice(0, 160),
    },
  };
}

/**
 * Fiches situées dans `rayonMetres` d'un point, dont le NOM est proche (bloc D).
 *
 * Le travail géographique est fait par l'index 2dsphere (`$geoNear`) : on ne compare des
 * noms qu'entre fiches réellement voisines, jamais sur 6 700 documents. Sert les deux
 * usages du rapprochement : proposer « C'est votre établissement ? » et refuser un doublon.
 */
async function fichesProchesParNom(nom, coords, rayonMetres, filtre = {}) {
  if (!nom || !coords) return [];
  const trouvees = await Establishment.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [coords.lng, coords.lat] },
        key: 'position',
        distanceField: 'distanceMetres',
        maxDistance: rayonMetres,
        query: filtre,
      },
    },
    { $sort: { distanceMetres: 1, _id: 1 } },
    { $limit: 30 },
    { $project: { nom: 1, categorie: 1, quartier: 1, commune: 1, localisation: 1, distanceMetres: 1 } },
  ]);
  return trouvees
    .filter((f) => nomsProches(f.nom, nom))
    .map((f) => ({ ...f, distanceMetres: Math.round(f.distanceMetres) }));
}

/* ─── Agents de terrain et anti-fraude (prompt 9) ─────────────────────────────
   Une inscription faite sur le terrain n'est JAMAIS refusée pour suspicion : le
   commerçant est devant l'agent, un refus lui ferait perdre son compte et ses
   photos. On crée donc la fiche, puis on la MARQUE `aVerifier` en écrivant les
   motifs. Le back-office tranche ensuite (onglet « Agents de terrain »).
   ─────────────────────────────────────────────────────────────────────────── */

const RAYON_SUSPICION_POSITION_M = 20;
const FICHES_MAX_PAR_APPAREIL_24H = 5;
const FENETRE_APPAREIL_MS = 24 * 60 * 60 * 1000;

/** Code agent normalisé (« ag42x1 » -> « AG42X1 »), ou '' si facultatif/illisible. */
function codeAgentNormalise(valeur) {
  const code = String(valeur || '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}

/**
 * Empreinte de l'appareil : SHA-256 de l'adresse IP et d'un sel serveur.
 *
 * POURQUOI UN HACHAGE : la règle « plus de 5 fiches en 24 h par appareil » exige
 * de RECONNAÎTRE l'appareil d'une fiche à l'autre, donc de conserver quelque
 * chose. Conserver l'IP en clair ajouterait une donnée personnelle permanente
 * pour un simple compteur ; son empreinte salée suffit à compter sans permettre
 * de remonter à une adresse (et n'est jamais renvoyée par une route).
 *
 * @param {object} req requête Express (derrière `trust proxy`, voir index.js).
 * @returns {string} 64 caractères hexadécimaux, ou '' si l'IP est inconnue.
 */
function empreinteAppareilDe(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  if (!ip) return '';
  const sel = process.env.EMPREINTE_SEL || process.env.JWT_SECRET || 'rejoins-moi-terrain';
  return crypto.createHash('sha256').update(`${sel}|${ip}`).digest('hex');
}

/**
 * Motifs de suspicion d'une fiche qui vient d'être créée (prompt 9).
 *
 * Les trois règles demandées, plus une quatrième évidente sur le terrain :
 *   1. le numéro figure déjà sur une autre fiche (comparaison NORMALISÉE : la
 *      même ligne saisie « 07 07… » puis « +225 07 07… » est un seul numéro) ;
 *   2. la position est à moins de 20 m d'une autre fiche (index 2dsphere) ;
 *   3. l'appareil (IP) a créé plus de 5 fiches dans les dernières 24 h ;
 *   4. le code agent saisi n'existe pas ou a été désactivé (une fiche payée au
 *      nom d'un code inconnu ne serait jamais réconciliée).
 *
 * @param {{ doc: object, agent: object|null }} p `agent` = Agent trouvé pour `doc.codeAgent`.
 * @returns {Promise<string[]>} libellés prêts à afficher dans le back-office.
 */
async function motifsSuspicion({ doc, agent }) {
  const motifs = [];

  // 1. Numéro déjà utilisé ailleurs.
  const telephoneSaisi = String(doc.telephone || doc.whatsapp || '').trim();
  const telephoneNormalise = normalizePhone(telephoneSaisi);
  if (telephoneNormalise) {
    const candidats = await Establishment.find({
      _id: { $ne: doc._id },
      $or: [
        { telephone: telephoneSaisi },
        { whatsapp: telephoneSaisi },
        { telephone: telephoneNormalise },
        { whatsapp: telephoneNormalise },
      ],
    })
      .select('telephone whatsapp')
      .limit(20);
    const dejaUtilise = candidats.some((fiche) =>
      [fiche.telephone, fiche.whatsapp].some(
        (valeur) => valeur && normalizePhone(valeur) === telephoneNormalise
      )
    );
    if (dejaUtilise) motifs.push('Numéro déjà utilisé sur une autre fiche');
  }

  // 2. Position à moins de 20 m d'une autre fiche. Le calcul est fait par la base
  //    ($geoNear sur `position`), pas en mémoire sur tout le catalogue.
  const lat = Number(doc.localisation?.lat);
  const lng = Number(doc.localisation?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const voisines = await Establishment.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lng, lat] },
            key: 'position',
            distanceField: 'distanceMetres',
            maxDistance: RAYON_SUSPICION_POSITION_M,
            query: { _id: { $ne: doc._id } },
          },
        },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ]);
      if (voisines.length) {
        motifs.push(`Position à moins de ${RAYON_SUSPICION_POSITION_M} m d’une autre fiche`);
      }
    } catch {
      // Index géographique absent ou fiche non indexée : ce contrôle est un PLUS,
      // il ne doit jamais faire échouer une inscription déjà enregistrée.
    }
  }

  // 3. Trop de fiches créées par le même appareil en 24 h.
  const empreinte = String(doc.empreinteAppareil || '');
  if (empreinte) {
    const nombre = await Establishment.countDocuments({
      empreinteAppareil: empreinte,
      createdAt: { $gte: new Date(Date.now() - FENETRE_APPAREIL_MS) },
    });
    if (nombre > FICHES_MAX_PAR_APPAREIL_24H) {
      motifs.push(`Plus de ${FICHES_MAX_PAR_APPAREIL_24H} fiches créées en 24 h par cet appareil`);
    }
  }

  // 4. Code agent inconnu ou désactivé (le code reste écrit sur la fiche).
  if (doc.codeAgent && !agent) motifs.push('Code agent inconnu ou désactivé');

  return motifs;
}

/**
 * Incrémente UN compteur d'établissement au plus UNE FOIS par identité et par jour (§3).
 *
 * La déduplication est portée par l'index UNIQUE de CompteurJournalier
 * ({ etablissement, type, cle, jour }) : on pose d'abord le marqueur, et seule une pose
 * réussie autorise l'incrément. Un second appel le même jour renvoie donc
 * `{ dejaCompte: true }` sans jamais gonfler le chiffre affiché (anti-manipulation).
 *
 * @param {{ req: object, type: 'visit'|'action', champ: string, select: string }} p
 * @returns {Promise<{doc?: object, dejaCompte?: boolean, introuvable?: boolean}>}
 */
async function incrementerUneFoisParJour({ req, type, champ, select }) {
  const etablissement = req.params.id;
  const cle = cleIncrement(req);
  const jour = new Date().toISOString().slice(0, 10); // Abidjan = UTC (pas d'heure d'été)

  try {
    await CompteurJournalier.create({ etablissement, type, cle, jour });
  } catch (err) {
    // 11000 = violation d'unicité : déjà compté aujourd'hui pour cette identité.
    if (err?.code === 11000) return { dejaCompte: true };
    throw err; // CastError (id invalide) et autres -> errorHandler (400/500)
  }

  const doc = await Establishment.findByIdAndUpdate(
    etablissement,
    { $inc: { [champ]: 1 } },
    { new: true, select }
  );
  if (!doc) {
    // Fiche absente : on retire le marqueur pour ne pas bloquer une future fiche.
    await CompteurJournalier.deleteOne({ etablissement, type, cle, jour }).catch(() => {});
    return { introuvable: true };
  }
  return { doc };
}

/**
 * Rayon sphérique utilisé par MongoDB pour les calculs 2dsphere (en km) :
 * c'est la valeur que $centerSphere attend en radians (distance / rayon) et
 * celle sur laquelle $geoNear renvoie `distanceMetres`. Utiliser LA MÊME
 * constante des deux côtés garantit que le comptage `total` et la liste
 * paginée portent exactement sur le même ensemble de fiches.
 *
 * (Attention : utils/geo.js calcule ses distances d'affichage avec un rayon de
 * 6 371 km — écart < 0,2 %, sans effet sur l'ordre des résultats.)
 */
const RAYON_TERRE_KM = 6378.137;

/** Plafond de pagination : au-delà, la réponse devient inutilement lourde en 4G. */
const LIMITE_MAX = 60;

/**
 * Tri MongoDB équivalent au tri en mémoire historique.
 * `null` = ordre calculé par une agrégation ($geoNear pour la proximité, score
 * pondéré pour la popularité) : voir le corps de la route.
 *
 * `_id` est TOUJOURS le dernier critère : sans départage unique, deux pages
 * successives peuvent répéter ou sauter des fiches quand des milliers d'entre
 * elles partagent la même clé de tri (cas réel : import à compteurs nuls).
 */
function triMongo(mode) {
  if (mode === 'note') return { noteMoyenne: -1, nombreAvis: -1, _id: 1 };
  if (mode === 'recent') return { createdAt: -1, _id: 1 };
  return null;
}

/**
 * Score du tri « popular » — règle produit conservée : les UTILISATEURS (clic sur
 * « Aller chez… ») pèsent trois fois plus lourd que les simples visites de fiche.
 * Les deux compteurs restent séparés en base ; le score n'existe que le temps de
 * la requête et n'est jamais stocké.
 */
const SCORE_POPULARITE = { $add: [{ $multiply: ['$compteurUtilisateurs', 3] }, '$compteurVisites'] };

/**
 * Catégories du feed (§4 : Tous / Alimentation / Beauté / Services / Artisanat, extensible).
 *
 * Depuis le prompt 6, la liste ne vit PLUS ici : elle est dans
 * backend/src/config/categories.js, avec les sous-catégories locales (maquis,
 * koutoukoudrom, garbadrom, clé minute…) et la règle « pas de pub pour les lieux
 * publics et cultes ». On la ré-exporte pour ne pas casser les scripts existants
 * (verifier-base.js interroge la route, verifier-pagination-proximite.js lit les slugs).
 */
export { CATEGORIES };


/**
 * Profondeur maximale du mélange équilibré (onglet « Tous »), en nombre de fiches.
 * Au-delà, l'API repasse en proximité pure et le DIT (`diversite: false`) : le client
 * sait alors qu'il ne doit plus paginer dans ce mode, sinon la page suivante
 * rejouerait des fiches déjà affichées (la proximité pure ramène les plus proches).
 * 150 = cinq pages de 30.
 */
const DIVERSITE_PROFONDEUR_MAX = 150;

/**
 * Les `n` fiches les plus proches d'un point, dans l'ordre réel des distances
 * (index 2dsphere). `filtre` est exactement celui du comptage — rayon inclus — pour
 * que la liste et `total` portent toujours sur le même ensemble de fiches.
 *
 * ⚠️ Le `$limit` est une étape SÉPARÉE, pas une option : celle de `$geoNear` a été
 * retirée de MongoDB (« $geoNear no longer supports the 'limit' parameter. Use a
 * $limit stage instead. » — message reçu le 30/09 en la testant). Le motif
 * `$geoNear` suivi de `$limit` est celui que le serveur reconnaît.
 */
function plusProches(filtre, coords, n) {
  return Establishment.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [coords.lng, coords.lat] },
        key: 'position',
        distanceField: 'distanceMetres',
        query: filtre,
      },
    },
    { $limit: n },
  ]);
}

/** Les `n` fiches les plus récentes d'un ensemble (mode `recent`). */
function plusRecents(filtre, n) {
  return Establishment.find(filtre).sort({ createdAt: -1, _id: 1 }).limit(n).lean();
}

/**
 * Mélange équilibré des catégories (« Tous ») — correction du 30/09.
 *
 * PROBLÈME RÉSOLU : trier 6 719 fiches par simple proximité rendait le feed
 * mono-catégorie. Mesuré le 30/09 : les 60 fiches les plus proches du Plateau
 * étaient 47 « alimentation » ; sans coordonnées, l'ancien tri « popular » donnait
 * 56 « beauté » + les points « Transfert d'argent » en tête. L'utilisateur ne voyait
 * donc pas son quartier, mais une seule rue commerçante.
 *
 * MÉTHODE (proximité) : UNE seule exploration de l'index 2dsphere ramène les
 * `fenetre` fiches les plus proches ; MongoDB les regroupe par catégorie, on garde
 * les `profondeur` premières de chaque catégorie, et l'indice dans le groupe
 * (`rang`) reconstruit l'interclassement EN TOURS : au tour n, la n-ième fiche la
 * plus proche de chaque catégorie, les fiches d'un tour étant classées par distance
 * réelle.
 *
 * POURQUOI PAS UNE REQUÊTE PAR CATÉGORIE (première tentative, abandonnée) : un
 * `$geoNear` filtré par catégorie force MongoDB à descendre l'index des distances
 * jusqu'à trouver 30 fiches d'une catégorie rare — mesuré à 3-5 s par feed (8
 * requêtes), contre ~1 s en une seule passe.
 *
 * POURQUOI PAS UN SIMPLE TRI PAR DISTANCE : interclasser les têtes de liste (« la
 * plus proche d'abord, toutes catégories confondues ») redonne exactement l'ordre
 * par proximité global — vérifié : 24 « alimentation » sur 30 près du Plateau. Un tour
 * par catégorie est la seule règle qui garantisse un vrai mélange.
 *
 * Conséquence assumée : dans chaque catégorie les distances augmentent (vraie
 * proximité), mais d'un tour à l'autre la distance « repart de près » pour une autre
 * catégorie. C'est le prix d'un annuaire équilibré — et c'est réversible avec
 * `diversite=0`, qui rend le tri par proximité pur.
 *
 * @returns {Promise<Array>} fiches brutes (champ `distanceMetres`) déjà interclassées
 */

/**
 * Fenêtre d'exploration du mélange, en fiches — FIXE, indépendante de la page.
 * Deux raisons : (1) les pages doivent rester les tranches successives d'UNE SEULE
 * séquence, or une fenêtre qui grandit avec la page change la longueur des listes par
 * catégorie et fait diverger l'interclassement (des fiches réapparaîtraient d'une page
 * à l'autre) ; (2) elle doit rester ≥ DIVERSITE_PROFONDEUR_MAX pour que chaque page du
 * mélange soit pleine. 240 = de quoi laisser ~8 fiches à chacune des catégories
 * présentes dans la première page (4 catégories × 60 tours), sans charger la mémoire.
 */
const FENETRE_MELANGE = 240;

/**
 * Interclassement en tours de listes DÉJÀ triées : au tour n, on prend la n-ième
 * fiche de chaque liste. Utilisé pour le mode `recent` (sans coordonnées, l'index
 * géographique ne sert à rien : on interclasse les 8 listes « plus récentes par
 * catégorie », petites et déjà triées).
 */
function interclasser(listes, profondeur, mode) {
  const melange = [];
  for (let tour = 0; melange.length < profondeur; tour += 1) {
    const duTour = [];
    for (const docs of listes) {
      if (docs[tour]) duTour.push(docs[tour]);
    }
    if (!duTour.length) break; // toutes les catégories sont épuisées
    duTour.sort((a, b) =>
      mode === 'recent'
        ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
          String(a._id).localeCompare(String(b._id))
        : a.distanceMetres - b.distanceMetres || String(a._id).localeCompare(String(b._id))
    );
    melange.push(...duTour);
  }
  return melange.slice(0, profondeur);
}

async function melangeParCategorie(mode, filtre, coords, profondeur) {
  if (mode === 'recent') {
    // Sans coordonnées, on doit demander à CHAQUE catégorie ses fiches les plus
    // récentes : une simple fenêtre « les plus récentes de l'annuaire » ne mélange
    // rien ici, car les 240 fiches les plus récentes appartiennent toutes à la même
    // catégorie (import OSM groupé par catégorie — vérifié : 30 « services » d'affilée).
    // Ces 8 requêtes sont servies par l'index { categorie, createdAt } du modèle.
    return interclasser(
      await Promise.all(
        CATEGORIES_FILTRABLES.map((slug) => plusRecents({ ...filtre, categorie: slug }, profondeur))
      ),
      profondeur,
      'recent'
    );
  }

  return Establishment.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [coords.lng, coords.lat] },
        key: 'position',
        distanceField: 'distanceMetres',
        query: filtre,
      },
    },
    { $limit: FENETRE_MELANGE },
    { $group: { _id: '$categorie', docs: { $push: '$$ROOT' } } },
    { $project: { _id: 0, docs: { $slice: ['$docs', FENETRE_MELANGE] } } },
    { $unwind: { path: '$docs', includeArrayIndex: 'rang' } },
    { $replaceRoot: { newRoot: { $mergeObjects: ['$docs', { rang: '$rang' }] } } },
    // Un tour à la fois, et dans un tour la plus proche d'abord (départage `_id`).
    { $sort: { rang: 1, distanceMetres: 1, _id: 1 } },
    { $limit: profondeur },
    { $project: { rang: 0 } },
  ]);
}

/**
 * GET /api/establishments/categories — taxonomie servie au client.
 *
 * Réponse :
 *   categories      = familles (onglets du feed) ;
 *   sousCategories  = précisions locales par famille (« Garbadrom », « Clé minute »…) ;
 *   personnalisees  = catégories PROPOSÉES par des utilisateurs et VALIDÉES par le
 *                     back-office (modèle DemandeCategorie). Elles n'ajoutent pas de
 *                     famille (l'enum reste fermé) : elles apparaissent comme
 *                     sous-catégories de leur famille d'origine au moment de
 *                     l'inscription d'un nouveau gérant (`famille` permet de les y placer).
 *
 * Les fiches déjà en bases gardent leur `categorie` / `sousCategorie` : cette route
 * décrit ce que l'application PROPOSE, elle ne réécrit rien.
 */
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    let personnalisees = [];
    try {
      const docs = await DemandeCategorie.find({ statut: 'validee' })
        .sort({ nom: 1 })
        .select('nom slug famille')
        .lean();
      personnalisees = docs.map((d) => ({
        slug: d.slug,
        label: d.nom,
        famille: d.famille || 'autre',
        personnalisee: true,
      }));
    } catch {
      // Une lecture de confort ne doit jamais casser l'annuaire : si la collection
      // n'existe pas encore (première mise en service), on sert la taxonomie de base.
      personnalisees = [];
    }
    res.json({ categories: CATEGORIES, sousCategories: SOUS_CATEGORIES, personnalisees });
  })
);

/**
 * GET /api/establishments
 * Query : q, categorie, sousCategorie, tags (séparés par virgule), lat, lng, radiusKm,
 *         sort, page, limit, diversite
 * sort : proximity (défaut si lat/lng fournis) | note | popular | recent
 *         (défaut SANS coordonnées : recent — « popular » favorisait de fait une
 *         seule catégorie, voir la note dans le corps de la route)
 * diversite : 0 (défaut) = PROXIMITÉ PURE (onglet « Tous » : du plus proche au plus
 *         loin, sur TOUTE la base, départage stable par `_id`) ; 1 = mélange
 *         équilibré par catégorie. Le mélange est une OPTION, plus le défaut.
 *         Voir melangeParCategorie.
 *
 * Note d'architecture : le backend renvoie une liste DÉJÀ triée selon des critères
 * simples et explicables (proximité, note, popularité). La personnalisation fine
 * (affinité apprise des interactions) est appliquée côté frontend dans
 * hooks/useFeedAlgorithm.js — c'est plus réactif et évite un aller-retour réseau
 * à chaque clic.
 *
 * PAGINATION (correction du 30/09) : le tri ET la pagination sont désormais faits
 * par MongoDB (`sort` / `$skip` / `$limit`), plus en mémoire sur les 400 fiches
 * les plus récentes. L'ancienne version chargeait `.limit(400)` puis triait ce
 * paquet : sur les 6 719 fiches importées, 583 fiches « Beauté » et une grande
 * partie de l'annuaire étaient inaccessibles, et `total` annonçait 400 au lieu
 * du compte réel. Le tri par proximité utilise maintenant l'index 2dsphere
 * (`$geoNear`, champ `position`) et `total` vient d'un `countDocuments` réel.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, categorie, tags, sort, page = 1, limit = 20 } = req.query;
    const coords = parseCoords(req.query);
    // Une valeur non numérique (« abc ») donnerait NaN : on la traite comme absente.
    const rayonDemande = Number(req.query.radiusKm);
    const radiusKm = Number.isFinite(rayonDemande) && rayonDemande > 0 ? rayonDemande : null;

    const filtre = {};
    if (categorie && categorie !== 'tous') filtre.categorie = categorie;
    if (tags) {
      const liste = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (liste.length) filtre.tags = { $in: liste };
    }

    // Sous-catégorie locale (« Garbadrom », « Clé minute », « WC publique »).
    //    - fiches migrées ou créées depuis le 20/11 → `sousCategorieSlug` (comparaison exacte) ;
    //    - fiches importées jamais migrées → `sousCategorie` (libellé, insensible à la casse).
    // On n'écrit PAS dans `filtre.$or` (réservé au texte `q`) : les deux conditions
    // cohabitent dans `$and`, sinon la seconde écraserait la première et le raccourci
    // « WC public » renverrait tout l'annuaire.
    const conditions = [];
    const sousCategorie = String(req.query.sousCategorie || '').trim();
    if (sousCategorie && sousCategorie !== 'toutes') {
      const cle = slugifier(sousCategorie);
      const libelle = resoudreSousCategorie(sousCategorie)?.label || sousCategorie;
      conditions.push({
        $or: [
          { sousCategorieSlug: cle },
          { sousCategorie: new RegExp(`^${escapeRegex(libelle)}$`, 'i') },
        ],
      });
    }

    if (q) {
      // Recherche insensible à la casse sur nom / tags / quartier / description (§4)
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      conditions.push({
        $or: [{ nom: rx }, { tags: rx }, { quartier: rx }, { commune: rx }, { description: rx }],
      });
    }
    if (conditions.length) filtre.$and = conditions;

    // 1) Ordre demandé. Sans coordonnées, « proximité » n'a aucun point de
    //    référence : on retombe sur les fiches les plus récentes.
    //    Correction du 30/09 : le défaut sans position était « popular ». Mesuré en
    //    production, il triait de fait par COMMUNAUTÉ (points « Transfert d'argent »
    //    puis 56 fiches « Beauté » sur 60) : une catégorie occupait tout l'écran, ce
    //    qui n'est pas ce qu'on attend d'un annuaire de quartier. « popular » reste
    //    disponible, mais uniquement sur demande explicite (`sort=popular`).
    let mode = sort || (coords ? 'proximity' : 'recent');
    if (mode === 'proximity' && !coords) mode = 'recent';
    const parProximite = mode === 'proximity';

    // 2) Filtre réellement compté. Le rayon n'est plus appliqué en JS après coup :
    //    il devient une contrainte géographique traitée par l'index 2dsphere.
    const filtreCompte = { ...filtre, test: { $ne: true } };
    if (coords && radiusKm) {
      filtreCompte.position = {
        $geoWithin: { $centerSphere: [[coords.lng, coords.lat], radiusKm / RAYON_TERRE_KM] },
      };
    }
    if (parProximite) {
      // $geoNear ignore les fiches sans point géographique : on compte donc le
      // MÊME ensemble, sinon `total` annoncerait plus de résultats que la liste
      // n'en contient (et `hasMore` mentirait à la dernière page).
      filtreCompte.position = filtreCompte.position || { $exists: true };
    }
    const total = await Establishment.countDocuments(filtreCompte);

    // 3) Pagination calculée AVANT la requête : c'est MongoDB qui saute et coupe,
    //    même quand il reste des milliers de fiches à parcourir.
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(LIMITE_MAX, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // 3 bis) Mélange équilibré des catégories (« Tous ») — désormais une OPTION.
    //    DÉCISION DE LANCEMENT : l'onglet « Tous » est par défaut une PROXIMITÉ PURE
    //    sur toute la base (du plus proche au plus loin), SANS échantillonnage par
    //    catégorie. On ne mélange donc que si le client le demande explicitement
    //    (`diversite=1`). Le mélange reste borné par DIVERSITE_PROFONDEUR_MAX.
    const diversiteDemandee = req.query.diversite === '1';
    const diversifie =
      (parProximite || mode === 'recent') &&
      !filtre.categorie &&
      diversiteDemandee &&
      skip + limitNum <= DIVERSITE_PROFONDEUR_MAX;

    // 4) Récupération de LA page demandée, triée par la base : index 2dsphere pour
    //    la proximité, score pondéré pour la popularité, index `noteMoyenne` pour
    //    la note, `createdAt` pour les plus récentes.
    let docs;
    if (diversifie) {
      // Le mélange est calculé sur `skip + limit` fiches (et non sur la seule page) :
      // la nième page est ainsi la tranche [skip, skip+limit) du même mélange, donc
      // aucune répétition ni fiche sautée d'une page à l'autre.
      const melange = await melangeParCategorie(mode, filtreCompte, coords, skip + limitNum);
      docs = melange.slice(skip, skip + limitNum);
    } else if (parProximite) {
      docs = await Establishment.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [coords.lng, coords.lat] },
            key: 'position',
            distanceField: 'distanceMetres',
            // Même filtre que le comptage, rayon inclus : les deux requêtes
            // portent ainsi exactement sur le même ensemble de fiches.
            query: filtreCompte,
          },
        },
        // DÉPARTAGE STABLE (exigence de lancement) : à distance égale (fiches au même
        // point, ou distances arrondies identiques), l'ordre est fixé par `_id` —
        // unique et immuable. Sans ce critère secondaire, l'ordre ne serait pas
        // totalement déterminé et deux pages successives pourraient répéter ou sauter
        // une fiche (un `$skip`/`$limit` sur un ordre ambigu n'est pas reproductible).
        { $sort: { distanceMetres: 1, _id: 1 } },
        { $skip: skip },
        { $limit: limitNum },
      ]);
    } else if (mode === 'popular') {
      docs = await Establishment.aggregate([
        { $match: filtreCompte },
        { $addFields: { scorePopularite: SCORE_POPULARITE } },
        { $sort: { scorePopularite: -1, _id: 1 } },
        { $skip: skip },
        { $limit: limitNum },
        // Le score est un détail d'implémentation : on ne le sérialise pas.
        { $project: { scorePopularite: 0 } },
      ]);
    } else {
      docs = await Establishment.find(filtreCompte).sort(triMongo(mode)).skip(skip).limit(limitNum);
    }

    const items = docs.map((brut) => {
      // `aggregate` renvoie des objets bruts : on les réhydrate pour retrouver les
      // méthodes du modèle (toCardJSON), exactement comme le fait `find`.
      const doc = brut instanceof Establishment ? brut : Establishment.hydrate(brut);
      const distanceKm = Number.isFinite(doc.distanceMetres)
        ? // Distance calculée par MongoDB (index 2dsphere) : la plus exacte.
          doc.distanceMetres / 1000
        : coords
          ? getDistanceKm(coords.lat, coords.lng, doc.localisation?.lat, doc.localisation?.lng)
          : null;
      return doc.toCardJSON({ distanceKm, base: basePublique(req) });
    });

    res.json({
      items,
      // Compte RÉEL en base (et non plus le nombre de fiches chargées : 400 au
      // maximum auparavant). C'est lui qui permet au client de savoir qu'il reste
      // des pages — indispensable avec 6 719 fiches.
      total,
      page: pageNum,
      limit: limitNum,
      hasMore: pageNum * limitNum < total,
      centre: coords,
      rayonKm: coords && radiusKm ? radiusKm : null,
      tri: mode,
      // `true` = la page vient d'un MÉLANGE équilibré des catégories (onglet
      // « Tous »). `false` = tri pur (catégorie choisie, tri explicite, ou fenêtre
      // au-delà de DIVERSITE_PROFONDEUR_MAX) : le client ne doit alors pas paginer
      // dans le mélange, car l'ordre n'est plus comparable d'une page à l'autre.
      diversite: diversifie,
    });
  })
);

/**
 * POST /api/establishments — inscription d'un établissement (§5).
 * Validation : minimum 3 tags ; photos recommandées mais facultatives (30/09),
 * une fiche sans photo doit pouvoir être publiée pendant la tournée terrain.
 */
router.post(
  '/',
  protect,
  // Anti-spam de fiches : 8 créations par minute et par IP + numéro
  // (même middleware que /login et /register — voir middleware/rateLimit.js).
  limiteurAuth(),
  // Textes libres de la fiche : balises et gestionnaires d'événements retirés
  // AVANT enregistrement (correctif XSS stocké du 27/11).
  assainirChamps([
    'nom',
    'sousCategorie',
    'description',
    'commune',
    'quartier',
    'adresse',
    'texteBoutonAction',
    'whatsapp',
    'horaires',
  ]),
  asyncHandler(async (req, res) => {
    const {
      nom,
      categorie,
      // Précision locale : « Garbadrom », « Clé minute »… ou le libellé libre proposé
      // par un gérant qui a choisi « Autre (précisez) ».
      sousCategorie = '',
      description = '',
      photoDevanture,
      photoVendeur,
      photos = [],
      tags,
      localisation,
      commune = '',
      quartier = '',
      adresse = '',
      texteBoutonAction = '',
      telephone,
      whatsapp = '',
      horaires = '',
      // Horaires structurés (16/11) : grille facultative. Une fiche peut encore se
      // créer sans (compatibilité avec l'ancien formulaire), elle n'aura alors pas
      // de badge « Ouvert / Fermé ».
      horairesStructures = null,
      fermetureTemporaire = undefined,
      // Code de l'agent qui accompagne l'inscription (prompt 9). Facultatif :
      // la plupart des gérants s'inscrivent seuls depuis leur téléphone.
      codeAgent = '',
    } = req.body || {};

    if (!nom || !String(nom).trim()) throw new ApiError(400, 'Le nom de l’établissement est obligatoire.');

    // ── §5 assoupli (30/09) : photos recommandées, jamais bloquantes. On refuse
    //    seulement une image invalide ou deux photos identiques. ──
    const controlePhotos = validateEstablishmentPhotos(photoDevanture, photoVendeur);
    if (!controlePhotos.ok) throw new ApiError(400, controlePhotos.error, { champPhotos: true });

    // ── Galerie multi-photos (16/11) : 8 URL https maximum, ordre conservé.
    //    `photos` est ici la galerie, d'où le nom `controlePhotos` ci-dessus.
    const controleGalerie = validerPhotos(photos);
    if (!controleGalerie.ok) {
      throw new ApiError(400, controleGalerie.error, { champPhotos: true });
    }
    const galerie = photos.map((p) => String(p).trim());

    // ── §5 : tags en bulles cliquables, minimum 3 ──
    const tagsPropres = sanitizeTags(tags);
    if (tagsPropres.length < 3) {
      throw new ApiError(400, 'Sélectionnez au moins 3 produits/services proposés par l’établissement.', {
        champTags: true,
      });
    }

    const lat = Number(localisation?.lat);
    const lng = Number(localisation?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new ApiError(400, 'Localisation obligatoire : activez la géolocalisation ou saisissez une adresse.');
    }
    if (!telephone || String(telephone).trim().length < 8) {
      throw new ApiError(400, 'Numéro de téléphone / WhatsApp obligatoire pour être joignable.');
    }

    // ── Horaires structurés (16/11) : on valide AVANT de créer la fiche, pour que
    //    l'inscription ne s'arrête pas après les photos (tout est renvoyé en une
    //    fois) et pour qu'aucune heure illisible n'entre en base.
    //    `grilleFournie` distingue « le formulaire a envoyé ses horaires » de « le
    //    champ n'a pas été transmis » (ancienne version de l'app) : dans le second
    //    cas on n'écrit rien, donc la fiche reste sans badge plutôt que d'annoncer
    //    des horaires 08:00-18:00 que personne n'a saisis.
    const grilleFournie = horairesStructures != null;
    const controleHoraires = horairesNormalises(horairesStructures);
    if (!controleHoraires.ok) throw new ApiError(400, controleHoraires.error, { champHoraires: true });
    const controleFermeture = fermetureTemporaireNormalisee(fermetureTemporaire);
    if (!controleFermeture.ok) throw new ApiError(400, controleFermeture.error);

    // ── Bloc D : DOUBLON EXACT refusé. Un nom identique (normalisé) à moins de 50 m, c'est
    //    le même établissement : on oriente vers la reprise de la fiche existante plutôt
    //    que de laisser une seconde entrée dans le quartier (avis et compteurs séparés).
    const doublons = await fichesProchesParNom(String(nom).trim(), { lat, lng }, DISTANCE_DOUBLON_M);
    if (doublons.length > 0) {
      const fiche = doublons[0];
      throw new ApiError(
        409,
        `« ${fiche.nom} » est déjà enregistré à ${fiche.distanceMetres} m : reprenez cette fiche au lieu d'en créer une seconde.`,
        { etablissementId: String(fiche._id), reprisePossible: true }
      );
    }

    // ── Sous-catégorie locale + proposition de catégorie (prompt 6) ──
    // La liste déroulante « Autre (précisez) » existe dans TOUTES les familles : un
    // gérant d'alimentation peut proposer « Poissonnerie », un « proximite » peut
    // proposer « Cordonnerie ». On enregistre TOUJOURS le libellé sur la fiche (rien ne
    // se perd) ; s'il n'existe pas encore dans la taxonomie, il part en modération
    // (DemandeCategorie) : c'est l'admin qui décide ce que verront les suivants.
    const categorieFiche = String(categorie || '').trim();
    if (!CATEGORIES_FILTRABLES.includes(categorieFiche)) {
      // 400 explicite plutôt qu'une ValidationError Mongoose en 500 : le formulaire
      // peut afficher la liste des familles autorisées et garder la saisie.
      throw new ApiError(400, 'Catégorie inconnue : choisissez une famille de la liste.', {
        champCategorie: true,
      });
    }
    const sousCategorieSaisie = String(sousCategorie || '').trim().slice(0, 60);
    const sousCategorieConnue = sousCategorieSaisie
      ? resoudreSousCategorie(sousCategorieSaisie, categorieFiche)
      : null;
    const sousCategorieLabel = sousCategorieConnue?.label || sousCategorieSaisie;
    const sousCategorieSlug = sousCategorieConnue?.slug || slugifier(sousCategorieSaisie);
    // Un libellé non répertorié = une proposition à modérer, quelle que soit la famille.
    const categorieLibre = Boolean(sousCategorieLabel) && !sousCategorieConnue;

    // ── Code agent (prompt 9) ────────────────────────────────────────────────
    // Un code au mauvais format est ignoré (il ne réconcilierait aucune paie) ;
    // un code BIEN formé mais inconnu ou désactivé est CONSERVÉ sur la fiche et
    // la marque `aVerifier` : on ne perd jamais la trace de ce que l'agent a
    // réellement saisi, et le back-office peut le rappeler.
    const codeAgentSaisi = codeAgentNormalise(codeAgent);
    const agentTrouve = codeAgentSaisi ? await Agent.findOne({ code: codeAgentSaisi }) : null;
    // Un agent désactivé compte comme inconnu : ses fiches doivent être relues
    // avant d'être payées (il a peut-être quitté l'équipe).
    const agentTerrain = agentTrouve?.actif ? agentTrouve : null;

    const doc = new Establishment({
      codeAgent: codeAgentSaisi,
      // Empreinte de l'appareil : sert au compteur « plus de 5 fiches en 24 h »
      // (voir motifsSuspicion). Jamais publiée, jamais renvoyée.
      empreinteAppareil: empreinteAppareilDe(req),
      nom: String(nom).trim(),
      categorie: categorieFiche,
      sousCategorie: sousCategorieLabel,
      sousCategorieSlug,
      description: String(description).trim(),
      // Chaîne vide autorisée (photo ajoutée plus tard) ; trim pour éviter un
      // espace qui ferait croire à une photo fournie.
      photoDevanture: String(photoDevanture || '').trim(),
      photoVendeur: String(photoVendeur || '').trim(),
      // Galerie : URL https Cloudinary, dans l'ordre choisi par le gérant.
      photos: galerie,
      tags: tagsPropres,
      localisation: { lat, lng },
      commune,
      quartier,
      adresse,
      // §5 : texte du bouton d'action dynamique (« Aller chez Chez Fatou »)
      texteBoutonAction: buildActionLabel(nom, texteBoutonAction),
      telephone: String(telephone).trim(),
      whatsapp: String(whatsapp || telephone).trim(),
      horaires,
      createdByUserId: req.user?._id,
    });

    // Horaires : la grille et son témoin de saisie sont écrits ENSEMBLE (voir le
    // commentaire du champ `horairesStructuresMisAJourLe` dans le modèle).
    if (grilleFournie) {
      doc.horairesStructures = controleHoraires.valeur;
      doc.horairesStructuresMisAJourLe = new Date();
    }
    if (controleFermeture.valeur) doc.fermetureTemporaire = controleFermeture.valeur;

    await doc.save();

    // ── Anti-fraude (prompt 9) : contrôles APRÈS création, JAMAIS bloquants.
    //    Une inscription ne doit pas échouer devant le commerçant ; la fiche est
    //    simplement marquée pour relecture par le back-office. Toute erreur ici
    //    (index géographique absent, base lente) est ignorée : la fiche existe.
    try {
      const motifs = await motifsSuspicion({ doc, agent: agentTerrain });
      if (motifs.length > 0) {
        await Establishment.updateOne(
          { _id: doc._id },
          { $set: { aVerifier: true, motifsVerification: motifs } }
        );
        doc.aVerifier = true;
        doc.motifsVerification = motifs;
      }
    } catch {
      /* la levée de doute reste possible à la main depuis le back-office */
    }

    // Rattaché au compte établissement pour permettre les mises à jour ultérieures.
    if (req.user && !req.user.etablissementId) {
      req.user.etablissementId = doc._id;
      // Plus de « typeCompte » (compte unifié, ajout du 29/09) : c'est le lien
      // etablissementId qui autorise les mises à jour ultérieures.
      await req.user.save();
    }

    // Proposition de catégorie : écrite APRÈS la fiche, et jamais bloquante — une
    // inscription ne doit pas échouer parce que la modération n'a pas pu être écrite.
    // Dédoublonnée par slug : trois « Poissonnerie » = une demande avec compteur 3.
    let propositionCategorie = null;
    if (categorieLibre) {
      try {
        const existante = await DemandeCategorie.findOne({
          slug: sousCategorieSlug,
          statut: { $in: ['en_attente', 'validee'] },
        });
        if (existante?.statut === 'en_attente') {
          existante.demandes += 1;
          await existante.save();
          propositionCategorie = existante.toPublicJSON();
        } else if (existante?.statut === 'validee') {
          // Déjà validée : rien à modérer, la fiche la portera simplement.
          propositionCategorie = existante.toPublicJSON();
        } else {
          const creee = await DemandeCategorie.create({
            nom: sousCategorieLabel,
            slug: sousCategorieSlug,
            // La famille d'origine sert à regrouper la proposition dans le formulaire
            // d'inscription des gérants suivants (et dans le back-office).
            famille: categorieFiche,
            userId: req.user?._id || null,
            etablissementId: doc._id,
          });
          propositionCategorie = creee.toPublicJSON();
        }
      } catch {
        propositionCategorie = null;
      }
    }

    res.status(201).json({
      etablissement: doc.toCardJSON({ base: basePublique(req) }),
      propositionCategorie,
    });
  })
);

/**
 * GET /api/establishments/rapprochement?nom=&lat=&lng= — « C'est votre établissement ? »
 *
 * Cherche les fiches importées NON RÉCLAMÉES (`estImporte=true`, `reclame=false`) à 150 m
 * ou moins, dont le nom est proche. Sert UNIQUEMENT à proposer au nouveau venu de reprendre
 * la fiche de son commerce au lieu d'en créer une seconde. Aucune donnée personnelle n'est
 * renvoyée : nom, catégorie, quartier et distance de la fiche publique.
 */
router.get(
  '/rapprochement',
  protect,
  asyncHandler(async (req, res) => {
    const coords = parseCoords(req.query);
    const nom = String(req.query.nom || '').trim();
    if (!coords || nom.length < 3) return res.json({ candidats: [] });

    const fiches = await fichesProchesParNom(nom, coords, DISTANCE_RECLAMATION_M, {
      estImporte: true,
      reclame: false,
    });

    res.json({
      candidats: fiches.map((f) => ({
        id: String(f._id),
        nom: f.nom,
        categorie: f.categorie,
        quartier: f.quartier || '',
        commune: f.commune || '',
        distanceMetres: f.distanceMetres,
      })),
    });
  })
);

/**
 * POST /api/establishments/:id/reclamer — « C'est mon établissement » (bloc D).
 *
 * ⚠️ CORRECTIF DE SÉCURITÉ (27/11). Cette route ACCEPTAIT auparavant la demande
 * automatiquement dès que les coordonnées envoyées par le client tombaient à 150 m
 * ou moins de la fiche (`surPlace`). Or ces coordonnées sont PUBLIQUES (`GET
 * /api/establishments` les sert) et c'est le client qui choisit ce qu'il envoie :
 * n'importe quel compte pouvait donc revendiquer n'importe quelle fiche importée
 * non réclamée, puis en modifier le nom, le téléphone et les photos.
 *
 * Désormais AUCUNE revendication n'est automatique :
 *   1. la demande est enregistrée dans `DemandeRevendication` à l'état `en_attente` ;
 *   2. l'équipe la voit dans le back-office (onglet « Revendications ») ;
 *   3. seule `PATCH /api/admin/demandes-revendication/:id/valider` rattache la fiche
 *      au compte (`reclame = true`, `createdByUserId`, `user.etablissementId`).
 *
 * La position déclarée est conservée à titre INDICATIF (priorisation), jamais comme
 * preuve : elle ne décide plus de rien.
 *
 * Réponses : 202 demande enregistrée (ou déjà en attente) · 404 fiche inconnue ·
 * 409 fiche déjà réclamée.
 */
router.post(
  '/:id/reclamer',
  protect,
  // `nomDeclare` est un texte libre affiché dans le back-office : nettoyé à l'entrée.
  assainirChamps(['nomDeclare']),
  asyncHandler(async (req, res) => {
    const MESSAGE = 'Votre demande a été envoyée. Elle sera examinée par notre équipe sous 24h.';

    const coords = parseCoords(req.query) || parseCoords(req.body || {});
    const fiche = await Establishment.findById(req.params.id);
    if (!fiche) throw new ApiError(404, 'Établissement introuvable.');
    if (fiche.reclame) {
      throw new ApiError(409, 'Cette fiche est déjà réclamée : elle a un responsable.');
    }

    // Distance INDICATIVE : coordonnées fournies par le client, donc falsifiables.
    // Elle est stockée pour l'affichage et n'entre dans aucune décision.
    const distance = distanceMetresEntre(
      { lat: coords?.lat, lng: coords?.lng },
      { lat: fiche.localisation?.lat, lng: fiche.localisation?.lng }
    );
    const nomDeclare = String(req.body?.nomDeclare || fiche.nom).trim().slice(0, 120);

    // Une seule demande EN ATTENTE par compte et par fiche : un second appel est
    // idempotent (même message, aucune ligne en double).
    const existante = await DemandeRevendication.findOne({
      userId: req.user._id,
      etablissementId: fiche._id,
      statut: 'en_attente',
    });

    const demande =
      existante ||
      (await DemandeRevendication.create({
        userId: req.user._id,
        etablissementId: fiche._id,
        date: new Date(),
        statut: 'en_attente',
        nomDeclare,
        distanceDeclareeMetres: distance != null && distance >= 0 ? Math.round(distance) : null,
      }));

    // Compatibilité avec l'onglet « Réclamations » historique, qui lit
    // `fiche.reclamation` : on y reflète la demande EN ATTENTE pour que les deux
    // écrans racontent la même histoire — sans jamais attribuer la fiche ici.
    // (L'onglet « Revendications » reste la source de vérité : il liste TOUS les
    // demandeurs d'une même fiche, ce sous-document ne garde que le dernier.)
    fiche.reclamation = {
      statut: 'en_attente',
      demandeurUserId: req.user._id,
      nomDeclare,
      distanceMetres: distance,
      demandeeLe: demande.date || new Date(),
      traiteeLe: null,
      traiteeParUserId: null,
    };
    await fiche.save();

    res.status(202).json({
      statut: 'en_attente',
      message: MESSAGE,
      demande: demande.toPublicJSON(),
    });
  })
);

/**
 * POST /api/establishments/:id/visit — incrémente le COMPTEUR DE VISITES.
 * Enregistre aussi une interaction « vue » si l'utilisateur est identifié (§3).
 * Utilise $inc atomique : deux visites simultanées ne se perdent jamais.
 */
router.post(
  '/:id/visit',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const resultat = await incrementerUneFoisParJour({
      req,
      type: 'visit',
      champ: 'compteurVisites',
      select: 'compteurVisites compteurUtilisateurs',
    });

    if (resultat.introuvable) throw new ApiError(404, 'Établissement introuvable.');
    // Déjà compté aujourd'hui pour cette identité : on renvoie l'état SANS incrémenter.
    if (resultat.dejaCompte) {
      const doc = await Establishment.findById(req.params.id).select(
        'compteurVisites compteurUtilisateurs'
      );
      return res.json({
        compteurVisites: doc?.compteurVisites ?? 0,
        compteurUtilisateurs: doc?.compteurUtilisateurs ?? 0,
        dejaCompte: true,
      });
    }

    const doc = resultat.doc;
    if (req.user) {
      req.user.ajouterInteraction({ type: 'vue', establishmentId: doc._id });
      await req.user.save().catch(() => {});
    }

    // Les deux compteurs restent renvoyés séparément (§3).
    res.json({
      compteurVisites: doc.compteurVisites,
      compteurUtilisateurs: doc.compteurUtilisateurs,
      dejaCompte: false,
    });
  })
);

/**
 * POST /api/establishments/:id/action — incrémente le COMPTEUR D'UTILISATEURS.
 * Appelé quand quelqu'un clique sur le bouton d'action dynamique
 * (« Aller chez Chez Fatou »). NE TOUCHE PAS au compteur de visites : les deux
 * chiffres doivent rester strictement indépendants (§3).
 */
router.post(
  '/:id/action',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const resultat = await incrementerUneFoisParJour({
      req,
      type: 'action',
      champ: 'compteurUtilisateurs',
      select: 'compteurVisites compteurUtilisateurs nom texteBoutonAction telephone localisation',
    });

    if (resultat.introuvable) throw new ApiError(404, 'Établissement introuvable.');
    if (resultat.dejaCompte) {
      const doc = await Establishment.findById(req.params.id).select(
        'compteurVisites compteurUtilisateurs texteBoutonAction telephone'
      );
      return res.json({
        compteurVisites: doc?.compteurVisites ?? 0,
        compteurUtilisateurs: doc?.compteurUtilisateurs ?? 0,
        texteBoutonAction: doc?.texteBoutonAction || '',
        telephone: doc?.telephone || '',
        dejaCompte: true,
      });
    }

    const doc = resultat.doc;
    if (req.user) {
      req.user.ajouterInteraction({
        type: 'clic',
        establishmentId: doc._id,
        terme: doc.texteBoutonAction,
      });
      await req.user.save().catch(() => {});
    }

    res.json({
      compteurVisites: doc.compteurVisites,
      compteurUtilisateurs: doc.compteurUtilisateurs,
      texteBoutonAction: doc.texteBoutonAction,
      telephone: doc.telephone,
      dejaCompte: false,
    });
  })
);

/**
 * GET /api/establishments/:id — fiche profil détaillée (§5).
 * NB : cette route N'incrémente PAS le compteur de visites. C'est volontaire :
 * le frontend appelle explicitement POST /:id/visit une seule fois au montage,
 * pour éviter de compter deux fois un simple rafraîchissement de données.
 */
router.get(
  '/:id',
  // `optionalAuth` : la fiche reste PUBLIQUE (aucun compte requis), mais quand un
  // jeton accompagne la requête on peut répondre « déjà visité ? ». Aucun jeton
  // invalide ne bloque la lecture : le middleware ignore et continue en anonyme.
  optionalAuth,
  asyncHandler(async (req, res) => {
    const doc = await Establishment.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    const coords = parseCoords(req.query);
    const distanceKm = coords
      ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
      : null;

    // « Déjà visité » (ajout du 17/11) : booléen calculé pour CE compte, jamais
    // stocké sur la fiche. Ne sort donc que dans la réponse à l'utilisateur
    // concerné — c'est une information privée (la fiche n'est pas modifiée).
    const estVisite = Boolean(
      req.user && (req.user.visites || []).some((v) => String(v) === String(doc._id))
    );

    res.json({
      etablissement: doc.toCardJSON({ distanceKm, base: basePublique(req) }),
      avis: (doc.avis || []).slice().reverse().slice(0, 50),
      estVisite,
    });
  })
);

/**
 * GET /api/establishments/:id/photo/:role — sert une photo d'établissement.
 *
 * POURQUOI CETTE ROUTE EXISTE : une photo peut être stockée en data-URI base64
 * (jusqu'à ~5,5 Mo). La renvoyer dans le JSON d'une liste rendait la page d'accueil
 * inutilisable sur un réseau lent. Les listes ne transportent donc plus qu'une URL,
 * et c'est ici que les octets de l'image partent — une seule fois, puis le
 * navigateur les garde en cache (`Cache-Control` long).
 *
 * `role` : `devanture` (défaut) ou `vendeur`.
 * - URL https : redirection vers l'hébergeur (aucun octet ne traverse l'API) ;
 * - data-URI : décodage en octets et envoi en image binaire.
 */
router.get(
  '/:id/photo/:role',
  asyncHandler(async (req, res) => {
    const role = req.params.role === 'vendeur' ? 'vendeur' : 'devanture';
    const champ = role === 'vendeur' ? 'photoVendeur' : 'photoDevanture';

    const doc = await Establishment.findById(req.params.id).select(
      'photoDevanture photoVendeur updatedAt'
    );
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    const valeur = String(doc[champ] || '').trim();
    if (!valeur) throw new ApiError(404, 'Aucune photo pour cet établissement.');

    // Un jour pour les URL distantes (l'hébergeur gère sa propre mise en cache),
    // une semaine pour les images servies ici : la photo d'une fiche ne change pas
    // à chaque visite. Une mise à jour de la fiche change l'ETag ci-dessous.
    if (estUrlDistante(valeur)) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.redirect(302, valeur);
    }

    const decode = decoderPhoto(valeur);
    if (!decode) throw new ApiError(404, 'Photo illisible pour cet établissement.');

    res.set('Content-Type', decode.contentType);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.set('ETag', `"${doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0}-${decode.buffer.length}"`);
    return res.send(decode.buffer);
  })
);

/** GET /api/establishments/:id/reviews — avis clients (§5). */
router.get(
  '/:id/reviews',
  asyncHandler(async (req, res) => {
    const doc = await Establishment.findById(req.params.id).select('avis noteMoyenne nombreAvis');
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');
    res.json({
      avis: (doc.avis || []).slice().reverse().slice(0, 50),
      noteMoyenne: doc.noteMoyenne,
      nombreAvis: doc.nombreAvis,
    });
  })
);

/**
 * POST /api/establishments/:id/reviews — ajoute un avis noté (§5).
 * Note obligatoire 1..5, commentaire optionnel. Recalcule la moyenne.
 */
router.post(
  '/:id/reviews',
  protect,
  // Anti-spam d'avis : même limiteur que les inscriptions (8/minute par IP + numéro).
  limiteurAuth(),
  // Le commentaire d'avis est un texte libre public : nettoyé à l'entrée.
  assainirChamps(['commentaire']),
  asyncHandler(async (req, res) => {
    const note = clampNote(req.body?.note);
    if (note == null) throw new ApiError(400, 'La note doit être un entier entre 1 et 5.');

    const doc = await Establishment.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    // Un seul avis par utilisateur : le second met à jour le premier.
    const dejaIndex = doc.avis.findIndex((a) => String(a.auteurId) === String(req.user._id));
    const avis = {
      auteurId: req.user._id,
      // Jamais le numéro de téléphone : un compte sans nom publié apparaissait avec
      // son numéro dans la liste publique des avis (fuite relevée par le pentest).
      auteurNom: req.user.nomComplet || 'Utilisateur',
      auteurPhoto: req.user.photoProfil || '',
      note,
      commentaire: String(req.body?.commentaire || '').slice(0, 600),
      tags: sanitizeTags(req.body?.tags),
      at: new Date(),
    };
    if (dejaIndex >= 0) doc.avis[dejaIndex] = { ...doc.avis[dejaIndex].toObject(), ...avis };
    else doc.avis.push(avis);

    doc.recalculerNote();
    await doc.save();

    res.status(201).json({
      noteMoyenne: doc.noteMoyenne,
      nombreAvis: doc.nombreAvis,
      avis: (doc.avis || []).slice().reverse().slice(0, 50),
    });
  })
);

/** PATCH /api/establishments/:id — mise à jour par le gérant propriétaire. */
router.patch(
  '/:id',
  protect,
  // Champs texte modifiables par le gérant : nettoyés avant écriture.
  assainirChamps([
    'nom',
    'description',
    'commune',
    'quartier',
    'adresse',
    'whatsapp',
    'horaires',
  ]),
  asyncHandler(async (req, res) => {
    const doc = await Establishment.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    const proprietaire =
      (doc.createdByUserId && String(doc.createdByUserId) === String(req.user._id)) ||
      (req.user.etablissementId && String(req.user.etablissementId) === String(doc._id));
    if (!proprietaire) {
      throw new ApiError(403, 'Seul le gérant de cet établissement peut le modifier.');
    }

    const champsSimple = ['nom', 'categorie', 'description', 'commune', 'quartier', 'adresse', 'telephone', 'whatsapp', 'horaires'];
    for (const c of champsSimple) {
      if (req.body?.[c] !== undefined) doc[c] = String(req.body[c]).trim();
    }
    if (req.body?.photoDevanture !== undefined || req.body?.photoVendeur !== undefined) {
      const nouvelleDevanture = req.body.photoDevanture ?? doc.photoDevanture;
      const nouveauVendeur = req.body.photoVendeur ?? doc.photoVendeur;
      const controle = validateEstablishmentPhotos(nouvelleDevanture, nouveauVendeur);
      if (!controle.ok) throw new ApiError(400, controle.error);
      doc.photoDevanture = String(nouvelleDevanture || '').trim();
      doc.photoVendeur = String(nouveauVendeur || '').trim();
    }
    // Galerie multi-photos (16/11) : ajout, retrait et réordonnancement par le
    // propriétaire. Le tableau envoyé REMPLACE l'ancien — c'est ce qui permet la
    // suppression et le réordonnancement depuis l'application. `undefined` = on
    // ne touche pas à la galerie (PATCH des autres champs).
    if (req.body?.photos !== undefined) {
      const controle = validerPhotos(req.body.photos);
      if (!controle.ok) throw new ApiError(400, controle.error);
      doc.photos = req.body.photos.map((p) => String(p).trim());
    }
    if (req.body?.tags !== undefined) {
      const tags = sanitizeTags(req.body.tags);
      if (tags.length < 3) throw new ApiError(400, 'Conservez au moins 3 produits/services.');
      doc.tags = tags;
    }
    // Localisation (16/11) : le gérant peut re-mesurer la position de son commerce
    // depuis la fiche (calibrage GPS de 10 s, puis confirmation sur la carte).
    // `parseCoords` applique les mêmes bornes que la création (lat -90..90,
    // lng -180..180, (0,0) refusé) : une mesure aberrante est REJETÉE (400) au lieu
    // d'être ignorée en silence — l'écran croirait avoir enregistré un point.
    if (req.body?.localisation !== undefined) {
      const coords = parseCoords(req.body.localisation);
      if (!coords) {
        throw new ApiError(
          400,
          'Position invalide : latitude entre -90 et 90, longitude entre -180 et 180.',
          { champLocalisation: true }
        );
      }
      doc.localisation = coords;
    }
    if (req.body?.texteBoutonAction !== undefined) {
      // Le libellé reste dynamique : par défaut « Aller chez {nom} » (§5)
      doc.texteBoutonAction = buildActionLabel(doc.nom, req.body.texteBoutonAction);
    }

    // ── Horaires structurés (16/11) ──────────────────────────────────────────
    // `null` = le gérant efface la grille (retour à « horaires inconnus », donc plus
    // de badge). Sinon on fusionne avec la grille en base : un PATCH qui ne parle
    // que du dimanche ne doit pas remettre les six autres jours à 08:00-18:00.
    if (req.body?.horairesStructures === null) {
      doc.horairesStructures = null;
      doc.horairesStructuresMisAJourLe = null;
    } else if (req.body?.horairesStructures !== undefined) {
      const controle = horairesNormalises(req.body.horairesStructures, doc.horairesStructures);
      if (!controle.ok) throw new ApiError(400, controle.error, { champHoraires: true });
      doc.horairesStructures = controle.valeur;
      doc.horairesStructuresMisAJourLe = new Date();
    }

    // Fermeture temporaire : elle prime sur la grille le temps qu'elle dure.
    if (req.body?.fermetureTemporaire !== undefined) {
      const controle = fermetureTemporaireNormalisee(req.body.fermetureTemporaire);
      if (!controle.ok) throw new ApiError(400, controle.error);
      if (controle.valeur) doc.fermetureTemporaire = controle.valeur;
    }

    await doc.save();
    res.json({ etablissement: doc.toCardJSON({ base: basePublique(req) }) });
  })
);

export default router;





