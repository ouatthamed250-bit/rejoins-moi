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
//   GET    /api/admin/demandes-categories        -> catégories proposées par les gérants (prompt 6)
//   POST   /api/admin/demandes-categories/:id/valider -> VALIDER une proposition (elle devient proposée)
//   POST   /api/admin/demandes-categories/:id/refuser -> REFUSER une proposition (elle reste sur les fiches)
//   GET    /api/admin/annonces-signalees         -> annonces signalées, les plus signalées d'abord (prompt 7)
//   DELETE /api/admin/jobs/:id                   -> RETIRER une annonce signalée (prompt 7)
//   GET    /api/admin/conversations              -> chercher les conversations d'un compte (messagerie, prompt B)
//   GET    /api/admin/conversations/:id/export   -> EXTRAIRE une conversation (réquisition légale)
//
// Suivi (ajout du 01/10) : le back-office n'est plus seulement une file de validation,
// c'est l'écran de pilotage — d'où /activite (qui s'inscrit, qui se connecte, quels
// paiements arrivent) et le statut de compte réversible (`statutCompte` côté User),
// qui coupe la connexion ET les jetons déjà émis (middleware/auth.js).
//
// Sécurité : le mot de passe admin est haché (bcrypt) et jamais renvoyé ; les routes
// sont protégées par protectAdmin qui RELIT `estAdmin` en base à chaque appel.

import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Job from '../models/Job.js';
import Establishment from '../models/Establishment.js';
import Subscription from '../models/Subscription.js';
import Depot from '../models/Depot.js';
import ListeAttente from '../models/ListeAttente.js';
import DemandeCategorie from '../models/DemandeCategorie.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { protectAdmin, signToken, DUREE_JETON_ADMIN } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { limiteurAuth } from '../middleware/rateLimit.js';
import { normalizePhone, escapeRegex } from '../utils/validators.js';
import { getUnlockFee, getCurrency } from '../services/cinetpay.js';
import { anonymiserOuSupprimerCompte } from '../services/suppressionCompte.js';
import { getDepots, getSupportWhatsapp } from '../config/paiement.js';
import { estModeGratuit } from '../config/abonnement.js';
import { libelleFamille } from '../config/categories.js';

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
      // Jeton COURT (12 h, bloc F) : le back-office peut tout faire, une session
      // d'une journée de travail suffit — voir DUREE_JETON_ADMIN dans middleware/auth.js.
      token: signToken(user, { expiresIn: DUREE_JETON_ADMIN }),
      // `prive: true` : le back-office est le seul autre lecteur légitime des
      // données privées (dernière connexion, état du compte, solde…).
      user: user.toPublicJSON({ prive: true }),
      admin: true,
    });
  })
);

/** GET /api/admin/moi — profil de l'admin connecté. */
router.get(
  '/moi',
  protectAdmin,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user.toPublicJSON({ prive: true }) });
  })
);

