// cinetpay.js — Passerelle de paiement mobile money (Wave + Orange Money)
//
// CAHIER DES CHARGES §2 : le déblocage d'un contact main-d'œuvre coûte 500 FCFA,
// payés via Wave ou Orange Money. On passe par **CinetPay**, passerelle de
// référence en Côte d'Ivoire qui agrège Wave, Orange Money, MTN MoMo et Moov
// Money — évite d'intégrer 2 API opérateurs distinctes et couvre le marché.
//
// ⚠️ IMPORTANT — AUCUN FAUX PAIEMENT ICI :
// Il n'y a pas de simulation de succès. Sans clés CinetPay configurées
// (CINETPAY_API_KEY / CINETPAY_SITE_ID), `initiatePayment()` lève une erreur
// explicite `PAYMENT_NOT_CONFIGURED` et la route répond 501. Le mode "sandbox"
// de CinetPay (clés de test fournies par la passerelle) est le SEUL moyen de
// tester une transaction avant mise en production, et il nécessite quand même
// des clés réelles de test obtenues sur cinetpay.com.
//
// Documentation officielle :
//   - Initialisation : POST https://api-checkout.cinetpay.com/v2/payment
//   - Vérification  : POST https://api-checkout.cinetpay.com/v2/payment/check
//   - Webhook NOTIFY : champs cpm_trans_id, cpm_result, cpm_amount...
//
// Flux implémenté (voir routes/jobs.js POST /:id/unlock-contact) :
//   1. Le frontend appelle initiatePayment() -> on renvoie `payment_url` + `transaction_id`.
//   2. L'utilisateur paie sur Wave/Orange Money (page CinetPay ou app opérateur).
//   3. Retour app -> confirmPayment(transaction_id) qui interroge CinetPay (source de vérité).
//   4. En parallèle, le webhook /api/jobs/webhook/cinetpay confirme côté serveur.
// Le contact n'est JAMAIS révélé sur la seule foi du retour navigateur : on
// revérifie toujours auprès de l'API CinetPay avant de débloquer.

import crypto from 'node:crypto';

const API_BASE = 'https://api-checkout.cinetpay.com/v2';

export class PaymentError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.details = details;
  }
}

export function isPaymentConfigured() {
  return Boolean(process.env.CINETPAY_API_KEY && process.env.CINETPAY_SITE_ID);
}

export function getUnlockFee() {
  return Number(process.env.CONTACT_UNLOCK_FEE || 500);
}

export function getCurrency() {
  return process.env.CURRENCY || 'XOF';
}

function requireConfig() {
  if (!isPaymentConfigured()) {
    throw new PaymentError(
      'PAYMENT_NOT_CONFIGURED',
      "Paiement mobile money non configuré : renseignez CINETPAY_API_KEY et CINETPAY_SITE_ID dans backend/.env (voir .env.example). Aucun paiement ne peut être simulé."
    );
  }
}

function buildTransactionId(prefix = 'RM') {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${Date.now()}-${rand}`;
}

/** URL d'itinéraire Google Maps (utilisée par les fiches établissement et santé). */
export function buildItineraryUrl(lat, lng) {
  const dest = `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}

/**
 * Étape 1 — Initialise un paiement CinetPay et renvoie l'URL de paiement.
 *
 * @param {object} params
 * @param {number} params.amount      Montant en FCFA (500 par défaut)
 * @param {string} params.description Libellé affiché à l'utilisateur
 * @param {string} params.customerName
 * @param {string} params.customerPhone Numéro ivoirien (format +225XXXXXXXX)
 * @param {string} [params.transactionId] Id existant (idempotence)
 * @param {string} [params.metadata]  Référence métier (ex. job:<id>:user:<id>)
 * @returns {Promise<{transactionId: string, paymentUrl: string, raw: object}>}
 */
