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
import ListeAttente from '../models/ListeAttente.js';
import Establishment from '../models/Establishment.js';
import { estSansPublicite } from '../config/categories.js';
import { signToken, protect, optionalAuth } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { normalizePhone, escapeRegex, validatePhoto } from '../utils/validators.js';
import { getDistanceKm, parseCoords } from '../utils/geo.js';
import { limiteurAuth } from '../middleware/rateLimit.js';
import { anonymiserOuSupprimerCompte, NOM_COMPTE_SUPPRIME } from '../services/suppressionCompte.js';

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
    if (!motDePasse || String(motDePasse).length < 8) {
      throw new ApiError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    }
    // Plafond photo (bloc F) : 300 Ko, comme les photos d'établissement. Une photo de
    // profil en base64 non contrôlée pèserait plusieurs Mo par compte.
    const controlePhoto = validatePhoto(photoProfil, 'La photo de profil');
    if (!controlePhoto.ok) throw new ApiError(400, controlePhoto.error, { champPhoto: true });

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
    // `prive: true` : le compte qui vient de se créer reçoit SA vue (le frontend
    // affiche son portefeuille et ses favoris dès l'inscription).
    res.status(201).json({ token: signToken(user), user: user.toPublicJSON({ prive: true }) });
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
    // `prive: true` : le mot de passe vient d'être vérifié, c'est bien le propriétaire.
    res.json({ token: signToken(user), user: user.toPublicJSON({ abonnement, prive: true }) });
  })
);

/** GET /api/users/me — profil de l'utilisateur connecté + historique d'interactions. */
router.get(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    const abonnement = await Subscription.trouverActif(req.user._id);
    res.json({
      // C'est le compte lui-même : `prive: true` débloque `favoris`, `visites`,
      // `solde` et l'état du compte — ce qui permet au frontend de savoir, dès le
      // chargement, quelles fiches sont marquées « déjà visité », sans requête
      // supplémentaire. Aucune route publique ne passe cette option.
      user: req.user.toPublicJSON({ abonnement, prive: true }),
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
    // Plafond photo (bloc F) : contrôlé AVANT toute écriture, et seulement si le
    // client envoie une photo (un simple changement de quartier n'est jamais bloqué).
    const controlePhoto = validatePhoto(req.body?.photoProfil, 'La photo de profil');
    if (!controlePhoto.ok) throw new ApiError(400, controlePhoto.error, { champPhoto: true });

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
    res.json({ user: req.user.toPublicJSON({ abonnement, prive: true }) });
  })
);

/**
 * DELETE /api/users/me — droit à l'effacement, en libre-service (20/11).
 *
 * body: { motDePasse }
 *
 * POURQUOI LE MOT DE PASSE EST EXIGÉ : la suppression est IRRÉVERSIBLE. Un
 * téléphone laissé déverrouillé sur une table ne doit pas suffire à effacer le
 * compte de son propriétaire. On revérifie donc le mot de passe (comme le font
 * les boutiques en ligne) avant de lancer l'anonymisation. Le jeton seul ne
 * suffit pas : il vit 30 jours et peut traîner dans un navigateur partagé.
 *
 * Le middleware `protect` a déjà chargé `req.user` : on relit le document avec
 * `+motDePasseHash` (le hash n'est jamais sélectionné par défaut).
 *
 * Réponse : un récapitulatif de ce qui a été conservé (paiements) et effacé,
 * pour que l'utilisateur sache exactement ce qui reste — transparence RGPD.
 * Le client DOIT ensuite oublier son jeton : toute requête suivante répond 401
 * (voir middleware/auth.js, contrôle `supprimeAt`).
 */
router.delete(
  '/me',
  protect,
  // Un mot de passe se devine : même limite que /login (5 essais/minute/IP+numéro).
  limiteurAuth({ max: 5, fenetreMs: 60000 }),
  asyncHandler(async (req, res) => {
    const motDePasse = req.body?.motDePasse;
    if (!motDePasse) {
      throw new ApiError(
        400,
        'Mot de passe obligatoire pour confirmer la suppression de votre compte.'
      );
    }

    const user = await User.findById(req.user._id).select('+motDePasseHash');
    if (!user) throw new ApiError(404, 'Compte introuvable.');
    if (!(await user.verifierMotDePasse(motDePasse))) {
      // 401 : le jeton reste valide, seule la confirmation a échoué.
      throw new ApiError(401, 'Mot de passe incorrect : votre compte n’a pas été supprimé.');
    }

    const rapport = await anonymiserOuSupprimerCompte(user._id);

    res.json({
      message:
        'Votre compte a été supprimé. Les avis que vous aviez laissés apparaissent désormais sous le nom « ' +
        `${NOM_COMPTE_SUPPRIME} ». Vos dépôts et abonnements payés sont conservés pour la comptabilité, ` +
        'sans aucune donnée personnelle.',
      // Aucune donnée personnelle dans la réponse : le numéro est déjà remplacé
      // par le jeton technique au moment où on la construit.
      suppression: {
        supprimeAt: rapport.supprimeAt,
        avisAnonymises: rapport.avisAnonymises,
        annoncesAnonymisees: rapport.annoncesAnonymisees,
        fichesSupprimees: rapport.fichesSupprimees,
        depotsConserves: rapport.depotsConserves,
        abonnementsConserves: rapport.abonnementsConserves,
      },
    });
  })
);

