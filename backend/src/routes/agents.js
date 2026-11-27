// agents.js — ESPACE AGENT DE TERRAIN (/api/agents).
//
// Un agent parcourt les quartiers et inscrit les commerces à leur place. Ce
// routeur est VOLONTAIREMENT séparé de /api/users : un agent n'est pas un
// utilisateur de l'annuaire (il ne cherche pas de clients, il n'a pas de fiche),
// et son jeton ne doit ouvrir NI la session utilisateur NI le back-office
// (voir middleware/auth.js → signAgentToken / protectAgent).
//
// Le contrôle d'accès tient en deux temps :
//   1. l'administrateur crée le recrutement et GÉNÈRE UN CODE D'ACTIVATION
//      (POST /api/admin/agents/generer-code) ;
//   2. l'agent saisit ce code une seule fois (POST /api/agents/activer). Sans ce
//      code, son compte reste `en_attente` : personne ne peut se proclamer agent
//      et créer des fiches au nom de l'équipe.
//
// La création de fiche est le SEUL geste qui engage de l'argent (une fiche
// créée par un agent est payée). Elle crée DEUX documents d'un coup :
//   • le compte du gérant (c'est lui qui choisit son mot de passe, sur place) ;
//   • la fiche établissement, marquée du code agent (`codeAgent`).
// Si la fiche échoue, le compte gérant est supprimé : jamais de compte orphelin
// que le commerçant ne pourrait plus rattacher à son commerce.
//
// Endpoints :
//   POST /api/agents/register    -> inscription d'un agent (statut en_attente)
//   POST /api/agents/activer     -> code d'activation + mot de passe => compte actif
//   POST /api/agents/login       -> connexion (téléphone + mot de passe)
//   GET  /api/agents/me          -> profil de l'agent connecté + compteurs
//   POST /api/agents/pointage    -> position GPS + état de service (toutes les 5 min)
//   GET  /api/agents/mes-fiches  -> fiches créées avec le code de cet agent
//   POST /api/agents/creer-fiche -> compte gérant + fiche établissement

import express from 'express';

import Agent from '../models/Agent.js';
import User from '../models/User.js';
import Establishment from '../models/Establishment.js';
import { protectAgent, signAgentToken } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { limiteurAuth } from '../middleware/rateLimit.js';
import { normalizePhone, sanitizeTags, validateEstablishmentPhotos } from '../utils/validators.js';
import { CATEGORIES, libelleFamille, resoudreSousCategorie, slugifier } from '../config/categories.js';

const router = express.Router();
router.use(requireDb);

/** Familles acceptées par le modèle Establishment (le slug « tous » exclu). */
const CATEGORIES_AUTORISEES = new Set(CATEGORIES.map((c) => c.slug));

/** Longueur minimale d'un mot de passe, alignée sur les comptes utilisateurs. */
const LONGUEUR_MIN_MOT_DE_PASSE = 8;

/**
 * Origine publique de l'API (« https://hote »), pour construire des URL de photos
 * absolues dans les fiches renvoyées : le frontend est servi par un autre domaine.
 */
function basePublique(req) {
  const hote = req.get('host');
  return hote ? `${req.protocol}://${hote}` : '';
}

/** Nombre de fiches rattachées au code d'un agent (source unique de vérité). */
function compterFiches(agent) {
  return Establishment.countDocuments({ codeAgent: agent.code, test: { $ne: true } });
}

/**
 * POST /api/agents/register — un agent crée SON compte.
 * body: { nom, telephone, motDePasse }
 *
 * Le compte naît `en_attente` : il ne peut pas se connecter tant que
 * l'administrateur n'a pas généré puis remis un code d'activation. Aucun jeton
 * n'est renvoyé ici — c'est volontaire, l'inscription seule n'ouvre rien.
 */
