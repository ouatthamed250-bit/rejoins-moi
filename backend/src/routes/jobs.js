// jobs.js — Endpoints mise en relation main-d'œuvre (voir cahier-des-charges §1-2)
// GET    /api/jobs                    -> liste des annonces (offres de boulot + demandes de main-d'œuvre)
// POST   /api/jobs                    -> poster une annonce (gratuit)
// POST   /api/jobs/:id/unlock-contact -> débloque le contact (500 FCFA OU inclus dans l'abonnement)
//
// DEUX TYPES D'ANNONCES, UNE SEULE COLLECTION (cahier des charges, ajout du 29/09 :
// page « Jobs » à deux sous-onglets). Le champ `typeAnnonce` distingue :
//   • 'offre'   -> offre de boulot (emploi proposé par un employeur)
//   • 'demande' -> demande de main-d'œuvre (mission ponctuelle artisan/journalier)
// Le filtre `?typeAnnonce=` est optionnel : sans lui, on renvoie tout.
//
// MODÈLE ÉCONOMIQUE (§2) : poster une annonce est GRATUIT et chercher du travail est
// GRATUIT. Le déblocage du numéro de contact est soit :
//   • couvert par un ABONNEMENT actif (models/Subscription.js, ajout du 29/09) : 0 FCFA,
//   • soit payé 500 FCFA à l'unité via Wave / Orange Money à travers CinetPay.
// Aucun faux paiement : sans clés CinetPay, la route répond 501 et le contact n'est
// JAMAIS révélé — sauf s'il est déjà couvert par un abonnement vérifié côté serveur.
//
// VARIANTE « journalier » (point ouvert §2, tranché ici — À VALIDER) :
// pour les demandes marquées `segment: 'journalier'` avec `premierContactGratuit`,
// le déblocage est GRATUIT. Le paiement de 500 FCFA n'intervient qu'après
// confirmation de la mission par le posteur (`POST /:id/confirm-mission`), pour
// ne pas freiner l'adoption par la main-d'œuvre précaire (4 000-5 000 FCFA/jour).

import express from 'express';
import Job from '../models/Job.js';
import Subscription from '../models/Subscription.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { escapeRegex } from '../utils/validators.js';
import { getDistanceKm, parseCoords } from '../utils/geo.js';
import {
  initiatePayment,
  confirmPayment,
  verifyNotifySignature,
  isPaymentConfigured,
  getUnlockFee,
  getCurrency,
  normalizeChannel,
  PaymentError,
} from '../services/cinetpay.js';

const router = express.Router();
router.use(requireDb);

export const METIERS = [
  'Électricien',
  'Plombier',
  'Maçon',
  'Couturier',
  'Menuisier',
  'Carreleur',
  'Peintre',
  'Mécanicien',
  'Soudeur',
  'Coiffeur',
  'Cuisinier',
  'Ménagère / Repassage',
  'Manœuvre',
  'Journalier',
  'Gardien',
  'Jardinier',
  'Chauffeur',
  'Autre',
];

/** GET /api/jobs/metiers — liste des métiers proposés dans le formulaire. */
router.get('/metiers', (req, res) => {
  res.json({ metiers: METIERS, fraisDeblocage: getUnlockFee(), devise: getCurrency(), paiementConfigure: isPaymentConfigured() });
});

/**
 * GET /api/jobs — liste des annonces (offres de boulot + demandes de main-d'œuvre),
 * filtrable par type, métier / urgence / segment / mot-clé, triée par proximité si
 * lat+lng fournis.
 * Le téléphone n'est renvoyé que si l'appelant a déjà débloqué ce contact.
 * `abonnementActif` indique au frontend que les contacts sont inclus sans frais.
 */
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { metier, q, urgence, segment, statut = 'ouvert', limit = 40, typeAnnonce } = req.query;
    const coords = parseCoords(req.query);

    const filtre = {};
    if (statut && statut !== 'tous') filtre.statut = statut;
    if (metier && metier !== 'tous') filtre.metier = new RegExp(`^${escapeRegex(String(metier))}$`, 'i');
    if (segment === 'journalier' || segment === 'specialise') filtre.segment = segment;
    // 'demande' inclut les annonces créées AVANT l'ajout du champ (valeur manquante
    // en base) : sans quoi l'historique disparaîtrait du sous-onglet « demandes ».
    if (typeAnnonce === 'offre') filtre.typeAnnonce = 'offre';
    else if (typeAnnonce === 'demande') filtre.typeAnnonce = { $in: ['demande', null] };
    if (urgence === 'true') filtre.urgence = true;
    if (q) {
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      filtre.$or = [{ metier: rx }, { intitule: rx }, { description: rx }, { commune: rx }, { quartier: rx }];
    }

    const docs = await Job.find(filtre).sort({ urgence: -1, createdAt: -1 }).limit(Math.min(100, Number(limit) || 40));

    const items = docs.map((doc) => {
      const distanceKm = coords
        ? getDistanceKm(coords.lat, coords.lng, doc.localisation.lat, doc.localisation.lng)
        : null;
      return { ...doc.toJSONFor({ userId: req.user?._id }), distanceKm };
    });

    if (coords) items.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));

    // Abonnement : une seule requête pour les déblocages inclus (voir §3 ajout 29/09).
    const abonnement = req.user ? await Subscription.trouverActif(req.user._id) : null;

    res.json({
      items,
      total: items.length,
      centre: coords,
      fraisDeblocage: getUnlockFee(),
      devise: getCurrency(),
      paiementConfigure: isPaymentConfigured(),
      abonnementActif: Boolean(abonnement),
      abonnement: abonnement ? abonnement.toPublicJSON() : null,
    });
  })
);

