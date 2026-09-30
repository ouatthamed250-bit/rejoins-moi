// healthFacilities.js — Endpoints pharmacies/cliniques (SANS notes ni avis, voir cahier-des-charges §6)
// GET  /api/health-facilities                 -> liste avec distance, filtrable par type et statut de garde
// PATCH /api/health-facilities/:id/garde       -> l'établissement met à jour lui-même son statut de garde
//
// ⚠️ CONTRAINTE DE CONFORMITÉ — À NE PAS ENFREINDRE (§6, §7) :
//  - Aucun endpoint de notation, d'avis ou de commentaire n'existe ici, et il ne
//    doit jamais en être ajouté : déontologie médicale, pas de publicité
//    comparative pour les actes médicaux.
//  - Aucun compteur de visites/utilisateurs, aucun classement « populaire » :
//    l'ordre est uniquement "de garde d'abord", puis distance croissante.
//  - L'API renvoie strictement : nom, type, statut, distance, téléphone, adresse.
//  - La mention « statut mis à jour par l'établissement, à confirmer par téléphone
//    en cas d'urgence » est portée dans la réponse (`avertissement`) pour que le
//    frontend ne puisse pas l'oublier.

import express from 'express';
import bcrypt from 'bcryptjs';
import HealthFacility from '../models/HealthFacility.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { escapeRegex } from '../utils/validators.js';
import { getDistanceKm, parseCoords } from '../utils/geo.js';

const router = express.Router();
router.use(requireDb);

export const AVERTISSEMENT_GARDE =
  "Statut mis à jour par l'établissement, à confirmer par téléphone en cas d'urgence.";

/**
 * GET /api/health-facilities
 * Query : type (pharmacie|clinique), deGarde (true|false), q, lat, lng, limit
 * Tri : les établissements de garde d'abord, puis distance croissante.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { type, deGarde, q, limit = 50 } = req.query;
    const coords = parseCoords(req.query);

    const filtre = {};
    if (type === 'pharmacie' || type === 'clinique') filtre.type = type;
    if (deGarde === 'true') filtre.deGarde = true;
    if (deGarde === 'false') filtre.deGarde = false;
    if (q) {
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      filtre.$or = [{ nom: rx }, { commune: rx }, { quartier: rx }, { adresse: rx }];
    }

    const docs = await HealthFacility.find(filtre).limit(Math.min(200, Number(limit) || 50));

    const items = docs.map((doc) => {
      const distanceKm = coords
        ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
        : null;
      return doc.toListItemJSON({ distanceKm });
    });

    items.sort((a, b) => {
      if (a.deGarde !== b.deGarde) return a.deGarde ? -1 : 1;
      return (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
    });

    res.json({
      items,
      total: items.length,
      centre: coords,
      avertissement: AVERTISSEMENT_GARDE,
    });
  })
);

/**
 * POST /api/health-facilities — enregistrement d'une pharmacie ou d'une clinique.
 * Réservé aux comptes (protect). Renvoie un `codeAcces` en clair UNE SEULE FOIS :
 * il permet ensuite à l'établissement de mettre à jour son statut de garde sans
 * compte utilisateur complet (option la plus réaliste pour démarrer, §6).
 */
router.post(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const { nom, type, telephone, localisation, commune = '', quartier = '', adresse = '', horaires = '' } = req.body || {};

    if (!nom) throw new ApiError(400, 'Le nom est obligatoire.');
    if (type !== 'pharmacie' && type !== 'clinique') {
      throw new ApiError(400, 'Le type doit être « pharmacie » ou « clinique ».');
    }
    const lat = Number(localisation?.lat);
    const lng = Number(localisation?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new ApiError(400, 'Localisation (lat/lng) obligatoire.');
    }
    if (!telephone) throw new ApiError(400, 'Le téléphone est obligatoire (bouton Appeler).');

    // Code d'accès à 6 chiffres, haché avant stockage. Jamais renvoyé après création.
    const codeAcces = String(Math.floor(100000 + Math.random() * 900000));

    const doc = new HealthFacility({
      nom: String(nom).trim(),
      type,
      telephone: String(telephone).trim(),
      localisation: { lat, lng },
      commune,
      quartier,
      adresse,
      horaires,
      deGarde: Boolean(req.body?.deGarde),
      deGardeUpdatedAt: new Date(),
      codeAccesHash: await bcrypt.hash(codeAcces, 10),
      createdByUserId: req.user?._id,
    });

    await doc.save();
    res.status(201).json({ etablissement: doc.toListItemJSON(), codeAcces });
  })
);

/** GET /api/health-facilities/:id — détail minimal d'une pharmacie/clinique. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await HealthFacility.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Établissement de santé introuvable.');
    const coords = parseCoords(req.query);
    const distanceKm = coords
      ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
      : null;
    res.json({ etablissement: doc.toListItemJSON({ distanceKm }), avertissement: AVERTISSEMENT_GARDE });
  })
);

/**
 * PATCH /api/health-facilities/:id/garde — mise à jour du statut « de garde » (§6).
 * body: { deGarde: boolean, codeAcces?: "123456" }
 *
 * Deux chemins d'autorisation :
 *  1. un JWT valide (compte créateur ou compte de type « etablissement ») ;
 *  2. le `codeAcces` remis à la création (pratique terrain : le gérant n'a qu'un
 *     code à retenir, sans créer de compte).
 * Le statut est TOUJOURS auto-déclaré : aucune synchronisation avec le tableau de
 * garde officiel de l'Ordre des Pharmaciens à ce stade (évolution prévue, §6).
 */
router.patch(
  '/:id/garde',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const doc = await HealthFacility.findById(req.params.id).select('+codeAccesHash');
    if (!doc) throw new ApiError(404, 'Établissement de santé introuvable.');

    // 1) JWT : propriétaire de la fiche ou compte de type « etablissement ».
    // 1) JWT : propriétaire réel de la fiche (compte unifié : plus de type de compte,
    //    on ne se base plus sur `typeCompte === 'etablissement'`, trop permissif).
    let autorise = Boolean(req.user && String(doc.createdByUserId || '') === String(req.user._id));
    // 2) Sinon, code d'accès à 6 chiffres remis à la création.
    if (!autorise && req.body?.codeAcces) {
      autorise = await bcrypt.compare(String(req.body.codeAcces), doc.codeAccesHash || '');
    }
    if (!autorise) {
      throw new ApiError(401, 'Code d’accès invalide ou authentification requise.');
    }

    if (typeof req.body?.deGarde !== 'boolean') {
      throw new ApiError(400, 'Le champ « deGarde » (booléen) est obligatoire.');
    }

    doc.deGarde = req.body.deGarde;
    doc.deGardeUpdatedAt = new Date();
    await doc.save();

    res.json({
      etablissement: doc.toListItemJSON(),
      avertissement: AVERTISSEMENT_GARDE,
    });
  })
);

export default router;


