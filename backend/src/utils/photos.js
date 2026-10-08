// photos.js — Poids des images dans les réponses API (bloc A, correction de lancement).
//
// PROBLÈME MESURÉ : les photos d'établissement peuvent être stockées en data-URI
// base64 (utile pendant la tournée terrain, quand l'upload réseau est instable —
// voir utils/validators.js). Un document de ce type pèse jusqu'à ~5,5 Mo de JSON.
// Tant qu'une LISTE renvoyait `photoDevanture` tel quel, une seule fiche inscrite
// depuis le téléphone suffisait à faire passer la page d'accueil de 20 Ko à
// plusieurs mégaoctets — c'est-à-dire, sur un réseau ivoirien, une liste qui
// n'arrive jamais.
//
// DÉCISION : une liste (`GET /api/establishments`) ne transporte JAMAIS l'image
// elle-même. Elle transporte :
//   - soit l'URL https légère de l'hébergeur (déjà le cas pour les fiches seedées) ;
//   - soit l'URL de la route dédiée `GET /api/establishments/:id/photo/:role`, qui
//     sert l'image binaire et se met en cache navigateur (une seule fois par photo).
//
// Le frontend utilise ces URL comme `src` d'une balise <img> : le navigateur charge
// l'image en flux, la garde en cache, et le JSON reste petit (Ko, pas Mo).

/** Vrai si la valeur porte l'image elle-même (data-URI base64), et non une URL. */
export function estImageIntegree(valeur) {
  return /^data:image\//i.test(String(valeur || '').trim());
}

/** Vrai si la valeur est une URL http(s) exploitable telle quelle par le navigateur. */
export function estUrlDistante(valeur) {
  return /^https?:\/\//i.test(String(valeur || '').trim());
}

/**
 * Construit l'URL publique qui sert une photo d'établissement.
 * `base` provient de la requête (`https://hote`) : indispensable, car le frontend
 * est servi par un autre domaine (Vercel) et une URL relative pointerait chez lui.
 */
export function urlPhotoEtablissement(base, id, role) {
  const prefixe = String(base || '').replace(/\/$/, '');
  return `${prefixe}/api/establishments/${id}/photo/${role === 'vendeur' ? 'vendeur' : 'devanture'}`;
}

/**
 * Forme CIRCULABLE d'une photo pour une liste : jamais de base64.
 * @returns {{valeur: string, url: string}} `valeur` = URL https ou '' ; `url` = à utiliser comme `src`.
 */
export function photoLegere(valeur, base, id, role) {
  const v = String(valeur || '').trim();
  if (!v) return { valeur: '', url: '' };
  if (estUrlDistante(v)) return { valeur: v, url: v };
  if (estImageIntegree(v)) return { valeur: '', url: urlPhotoEtablissement(base, id, role) };
  // Valeur inconnue (ni URL ni data-URI) : on ne la transporte pas non plus.
  return { valeur: '', url: '' };
}

/**
 * Décode une data-URI image en octets, pour la route qui sert la photo.
 * @returns {{buffer: Buffer, contentType: string}|null}
 */
export function decoderPhoto(valeur) {
  const correspondance = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(valeur || '').trim());
  if (!correspondance) return null;
  try {
    const buffer = Buffer.from(correspondance[2], 'base64');
    if (!buffer.length) return null;
    return { buffer, contentType: correspondance[1].toLowerCase() };
  } catch {
    return null;
  }
}

/** Poids approximatif (octets) de l'image portée par une valeur, sans la décoder. */
export function poidsEstimeOctets(valeur) {
  const v = String(valeur || '').trim();
  if (!v) return 0;
  if (estImageIntegree(v)) {
    const separateur = v.indexOf(',');
    return separateur === -1 ? v.length : Math.floor((v.length - separateur - 1) * 0.75);
  }
  return v.length; // URL : quelques dizaines d'octets
}

export default {
  estImageIntegree,
  estUrlDistante,
  urlPhotoEtablissement,
  photoLegere,
  decoderPhoto,
  poidsEstimeOctets,
};
