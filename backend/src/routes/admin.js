// admin.js — BACK-OFFICE administrateur Rejoins'Moi.
//
// Réservé aux comptes `estAdmin: true` (voir middleware/auth.js protectAdmin).
// Le compte admin est créé par scripts/creer-admin.js (numéro de démonstration
// « 0102030405 ») : la connexion se fait par numéro de téléphone, comme pour tous
// les comptes — d'où le rapprochement avec normalizePhone dans /login.
//
// Endpoints :
//   POST   /api/admin/login                     -> connexion admin (identifiant + mot de passe)
//   GET    /api/admin/moi                        -> profil admin courant
//   PATCH  /api/admin/moi/mot-de-passe           -> l'admin change SON mot de passe
//   GET    /api/admin/statistiques               -> tableau de bord (compteurs globaux)
//   GET    /api/admin/utilisateurs               -> liste/recherche des comptes inscrits
//   GET    /api/admin/utilisateurs/:id           -> détail d'un compte
//   PATCH  /api/admin/utilisateurs/:id           -> modifier un compte (profil, capacités, rôle)
//   POST   /api/admin/utilisateurs/:id/mot-de-passe -> réinitialiser le mot de passe d'un compte
//   GET    /api/admin/depots                     -> suivre les dépôts (en attente / validés / rejetés)
//   POST   /api/admin/depots/:id/valider         -> VALIDER un dépôt => débloque le contact
//   POST   /api/admin/depots/:id/rejeter         -> REJETER un dépôt (motif optionnel)
//   GET    /api/admin/activite                   -> journal de suivi (inscriptions, connexions, paiements)
//   PATCH  /api/admin/utilisateurs/:id/statut    -> VALIDER (réactiver) ou SUSPENDRE un compte
//
// Suivi (ajout du 01/10) : le back-office n'est plus seulement une file de validation,
// c'est l'écran de pilotage — d'où /activite (qui s'inscrit, qui se connecte, quels
// paiements arrivent) et le statut de compte réversible (`statutCompte` côté User),
// qui coupe la connexion ET les jetons déjà émis (middleware/auth.js).
//
// Sécurité : le mot de passe admin est haché (bcrypt) et jamais renvoyé ; les routes
// sont protégées par protectAdmin qui RELIT `estAdmin` en base à chaque appel.

import express from 'express';
import User from '../models/User.js';
import Job from '../models/Job.js';
import Establishment from '../models/Establishment.js';
import Subscription from '../models/Subscription.js';
import Depot from '../models/Depot.js';
import { protectAdmin, signToken } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { limiteurAuth } from '../middleware/rateLimit.js';
import { normalizePhone, escapeRegex } from '../utils/validators.js';
import { getUnlockFee, getCurrency } from '../services/cinetpay.js';
import { getDepots, getSupportWhatsapp } from '../config/paiement.js';

const router = express.Router();
router.use(requireDb);

/**
 * POST /api/admin/login — connexion du back-office.
 * body: { identifiant, motDePasse }  (l'identifiant est le NUMÉRO DE TÉLÉPHONE du
 * compte admin, ex. « 0102030405 » — même logique que /api/users/login).
 * Les numéros sont stockés normalisés (« +225102030405 », voir
 * utils/validators.js normalizePhone) : on interroge donc les DEUX formes pour
 * accepter la saisie locale comme internationale. Un identifiant qui n'est pas un
 * numéro (ancien compte de test) reste accepté tel quel.
 * Limité en débit (anti brute-force) comme /login.
 */
