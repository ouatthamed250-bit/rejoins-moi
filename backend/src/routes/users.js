// users.js — Authentification et profils utilisateurs (auth par numéro de téléphone recommandée,
// cohérent avec les usages mobile money locaux)
// POST /api/users/register
// POST /api/users/login
// GET  /api/users/me
// PATCH /api/users/me
// GET  /api/users/artisans   (annuaire des artisans / prestataires)
// GET  /api/users/:id
//
// Décision produit (à signaler) : l'auth se fait par téléphone + mot de passe
// (pas d'e-mail), cohérent avec les usages locaux et le mobile money (§2, §10).
//
// COMPTE UNIFIÉ (cahier des charges, ajout du 29/09) : plus de type de compte à
// l'inscription. Tout le monde peut chercher du travail, poster une annonce et être
// trouvé comme artisan. Deux CAPACITÉS modifiables librement remplacent l'ancien
// `typeCompte` : `estArtisan` (je propose mes services) et `chercheTravail`
// (je cherche des missions). Voir models/User.js.
// Le champ `solde` (FCFA) est le portefeuille interne ; les déblocages de contact et
// les abonnements passent par CinetPay (voir routes/jobs.js et routes/subscriptions.js).

import express from 'express';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { signToken, protect, optionalAuth } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { normalizePhone, escapeRegex } from '../utils/validators.js';
import { getDistanceKm, parseCoords } from '../utils/geo.js';
import { limiteurAuth } from '../middleware/rateLimit.js';

const router = express.Router();

// Toutes les routes utilisateurs nécessitent une base disponible.
router.use(requireDb);

/**
 * POST /api/users/register — création de compte UNIQUE.
 * body: { telephone, motDePasse, nom, prenom, metier?, estArtisan?, chercheTravail?,
 *         segment?, photoProfil?, quartier?, commune?, localisation? }
 *
 * Aucun choix de « type de compte » : le métier renseigné suffit à activer la
 * visibilité artisan (décision à valider : elle reste modifiable depuis le profil).
 */
router.post(
  '/register',
  // Anti-spam d'inscriptions : 8 requêtes/minute par IP + numéro (voir middleware/rateLimit.js).
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const {
      motDePasse,
      nom = '',
      prenom = '',
      metier = '',
      segment = '',
      photoProfil = '',
      quartier = '',
      commune = '',
      localisation,
    } = req.body || {};

    const telephone = normalizePhone(req.body?.telephone);
    if (!telephone) {
      throw new ApiError(400, 'Numéro de téléphone ivoirien invalide (ex. 07 07 12 34 56).');
    }
    if (!motDePasse || String(motDePasse).length < 6) {
      throw new ApiError(400, 'Le mot de passe doit contenir au moins 6 caractères.');
    }

    const existant = await User.findOne({ telephone });
    if (existant) {
      throw new ApiError(409, 'Un compte existe déjà avec ce numéro. Connectez-vous plutôt.');
    }

    const metierNettoye = String(metier).trim();
    // Par défaut : artisan dès qu'un métier est déclaré, et tout le monde peut
    // chercher du travail (c'est le cœur de l'application).
    const estArtisan = req.body?.estArtisan !== undefined ? Boolean(req.body.estArtisan) : Boolean(metierNettoye);
    const chercheTravail = req.body?.chercheTravail !== undefined ? Boolean(req.body.chercheTravail) : true;

    const user = new User({
      telephone,
      nom: String(nom).trim(),
      prenom: String(prenom).trim(),
      motDePasseHash: await User.hashMotDePasse(motDePasse),
      estArtisan,
      chercheTravail,
      metier: metierNettoye,
      segment: segment === 'journalier' ? 'journalier' : segment === 'specialise' ? 'specialise' : '',
      photoProfil,
      quartier,
      commune,
      localisation: {
        lat: Number.isFinite(Number(localisation?.lat)) ? Number(localisation.lat) : null,
        lng: Number.isFinite(Number(localisation?.lng)) ? Number(localisation.lng) : null,
      },
    });

    await user.save();
    res.status(201).json({ token: signToken(user), user: user.toPublicJSON() });
  })
);

/**
 * POST /api/users/login
 * body: { telephone, motDePasse }
 */