/**
 * POST /api/jobs — poster une annonce (GRATUIT, §2).
 * body: { typeAnnonce, metier, intitule?, description, localisation{lat,lng}, urgence,
 *         budgetFcfa, duree, telephoneContact, commune, quartier, segment, premierContactGratuit }
 */
router.post(
  '/',
  protect,
  asyncHandler(async (req, res) => {
    const {
      metier,
      intitule = '',
      description,
      localisation,
      urgence = false,
      budgetFcfa = 0,
      duree = '',
      telephoneContact,
      commune = '',
      quartier = '',
      segment = 'specialise',
      typeAnnonce = 'demande',
    } = req.body || {};

    if (!metier) throw new ApiError(400, 'Le métier recherché est obligatoire.');
    if (!description || String(description).trim().length < 10) {
      throw new ApiError(400, 'Décrivez le besoin en quelques mots (10 caractères minimum).');
    }
    const lat = Number(localisation?.lat);
    const lng = Number(localisation?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new ApiError(400, 'Localisation obligatoire pour trier les besoins par proximité.');
    }
    const contact = telephoneContact || req.user.telephone;
    if (!contact) throw new ApiError(400, 'Un numéro de contact est obligatoire.');

    // Variante journalier : premier contact gratuit par défaut (voir en-tête de fichier)
    const premierContactGratuit =
      segment === 'journalier' ? req.body?.premierContactGratuit !== false : Boolean(req.body?.premierContactGratuit);

    const doc = new Job({
      // Une offre de boulot est un emploi : le segment « journalier » n'a de sens
      // que pour les demandes de main-d'œuvre ponctuelles.
      typeAnnonce: typeAnnonce === 'offre' ? 'offre' : 'demande',
      metier,
      intitule: String(intitule || '').trim().slice(0, 120),
      description: String(description).trim(),
      localisation: { lat, lng },
      commune,
      quartier,
      urgence: Boolean(urgence),
      budgetFcfa: Number(budgetFcfa) || 0,
      duree,
      posteParUserId: req.user._id,
      nomPosteur: req.user.nomComplet || req.user.telephone,
      telephoneContact: contact,
      segment: segment === 'journalier' ? 'journalier' : 'specialise',
      premierContactGratuit,
    });

    await doc.save();
    res.status(201).json({ job: doc.toJSONFor({ userId: req.user._id }) });
  })
);

/**
 * POST /api/jobs/webhook/cinetpay — notification serveur-à-serveur de CinetPay.
 * Sécurisé par signature HMAC-SHA256 (en-tête `x-token`) lorsque
 * CINETPAY_SECRET_KEY est configurée. Body brut disponible via `req.rawBody`
 * (voir le `verify` du express.json() dans src/index.js).
 */