/** PATCH /api/admin/moi/mot-de-passe — l'admin change son propre mot de passe. */
router.patch(
  '/moi/mot-de-passe',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const ancien = String(req.body?.ancienMotDePasse ?? '');
    const nouveau = String(req.body?.nouveauMotDePasse ?? '');
    if (nouveau.length < 8)
      throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');

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
      // Offres de stage (prompt 7) : comptées à part pour que le total des annonces
      // reste juste — un stage n'est ni une offre « classique » ni une demande.
      stages,
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
      Job.countDocuments({ typeAnnonce: 'stage' }),
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

    // Demandes « Je veux être mis en avant » (mode 100 % gratuit) : le back-office
    // doit voir une FILE, pas seulement un compteur — c'est la liste des personnes
    // à rappeler quand les options de visibilité arriveront.
    const [demandesMiseEnAvant, recentesMiseEnAvant] = await Promise.all([
      ListeAttente.countDocuments({ statut: 'en_attente' }),
      ListeAttente.find({ statut: 'en_attente' })
        .sort({ date: -1 })
        .limit(6)
        .populate('userId', 'nom prenom telephone metier')
        .populate('etablissementId', 'nom')
        .lean(),
    ]);

    // Catégories proposées par les gérants (« Autre (précisez) », prompt 6) : même
    // logique de FILE — l'admin valide ce qui entrera dans la liste des choix.
    const [demandesCategorie, recentesDemandeCategorie] = await Promise.all([
      DemandeCategorie.countDocuments({ statut: 'en_attente' }),
      DemandeCategorie.find({ statut: 'en_attente' }).sort({ demandes: -1, date: -1 }).limit(6),
    ]);

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
      jobs: { total: offres + demandes + stages, offres, demandes, stages },
      abonnementsActifs,
      depots: {
        enAttente: depotsEnAttente,
        valides: depotsValides,
        rejetes: depotsRejetes,
        aujourdhui: depotsAujourdhui,
        montantEncaisseFcfa: encaisse?.[0]?.total || 0,
        serie7j,
      },
      listeAttente: {
        enAttente: demandesMiseEnAvant,
        recentes: recentesMiseEnAvant.map((demande) => {
          const nom = [demande.userId?.prenom, demande.userId?.nom]
            .filter(Boolean)
            .join(' ')
            .trim();
          return {
            id: demande._id,
            date: demande.date,
            statut: demande.statut,
            utilisateur: demande.userId
              ? {
                  id: demande.userId._id,
                  nom: nom || null,
                  telephone: demande.userId.telephone || null,
                  metier: demande.userId.metier || '',
                }
              : null,
            etablissement: demande.etablissementId
              ? { id: demande.etablissementId._id, nom: demande.etablissementId.nom || '' }
              : null,
          };
        }),
      },
      // Catégories proposées par les gérants : le back-office doit voir une file
      // courte (les plus demandées d'abord) pour trancher vite.
      demandesCategorie: {
        enAttente: demandesCategorie,
        recentes: recentesDemandeCategorie.map((d) => d.toPublicJSON()),
      },
      // 0 pendant la gratuité : le back-office n'affiche aucun tarif non plus.
      fraisDeblocage: estModeGratuit() ? 0 : getUnlockFee(),
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
    // Comptes effacés (droit à l'oubli) : visibles UNIQUEMENT ici, pour l'audit —
    // ils n'ont plus de nom ni de numéro, seulement un identifiant technique.
    else if (filtre === 'effaces') filtreReq.supprimeAt = { $ne: null };

    // Les comptes effacés sortent des listes courantes : ils n'ont plus de nom à
    // chercher ni de numéro à appeler, et les afficher partout noierait l'équipe.
    // Ils ne réapparaissent que par l'onglet « Effacés » (audit ci-dessus).
    if (filtre !== 'effaces') filtreReq.supprimeAt = null;

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
        // Comptes anonymisés : on les compte à part, ils ne sont « actifs » pour personne.
        User.countDocuments({ supprimeAt: { $ne: null } }),
      ]).then(([utilisateurs, suspendus, artisans, chercheurs, admins, connectes24h, effaces]) => ({
        utilisateurs,
        suspendus,
        artisans,
        chercheurs,
        admins,
        connectes24h,
        effaces,
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
        // Liste du back-office : seule route qui doit voir l'état de compte et la
        // dernière connexion de chaque personne (modération).
        ...d.toPublicJSON({ prive: true }),
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

/**
 * GET /api/admin/reclamations — file d'attente « c'est mon établissement » (bloc D).
 *
 * `?statut=traitees` renvoie les décisions déjà prises, par défaut les demandes EN ATTENTE.
 * Chaque ligne porte de quoi décider sans ouvrir autre chose : la fiche, le nom déclaré, la
 * distance mesurée et le compte demandeur (qui, quand).
 */
router.get(
  '/reclamations',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const traitees = req.query.statut === 'traitees';
    const fiches = await Establishment.find({
      'reclamation.statut': traitees ? { $in: ['acceptee', 'refusee'] } : 'en_attente',
    })
      .sort({ 'reclamation.demandeeLe': traitees ? -1 : 1, _id: 1 })
      .limit(100)
      .lean();

    const ids = fiches.map((f) => f.reclamation?.demandeurUserId).filter(Boolean);
    const demandeurs = await User.find({ _id: { $in: ids } }).select('prenom nom telephone').lean();
    const parId = new Map(demandeurs.map((u) => [String(u._id), u]));

    res.json({
      total: fiches.length,
      reclamations: fiches.map((f) => {
        const demandeur = f.reclamation?.demandeurUserId ? parId.get(String(f.reclamation.demandeurUserId)) : null;
        return {
          etablissementId: String(f._id),
          nomFiche: f.nom,
          categorie: f.categorie,
          quartier: f.quartier || '',
          commune: f.commune || '',
          statut: f.reclamation?.statut || '',
          nomDeclare: f.reclamation?.nomDeclare || '',
          distanceMetres: f.reclamation?.distanceMetres ?? null,
          demandeeLe: f.reclamation?.demandeeLe || null,
          traiteeLe: f.reclamation?.traiteeLe || null,
          demandeur: demandeur
            ? {
                id: String(demandeur._id),
                nomComplet: [demandeur.prenom, demandeur.nom].filter(Boolean).join(' ') || 'Compte sans nom',
                telephone: demandeur.telephone || '',
              }
            : null,
        };
      }),
    });
  })
);

/**
 * POST /api/admin/reclamations/:id — l'équipe tranche : `accepter` ou `refuser` (bloc D).
 *
 * L'acceptation rattache la fiche EXISTANTE au demandeur : aucune copie, et aucune des
 * informations publiques (photos, horaires, description) n'est écrasée. Le refus laisse la
 * fiche réclamable par quelqu'un d'autre.
 */
router.post(
  '/reclamations/:id',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const decision = String(req.body?.decision || '');
    if (!['accepter', 'refuser'].includes(decision)) {
      throw new ApiError(400, 'Décision attendue : « accepter » ou « refuser ».');
    }
    const fiche = await Establishment.findById(req.params.id);
    if (!fiche) throw new ApiError(404, 'Établissement introuvable.');
    if (!fiche.reclamation?.statut) throw new ApiError(400, 'Aucune réclamation sur cette fiche.');
    if (fiche.reclame) throw new ApiError(409, 'Cette fiche est déjà réclamée.');

    fiche.reclamation.traiteeLe = new Date();
    fiche.reclamation.traiteeParUserId = req.user._id;

    if (decision === 'accepter') {
      fiche.reclamation.statut = 'acceptee';
      fiche.reclame = true;
      fiche.createdByUserId = fiche.reclamation.demandeurUserId;
      await fiche.save();
      const demandeur = await User.findById(fiche.reclamation.demandeurUserId);
      if (demandeur && !demandeur.etablissementId) {
        demandeur.etablissementId = fiche._id;
        await demandeur.save();
      }
      return res.json({ statut: fiche.reclamation.statut, etablissementId: String(fiche._id), reclame: true });
    }

    fiche.reclamation.statut = 'refusee';
    await fiche.save();
    res.json({ statut: fiche.reclamation.statut, etablissementId: String(fiche._id), reclame: false });
  })
);

