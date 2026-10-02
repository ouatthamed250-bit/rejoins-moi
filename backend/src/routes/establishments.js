// establishments.js — Endpoints pour les profils d'établissements (kiosque, boulangerie, artisan, église...)
// GET    /api/establishments               -> liste + filtres (catégorie, proximité)
// GET    /api/establishments/:id           -> détail complet
// POST   /api/establishments               -> création (inscription, 2 photos + tags, voir modèle)
// POST   /api/establishments/:id/visit     -> incrémente le compteur de VISITES
// POST   /api/establishments/:id/action    -> incrémente le compteur d'UTILISATEURS
//                                              (clic sur le bouton "Aller chez...")
// POST   /api/establishments/:id/reviews   -> ajouter un avis + note
//
// ⚠️ RÈGLE CRITIQUE (§3) : `compteurVisites` et `compteurUtilisateurs` sont deux
// compteurs INDÉPENDANTS, incrémentés par DEUX endpoints distincts, et toujours
// renvoyés séparément. On n'expose volontairement aucun champ agrégé.

import express from 'express';
import Establishment from '../models/Establishment.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import {
  validateEstablishmentPhotos,
  sanitizeTags,
  clampNote,
  buildActionLabel,
  escapeRegex,
} from '../utils/validators.js';
import { getDistanceKm, parseCoords } from '../utils/geo.js';
import CompteurJournalier from '../models/CompteurJournalier.js';

const router = express.Router();
router.use(requireDb);

/** Clé d'identité du compteur : l'utilisateur connecté, sinon son adresse IP (anonyme). */
function cleIncrement(req) {
  return req.user ? `u:${req.user._id}` : `ip:${req.ip || req.socket?.remoteAddress || 'inconnue'}`;
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
 * Décision produit (à valider) : j'ai ajouté « commerce », « santé », « spiritualité »
 * et « autre » pour couvrir les exemples cités dans le cahier des charges
 * (kiosque, église, clinique, pharmacie) sans créer un établissement « fourre-tout ».
 * Le frontend consomme GET /api/establishments/categories pour rester synchronisé.
 */
export const CATEGORIES = [
  { slug: 'tous', label: 'Tous', icone: 'grid' },
  { slug: 'alimentation', label: 'Alimentation', icone: 'utensils' },
  { slug: 'beaute', label: 'Beauté', icone: 'scissors' },
  { slug: 'services', label: 'Services', icone: 'tools' },
  { slug: 'artisanat', label: 'Artisanat', icone: 'hammer' },
  { slug: 'commerce', label: 'Commerce', icone: 'store' },
  { slug: 'sante', label: 'Santé', icone: 'heart' },
  { slug: 'spiritualite', label: 'Spiritualité', icone: 'church' },
  { slug: 'autre', label: 'Autre', icone: 'dot' },
];

/** Slug des catégories utilisables comme filtre (tout sauf le pseudo-onglet « tous »). */
const CATEGORIES_FILTRABLES = CATEGORIES.filter((cat) => cat.slug !== 'tous').map((cat) => cat.slug);

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

/** GET /api/establishments/categories — liste extensible des catégories (utilisée par CategoryFilter). */
router.get('/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

/**
 * GET /api/establishments
 * Query : q, categorie, tags (séparés par virgule), lat, lng, radiusKm, sort, page,
 *         limit, diversite
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
    if (q) {
      // Recherche insensible à la casse sur nom / tags / quartier / description (§4)
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      filtre.$or = [{ nom: rx }, { tags: rx }, { quartier: rx }, { commune: rx }, { description: rx }];
    }

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
    const filtreCompte = { ...filtre };
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
      return doc.toCardJSON({ distanceKm });
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
  asyncHandler(async (req, res) => {
    const {
      nom,
      categorie,
      description = '',
      photoDevanture,
      photoVendeur,
      tags,
      localisation,
      commune = '',
      quartier = '',
      adresse = '',
      texteBoutonAction = '',
      telephone,
      whatsapp = '',
      horaires = '',
    } = req.body || {};

    if (!nom || !String(nom).trim()) throw new ApiError(400, 'Le nom de l’établissement est obligatoire.');

    // ── §5 assoupli (30/09) : photos recommandées, jamais bloquantes. On refuse
    //    seulement une image invalide ou deux photos identiques. ──
    const photos = validateEstablishmentPhotos(photoDevanture, photoVendeur);
    if (!photos.ok) throw new ApiError(400, photos.error, { champPhotos: true });

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

    const doc = new Establishment({
      nom: String(nom).trim(),
      categorie,
      description: String(description).trim(),
      // Chaîne vide autorisée (photo ajoutée plus tard) ; trim pour éviter un
      // espace qui ferait croire à une photo fournie.
      photoDevanture: String(photoDevanture || '').trim(),
      photoVendeur: String(photoVendeur || '').trim(),
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

    await doc.save();

    // Rattaché au compte établissement pour permettre les mises à jour ultérieures.
    if (req.user && !req.user.etablissementId) {
      req.user.etablissementId = doc._id;
      // Plus de « typeCompte » (compte unifié, ajout du 29/09) : c'est le lien
      // etablissementId qui autorise les mises à jour ultérieures.
      await req.user.save();
    }

    res.status(201).json({ etablissement: doc.toCardJSON() });
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
  asyncHandler(async (req, res) => {
    const doc = await Establishment.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    const coords = parseCoords(req.query);
    const distanceKm = coords
      ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
      : null;

    res.json({
      etablissement: doc.toCardJSON({ distanceKm }),
      avis: (doc.avis || []).slice().reverse().slice(0, 50),
    });
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
  asyncHandler(async (req, res) => {
    const note = clampNote(req.body?.note);
    if (note == null) throw new ApiError(400, 'La note doit être un entier entre 1 et 5.');

    const doc = await Establishment.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    // Un seul avis par utilisateur : le second met à jour le premier.
    const dejaIndex = doc.avis.findIndex((a) => String(a.auteurId) === String(req.user._id));
    const avis = {
      auteurId: req.user._id,
      auteurNom: req.user.nomComplet || req.user.telephone,
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
    if (req.body?.tags !== undefined) {
      const tags = sanitizeTags(req.body.tags);
      if (tags.length < 3) throw new ApiError(400, 'Conservez au moins 3 produits/services.');
      doc.tags = tags;
    }
    if (req.body?.localisation) {
      const lat = Number(req.body.localisation.lat);
      const lng = Number(req.body.localisation.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) doc.localisation = { lat, lng };
    }
    if (req.body?.texteBoutonAction !== undefined) {
      // Le libellé reste dynamique : par défaut « Aller chez {nom} » (§5)
      doc.texteBoutonAction = buildActionLabel(doc.nom, req.body.texteBoutonAction);
    }

    await doc.save();
    res.json({ etablissement: doc.toCardJSON() });
  })
);

export default router;