router.post(
  '/webhook/cinetpay',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-token'] || req.headers['x-signature'];
    if (!verifyNotifySignature(req.rawBody || JSON.stringify(req.body || {}), signature)) {
      return res.status(401).json({ error: 'Signature CinetPay invalide.' });
    }

    const transactionId = req.body?.cpm_trans_id || req.body?.transaction_id;
    const metadata = req.body?.cpm_custom || req.body?.metadata || '';
    // metadata attendu : "job:<jobId>:user:<userId>"
    const [, jobId, , userId] = String(metadata).split(':');

    if (!jobId || !userId) {
      return res.status(202).json({ received: true, ignored: 'metadata non exploitable' });
    }

    try {
      const verification = await confirmPayment(transactionId);
      if (!verification.accepted) {
        return res.status(202).json({ received: true, statut: verification.status });
      }
      const job = await Job.findById(jobId);
      if (job && !job.dejaDebloquePar(userId)) {
        job.contactDebloquePar.push({
          userId,
          montant: getUnlockFee(),
          devise: getCurrency(),
          moyenPaiement: normalizeChannel(verification.paymentMethod || req.body?.cpm_payment_method),
          transactionId,
          statutPaiement: 'ACCEPTED',
        });
        await job.save();
      }
      return res.json({ received: true, debloque: true });
    } catch (err) {
      // On répond 200 pour éviter les re-essais en boucle du webhook, mais on log.
      console.error('[jobs] webhook cinetpay :', err.message);
      return res.status(200).json({ received: true, erreur: err.message });
    }
  })
);

/**
 * POST /api/jobs/:id/unlock-contact — débloque le numéro de contact (§2).
 * body: { transactionId?, moyenPaiement? }
 *
 * Trois cas :
 *  A. Déjà débloqué -> renvoie le contact directement (idempotent).
 *  B. ABONNEMENT actif (ajout du 29/09) -> déblocage immédiat, 0 FCFA, sans passerelle
 *     de paiement : l'accès aux offres et demandes est inclus dans l'abonnement.
 *     Vérifié EN BASE à chaque appel, jamais sur la foi du client.
 *  C. Demande « journalier » avec premier contact gratuit -> déblocage immédiat, 0 FCFA.
 *  D. Sinon -> 500 FCFA :
 *     - sans `transactionId` : initialise un paiement CinetPay et renvoie
 *       `paymentUrl` (HTTP 202) — le frontend redirige vers Wave/Orange Money ;
 *     - avec `transactionId` : vérifie la transaction auprès de CinetPay (seule
 *       source de vérité) et ne débloque QUE si elle est ACCEPTED.
 * Si la passerelle n'est pas configurée : HTTP 501, contact jamais révélé.
 */
router.post(
  '/:id/unlock-contact',
  protect,
  asyncHandler(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw new ApiError(404, 'Besoin introuvable.');
    if (job.statut === 'annule') throw new ApiError(400, 'Ce besoin a été annulé.');

    const userId = req.user._id;
    const montant = getUnlockFee();
    const devise = getCurrency();

    // ── Cas A : déjà débloqué ──
    if (job.dejaDebloquePar(userId)) {
      return res.json({
        debloque: true,
        telephoneContact: job.telephoneContact,
        montantPaye: 0,
        message: 'Contact déjà débloqué.',
      });
    }

    // ── Cas B : abonnement actif -> contacts inclus, 0 FCFA ──
    const abonnement = await Subscription.trouverActif(userId);
    if (abonnement) {
      job.contactDebloquePar.push({
        userId,
        montant: 0,
        devise,
        moyenPaiement: 'ABONNEMENT',
        statutPaiement: 'ACCEPTED',
        viaAbonnement: true,
      });
      await job.save();
      req.user.ajouterInteraction({ type: 'contact', terme: `job:${job._id}` });
      await req.user.save().catch(() => {});

      return res.json({
        debloque: true,
        telephoneContact: job.telephoneContact,
        montantPaye: 0,
        gratuit: true,
        viaAbonnement: true,
        message: `Contact inclus dans votre ${abonnement.toPublicJSON().libelle} : aucun frais à l’unité.`,
      });
    }

    // ── Cas C : variante journalier, premier contact offert ──
    if (job.segment === 'journalier' && job.premierContactGratuit) {
      job.contactDebloquePar.push({
        userId,
        montant: 0,
        devise,
        moyenPaiement: 'GRATUIT_JOURNALIER',
        statutPaiement: 'ACCEPTED',
      });
      await job.save();
      req.user.ajouterInteraction({ type: 'contact', terme: `job:${job._id}` });
      await req.user.save().catch(() => {});
      return res.json({
        debloque: true,
        telephoneContact: job.telephoneContact,
        montantPaye: 0,
        gratuit: true,
        message:
          'Premier contact offert (mission journalière). Le paiement interviendra après confirmation de la mission.',
      });
    }

    // ── Cas D : paiement mobile money obligatoire via CinetPay ──
    if (!isPaymentConfigured()) {
      throw new ApiError(
        501,
        "Le paiement Wave / Orange Money n'est pas encore activé sur cet environnement. Renseignez CINETPAY_API_KEY et CINETPAY_SITE_ID (backend/.env) pour encaisser les 500 FCFA."
      );
    }

    const transactionId = req.body?.transactionId;
    try {
      if (!transactionId) {
        // Phase 1 : initialisation du paiement
        const init = await initiatePayment({
          amount: montant,
          description: `Rejoins'Moi — contact ${job.metier}`,
          customerName: req.user.nomComplet || req.user.telephone,
          customerPhone: req.user.telephone,
          metadata: `job:${job._id}:user:${req.user._id}`,
        });
        return res.status(202).json({
          debloque: false,
          paiementRequis: true,
          montant,
          devise,
          transactionId: init.transactionId,
          paymentUrl: init.paymentUrl,
          operateurs: ['Wave', 'Orange Money'],
          message: 'Finalisez le paiement sur Wave ou Orange Money, puis revenez dans l’application.',
        });
      }

      // Phase 2 : vérification — SEULE source de vérité
      const verification = await confirmPayment(transactionId);
      if (!verification.accepted) {
        throw new ApiError(402, `Paiement non confirmé (statut : ${verification.status}). Le contact reste masqué.`, {
          statut: verification.status,
        });
      }

      job.contactDebloquePar.push({
        userId,
        montant,
        devise,
        moyenPaiement: normalizeChannel(verification.paymentMethod || req.body?.moyenPaiement),
        transactionId,
        statutPaiement: 'ACCEPTED',
      });
      await job.save();

      req.user.ajouterInteraction({ type: 'contact', terme: `job:${job._id}` });
      await req.user.save().catch(() => {});

      return res.json({
        debloque: true,
        telephoneContact: job.telephoneContact,
        montantPaye: montant,
        devise,
        transactionId,
        message: 'Contact débloqué. Bonne mission !',
      });
    } catch (err) {
      if (err instanceof PaymentError) {
        throw new ApiError(err.code === 'PAYMENT_NOT_CONFIGURED' ? 501 : 502, err.message, err.details);
      }
      throw err;
    }
  })
);