/**
 * GET /api/admin/annonces-signalees — annonces signalées par les utilisateurs
 * (prompt 7). Triées par NOMBRE de signalements : une annonce signalée dix fois
 * passe avant celle signalée une fois, quel que soit l'âge de la fiche.
 */
router.get(
  '/annonces-signalees',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const docs = await Job.find({ signalements: { $gt: 0 } })
      .sort({ signalements: -1, dernierSignalementAt: -1, _id: 1 })
      .limit(200)
      .populate('posteParUserId', 'nom prenom telephone metier');

    const items = docs.map((doc) => ({
      id: String(doc._id),
      titre: doc.intitule || doc.metier || 'Annonce',
      typeAnnonce: doc.typeAnnonce || 'demande',
      metier: doc.metier,
      description: doc.description,
      commune: doc.commune,
      quartier: doc.quartier,
      statut: doc.statut,
      // Le numéro est visible ici, dans le back-office : c'est un écran de
      // modération, pas une réponse publique (aucune règle de masquage à casser).
      telephoneContact: doc.telephoneContact,
      contactPublic: Boolean(doc.contactPublic),
      signalements: doc.signalements || 0,
      dernierSignalementAt: doc.dernierSignalementAt || null,
      createdAt: doc.createdAt,
      auteur: doc.posteParUserId
        ? {
            id: String(doc.posteParUserId._id),
            nom:
              [doc.posteParUserId.prenom, doc.posteParUserId.nom].filter(Boolean).join(' ') ||
              'Sans nom',
            telephone: doc.posteParUserId.telephone || '',
            metier: doc.posteParUserId.metier || '',
          }
        : null,
    }));

    res.json({ items, total: items.length });
  })
);

