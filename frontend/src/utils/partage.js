// partage.js — Partage d'une fiche vers WhatsApp.
//
// WhatsApp est LE canal de transmission en Côte d'Ivoire : une fiche ne circule
// pas par e-mail, elle circule par une conversation. Deux chemins, un seul bouton :
//
//  - MOBILE : `navigator.share` ouvre la feuille de partage du système, où WhatsApp
//    figure en tête. L'utilisateur choisit SON contact, avec le geste qu'il connaît
//    déjà — rien à copier, rien à coller.
//  - DESKTOP (et tout navigateur sans `navigator.share`) : `wa.me/?text=…` ouvre
//    WhatsApp Web avec le message déjà rédigé. Aucune dépendance, aucun SDK, aucun
//    compte à connecter côté app : on n'utilise que les API standard du navigateur.
//
// Le lien est construit en ABSOLU et inclut le sous-dossier de déploiement
// (`import.meta.env.BASE_URL` : « /rejoins-moi/ » sur GitHub Pages, « / » en local).
// Un lien partagé doit s'ouvrir tel quel chez le destinataire, pas tomber sur une 404.

/**
 * Partage `texte` + `url` vers WhatsApp.
 * Ne rejette jamais : si la feuille native échoue ou est annulée, on retombe sur
 * `wa.me` (desktop et fallback).
 *
 * @param {{ texte?: string, url?: string }} contenu
 * @returns {Promise<void>}
 */
export function partagerWhatsApp({ texte, url }) {
  const message = `${texte}\n${url}`;
  const urlWa = `https://wa.me/?text=${encodeURIComponent(message)}`;
  // navigator.share si dispo (mobile natif), sinon wa.me (desktop + fallback)
  if (typeof navigator !== 'undefined' && navigator.share) {
    return navigator
      .share({ text: texte, url })
      .catch(() => {
        window.open(urlWa, '_blank', 'noopener,noreferrer');
      });
  }
  window.open(urlWa, '_blank', 'noopener,noreferrer');
  return Promise.resolve();
}

/**
 * Adresse publique d'une fiche (`/etablissement/<id>`), préfixée par le
 * sous-dossier de déploiement. `window.location.origin` seul donnerait
 * `https://…/etablissement/<id>`, donc une 404 sur GitHub Pages.
 *
 * @param {string} id
 * @returns {string}
 */
export function urlPartageFiche(id) {
  return `${window.location.origin}${import.meta.env.BASE_URL}etablissement/${id}`;
}

/**
 * Message qui accompagne le lien. Volontairement court et parlant : sur WhatsApp,
 * c'est la première ligne qu'on lit dans la conversation.
 *
 * @param {{ nom?: string, categorie?: string, commune?: string }} [etablissement]
 * @returns {string}
 */
export function textePartageFiche(etablissement) {
  const nom = etablissement?.nom || 'un établissement';
  const metier = etablissement?.categorie || '';
  const commune = etablissement?.commune || '';
  const morceaux = [`Découvre ${nom}`];
  if (metier) morceaux.push(`(${metier})`);
  if (commune) morceaux.push(`à ${commune}`);
  return `${morceaux.join(' ')} sur Rejoins’Moi — l’annuaire des artisans de quartier à Abidjan`;
}

export default { partagerWhatsApp, urlPartageFiche, textePartageFiche };
