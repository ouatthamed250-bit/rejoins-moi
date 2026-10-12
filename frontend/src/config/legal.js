// legal.js — Textes légaux et coordonnées de contact (bloc G du 12/10).
//
// RÈGLE DE CET ÉCRAN : on n'écrit QUE ce que l'application fait réellement.
// Il n'existe AUCUN bouton « supprimer mon compte » dans l'application : promettre
// « supprimez vos données depuis l'onglet Messages » était donc faux. La suppression
// et la correction passent par WhatsApp, où une personne répond et agit.
//
// Le numéro vit dans une SEULE constante de configuration (SUPPORT_WHATSAPP, dans
// config/paiement.js) : affichage, lien wa.me et page Mentions légales la réutilisent,
// donc changer le numéro à un endroit les met tous à jour.
//
// ⚠️ La mention « déclaration ARTCI en cours » a été RETIRÉE le 12/10 à la demande du
// fondateur : la déclaration n'est PAS déposée. Ne la remettre que le jour où elle
// l'est, avec la référence du dossier — une conformité annoncée à tort est un risque
// juridique, pas un argument commercial.

import { SUPPORT_WHATSAPP, enFormatWhatsapp } from './paiement.js';

/** Numéro du support, au format affiché (« 0554233234 »). */
export const NUMERO_SUPPORT = SUPPORT_WHATSAPP;

/**
 * Lien WhatsApp prêt à l'emploi.
 * Format international : « +225 0554233234 » -> « 2250554233234 » (le 0 initial fait
 * PARTIE du numéro ivoirien depuis la refonte de 2021 : on ne le supprime pas).
 */
export function lienWhatsapp(message = '') {
  const numero = enFormatWhatsapp(NUMERO_SUPPORT);
  const texte = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${numero}${texte}`;
}

/** Phrase UNIQUE, reprise mot pour mot sur tous les écrans. */
export const TEXTE_DONNEES = `Pour supprimer ou corriger vos données, écrivez-nous sur WhatsApp au ${NUMERO_SUPPORT}`;

/** Message pré-rempli : l'utilisateur n'a rien à rédiger, il appuie sur « envoyer ». */
export const MESSAGE_DONNEES =
  "Bonjour Rejoins'Moi, je souhaite supprimer ou corriger mes données inscrites dans l'application.";

/** Lien WhatsApp avec le message pré-rempli (suppression / correction des données). */
export const LIEN_DONNEES = lienWhatsapp(MESSAGE_DONNEES);

/** Lien WhatsApp pour une question générale. */
export const LIEN_SUPPORT = lienWhatsapp("Bonjour Rejoins'Moi, j'ai une question.");

export default {
  NUMERO_SUPPORT,
  TEXTE_DONNEES,
  MESSAGE_DONNEES,
  LIEN_DONNEES,
  LIEN_SUPPORT,
  lienWhatsapp,
};