router.post(
  '/login',
  limiteurAuth(),
  asyncHandler(async (req, res) => {
    const identifiant = String(req.body?.identifiant ?? req.body?.telephone ?? '').trim();
    const motDePasse = String(req.body?.motDePasse ?? '');
    if (!identifiant || !motDePasse) {
      throw new ApiError(400, 'Identifiant et mot de passe obligatoires.');
    }

    const normalise = normalizePhone(identifiant);
    const candidats = normalise && normalise !== identifiant ? [identifiant, normalise] : [identifiant];

    const user = await User.findOne({ telephone: { $in: candidats }, estAdmin: true }).select('+motDePasseHash');
    if (!user || !(await user.verifierMotDePasse(motDePasse))) {
      throw new ApiError(401, 'Identifiant ou mot de passe administrateur incorrect.');
    }

    // Trace de connexion du back-office : le journal d'activité (GET /activite) et le
    // tableau de bord (« connectés ces dernières 24 h ») s'appuient dessus. On écrit par
    // updateOne plutôt que save() : inutile de re-valider tout le document pour une date,
    // et on évite qu'un champ hérité bloque la connexion.
    const connexionAt = new Date();
    user.dernierLoginAt = connexionAt;
    await User.updateOne({ _id: user._id }, { $set: { dernierLoginAt: connexionAt } });

    res.json({
      token: signToken(user),
      user: user.toPublicJSON(),
      admin: true,
    });
  })
);

/** GET /api/admin/moi — profil de l'admin connecté. */
router.get(
  '/moi',
  protectAdmin,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user.toPublicJSON() });
  })
);

/** PATCH /api/admin/moi/mot-de-passe — l'admin change son propre mot de passe. */
router.patch(
  '/moi/mot-de-passe',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const ancien = String(req.body?.ancienMotDePasse ?? '');
    const nouveau = String(req.body?.nouveauMotDePasse ?? '');
    if (nouveau.length < 6) throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 6 caractères.');

    const user = await User.findById(req.user._id).select('+motDePasseHash');
    if (!(await user.verifierMotDePasse(ancien))) {
      throw new ApiError(401, 'Mot de passe actuel incorrect.');
    }
    user.motDePasseHash = await User.hashMotDePasse(nouveau);
    await user.save();
    res.json({ ok: true, message: 'Mot de passe administrateur modifié.' });
  })
);