/**
 * DELETE /api/admin/jobs/:id — retirer une annonce (prompt 7).
 *
 * Suppression RÉELLE du document : une annonce frauduleuse ne doit pas continuer à
 * exister « en pause ». Les dépôts éventuellement liés gardent leur `jobId`
 * (historique comptable) ; les écrans du back-office affichent déjà « annonce
 * retirée » lorsque le populate ne trouve plus le document.
 */
router.delete(
  '/jobs/:id',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw new ApiError(404, 'Annonce introuvable.');
    const titre = job.intitule || job.metier || 'Annonce';
    const signalements = job.signalements || 0;
    await Job.deleteOne({ _id: job._id });
    res.json({ supprime: true, id: String(job._id), titre, signalements });
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
        .populate('jobId', 'metier intitule typeAnnonce')
        // Qui a tranché ce dépôt (bloc F) : affiché en « validé par » sur la fiche.
        .populate('valideParUserId', 'nom prenom'),
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
      user: user.toPublicJSON({ abonnement, prive: true }),
      resume,
      depots: depots.map((d) => ({
        ...d.toJSON(),
        validePar: d.valideParUserId
          ? {
              id: d.valideParUserId._id,
              nom: [d.valideParUserId.prenom, d.valideParUserId.nom].filter(Boolean).join(' ') || 'Administrateur',
            }
          : null,
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
    res.json({ user: user.toPublicJSON({ prive: true }), message: 'Compte mis à jour.' });
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
        // Le back-office doit voir l'état résultant (statut, motif, date) : `prive`.
        user: user.toPublicJSON({ prive: true }),
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
      user: user.toPublicJSON({ prive: true }),
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
    if (motDePasse.length < 8)
      throw new ApiError(400, 'Le mot de passe doit contenir au moins 8 caractères.');

    const user = await User.findById(req.params.id).select('+motDePasseHash');
    if (!user) throw new ApiError(404, 'Compte introuvable.');
    user.motDePasseHash = await User.hashMotDePasse(motDePasse);
    await user.save();
    res.json({ ok: true, message: `Mot de passe réinitialisé pour ${user.telephone}.` });
  })
);

/**
 * DELETE /api/admin/utilisateurs/:id — droit à l'effacement appliqué par l'équipe.
 * body: { confirmation: "<nom complet du compte>" , motif? }
 *
 * Deux cas d'usage :
 *   1. une personne écrit à l'équipe (« supprimez mon compte, je n'ai plus accès à
 *      mon téléphone ») : on applique la même anonymisation que le libre-service
 *      (voir services/suppressionCompte.js), sans attendre qu'elle se connecte ;
 *   2. compte frauduleux à nettoyer tout en gardant les traces de paiement.
 *
 * GARDE-FOUS (l'opération est IRRÉVERSIBLE) :
 *   - on ne supprime pas SON PROPRE compte : le back-office se verrouillerait ;
 *   - on ne supprime pas un compte ADMINISTRATEUR (retirer le rôle d'abord) ;
 *   - on exige la saisie du nom affiché du compte : une erreur d'identifiant dans
 *     l'URL ne peut pas effacer quelqu'un d'autre ;
 *   - un compte déjà anonymisé n'est pas retraité (réponse idempotente) : les
 *     compteurs du rapport ne sont jamais faussés par un double clic.
 *
 * Contrairement à une suppression de document, les dépôts et abonnements restent
 * en base (obligations comptables) : c'est le comportement voulu, et la réponse
 * le dit explicitement à l'administrateur.
 */
router.delete(
  '/utilisateurs/:id',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Compte introuvable.');

    if (String(user._id) === String(req.user._id)) {
      throw new ApiError(409, 'Vous ne pouvez pas effacer votre propre compte depuis le back-office.');
    }
    if (user.estAdmin) {
      throw new ApiError(
        409,
        'Un compte administrateur ne peut pas être effacé : retirez d’abord le rôle administrateur.'
      );
    }

    if (user.supprimeAt) {
      return res.json({
        ok: true,
        dejaSupprime: true,
        // `prive` : l'admin a le droit de voir l'état de modération du compte.
        user: user.toPublicJSON({ prive: true }),
        message: 'Ce compte a déjà été effacé : aucune donnée personnelle ne subsiste.',
      });
    }

    // Double validation par saisie du nom : même principe que la suppression d'un
    // dépôt GitHub — on ne peut pas effacer un compte « au hasard » d'un clic.
    const attendu = (user.nomComplet || user.telephone || '').trim();
    const saisi = String(req.body?.confirmation ?? '').trim();
    if (!saisi) {
      throw new ApiError(
        400,
        `Pour confirmer, saisissez le nom affiché du compte : « ${attendu} ».`,
        { confirmationAttendue: attendu }
      );
    }
    if (saisi.toLowerCase() !== attendu.toLowerCase()) {
      throw new ApiError(
        400,
        'La confirmation ne correspond pas au nom du compte : rien n’a été supprimé.',
        { confirmationAttendue: attendu }
      );
    }

    const motif = String(req.body?.motif ?? '').trim().slice(0, 200);
    const rapport = await anonymiserOuSupprimerCompte(user._id);

    res.json({
      ok: true,
      dejaSupprime: false,
      // On relit le compte pour renvoyer son état réel (nom remplacé, supprimeAt).
      user: (await User.findById(user._id)).toPublicJSON({ prive: true }),
      message:
        'Compte effacé : identité, coordonnées et contenus personnels ont été anonymisés. ' +
        `Dépôts et abonnements conservés pour la comptabilité (${rapport.depotsConserves} dépôt(s), ` +
        `${rapport.abonnementsConserves} abonnement(s)).`,
      // Détail utile au back-office (et au rapport d'audit) : aucune donnée
      // personnelle ici, seulement des compteurs.
      suppression: { ...rapport, motif },
    });
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
      .populate('jobId', 'metier intitule typeAnnonce telephoneContact')
      // QUI a tranché : la décision (valider = révéler un contact payé) est
      // irréversible, elle doit être attribuable à un administrateur nommé.
      .populate('valideParUserId', 'nom prenom telephone');

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
      // « validé par » / « rejeté par » : null tant que la décision n'est pas prise.
      validePar: d.valideParUserId
        ? {
            id: d.valideParUserId._id,
            nom: [d.valideParUserId.prenom, d.valideParUserId.nom].filter(Boolean).join(' ') || 'Administrateur',
            telephone: d.valideParUserId.telephone || '',
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

/**
 * GET /api/admin/demandes-categories — catégories proposées par les gérants.
 * Query : { statut? = 'en_attente' | 'validee' | 'refusee' | 'toutes', limit? }
 *
 * Pourquoi une file et pas une liste déroulante : un gérant qui choisit
 * « Autre (précisez) » ne crée PAS de famille (l'enum reste fermé, sinon les
 * 6 719 fiches importées et les liens `?categorie=` partagés casseraient). Sa
 * proposition est stockée à part et c'est ici qu'on décide de l'exposer.
 */
router.get(
  '/demandes-categories',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const statut = String(req.query.statut || 'en_attente');
    const autorises = ['en_attente', 'validee', 'refusee'];
    const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const filtre = statut === 'toutes' ? {} : { statut: autorises.includes(statut) ? statut : 'en_attente' };

    const [demandes, compteurs] = await Promise.all([
      DemandeCategorie.find(filtre)
        // Les plus réclamées d'abord : un libellé demandé 12 fois passe avant
        // celui d'un seul gérant, c'est le signal le plus honnête.
        .sort({ demandes: -1, date: -1 })
        .limit(limite)
        .populate('userId', 'nom prenom telephone')
        .populate('etablissementId', 'nom'),
      Promise.all([
        DemandeCategorie.countDocuments({ statut: 'en_attente' }),
        DemandeCategorie.countDocuments({ statut: 'validee' }),
        DemandeCategorie.countDocuments({ statut: 'refusee' }),
      ]),
    ]);

    res.json({
      demandes: demandes.map((d) => ({
        ...d.toPublicJSON(),
        // Combien de gérants ont écrit ce même libellé (toPublicJSON ne le publie pas :
        // c'est un signal de pilotage, pas une information de fiche).
        demandes: d.demandes || 1,
        // Motif de refus : visible uniquement en back-office (jamais dans toPublicJSON).
        noteAdmin: d.noteAdmin || '',
        utilisateur: d.userId
          ? {
              id: d.userId._id,
              nom: [d.userId.prenom, d.userId.nom].filter(Boolean).join(' ') || null,
              telephone: d.userId.telephone || null,
            }
          : null,
        etablissement: d.etablissementId
          ? { id: d.etablissementId._id, nom: d.etablissementId.nom || '' }
          : null,
      })),
      compteurs: { enAttente: compteurs[0], validees: compteurs[1], refusees: compteurs[2] },
    });
  })
);

/**
 * POST /api/admin/demandes-categories/:id/valider — la catégorie devient proposée.
 * body: { famille? } — famille d'accueil ; par défaut celle proposée par le gérant
 * (l'admin ne peut pas changer l'enum des familles, seulement rattacher la
 * sous-catégorie à l'une d'elles).
 */
router.post(
  '/demandes-categories/:id/valider',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const demande = await DemandeCategorie.findById(req.params.id);
    if (!demande) throw new ApiError(404, 'Demande introuvable.');
    if (demande.statut === 'validee') {
      throw new ApiError(409, 'Cette catégorie est déjà validée.');
    }

    demande.statut = 'validee';
    const famille = String(req.body?.famille || demande.famille || 'autre').trim();
    if (famille) demande.famille = famille;
    demande.traiteLe = new Date();
    demande.traiteParUserId = req.user._id;
    await demande.save();

    res.json({
      demande: demande.toPublicJSON(),
      message: `« ${demande.nom} » est désormais proposée comme sous-catégorie de « ${libelleFamille(
        demande.famille
      )} ».`,
    });
  })
);