/**
 * POST /api/jobs/:id/confirm-mission — le posteur confirme que la mission a bien
 * été réalisée. Dans la variante « journalier » (§2), c'est cet événement qui
 * déclenche l'exigibilité des 500 FCFA côté ouvrier (le premier contact, lui,
 * était gratuit). Réservé au posteur du besoin.
 */
router.post(
  '/:id/confirm-mission',
  protect,
  asyncHandler(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw new ApiError(404, 'Besoin introuvable.');
    if (String(job.posteParUserId) !== String(req.user._id)) {
      throw new ApiError(403, 'Seule la personne ayant posté le besoin peut confirmer la mission.');
    }

    job.statut = 'pourvu';
    await job.save();

    res.json({
      job: job.toJSONFor({ userId: req.user._id }),
      message:
        job.segment === 'journalier'
          ? 'Mission confirmée. Les frais de mise en relation (500 FCFA) deviennent exigibles pour l’ouvrier.'
          : 'Mission confirmée.',
    });
  })
);

/** PATCH /api/jobs/:id/statut — le posteur ouvre/ferme/annule son besoin. */
router.patch(
  '/:id/statut',
  protect,
  asyncHandler(async (req, res) => {
    const statut = req.body?.statut;
    if (!['ouvert', 'pourvu', 'annule'].includes(statut)) {
      throw new ApiError(400, 'statut doit être : ouvert, pourvu ou annule.');
    }
    const job = await Job.findById(req.params.id);
    if (!job) throw new ApiError(404, 'Besoin introuvable.');
    if (String(job.posteParUserId) !== String(req.user._id)) {
      throw new ApiError(403, 'Seule la personne ayant posté le besoin peut le modifier.');
    }
    job.statut = statut;
    await job.save();
    res.json({ job: job.toJSONFor({ userId: req.user._id }) });
  })
);

/** GET /api/jobs/:id — détail d'un besoin (contact masqué tant qu'il n'est pas débloqué). */
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const job = await Job.findById(req.params.id).select('+telephoneContact');
    if (!job) throw new ApiError(404, 'Besoin introuvable.');
    const coords = parseCoords(req.query);
    const distanceKm = coords
      ? getDistanceKm(coords.lat, coords.lng, job.localisation.lat, job.localisation.lng)
      : null;
    const abonnement = req.user ? await Subscription.trouverActif(req.user._id) : null;
    res.json({
      job: { ...job.toJSONFor({ userId: req.user?._id }), distanceKm },
      fraisDeblocage: getUnlockFee(),
      devise: getCurrency(),
      paiementConfigure: isPaymentConfigured(),
      abonnementActif: Boolean(abonnement),
      abonnement: abonnement ? abonnement.toPublicJSON() : null,
    });
  })
);

export default router;