/** GET /api/admin/statistiques — tableau de bord global. */
router.get(
  '/statistiques',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const maintenant = new Date();
    const debutJour = new Date(maintenant);
    debutJour.setHours(0, 0, 0, 0);
    // Abidjan est à UTC+0 toute l'année : « aujourd'hui », « 7 jours » et la série
    // quotidienne se calculent sans décalage horaire, donc sans bibliothèque de dates.
    const il24h = new Date(maintenant.getTime() - 24 * 3600 * 1000);
    const il7j = new Date(maintenant.getTime() - 7 * 24 * 3600 * 1000);
    const il30j = new Date(maintenant.getTime() - 30 * 24 * 3600 * 1000);
    const debutSerie = new Date(debutJour.getTime() - 6 * 24 * 3600 * 1000);

    const [
      utilisateurs,
      artisans,
      chercheurs,
      administrateurs,
      suspendus,
      inscrits7j,
      inscrits30j,
      connectes24h,
      connectes7j,
      etablissements,
      offres,
      demandes,
      abonnementsActifs,
      depotsEnAttente,
      depotsValides,
      depotsRejetes,
      depotsAujourdhui,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ estArtisan: true }),
      User.countDocuments({ chercheTravail: true }),
      User.countDocuments({ estAdmin: true }),
      // Suivi (01/10) : le back-office doit voir d'un coup d'œil la santé du parc —
      // comptes coupés, nouvelles inscriptions, utilisateurs réellement actifs.
      User.countDocuments({ statutCompte: 'suspendu' }),
      User.countDocuments({ createdAt: { $gte: il7j } }),
      User.countDocuments({ createdAt: { $gte: il30j } }),
      User.countDocuments({ dernierLoginAt: { $gte: il24h } }),
      User.countDocuments({ dernierLoginAt: { $gte: il7j } }),
      Establishment.countDocuments({}),
      Job.countDocuments({ typeAnnonce: 'offre' }),
      Job.countDocuments({ typeAnnonce: 'demande' }),
      Subscription.countDocuments({ statut: { $in: ['actif', 'annule'] }, finAt: { $gt: maintenant } }),
      Depot.countDocuments({ statut: 'en_attente' }),
      Depot.countDocuments({ statut: 'valide' }),
      Depot.countDocuments({ statut: 'rejete' }),
      Depot.countDocuments({ createdAt: { $gte: debutJour } }),
    ]);

    // Montant encaissé par les dépôts VALIDÉS (audit simple du mobile money manuel).
    const encaisse = await Depot.aggregate([
      { $match: { statut: 'valide' } },
      { $group: { _id: null, total: { $sum: '$montant' } } },
    ]);

    // Série des 7 derniers jours : une barre par jour dans le tableau de bord. On agrège
    // par JOUR + STATUT, puis on recoud les jours vides côté JS pour que la courbe garde
    // toujours 7 colonnes — un lundi sans paiement est une information, pas un trou.
    const agregat = await Depot.aggregate([
      { $match: { createdAt: { $gte: debutSerie } } },
      {
        $group: {
          _id: {
            jour: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            statut: '$statut',
          },
          nombre: { $sum: 1 },
          montant: { $sum: '$montant' },
        },
      },
    ]);

    const parJour = new Map();
    for (const ligne of agregat) {
      const cle = ligne._id.jour;
      const courant = parJour.get(cle) || { total: 0, valides: 0, rejetes: 0, montantValide: 0 };
      courant.total += ligne.nombre;
      if (ligne._id.statut === 'valide') {
        courant.valides += ligne.nombre;
        courant.montantValide += ligne.montant;
      } else if (ligne._id.statut === 'rejete') {
        courant.rejetes += ligne.nombre;
      }
      parJour.set(cle, courant);
    }

    const serie7j = Array.from({ length: 7 }, (_, i) => {
      const jour = new Date(debutSerie.getTime() + i * 24 * 3600 * 1000);
      const cle = jour.toISOString().slice(0, 10);
      return {
        jour: cle,
        ...(parJour.get(cle) || { total: 0, valides: 0, rejetes: 0, montantValide: 0 }),
      };
    });

    res.json({
      utilisateurs,
      artisans,
      chercheurs,
      administrateurs,
      // Suivi (01/10) : parc de comptes et présence réelle.
      suspendus,
      inscrits7j,
      inscrits30j,
      connectes: { dernier24h: connectes24h, dernier7j: connectes7j },
      etablissements,
      jobs: { total: offres + demandes, offres, demandes },
      abonnementsActifs,
      depots: {
        enAttente: depotsEnAttente,
        valides: depotsValides,
        rejetes: depotsRejetes,
        aujourdhui: depotsAujourdhui,
        montantEncaisseFcfa: encaisse?.[0]?.total || 0,
        serie7j,
      },
      fraisDeblocage: getUnlockFee(),
      devise: getCurrency(),
      depotsConfig: getDepots(),
      support: getSupportWhatsapp(),
      horodatage: new Date().toISOString(),
    });
  })
);

/**
 * GET /api/admin/utilisateurs — liste/recherche des comptes inscrits.
 * Query :
 *   q      : nom / prénom / téléphone (tolérant aux espaces) / métier / commune ;
 *   filtre : 'artisans' | 'chercheurs' | 'admins' | 'suspendus' | 'actifs' ;
 *   statut : 'actif' | 'suspendu' (raccourci du filtre, pratique pour un lien direct) ;
 *   tri    : 'recents' (inscription, défaut) | 'activite' (dernière connexion)
 *            | 'nom' (alphabétique) | 'anciens' (comptes dormants d'abord) ;
 *   page / limit (défaut 30, max 100).
 *
 * Réponse : items + total/pages, PLUS `compteurs` (état GLOBAL du parc, non filtré,
 * pour les onglets du back-office) et, pour chaque ligne, son nombre de dépôts — on
 * doit pouvoir repérer « qui paie » sans ouvrir trente fiches une par une.
 */
