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
 * à chaque clic. `distanceKm` est recalculé en JS (voir utils/geo.js).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, categorie, tags, sort, page = 1, limit = 20 } = req.query;
    const coords = parseCoords(req.query);
    const radiusKm = req.query.radiusKm ? Number(req.query.radiusKm) : null;

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

    const docs = await Establishment.find(filtre).sort({ createdAt: -1 }).limit(400);

    let items = docs.map((doc) => {
      const distanceKm = coords
        ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
        : null;
      return { doc, distanceKm, json: doc.toCardJSON({ distanceKm }) };
    });

    if (coords && radiusKm) {
      items = items.filter((it) => it.distanceKm != null && it.distanceKm <= radiusKm);
    }

    const mode = sort || (coords ? 'proximity' : 'popular');
    items.sort((a, b) => {
      if (mode === 'note') {
        return b.json.noteMoyenne - a.json.noteMoyenne || (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
      }
      if (mode === 'recent') {
        return new Date(b.json.createdAt) - new Date(a.json.createdAt);
      }
      if (mode === 'popular') {
        // Deux compteurs pondérés séparément, jamais fusionnés en un champ unique :
        // les "utilisateurs" pèsent plus lourd que les simples visites de profil.
        const scoreA = a.json.compteurUtilisateurs * 3 + a.json.compteurVisites;
        const scoreB = b.json.compteurUtilisateurs * 3 + b.json.compteurVisites;
        return scoreB - scoreA;
      }
      // proximity (défaut quand la position est connue)
      return (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
    });

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(60, Math.max(1, Number(limit) || 20));
    const start = (pageNum - 1) * limitNum;
    const pageItems = items.slice(start, start + limitNum);

    res.json({
      items: pageItems.map((it) => it.json),
      total: items.length,
      page: pageNum,
      limit: limitNum,
      hasMore: start + limitNum < items.length,
      centre: coords,
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