/** POST /api/admin/demandes-categories/:id/refuser — reste hors de la liste (motif libre). */
router.post(
  '/demandes-categories/:id/refuser',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const demande = await DemandeCategorie.findById(req.params.id);
    if (!demande) throw new ApiError(404, 'Demande introuvable.');
    if (demande.statut === 'refusee') throw new ApiError(409, 'Cette demande est déjà refusée.');

    demande.statut = 'refusee';
    demande.noteAdmin = String(req.body?.noteAdmin || '').trim().slice(0, 300);
    demande.traiteLe = new Date();
    demande.traiteParUserId = req.user._id;
    await demande.save();

    // Le libellé reste sur les fiches qui l'ont saisi : refuser une proposition
    // n'efface pas le travail du gérant, ça évite juste de le proposer aux suivants.
    res.json({ demande: demande.toPublicJSON(), message: 'Proposition refusée.' });
  })
);

/* ─── Messagerie interne : recherche et extraction (prompt B) ──────────────────
   L'administrateur ne participe JAMAIS à une conversation : il ne peut pas
   écrire à la place d'un compte. Il dispose de deux gestes, tous deux protégés
   par protectAdmin (qui relit `estAdmin` en base à chaque appel) :

   1. RETROUVER les conversations d'une personne à partir de son nom ou de son
      numéro — indispensable quand une réquisition ne donne qu'un nom ;
   2. EXTRAIRE une conversation entière en JSON (participants, numéros, date et
      heure de chaque message, expéditeur).

   Ces routes sont les SEULES à publier les numéros de téléphone des participants :
   c'est le prix de la réquisition, et il reste enfermé derrière `estAdmin`.
   Un message n'est ni modifiable ni supprimable un par un : une pièce ne doit pas
   pouvoir être altérée après coup. */