router.get(
  '/utilisateurs',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const { q, filtre } = req.query;
    const statut = String(req.query.statut || '');
    const tri = String(req.query.tri || 'recents');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));

    const filtreReq = {};
    if (filtre === 'artisans') filtreReq.estArtisan = true;
    else if (filtre === 'chercheurs') filtreReq.chercheTravail = true;
    else if (filtre === 'admins') filtreReq.estAdmin = true;
    else if (filtre === 'suspendus') filtreReq.statutCompte = 'suspendu';
    else if (filtre === 'actifs') filtreReq.statutCompte = { $ne: 'suspendu' };

    if (statut === 'suspendu') filtreReq.statutCompte = 'suspendu';
    else if (statut === 'actif') filtreReq.statutCompte = { $ne: 'suspendu' };

    if (q) {
      const terme = String(q).trim();
      const rx = new RegExp(escapeRegex(terme), 'i');
      const branches = [{ telephone: rx }, { nom: rx }, { prenom: rx }, { metier: rx }, { commune: rx }];

      // Recherche par NUMÉRO tolérante : les numéros sont stockés sous la forme
      // normalisée « +225XXXXXXXX » (8 chiffres après la refonte de 2021). Un admin
      // qui tape « 07 02 31 11 62 » ou « +2250702311162 » doit trouver le compte,
      // on compare donc les 8 DERNIERS chiffres saisis à la fin du numéro stocké.
      const chiffres = terme.replace(/\D/g, '');
      if (chiffres.length >= 8) {
        const fin = chiffres.slice(-8);
        branches.push({ telephone: new RegExp(`${escapeRegex(fin)}$`) });
      }

      filtreReq.$or = branches;
    }

    // Tri : « activite » met en avant ceux qui se connectent vraiment (les comptes
    // jamais connectés passent en fin de liste), « anciens » sert au contraire à
    // repérer les comptes dormants à relancer.
    const tris = {
      recents: { createdAt: -1, _id: 1 },
      anciens: { createdAt: 1, _id: 1 },
      activite: { dernierLoginAt: -1, createdAt: -1 },
      nom: { nom: 1, prenom: 1 },
    };

    const [docs, total, compteurs] = await Promise.all([
      User.find(filtreReq)
        .sort(tris[tri] || tris.recents)
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filtreReq),
      // Compteurs GLOBAUX (indépendants des filtres) : ils alimentent les onglets.
      Promise.all([
        User.countDocuments({}),
        User.countDocuments({ statutCompte: 'suspendu' }),
        User.countDocuments({ estArtisan: true }),
        User.countDocuments({ chercheTravail: true }),
        User.countDocuments({ estAdmin: true }),
        User.countDocuments({ dernierLoginAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }),
      ]).then(([utilisateurs, suspendus, artisans, chercheurs, admins, connectes24h]) => ({
        utilisateurs,
        suspendus,
        artisans,
        chercheurs,
        admins,
        connectes24h,
      })),
    ]);

    // Dépôts des comptes affichés : UNE agrégation pour toute la page (jamais une
    // requête par ligne) — c'est la colonne « Paiements » du tableau des utilisateurs.
    const idsPage = docs.map((d) => d._id);
    const lignesDepots = idsPage.length
      ? await Depot.aggregate([
          { $match: { userId: { $in: idsPage } } },
          {
            $group: {
              _id: { userId: '$userId', statut: '$statut' },
              nombre: { $sum: 1 },
              montant: { $sum: '$montant' },
            },
          },
        ])
      : [];

    const depotsParUser = new Map();
    for (const ligne of lignesDepots) {
      const cle = String(ligne._id.userId);
      const courant = depotsParUser.get(cle) || {
        total: 0,
        enAttente: 0,
        valides: 0,
        rejetes: 0,
        montantValide: 0,
      };
      courant.total += ligne.nombre;
      if (ligne._id.statut === 'valide') {
        courant.valides += ligne.nombre;
        courant.montantValide += ligne.montant;
      } else if (ligne._id.statut === 'rejete') courant.rejetes += ligne.nombre;
      else courant.enAttente += ligne.nombre;
      depotsParUser.set(cle, courant);
    }

    res.json({
      items: docs.map((d) => ({
        ...d.toPublicJSON(),
        depots: depotsParUser.get(String(d._id)) || {
          total: 0,
          enAttente: 0,
          valides: 0,
          rejetes: 0,
          montantValide: 0,
        },
      })),
      compteurs,
      filtre: filtre || '',
      tri,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    });
  })
);