/**
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
 * POST /api/users/me/visites/:establishmentId — marque/démarque une fiche comme
 * « déjà visité » (toggle), exactement comme la route des favoris.
 *
 * POURQUOI ICI ET PAS SUR L'ÉTABLISSEMENT : « déjà visité » est un souvenir
 * PERSONNEL (« j'ai déjà mangé chez ce maquis »), pas une donnée de la fiche. Il
 * vit donc dans le compte, et la réponse ne contient que le tableau du compte
 * connecté — aucun autre utilisateur ne peut le lire. Le compteur public de la
 * fiche (`compteurVisites`) est une notion différente, alimentée par les vues.
 *
 * Le paramètre est validé (24 caractères hexadécimaux) avant écriture : un
 * identifiant fantaisiste ferait échouer la sauvegarde Mongoose en 500.
 */
router.post(
  '/me/visites/:establishmentId',
  protect,
  asyncHandler(async (req, res) => {
    const id = req.params.establishmentId;
    if (!/^[0-9a-fA-F]{24}$/.test(String(id))) {
      throw new ApiError(400, 'Identifiant d’établissement invalide.');
    }
    const dejaVisite = (req.user.visites || []).some((v) => String(v) === String(id));
    if (dejaVisite) {
      req.user.visites = req.user.visites.filter((v) => String(v) !== String(id));
    } else {
      req.user.visites.push(id);
    }
    // Pas d'interaction ajoutée au feed : le carnet de visites est privé, il ne
    // doit pas peser sur l'apprentissage public du classement (§3).
    await req.user.save();
    res.json({ visites: req.user.visites.map(String), estVisite: !dejaVisite });
  })
);

/**
 * POST /api/users/mise-en-avant — « Je veux être mis en avant » (mode gratuit).
 * body: { etablissementId?, note? }
 *
 * Pendant la gratuité, il n'y a rien à payer : on ne fait qu'ENREGISTRER l'intérêt
 * pour les futures options de visibilité (modèle ListeAttente). Une seule demande
 * en attente par utilisateur et par fiche : un second clic renvoie la demande
 * existante au lieu d'en créer une deuxième (la file du back-office reste lisible).
 */
router.post(
  '/mise-en-avant',
  protect,
  asyncHandler(async (req, res) => {
    const brut = req.body?.etablissementId || req.user.etablissementId || null;
    if (brut && !/^[a-f\d]{24}$/i.test(String(brut))) {
      throw new ApiError(400, 'Identifiant d’établissement invalide.');
    }
    const etablissementId = brut ? String(brut) : null;

    // ── Règle métier : PAS DE PUBLICITÉ POUR LES LIEUX PUBLICS ET LES CULTES ──
    // Un WC public, une mosquée, une église ou une association ne sont jamais proposés
    // à une option payante. On refuse ICI, côté serveur, même si la mise en avant est
    // gratuite aujourd'hui : le jour où elle redevient payante, la règle tient déjà
    // (le front masque la carte, mais le front ne décide pas).
    if (etablissementId) {
      const fiche = await Establishment.findById(etablissementId).select(
        'categorie sousCategorie sousCategorieSlug'
      );
      if (
        fiche &&
        estSansPublicite({
          categorie: fiche.categorie,
          sousCategorie: fiche.sousCategorie,
          sousCategorieSlug: fiche.sousCategorieSlug,
        })
      ) {
        throw new ApiError(
          400,
          'Les lieux publics et les lieux de culte (WC public, mosquée, église, association) ne sont jamais mis en avant, gratuitement ou non.'
        );
      }
    }

    let demande = await ListeAttente.findOne({
      userId: req.user._id,
      etablissementId,
      statut: 'en_attente',
    });
    const dejaDemande = Boolean(demande);
    if (!demande) {
      demande = await ListeAttente.create({
        userId: req.user._id,
        etablissementId,
        note: String(req.body?.note || '').slice(0, 500),
        statut: 'en_attente',
      });
    }

    res.status(dejaDemande ? 200 : 201).json({
      demande: demande.toPublicJSON(),
      dejaDemande,
      message: 'Votre demande a bien été enregistrée.',
    });
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

    // `supprimeAt: null` : un compte effacé n'est plus un artisan (le service met
    // estArtisan à false) — la condition est redondante mais explicite : on ne
    // veut jamais proposer « Utilisateur supprimé » comme prestataire.
    const filtre = { estArtisan: true, test: { $ne: true }, supprimeAt: null };
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
    // Compte anonymisé : son identité n'existe plus. On répond 404 plutôt que
    // d'afficher « Utilisateur supprimé » avec sa note et ses avis — un profil
    // effacé n'a plus de page publique.
    if (!user || user.supprimeAt) throw new ApiError(404, 'Utilisateur introuvable.');
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
    if (!cible || cible.supprimeAt) throw new ApiError(404, 'Utilisateur introuvable.');

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