router.post(
  '/register',
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const nom = String(req.body?.nom ?? '').trim();
    const telephone = normalizePhone(req.body?.telephone);
    const motDePasse = String(req.body?.motDePasse ?? '');

    if (nom.length < 2) throw new ApiError(400, 'Indiquez votre nom complet (2 caractères minimum).');
    if (nom.length > 80) throw new ApiError(400, 'Le nom est trop long (80 caractères maximum).');
    if (!telephone) {
      throw new ApiError(400, 'Numéro de téléphone ivoirien invalide (ex. 07 07 12 34 56).');
    }
    if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      throw new ApiError(400, `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`);
    }

    const existant = await Agent.findOne({ telephone });
    if (existant) {
      throw new ApiError(
        409,
        existant.statutEffectif() === 'actif'
          ? 'Un compte agent existe déjà avec ce numéro. Connectez-vous plutôt.'
          : 'Un compte agent existe déjà avec ce numéro : demandez votre code d’activation à l’administrateur.'
      );
    }

    // Même précaution que pour la création côté back-office : l'index unique sur
    // `code` reste seul juge, on ne suppose jamais qu'un tirage est libre.
    let agent = null;
    for (let essai = 0; essai < 5 && !agent; essai += 1) {
      try {
        agent = await Agent.create({
          code: Agent.genererCode(),
          nom,
          telephone,
          motDePasseHash: await Agent.hashMotDePasse(motDePasse),
          statut: 'en_attente',
          actif: false,
        });
      } catch (err) {
        if (err?.code === 11000) continue; // code (ou téléphone) déjà pris : on retire
        throw err;
      }
    }
    if (!agent) throw new ApiError(503, 'Impossible de créer le compte agent. Réessayez dans un instant.');

    res.status(201).json({
      agent: agent.toPublicJSON(),
      message:
        'Compte créé. Il reste à activer : demandez à l’administrateur votre code d’activation, puis saisissez-le ici.',
    });
  })
);

/**
 * POST /api/agents/activer — activation d'un compte en attente.
 * body: { telephone, motDePasse, codeActivation }
 *
 * Le mot de passe est vérifié AVANT le code (comme partout ailleurs : on ne
 * transforme pas la route en oracle « ce numéro est-il agent ? »). Un compte créé
 * par l'administrateur n'a pas encore de mot de passe : dans ce cas il est défini
 * ici, au moment de l'activation.
 */
router.post(
  '/activer',
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const telephone = normalizePhone(req.body?.telephone);
    const motDePasse = String(req.body?.motDePasse ?? '');
    const codeSaisi = String(req.body?.codeActivation ?? '').trim().toUpperCase();

    if (!telephone) throw new ApiError(400, 'Numéro de téléphone invalide.');
    if (!codeSaisi) throw new ApiError(400, 'Saisissez le code d’activation fourni par l’administrateur.');

    const agent = await Agent.findOne({ telephone }).select('+motDePasseHash +codeActivation');
    if (!agent) throw new ApiError(401, 'Numéro ou code d’activation incorrect.');

    const statut = agent.statutEffectif();
    if (statut === 'suspendu') {
      throw new ApiError(403, 'Ce compte agent est suspendu. Contactez l’équipe Rejoins’Moi.', {
        code: 'AGENT_SUSPENDU',
      });
    }

    // Compte créé par l'admin (nom + téléphone seulement) : le mot de passe est
    // choisi maintenant, et il doit respecter la même longueur minimale.
    if (!agent.motDePasseHash) {
      if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
        throw new ApiError(400, `Choisissez un mot de passe de ${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum.`);
      }
      agent.motDePasseHash = await Agent.hashMotDePasse(motDePasse);
    } else if (!(await agent.verifierMotDePasse(motDePasse))) {
      throw new ApiError(401, 'Numéro ou code d’activation incorrect.');
    }

    if (!agent.codeActivation) {
      throw new ApiError(
        409,
        'Aucun code d’activation n’a encore été généré pour ce compte. Demandez-le à l’administrateur.',
        { code: 'AGENT_SANS_CODE' }
      );
    }
    if (agent.codeActivation !== codeSaisi) {
      throw new ApiError(401, 'Numéro ou code d’activation incorrect.');
    }

    agent.statut = 'actif';
    // Le code à 6 caractères (paie) redevient utilisable : c'est `actif` que lit
    // l'anti-fraude de routes/establishments.js.
    agent.actif = true;
    agent.codeActivation = null;
    await agent.save();

    res.json({
      token: signAgentToken(agent),
      agent: agent.toPublicJSON(),
      message: 'Compte activé. Bonne tournée !',
    });
  })
);

/**
 * POST /api/agents/login — connexion agent.
 * body: { telephone, motDePasse }
 *
 * Un compte en attente répond 403 avec `details.code = AGENT_EN_ATTENTE` :
 * l'écran affiche alors le champ « code d'activation » au lieu d'un message
 * d'erreur sec. Un compte suspendu répond de la même façon (AGENT_SUSPENDU).
 */
router.post(
  '/login',
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const telephone = normalizePhone(req.body?.telephone);
    const motDePasse = String(req.body?.motDePasse ?? '');
    if (!telephone || !motDePasse) {
      throw new ApiError(400, 'Numéro de téléphone et mot de passe obligatoires.');
    }

    const agent = await Agent.findOne({ telephone }).select('+motDePasseHash');
    if (!agent || !(await agent.verifierMotDePasse(motDePasse))) {
      throw new ApiError(401, 'Numéro ou mot de passe incorrect.');
    }

    const statut = agent.statutEffectif();
    if (statut === 'suspendu') {
      throw new ApiError(403, 'Compte agent suspendu. Contactez l’équipe Rejoins’Moi.', {
        code: 'AGENT_SUSPENDU',
      });
    }
    if (statut === 'en_attente') {
      throw new ApiError(
        403,
        'Compte en attente d’activation : saisissez le code fourni par l’administrateur.',
        { code: 'AGENT_EN_ATTENTE' }
      );
    }

    res.json({ token: signAgentToken(agent), agent: agent.toPublicJSON() });
  })
);