/** GET /api/admin/utilisateurs/:id — fiche complète d'un compte (profil + activité + argent). */
router.get(
  '/utilisateurs/:id',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Compte introuvable.');

    const [abonnement, depots, lignesDepots, contactsDebloques] = await Promise.all([
      Subscription.trouverActif(user._id),
      Depot.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('jobId', 'metier intitule typeAnnonce'),
      Depot.aggregate([
        { $match: { userId: user._id } },
        { $group: { _id: '$statut', nombre: { $sum: 1 }, montant: { $sum: '$montant' } } },
      ]),
      // Nombre d'annonces dont ce compte a vraiment débloqué le contact : l'indicateur
      // le plus honnête de « cet utilisateur paie et se sert du service ».
      Job.countDocuments({ 'contactDebloquePar.userId': user._id }),
    ]);

    const resume = {
      depots: { total: 0, enAttente: 0, valides: 0, rejetes: 0, montantValideFcfa: 0 },
      contactsDebloques,
      favoris: (user.favoris || []).length,
      avis: user.nombreAvis || 0,
      noteMoyenne: user.noteMoyenne || 0,
      interactions: (user.historiqueInteractions || []).length,
    };
    for (const ligne of lignesDepots) {
      resume.depots.total += ligne.nombre;
      if (ligne._id === 'valide') {
        resume.depots.valides += ligne.nombre;
        resume.depots.montantValideFcfa += ligne.montant;
      } else if (ligne._id === 'rejete') resume.depots.rejetes += ligne.nombre;
      else resume.depots.enAttente += ligne.nombre;
    }

    res.json({
      user: user.toPublicJSON({ abonnement }),
      resume,
      depots: depots.map((d) => ({
        ...d.toJSON(),
        job: d.jobId
          ? {
              id: d.jobId._id,
              titre: d.jobId.intitule || d.jobId.metier || 'Annonce',
              typeAnnonce: d.jobId.typeAnnonce,
            }
          : null,
      })),
    });
  })
);

/**
 * PATCH /api/admin/utilisateurs/:id — modifier un compte.
 * Champs modifiables : nom, prenom, metier, bio, quartier, commune, telephone,
 * estArtisan, chercheTravail, estAdmin. Refuse de retirer le dernier administrateur.
 */
router.patch(
  '/utilisateurs/:id',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Compte introuvable.');

    const champsTexte = ['nom', 'prenom', 'metier', 'bio', 'quartier', 'commune'];
    for (const c of champsTexte) {
      if (req.body?.[c] !== undefined) user[c] = String(req.body[c]).trim();
    }
    for (const c of ['estArtisan', 'chercheTravail']) {
      if (req.body?.[c] !== undefined) user[c] = Boolean(req.body[c]);
    }

    // Changement de numéro : normalisation + unicité (le téléphone identifie le compte).
    if (req.body?.telephone !== undefined && String(req.body.telephone).trim() !== user.telephone) {
      const telephone = normalizePhone(req.body.telephone);
      if (!telephone) throw new ApiError(400, 'Numéro de téléphone ivoirien invalide.');
      const dejaPris = await User.findOne({ telephone, _id: { $ne: user._id } });
      if (dejaPris) throw new ApiError(409, 'Ce numéro est déjà utilisé par un autre compte.');
      user.telephone = telephone;
    }

    // Rôle admin : on empêche de supprimer le DERNIER administrateur (sinon plus
    // aucun accès au back-office). Il faut donc en créer un autre d'abord.
    if (req.body?.estAdmin !== undefined && Boolean(req.body.estAdmin) !== Boolean(user.estAdmin)) {
      if (user.estAdmin && req.body.estAdmin === false) {
        const autres = await User.countDocuments({ estAdmin: true, _id: { $ne: user._id } });
        if (autres === 0) throw new ApiError(409, 'Impossible : ce compte est le dernier administrateur.');
      }
      user.estAdmin = Boolean(req.body.estAdmin);
    }

    await user.save();
    res.json({ user: user.toPublicJSON(), message: 'Compte mis à jour.' });
  })
);