router.post(
  '/login',
  // Anti brute-force : 8 tentatives/minute par IP + numéro (voir middleware/rateLimit.js).
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const telephone = normalizePhone(req.body?.telephone);
    const motDePasse = req.body?.motDePasse;
    if (!telephone || !motDePasse) {
      throw new ApiError(400, 'Numéro de téléphone et mot de passe obligatoires.');
    }

    const user = await User.findOne({ telephone }).select('+motDePasseHash');
    if (!user || !(await user.verifierMotDePasse(motDePasse))) {
      throw new ApiError(401, 'Numéro ou mot de passe incorrect.');
    }

    // Compte SUSPENDU par le back-office (01/10) : le mot de passe est bon, mais
    // l'accès reste fermé. On vérifie APRÈS le mot de passe — pas question d'en faire
    // un oracle « ce numéro existe » — et on transmet le motif saisi par l'équipe pour
    // que l'utilisateur sache quoi faire plutôt que de croire à une panne.
    if ((user.statutCompte || 'actif') === 'suspendu') {
      throw new ApiError(
        403,
        user.motifSuspension
          ? `Compte suspendu : ${user.motifSuspension}`
          : 'Compte suspendu. Contactez l’équipe Rejoins’Moi pour le réactiver.',
        { code: 'COMPTE_SUSPENDU' }
      );
    }

    user.dernierLoginAt = new Date();
    await user.save();

    // L'abonnement est renvoyé dès la connexion : l'interface affiche tout de suite
    // « contacts inclus » sur la page Jobs, sans second aller-retour réseau.
    const abonnement = await Subscription.trouverActif(user._id);
    res.json({ token: signToken(user), user: user.toPublicJSON({ abonnement }) });
  })
);

/** GET /api/users/me — profil de l'utilisateur connecté + historique d'interactions. */
router.get(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    const abonnement = await Subscription.trouverActif(req.user._id);
    res.json({
      user: req.user.toPublicJSON({ abonnement }),
      historique: (req.user.historiqueInteractions || []).slice(-60).reverse(),
    });
  })
);

/**
 * PATCH /api/users/me — mise à jour du profil (photo, quartier, métier, capacités...).
 * `estArtisan` / `chercheTravail` sont les deux capacités du compte unifié : elles
 * s'activent et se désactivent à tout moment, sans créer un nouveau compte.
 */
router.patch(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    const champs = ['nom', 'prenom', 'photoProfil', 'metier', 'bio', 'quartier', 'commune'];
    for (const c of champs) {
      if (req.body?.[c] !== undefined) req.user[c] = String(req.body[c]).trim();
    }
    if (req.body?.segment !== undefined) {
      req.user.segment = req.body.segment === 'journalier' ? 'journalier' : 'specialise';
    }
    if (req.body?.estArtisan !== undefined) {
      req.user.estArtisan = Boolean(req.body.estArtisan);
    }
    if (req.body?.chercheTravail !== undefined) {
      req.user.chercheTravail = Boolean(req.body.chercheTravail);
    }
    // Cohérence : un artisan sans métier n'est pas trouvable → on l'inscrit d'office.
    if (req.user.estArtisan && !req.user.metier) {
      req.user.metier = 'Autre';
    }
    if (req.body?.localisation) {
      const { lat, lng } = req.body.localisation;
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        req.user.localisation = { lat: Number(lat), lng: Number(lng) };
      }
    }
    await req.user.save();
    const abonnement = await Subscription.trouverActif(req.user._id);
    res.json({ user: req.user.toPublicJSON({ abonnement }) });
  })
);

/**
 * POST /api/users/me/interactions
 * body: { type, establishmentId?, categorie?, tags?, terme? }
 * Alimente l'apprentissage progressif du feed (§3).
 */
router.post(
  '/me/interactions',
  protect,
  asyncHandler(async (req, res) => {
    const { type, establishmentId, categorie, tags, terme } = req.body || {};
    const types = ['vue', 'recherche', 'clic', 'favori', 'contact', 'itineraire'];
    if (!types.includes(type)) {
      throw new ApiError(400, `type d'interaction invalide (${types.join(', ')})`);
    }

    req.user.ajouterInteraction({ type, establishmentId, categorie, tags, terme });
    await req.user.save();
    res.status(201).json({ ok: true, totalInteractions: req.user.historiqueInteractions.length });
  })
);