/** GET /api/agents/me — profil de l'agent connecté + compteurs de fiches. */
router.get(
  '/me',
  protectAgent,
  asyncHandler(async (req, res) => {
    const totalFiches = await compterFiches(req.agent);
    res.json({ agent: req.agent.toPublicJSON(), stats: { totalFiches } });
  })
);

/**
 * POST /api/agents/pointage — position GPS et état de service.
 * body: { lat, lng, enService }
 *
 * Appelé à la prise de service, toutes les 5 minutes pendant la tournée, puis
 * une dernière fois au départ. Une position INVALIDE est refusée quand l'agent
 * se déclare en service : mieux vaut un pointage manqué qu'un point inventé sur
 * la carte du back-office. `enService: false` n'exige aucune coordonnée (on
 * quitte le service même si le GPS n'a jamais accroché).
 */
router.post(
  '/pointage',
  protectAgent,
  asyncHandler(async (req, res) => {
    const enServiceDemande = req.body?.enService;
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const coordonneesFournies = req.body?.lat != null && req.body?.lng != null;
    const coordonneesValides =
      coordonneesFournies &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

    if (enServiceDemande === true && !coordonneesValides) {
      throw new ApiError(
        400,
        'Position GPS introuvable : activez la localisation de votre téléphone, puis réessayez.',
        { code: 'POSITION_INDISPONIBLE' }
      );
    }

    const agent = req.agent;
    if (enServiceDemande !== undefined) agent.enService = Boolean(enServiceDemande);
    if (coordonneesValides) {
      agent.dernierePosition = { lat, lng, updatedAt: new Date() };
    }
    await agent.save();

    res.json({
      enService: Boolean(agent.enService),
      dernierePosition: agent.toPublicJSON().dernierePosition,
      message: agent.enService ? 'Position enregistrée.' : 'Service terminé.',
    });
  })
);