/**
 * PATCH /api/admin/utilisateurs/:id/statut — VALIDER (réactiver) ou SUSPENDRE un compte.
 * body: { statut: 'actif' | 'suspendu', motif? }
 *
 * Pourquoi une route dédiée plutôt qu'un champ du PATCH générique : suspendre coupe
 * l'accès immédiatement (connexion + jetons déjà émis, voir middleware/auth.js), ça
 * mérite ses propres garde-fous et un message clair — pas une case à cocher noyée
 * dans le formulaire de profil.
 *
 * Garde-fous :
 *   - impossible de changer SON PROPRE statut (on ne se coupe pas la main) ;
 *   - impossible de suspendre un compte administrateur (il faut d'abord retirer le
 *     rôle) : sinon on peut verrouiller le back-office pour de bon ;
 *   - un motif est enregistré et affiché à l'utilisateur bloqué (jamais de sanction
 *     silencieuse : « Compte suspendu : <motif> » à la connexion).
 */
router.patch(
  '/utilisateurs/:id/statut',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const statut = String(req.body?.statut ?? '').trim();
    if (!['actif', 'suspendu'].includes(statut)) {
      throw new ApiError(400, 'Statut invalide : attendu « actif » ou « suspendu ».');
    }
    const motif = String(req.body?.motif ?? '').trim();

    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Compte introuvable.');

    if (String(user._id) === String(req.user._id)) {
      throw new ApiError(409, 'Vous ne pouvez pas changer le statut de votre propre compte.');
    }
    if (user.estAdmin && statut === 'suspendu') {
      throw new ApiError(
        409,
        'Un compte administrateur ne peut pas être suspendu : retirez d’abord le rôle administrateur.'
      );
    }

    const actuel = user.statutCompte || 'actif';
    if (actuel === statut) {
      return res.json({
        user: user.toPublicJSON(),
        message: statut === 'actif' ? 'Ce compte était déjà actif.' : 'Ce compte était déjà suspendu.',
      });
    }

    user.statutCompte = statut;
    if (statut === 'suspendu') {
      user.suspenduAt = new Date();
      user.motifSuspension = motif.slice(0, 300);
    } else {
      user.suspenduAt = null;
      user.motifSuspension = '';
    }
    await user.save();

    res.json({
      user: user.toPublicJSON(),
      message:
        statut === 'suspendu'
          ? 'Compte suspendu : la connexion est coupée immédiatement, même avec un jeton déjà émis.'
          : 'Compte réactivé : l’utilisateur peut se reconnecter dès maintenant.',
    });
  })
);

/** POST /api/admin/utilisateurs/:id/mot-de-passe — réinitialiser le mot de passe d'un compte. */
router.post(
  '/utilisateurs/:id/mot-de-passe',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const motDePasse = String(req.body?.motDePasse ?? '');
    if (motDePasse.length < 6) throw new ApiError(400, 'Le mot de passe doit contenir au moins 6 caractères.');

    const user = await User.findById(req.params.id).select('+motDePasseHash');
    if (!user) throw new ApiError(404, 'Compte introuvable.');
    user.motDePasseHash = await User.hashMotDePasse(motDePasse);
    await user.save();
    res.json({ ok: true, message: `Mot de passe réinitialisé pour ${user.telephone}.` });
  })
);