const FR_DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Africa/Abidjan',
});
const FR_HEURE = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Africa/Abidjan',
});

/** « 26/11/2026 » — jamais « Invalid Date » dans une pièce remise à la police. */
function dateLisible(valeur) {
  if (!valeur) return '';
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? '' : FR_DATE_LONGUE.format(date);
}

/** « 14:32:07 » (heure d'Abidjan). */
function heureLisible(valeur) {
  if (!valeur) return '';
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? '' : FR_HEURE.format(date);
}

/** Participants d'une conversation, avec le numéro (back-office uniquement). */
function participantsExport(conversation) {
  return (conversation.participants || []).map((p) => ({
    id: String(p?._id || p),
    nom: p?.nomComplet || [p?.prenom, p?.nom].filter(Boolean).join(' ') || 'Compte sans nom',
    telephone: p?.telephone || '',
    estArtisan: Boolean(p?.estArtisan),
    metier: p?.metier || '',
    compteSupprime: Boolean(p?.supprimeAt),
  }));
}

/**
 * GET /api/admin/conversations?q=…&limit=…
 *
 * Sans `q` : les conversations les plus récentes de la plateforme (veille).
 * Avec `q` : celles dont UN participant correspond au nom, au prénom ou au
 * numéro. Un identifiant de conversation collé tel quel fonctionne aussi : c'est
 * le geste le plus rapide quand la réquisition donne déjà cet identifiant.
 */
