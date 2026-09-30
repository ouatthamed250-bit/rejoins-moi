// subscriptions.js — Abonnement (cahier des charges, ajout du 29/09)
//
// Endpoints :
//   GET    /api/subscriptions/formules            -> formules proposées + prix + périodicité
//   GET    /api/subscriptions/moi                 -> abonnement en cours de l'utilisateur
//   POST   /api/subscriptions/souscrire           -> souscrire / renouveler (paiement CinetPay)
//   POST   /api/subscriptions/resilier            -> arrêter le renouvellement (accès jusqu'à l'échéance)
//   POST   /api/subscriptions/webhook/cinetpay    -> notification serveur-à-serveur CinetPay
//
// MODÈLE ÉCONOMIQUE : l'abonnement COHABITE avec le paiement à l'unité de 500 FCFA
// (routes/jobs.js). Un abonné ne paie plus rien au contact ; un non-abonné continue
// de payer 500 FCFA par déblocage. Les prix et périodicités vivent EXCLUSIVEMENT dans
// config/abonnement.js (provisoires à ce jour).
//
// DEUX FORMULES EN PARALLÈLE (semaine 7 j / mois 30 j, ajout du 29/09) : le client
// envoie `formule` (« artisan_hebdo » ou « artisan_mensuel »). Une clé inconnue est
// refusée en 400 et une formule retirée de la vente en 409 — jamais de repli silencieux
// sur un autre tarif. Le montant transmis à CinetPay est celui de la formule résolue.
//
// ⚠️ AUCUN FAUX PAIEMENT : sans clés CinetPay côté serveur, `isPaymentConfigured()`
// est false, la route répond 501 et AUCUN abonnement n'est activé. C'est toujours le
// serveur qui vérifie la transaction auprès de CinetPay avant d'ouvrir l'accès.

import express from 'express';
import Subscription from '../models/Subscription.js';
import { protect } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { getFormule, getFormules, getDeviseAbonnement, dureeJoursFormule, getFormuleStricte, estFormuleActive, PERIODICITES_ACTIVES, CATALOGUE, FORMULE_PAR_DEFAUT } from '../config/abonnement.js';
import {
  initiatePayment,
  confirmPayment,
  verifyNotifySignature,
  isPaymentConfigured,
  normalizeChannel,
  PaymentError,
} from '../services/cinetpay.js';

const router = express.Router();

// `requireDb` est appliqué route par route (et non au routeur entier) : le catalogue
// des formules doit rester lisible même si MongoDB est indisponible, pour que le
// frontend affiche le bon prix au lieu de le deviner.

/** Canaux proposés à l'utilisateur (miroir de CINETPAY_CHANNELS). */
const OPERATEURS = ['Wave', 'Orange Money', 'MTN MoMo', 'Moov Money'];

/** Référence métier transmise à CinetPay : « abo:<formule>:user:<userId> ». */
function metadataAbonnement(formule, userId) {
  return `abo:${formule}:user:${userId}`;
}

/**
 * GET /api/subscriptions/formules — catalogue public.
 * Le frontend lit le prix ICI : il n'y a donc qu'un seul endroit à modifier pour
 * changer les tarifs (backend/src/config/abonnement.js), même en production.
 * Deux formules sont proposées (semaine + mois) tant que le tarif n'est pas tranché.
 */
router.get('/formules', (req, res) => {
  res.json({
    formules: getFormules(),
    formuleParDefaut: FORMULE_PAR_DEFAUT.cle,
    periodicitesActives: PERIODICITES_ACTIVES,
    catalogue: CATALOGUE,
    devise: getDeviseAbonnement(),
    paiementConfigure: isPaymentConfigured(),
    operateurs: OPERATEURS,
  });
});

/**
 * Résout la formule demandée par le client en REFUSANT tout ce qui n'est pas
 * encaissable : clé inconnue (400) ou formule retirée de la vente par configuration
 * (409). On ne retombe JAMAIS silencieusement sur un autre tarif : un artisan ne
 * doit pas pouvoir payer 700 FCFA en croyant acheter un mois.
 *
 * @param {string|undefined} demande `formule` envoyée par le client
 * @returns {object} la formule résolue (avec `cle`, `prixFcfa`, `periodicite`)
 * @throws {ApiError}
 */