export async function initiatePayment({
  amount,
  description,
  customerName,
  customerPhone,
  transactionId,
  metadata,
}) {
  requireConfig();

  const txId = transactionId || buildTransactionId();
  const body = {
    apikey: process.env.CINETPAY_API_KEY,
    site_id: process.env.CINETPAY_SITE_ID,
    transaction_id: txId,
    amount: Number(amount),
    currency: getCurrency(),
    description: String(description || "Rejoins'Moi — déblocage de contact").slice(0, 100),
    notify_url: process.env.CINETPAY_NOTIFY_URL || undefined,
    return_url: process.env.CINETPAY_RETURN_URL || 'http://localhost:5173/main-doeuvre',
    channels: process.env.CINETPAY_CHANNELS || 'WAVE,ORANGE_MONEY',
    lang: 'fr',
    metadata: metadata || '',
    customer_name: customerName || "Utilisateur Rejoins'Moi",
    customer_phone_number: customerPhone || '',
    customer_email: '',
    customer_address: 'Abidjan',
    customer_city: 'Abidjan',
    customer_country: 'CI',
    customer_state: 'CI',
    customer_zip_code: '00225',
  };

  let json;
  try {
    const res = await fetch(`${API_BASE}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    json = await res.json();
  } catch (err) {
    throw new PaymentError('PAYMENT_GATEWAY_UNREACHABLE', `Passerelle CinetPay injoignable : ${err.message}`);
  }

  if (json?.code !== '201' || !json?.data?.payment_url) {
    throw new PaymentError(
      'PAYMENT_INIT_FAILED',
      json?.message || "CinetPay a refusé l'initialisation du paiement.",
      json
    );
  }

  return {
    transactionId: json.data.payment_token || txId,
    paymentUrl: json.data.payment_url,
    raw: json,
  };
}

/**
 * Étape 2/3 — Vérifie le statut réel d'une transaction auprès de CinetPay.
 * C'est la SEULE source de vérité pour débloquer un contact.
 *
 * @returns {Promise<{accepted: boolean, status: string, amount: number|null, paymentMethod: string|null, raw: object}>}
 */
export async function confirmPayment(transactionId) {
  requireConfig();
  if (!transactionId) {
    throw new PaymentError('TRANSACTION_ID_REQUIRED', 'transaction_id manquant pour la vérification.');
  }

  let json;
  try {
    const res = await fetch(`${API_BASE}/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_API_KEY,
        site_id: process.env.CINETPAY_SITE_ID,
        transaction_id: transactionId,
      }),
    });
    json = await res.json();
  } catch (err) {
    throw new PaymentError('PAYMENT_GATEWAY_UNREACHABLE', `Vérification CinetPay impossible : ${err.message}`);
  }

  const status = json?.data?.status || json?.message || 'UNKNOWN';
  const accepted = status === 'ACCEPTED' && String(json?.code) === '00';

  return {
    accepted,
    status,
    amount: json?.data?.amount != null ? Number(json.data.amount) : null,
    paymentMethod: json?.data?.payment_method || null,
    operatorId: json?.data?.operator_id || null,
    raw: json,
  };
}

/**
 * Webhook CinetPay : CinetPay POST le résultat sur `notify_url`.
 * En production, on vérifie en plus la signature HMAC-SHA256 transmise dans
 * l'en-tête `x-token` avec CINETPAY_SECRET_KEY.
 */
export function verifyNotifySignature(rawBody, headerToken) {
  if (!process.env.CINETPAY_SECRET_KEY) return true; // non configuré : on ne bloque pas en dev
  try {
    const hmac = crypto
      .createHmac('sha256', process.env.CINETPAY_SECRET_KEY)
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');
    return hmac === headerToken;
  } catch {
    return false;
  }
}

/** Normalise le nom de l'opérateur CinetPay vers nos valeurs de modèle. */
export function normalizeChannel(rawChannel) {
  const c = String(rawChannel || '').toUpperCase();
  if (c.includes('WAVE')) return 'WAVE';
  if (c.includes('ORANGE')) return 'ORANGE_MONEY';
  if (c.includes('MTN')) return 'MTN_MOMO';
  if (c.includes('MOOV')) return 'MOOV_MONEY';
  return 'WAVE';
}

export default {
  initiatePayment,
  confirmPayment,
  verifyNotifySignature,
  isPaymentConfigured,
  getUnlockFee,
  getCurrency,
  normalizeChannel,
  buildItineraryUrl,
  PaymentError,
};