router.get(
  '/conversations',
  protectAdmin,
  asyncHandler(async (req, res) => {
    const terme = String(req.query.q || '').trim();
    const limite = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

    const filtre = {};

    if (terme) {
      const rx = new RegExp(escapeRegex(terme), 'i');
      const comptes = await User.find({
        $or: [{ nom: rx }, { prenom: rx }, { telephone: rx }],
      })
        .select('_id')
        .limit(50);

      // Aucun compte ne correspond : inutile d'interroger les conversations
      // (et surtout, ne pas retomber sur « tout » par un filtre vide).
      if (comptes.length === 0 && !mongoose.isValidObjectId(terme)) {
        return res.json({ conversations: [], total: 0, terme });
      }

      const conditions = [{ participants: { $in: comptes.map((c) => c._id) } }];
      if (mongoose.isValidObjectId(terme)) conditions.push({ _id: terme });
      filtre.$or = conditions;
    }

    const conversations = await Conversation.find(filtre)
      .sort({ derniereActivite: -1 })
      .limit(limite)
      .populate({
        path: 'participants',
        select: 'nom prenom telephone estArtisan metier supprimeAt',
      });

    // Nombre de messages par conversation, en une agrégation (pas une requête
    // par ligne).
    const ids = conversations.map((c) => c._id);
    const compteurs = ids.length
      ? await Message.aggregate([
          { $match: { conversationId: { $in: ids } } },
          { $group: { _id: '$conversationId', total: { $sum: 1 } } },
        ])
      : [];
    const parConversation = new Map(compteurs.map((c) => [String(c._id), c.total]));

    res.json({
      conversations: conversations.map((conversation) => ({
        id: String(conversation._id),
        participants: participantsExport(conversation),
        dernierMessage: conversation.dernierMessage || '',
        debut: conversation.createdAt,
        derniereActivite: conversation.derniereActivite,
        nombreMessages: parConversation.get(String(conversation._id)) || 0,
      })),
      total: conversations.length,
      terme,
    });
  })
);