function resoudreFormule(demande) {
  if (!demande) return FORMULE_PAR_DEFAUT;
  const formule = getFormuleStricte(demande);
  if (!formule) {
    throw new ApiError(400, `Formule d’abonnement inconnue : « ${demande} ».`, {
      formulesDisponibles: getFormules().map((f) => f.cle),
    });
  }
  if (!estFormuleActive(formule.cle)) {
    throw new ApiError(
      409,
      `La formule « ${formule.libelle} » n’est pas proposée en ce moment.`,
      { formulesDisponibles: getFormules().map((f) => f.cle), periodicitesActives: PERIODICITES_ACTIVES }
    );
  }
  return formule;
}

/**
 * GET /api/subscriptions/moi — état d'abonnement de l'utilisateur connecté.
 * `abonnement: null` signifie simplement « pas d'abonnement en cours ».
 */
router.get(
  '/moi',
  requireDb,
  protect,
  asyncHandler(async (req, res) => {
    const actif = await Subscription.trouverActif(req.user._id);
    const derniers = await Subscription.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(5);
    res.json({
      abonnement: actif ? actif.toPublicJSON() : null,
      abonnementActif: Boolean(actif),
      historique: derniers.map((d) => d.toPublicJSON()),
      formules: getFormules(),
      formuleParDefaut: FORMULE_PAR_DEFAUT.cle,
      periodicitesActives: PERIODICITES_ACTIVES,
      catalogue: CATALOGUE,
      devise: getDeviseAbonnement(),
      paiementConfigure: isPaymentConfigured(),
      operateurs: OPERATEURS,
    });
  })
);

/**
 * POST /api/subscriptions/souscrire — souscrire (ou renouveler) l'abonnement.
 * body: { formule?, transactionId?, moyenPaiement?, renouveler? }
 *
 * Déroulé identique au déblocage de contact (routes/jobs.js), pour que
 * l'utilisateur vive la même chose dans les deux cas :
 *   A. abonnement en cours et `renouveler: false` -> on renvoie l'état, rien à payer ;
 *   B. sans `transactionId` -> initialisation CinetPay, réponse 202 avec `paymentUrl` ;
 *   C. avec `transactionId` -> vérification auprès de CinetPay (seule source de
 *      vérité) puis activation / prolongation de la période.
 * Si la passerelle n'est pas configurée : HTTP 501, aucun abonnement activé.
 */