/**
 * GET /api/admin/activite — journal de suivi du back-office.
 * Query : type = 'tout' (défaut) | 'inscriptions' | 'connexions' | 'paiements' ;
 *         limit (10..60, défaut 30).
 *
 * Pourquoi : l'équipe doit pouvoir répondre à « qu'est-ce qui se passe en ce moment ? »
 * — qui s'inscrit, qui se connecte (dernierLoginAt, écrit à chaque connexion par
 * /api/users/login et /api/admin/login) et quels paiements arrivent. Les trois sources
 * sont fusionnées PUIS retriées par date, pour donner un seul flux chronologique au lieu
 * de trois écrans à recouper mentalement.
 */
router.get(
  '/activite',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const type = String(req.query.type || 'tout');
    const limite = Math.min(60, Math.max(10, Number(req.query.limit) || 30));

    const seuil24h = new Date(Date.now() - 24 * 3600 * 1000);
    const seuil7j = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const veut = (t) => type === 'tout' || type === t;

    const [inscriptions, connexions, depots, connectes24h, connectes7j, suspendus] = await Promise.all([
      veut('inscriptions')
        ? User.find({})
            .sort({ createdAt: -1 })
            .limit(limite)
            .select('nom prenom telephone createdAt statutCompte estAdmin')
        : [],
      veut('connexions')
        ? User.find({ dernierLoginAt: { $ne: null } })
            .sort({ dernierLoginAt: -1 })
            .limit(limite)
            .select('nom prenom telephone dernierLoginAt statutCompte estAdmin')
        : [],
      veut('paiements')
        ? Depot.find({}).sort({ createdAt: -1 }).limit(limite).populate('userId', 'nom prenom telephone')
        : [],
      User.countDocuments({ dernierLoginAt: { $gte: seuil24h } }),
      User.countDocuments({ dernierLoginAt: { $gte: seuil7j } }),
      User.countDocuments({ statutCompte: 'suspendu' }),
    ]);

    const nomDe = (u) => (u ? [u.prenom, u.nom].filter(Boolean).join(' ') || 'Sans nom' : 'compte supprimé');
    const numeroDe = (u) => (u?.telephone ? String(u.telephone) : '');

    const evenements = [
      ...inscriptions.map((u) => ({
        type: 'inscription',
        at: u.createdAt,
        titre: 'Nouvelle inscription',
        qui: nomDe(u),
        numero: numeroDe(u),
        utilisateurId: u._id,
        admin: Boolean(u.estAdmin),
      })),
      ...connexions.map((u) => ({
        type: 'connexion',
        at: u.dernierLoginAt,
        titre: 'Connexion',
        qui: nomDe(u),
        numero: numeroDe(u),
        utilisateurId: u._id,
        suspendu: (u.statutCompte || 'actif') === 'suspendu',
      })),
      ...depots.map((d) => ({
        type: 'paiement',
        at: d.createdAt,
        titre:
          d.statut === 'valide' ? 'Dépôt validé' : d.statut === 'rejete' ? 'Dépôt rejeté' : 'Dépôt à vérifier',
        qui: nomDe(d.userId),
        // Le numéro PAYEUR est celui qui compte pour retrouver l'argent reçu.
        numero: d.telephonePayeur || numeroDe(d.userId),
        utilisateurId: d.userId?._id || d.userId || null,
        depotId: d._id,
        montant: d.montant,
        devise: d.devise,
        operateur: d.operateur,
        reference: d.reference,
        statut: d.statut,
      })),
    ]
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limite);

    res.json({
      evenements,
      type,
      connectes: { dernier24h: connectes24h, dernier7j: connectes7j },
      suspendus,
      horodatage: new Date().toISOString(),
    });
  })
);


/**
 * GET /api/admin/depots — suivi des dépôts mobile money.
 * Query : statut = 'en_attente' (défaut) | 'valide' | 'rejete' | 'tous'.
 */