/** GET /api/agents/mes-fiches — les fiches créées avec le code de cet agent. */
router.get(
  '/mes-fiches',
  protectAgent,
  asyncHandler(async (req, res) => {
    const base = basePublique(req);
    const fiches = await Establishment.find({ codeAgent: req.agent.code, test: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(60);

    res.json({
      total: await compterFiches(req.agent),
      items: fiches.map((fiche) => ({
        ...fiche.toCardJSON({ base }),
        telephone: fiche.telephone || '',
        codeAgent: fiche.codeAgent || '',
        createdAt: fiche.createdAt,
      })),
    });
  })
);

/**
 * POST /api/agents/creer-fiche — compte du gérant + fiche établissement.
 * body: {
 *   nom, categorie, sousCategorie?, description?, telephone,
 *   tags[], photoDevanture?, photoVendeur?, localisation{lat,lng},
 *   commune?, quartier?, adresse?,
 *   gerant: { nom, telephone, motDePasse }
 * }
 *
 * Pourquoi le mot de passe du gérant est saisi ICI : c'est le commerçant qui
 * tape lui-même son mot de passe sur le téléphone de l'agent (jamais l'agent à sa
 * place). L'agent ne le connaît donc pas, et ne peut pas se connecter plus tard
 * au compte du commerce qu'il a inscrit.
 */
router.post(
  '/creer-fiche',
  protectAgent,
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const {
      nom,
      categorie,
      sousCategorie = '',
      description = '',
      photoDevanture,
      photoVendeur,
      tags,
      localisation,
      commune = '',
      quartier = '',
      adresse = '',
      gerant,
    } = req.body || {};

    // ── Fiche ────────────────────────────────────────────────────────────────
    const nomFiche = String(nom ?? '').trim();
    if (nomFiche.length < 2) throw new ApiError(400, 'Indiquez le nom du commerce.');
    if (nomFiche.length > 120) throw new ApiError(400, 'Le nom du commerce est trop long (120 caractères).');

    const categorieSlug = String(categorie ?? '').trim();
    if (!CATEGORIES_AUTORISEES.has(categorieSlug)) {
      throw new ApiError(400, 'Choisissez la catégorie du commerce dans la liste proposée.');
    }

    const controlePhotos = validateEstablishmentPhotos(photoDevanture, photoVendeur);
    if (!controlePhotos.ok) throw new ApiError(400, controlePhotos.error, { champPhotos: true });

    // Trois produits/services minimum (§5) : ils alimentent la recherche et les
    // filtres. L'agent les coche sur place avec le commerçant, comme à l'inscription.
    const tagsPropres = sanitizeTags(tags);
    if (tagsPropres.length < 3) {
      throw new ApiError(400, 'Sélectionnez au moins 3 produits/services proposés par le commerce.', {
        champTags: true,
      });
    }

    const lat = Number(localisation?.lat);
    const lng = Number(localisation?.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new ApiError(400, 'Position GPS du commerce obligatoire : placez le repère sur la carte.');
    }

    const telephoneFiche = normalizePhone(req.body?.telephone);
    if (!telephoneFiche) {
      throw new ApiError(400, 'Numéro de téléphone du commerce invalide (ex. 07 07 12 34 56).');
    }

    // ── Gérant ───────────────────────────────────────────────────────────────
    const nomGerant = String(gerant?.nom ?? '').trim();
    const telephoneGerant = normalizePhone(gerant?.telephone);
    const motDePasseGerant = String(gerant?.motDePasse ?? '');
    if (nomGerant.length < 2) throw new ApiError(400, 'Indiquez le nom du gérant.');
    if (!telephoneGerant) throw new ApiError(400, 'Numéro de téléphone du gérant invalide.');
    if (motDePasseGerant.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      throw new ApiError(
        400,
        `Le gérant doit choisir un mot de passe de ${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum.`
      );
    }

    const gerantExistant = await User.findOne({ telephone: telephoneGerant });
    if (gerantExistant) {
      throw new ApiError(
        409,
        'Un compte existe déjà avec le numéro du gérant. Il peut se connecter directement et compléter sa fiche.'
      );
    }

    // Sous-catégorie : répertoriée → libellé + slug officiels ; libre → saisis tels
    // quels (comme à l'inscription, la modération les traitera).
    const sousCategorieSaisie = String(sousCategorie ?? '').trim().slice(0, 60);
    const sousCategorieConnue = sousCategorieSaisie
      ? resoudreSousCategorie(sousCategorieSaisie, categorieSlug)
      : null;
    const sousCategorieLabel = sousCategorieConnue?.label || sousCategorieSaisie;
    const sousCategorieSlug = sousCategorieConnue?.slug || slugifier(sousCategorieSaisie);

    const compteGerant = new User({
      telephone: telephoneGerant,
      nom: nomGerant,
      motDePasseHash: await User.hashMotDePasse(motDePasseGerant),
      // Un gérant n'est ni artisan ni chercheur d'emploi par défaut : ses
      // capacités restent modifiables depuis son profil.
      estArtisan: false,
      chercheTravail: false,
      contactPublic: false,
    });
    await compteGerant.save();

    let fiche = null;
    try {
      fiche = new Establishment({
        codeAgent: req.agent.code,
        nom: nomFiche,
        categorie: categorieSlug,
        sousCategorie: sousCategorieLabel,
        sousCategorieSlug,
        description: String(description ?? '').trim().slice(0, 500),
        photoDevanture: String(photoDevanture || '').trim(),
        photoVendeur: String(photoVendeur || '').trim(),
        tags: tagsPropres,
        localisation: { lat, lng },
        commune: String(commune ?? '').trim(),
        quartier: String(quartier ?? '').trim(),
        adresse: String(adresse ?? '').trim(),
        // Le numéro affiché est celui du commerce ; `whatsapp` retombe dessus.
        telephone: String(req.body?.telephone ?? '').trim() || telephoneFiche,
        whatsapp: telephoneFiche,
        createdByUserId: compteGerant._id,
      });
      fiche.texteBoutonAction = `Aller chez ${nomFiche}`;
      await fiche.save();
    } catch (err) {
      // Compensation : sans fiche, le compte gérant ne servirait à rien et
      // bloquerait une nouvelle inscription avec le même numéro.
      await User.deleteOne({ _id: compteGerant._id }).catch(() => {});
      throw err;
    }

    // Rattachement réciproque : le gérant retrouve « son » établissement dans son
    // profil, et la fiche sait qui l'administre.
    compteGerant.etablissementId = fiche._id;
    await compteGerant.save().catch(() => {});

    res.status(201).json({
      message: 'Fiche créée avec succès. Le gérant peut se connecter.',
      fiche: fiche.toCardJSON({ base: basePublique(req) }),
      gerant: { id: compteGerant._id, nom: nomGerant, telephone: telephoneGerant },
      agent: { code: req.agent.code, nom: req.agent.nom },
      categorieLibelle: libelleFamille(categorieSlug),
    });
  })
);

export default router;