router.post(
  '/souscrire',
  requireDb,
  protect,
  asyncHandler(async (req, res) => {
    // `resoudreFormule` refuse (400/409) une clé inconnue ou une formule retirée de
    // la vente : le montant envoyé à CinetPay est donc toujours celui affiché.
    const formule = resoudreFormule(req.body?.formule);
    const montant = formule.prixFcfa;
    const devise = getDeviseAbonnement();
    const dureeJours = dureeJoursFormule(formule.cle);
    const transactionId = req.body?.transactionId;
    const renouveler = req.body?.renouveler !== false;

    // ── Cas A : déjà abonné, on ne prélève rien de plus ──
    if (!transactionId && !renouveler) {
      const actif = await Subscription.trouverActif(req.user._id);
      if (actif) {
        return res.json({
          abonnement: actif.toPublicJSON(),
          abonnementActif: true,
          paiementRequis: false,
          message: `Votre ${formule.libelle} est déjà actif.`,
        });
      }
    }

    if (!isPaymentConfigured()) {
      throw new ApiError(
        501,
        "Le paiement Wave / Orange Money n'est pas encore activé sur cet environnement. Renseignez CINETPAY_API_KEY et CINETPAY_SITE_ID (backend/.env) pour activer les abonnements."
      );
    }

    try {
      if (!transactionId) {
        const init = await initiatePayment({
          amount: montant,
          description: `Rejoins'Moi — ${formule.libelle}`,
          customerName: req.user.nomComplet || req.user.telephone,
          customerPhone: req.user.telephone,
          metadata: metadataAbonnement(formule.cle, req.user._id),
        });
        return res.status(202).json({
          abonnementActif: false,
          paiementRequis: true,
          formule: formule.cle,
          montant,
          devise,
          dureeJours,
          periodicite: formule.periodicite,
          transactionId: init.transactionId,
          paymentUrl: init.paymentUrl,
          operateurs: OPERATEURS,
          message: `Finalisez le paiement de ${montant} ${devise} sur Wave ou Orange Money, puis revenez dans l'application pour activer votre abonnement.`,
        });
      }

      // ── Cas C : vérification — seule source de vérité ──
      const verification = await confirmPayment(transactionId);
      if (!verification.accepted) {
        throw new ApiError(
          402,
          `Paiement non confirmé (statut : ${verification.status}). Aucun abonnement n'a été activé.`,
          { statut: verification.status }
        );
      }

      const abonnement = await Subscription.activerOuProlonger({
        userId: req.user._id,
        formule: formule.cle,
        montant,
        devise,
        moyenPaiement: normalizeChannel(verification.paymentMethod || req.body?.moyenPaiement),
        transactionId,
      });

      req.user.ajouterInteraction({ type: 'contact', terme: `abonnement:${formule.cle}` });
      await req.user.save().catch(() => {});

      return res.status(201).json({
        abonnementActif: true,
        paiementRequis: false,
        abonnement: abonnement.toPublicJSON(),
        montantPaye: montant,
        devise,
        transactionId,
        message:
          'Abonnement actif : offres de boulot, demandes de main-d’œuvre et mise en avant de votre profil sont débloqués.',
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
 * POST /api/subscriptions/resilier — arrête le RENOUVELLEMENT.
 * Choix produit à valider : l'accès courant n'est pas coupé, il court jusqu'à
 * `finAt` (la période est payée).
 */
router.post(
  '/resilier',
  requireDb,
  protect,
  asyncHandler(async (req, res) => {
    const actif = await Subscription.trouverActif(req.user._id);
    if (!actif) throw new ApiError(404, 'Aucun abonnement en cours à résilier.');

    actif.statut = 'annule';
    actif.renouvellementAuto = false;
    await actif.save();

    res.json({
      abonnement: actif.toPublicJSON(),
      abonnementActif: actif.estActifMaintenant(),
      message: 'Renouvellement arrêté. Votre abonnement reste actif jusqu’à son échéance.',
    });
  })
);

/**
 * POST /api/subscriptions/webhook/cinetpay — notification serveur-à-serveur.
 * Sécurisée par la signature HMAC-SHA256 (en-tête `x-token`) lorsque
 * CINETPAY_SECRET_KEY est configurée. Metadata attendue : « abo:<formule>:user:<id> ».
 */
router.post(
  '/webhook/cinetpay',
  requireDb,
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-token'] || req.headers['x-signature'];
    if (!verifyNotifySignature(req.rawBody || JSON.stringify(req.body || {}), signature)) {
      return res.status(401).json({ error: 'Signature CinetPay invalide.' });
    }

    const transactionId = req.body?.cpm_trans_id || req.body?.transaction_id;
    const metadata = req.body?.cpm_custom || req.body?.metadata || '';
    const [prefixe, formule, , userId] = String(metadata).split(':');

    if (prefixe !== 'abo' || !userId) {
      return res.status(202).json({ received: true, ignored: 'metadata non exploitable' });
    }

    try {
      const verification = await confirmPayment(transactionId);
      if (!verification.accepted) {
        return res.status(202).json({ received: true, statut: verification.status });
      }
      const abonnement = await Subscription.activerOuProlonger({
        userId,
        formule,
        montant: verification.amount || getFormule(formule).prixFcfa,
        devise: getDeviseAbonnement(),
        moyenPaiement: normalizeChannel(verification.paymentMethod || req.body?.cpm_payment_method),
        transactionId,
      });
      return res.json({ received: true, abonnementActif: true, finAt: abonnement.finAt });
    } catch (err) {
      // 200 pour éviter les re-essais en boucle du webhook, mais on journalise.
      console.error('[subscriptions] webhook cinetpay :', err.message);
      return res.status(200).json({ received: true, erreur: err.message });
    }
  })
);

export default router;

