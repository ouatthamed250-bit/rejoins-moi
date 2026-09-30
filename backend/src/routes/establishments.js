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

const router = express.Router();
router.use(requireDb);

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

/** GET /api/establishments/categories — liste extensible des catégories (utilisée par CategoryFilter). */
router.get('/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

/**
 * GET /api/establishments
 * Query : q, categorie, tags (séparés par virgule), lat, lng, radiusKm, sort, page, limit
 * sort : proximity (défaut si lat/lng fournis) | note | popular | recent
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
    let mode = sort || (coords ? 'proximity' : 'popular');
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

    // 4) Récupération de LA page demandée, triée par la base : index 2dsphere pour
    //    la proximité, score pondéré pour la popularité, index `noteMoyenne` pour
    //    la note, `createdAt` pour les plus récentes.
    let docs;
    if (parProximite) {
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
    const doc = await Establishment.findByIdAndUpdate(
      req.params.id,
      { $inc: { compteurVisites: 1 } },
      { new: true, select: 'compteurVisites compteurUtilisateurs' }
    );
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

    if (req.user) {
      req.user.ajouterInteraction({ type: 'vue', establishmentId: doc._id });
      await req.user.save().catch(() => {});
    }

    // Les deux compteurs restent renvoyés séparément (§3).
    res.json({
      compteurVisites: doc.compteurVisites,
      compteurUtilisateurs: doc.compteurUtilisateurs,
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
    const doc = await Establishment.findByIdAndUpdate(
      req.params.id,
      { $inc: { compteurUtilisateurs: 1 } },
      { new: true, select: 'compteurVisites compteurUtilisateurs nom texteBoutonAction telephone localisation' }
    );
    if (!doc) throw new ApiError(404, 'Établissement introuvable.');

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