/**
 * GET /api/admin/conversations/:id/export — EXTRAIRE une conversation.
 *
 * Réponse JSON téléchargeable (`Content-Disposition: attachment`) : c'est une
 * pièce destinée à être remise telle quelle (police, justice), donc lisible sans
 * l'application. Contenu :
 *   • meta : identifiant, dates, nombre de messages, qui a exporté et quand ;
 *   • participants : nom, numéro, métier, état du compte ;
 *   • messages : numéro d'ordre, expéditeur, identifiant, date et heure locales
 *     (Africa/Abidjan, sans ambiguïté de fuseau).
 *
 * On n'arrondit rien et on ne tronque rien : un message de 1000 caractères sort
 * entier. Le plafond de 5000 messages protège seulement la mémoire du serveur.
 */
router.get(
  '/conversations/:id/export',
  protectAdmin,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new ApiError(404, 'Conversation introuvable.');
    }

    const conversation = await Conversation.findById(req.params.id).populate({
      path: 'participants',
      select: 'nom prenom telephone estArtisan metier supprimeAt statutCompte createdAt',
    });
    if (!conversation) throw new ApiError(404, 'Conversation introuvable.');

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(5000);

    const participants = participantsExport(conversation);
    const nomsParId = new Map(participants.map((p) => [p.id, p.nom]));

    const charge = {
      meta: {
        conversationId: String(conversation._id),
        debut: conversation.createdAt,
        debutLisible: `${dateLisible(conversation.createdAt)} ${heureLisible(conversation.createdAt)}`.trim(),
        derniereActivite: conversation.derniereActivite,
        nombreMessages: messages.length,
        exporteLe: new Date().toISOString(),
        exportePar: {
          id: String(req.user._id),
          nom: req.user.nomComplet || 'Administrateur',
          telephone: req.user.telephone || '',
        },
        fuseauHoraire: 'Africa/Abidjan',
        // Rappel explicite pour le destinataire de la pièce : ce document contient
        // des données personnelles (loi ivoirienne n° 2013-450 sur la protection
        // des données à caractère personnel).
        avertissement:
          'Extraction de messagerie interne Rejoins’Moi — données personnelles, usage strictement limité au cadre de la réquisition.',
      },
      participants,
      messages: messages.map((message, index) => ({
        numero: index + 1,
        id: String(message._id),
        expediteurId: String(message.expediteurId),
        expediteur: nomsParId.get(String(message.expediteurId)) || 'Compte inconnu',
        date: message.createdAt,
        dateLisible: dateLisible(message.createdAt),
        heure: heureLisible(message.createdAt),
        contenu: message.contenu,
        luPar: (message.luPar || []).map(String),
      })),
    };

    const nomFichier = `conversation-${conversation._id}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
    // `res.send` (et non `res.json`) pour ne pas réécrire l'en-tête Content-Type
    // déjà posé : le fichier doit sortir en JSON lisible, indenté.
    res.send(JSON.stringify(charge, null, 2));
  })
);

export default router;