router.get(
  '/depots',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const { statut = 'en_attente' } = req.query;
    const filtre = statut === 'tous' ? {} : { statut };

    const docs = await Depot.find(filtre)
      .sort({ createdAt: -1, _id: 1 })
      .limit(200)
      .populate('userId', 'nom prenom telephone metier')
      .populate('jobId', 'metier intitule typeAnnonce telephoneContact');

    const items = docs.map((d) => ({
      ...d.toJSON(),
      utilisateur: d.userId
        ? {
            id: d.userId._id,
            nom: [d.userId.prenom, d.userId.nom].filter(Boolean).join(' ') || 'Sans nom',
            telephone: d.userId.telephone,
            metier: d.userId.metier || '',
          }
        : null,
      job: d.jobId
        ? {
            id: d.jobId._id,
            titre: d.jobId.intitule || d.jobId.metier || 'Annonce',
            typeAnnonce: d.jobId.typeAnnonce,
            telephoneContact: d.jobId.telephoneContact,
          }
        : null,
    }));

    const compte = (s) => Depot.countDocuments(s === 'tous' ? {} : { statut: s });
    const [enAttente, valides, rejetes] = await Promise.all([
      compte('en_attente'),
      compte('valide'),
      compte('rejete'),
    ]);

    res.json({ items, total: items.length, compteurs: { enAttente, valides, rejetes }, statut });
  })
);

/**
 * POST /api/admin/depots/:id/valider — VALIDE un dépôt et DÉBLOQUE le contact.
 * C'est ici que le contact est réellement révélé (Job.contactDebloquePar), de façon
 * idempotente : revalider ne crée pas de doublon.
 */
router.post(
  '/depots/:id/valider',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const depot = await Depot.findById(req.params.id);
    if (!depot) throw new ApiError(404, 'Dépôt introuvable.');
    if (depot.statut === 'valide') {
      return res.json({ depot: depot.toJSON(), message: 'Dépôt déjà validé.' });
    }
    if (depot.statut === 'rejete') {
      throw new ApiError(409, 'Ce dépôt a été rejeté : impossible de le valider.');
    }

    const job = await Job.findById(depot.jobId);
    if (!job) throw new ApiError(404, 'Annonce associée introuvable.');

    if (!job.dejaDebloquePar(depot.userId)) {
      job.contactDebloquePar.push({
        userId: depot.userId,
        montant: Number(depot.montant) || getUnlockFee(),
        devise: depot.devise || getCurrency(),
        moyenPaiement: depot.operateur,
        transactionId: depot.reference || `DEPOT-${depot._id}`,
        statutPaiement: 'ACCEPTED',
        viaDepot: true,
      });
      await job.save();
    }

    depot.statut = 'valide';
    depot.valideParUserId = req.user._id;
    depot.valideAt = new Date();
    if (req.body?.noteAdmin !== undefined) depot.noteAdmin = String(req.body.noteAdmin).trim();
    await depot.save();

    res.json({
      depot: depot.toJSON(),
      debloque: true,
      telephoneContact: job.telephoneContact,
      message: 'Dépôt validé : le contact est maintenant révélé à l’utilisateur.',
    });
  })
);

/** POST /api/admin/depots/:id/rejeter — rejette un dépôt (motif optionnel). */
router.post(
  '/depots/:id/rejeter',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const depot = await Depot.findById(req.params.id);
    if (!depot) throw new ApiError(404, 'Dépôt introuvable.');
    if (depot.statut === 'valide') throw new ApiError(409, 'Un dépôt validé ne peut pas être rejeté.');

    depot.statut = 'rejete';
    depot.valideParUserId = req.user._id;
    depot.valideAt = new Date();
    depot.noteAdmin = String(req.body?.noteAdmin || 'Dépôt non retrouvé.').trim();
    await depot.save();

    res.json({ depot: depot.toJSON(), message: 'Dépôt rejeté.' });
  })
);

export default router;