/** POST /api/users/me/favoris/:establishmentId — ajoute/retire un favori (toggle). */
router.post(
  '/me/favoris/:establishmentId',
  protect,
  asyncHandler(async (req, res) => {
    const id = req.params.establishmentId;
    const dejaFavori = req.user.favoris.some((f) => String(f) === id);
    if (dejaFavori) {
      req.user.favoris = req.user.favoris.filter((f) => String(f) !== id);
    } else {
      req.user.favoris.push(id);
    }
    req.user.ajouterInteraction({ type: 'favori', establishmentId: id });
    await req.user.save();
    res.json({ favoris: req.user.favoris.map(String), estFavori: !dejaFavori });
  })
);

/**
 * GET /api/users/artisans — annuaire des artisans / prestataires.
 * Query : { q?, metier?, lat?, lng?, limit? }
 *
 * Ordre « mise en avant » (avantage de l'abonnement, ajout du 29/09) :
 *   1. artisans ABONNÉS (profil mis en avant), 2. meilleure note, 3. plus proche.
 * Un abonnement ne rend visible que ceux qui le sont déjà (estArtisan) : il ne
 * remplace jamais le critère de proximité pour les autres.
 */
router.get(
  '/artisans',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { q, metier, limit = 40 } = req.query;
    const coords = parseCoords(req.query);

    const filtre = { estArtisan: true };
    if (metier && metier !== 'tous') filtre.metier = new RegExp(`^${escapeRegex(String(metier))}$`, 'i');
    if (q) {
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      filtre.$or = [{ metier: rx }, { bio: rx }, { nom: rx }, { prenom: rx }, { commune: rx }, { quartier: rx }];
    }

    const docs = await User.find(filtre).limit(Math.min(100, Number(limit) || 40));

    const abonnes = await Subscription.utilisateursActifsParmi(docs.map((d) => d._id));

    const items = docs
      .map((doc) => {
        const distanceKm =
          coords && doc.localisation?.lat != null && doc.localisation?.lng != null
            ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
            : null;
        const publicJson = doc.toPublicJSON({ abonnementActif: abonnes.has(String(doc._id)) });
        return {
          ...publicJson,
          // Annuaire public : le numéro n'est JAMAIS servi ici. La mise en relation
          // passe par la page Jobs, où le déblocage est payé et tracé (§2).
          telephone: null,
          telephoneMasque: true,
          distanceKm,
        };
      })
      .sort((a, b) => {
        if (a.misEnAvant !== b.misEnAvant) return a.misEnAvant ? -1 : 1;
        if (b.noteMoyenne !== a.noteMoyenne) return b.noteMoyenne - a.noteMoyenne;
        return (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
      });

    res.json({ items, total: items.length, centre: coords });
  })
);

/** GET /api/users/:id — profil public (réputation d'un ouvrier/artisan, §1). */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Utilisateur introuvable.');
    const abonnement = await Subscription.trouverActif(user._id);
    res.json({
      // Profil public : le téléphone n'est pas exposé (mise en relation tracée ailleurs).
      user: { ...user.toPublicJSON({ abonnement }), telephone: null, telephoneMasque: true },
      avis: (user.avis || []).slice().reverse().slice(0, 30),
    });
  })
);

/** POST /api/users/:id/avis — avis noté sur un ouvrier/artisan (réputation §1). */
router.post(
  '/:id/avis',
  protect,
  asyncHandler(async (req, res) => {
    const note = Number(req.body?.note);
    if (!Number.isFinite(note) || note < 1 || note > 5) {
      throw new ApiError(400, 'La note doit être comprise entre 1 et 5.');
    }
    if (String(req.params.id) === String(req.user._id)) {
      throw new ApiError(400, 'Vous ne pouvez pas vous noter vous-même.');
    }
    const cible = await User.findById(req.params.id);
    if (!cible) throw new ApiError(404, 'Utilisateur introuvable.');

    cible.avis.push({
      auteurId: req.user._id,
      auteurNom: req.user.nomComplet || req.user.telephone,
      note: Math.round(note),
      commentaire: String(req.body?.commentaire || '').slice(0, 600),
    });
    cible.recalculerReputation();
    await cible.save();

    res.status(201).json({ noteMoyenne: cible.noteMoyenne, nombreAvis: cible.nombreAvis });
  })
);

export default router;



