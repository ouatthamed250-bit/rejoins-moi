// validators.js — Validation centrale des entrées API (téléphone ivoirien, photos, tags).
//
// Décision produit (§5 du cahier des charges, assouplie le 30/09) : l'inscription
// établissement demande DEUX photos distinctes (devanture + vendeur/gérant), mais
// elles sont RECOMMANDÉES et non plus bloquantes. Sur la tournée terrain, il arrive
// qu'on n'ait pas la photo sous la main ou que le réseau lâche : une fiche sans
// photo — complétée plus tard depuis /profil — vaut mieux qu'un compte perdu.
// La validation ci-dessous refuse uniquement une valeur fournie qui n'est pas une
// image valide, ou deux photos identiques (devanture = vendeur).
//
// Stockage des images : le squelette ne prévoit pas de service de stockage objet.
// On accepte donc soit une URL https (Cloudinary/S3 en production), soit une
// data-URI `data:image/...;base64,...` (pratique pour la tournée terrain quand
// l'upload réseau est instable). Taille limitée à ~4 Mo par image.
// -> À MIGRER vers Cloudinary/S3 avant lancement public : garder uniquement
//    l'URL et supprimer le base64 (poids inutile en base et dans les réponses).

const IMAGE_DATA_URI = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i;
const IMAGE_URL = /^https?:\/\/.+/i;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024 * 1.37; // ~4 Mo binaire -> base64

/** Normalise un numéro ivoirien en format international +225XXXXXXXXXX. */
export function normalizePhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+225')) digits = digits.slice(4);
  else if (digits.startsWith('225') && digits.length > 8) digits = digits.slice(3);
  digits = digits.replace(/^0+/, '');
  // Numéros ivoiriens : 8 chiffres après refonte de 2021 (ex. 07 07 12 34 56 -> 0707123456)
  if (!/^\d{8,10}$/.test(digits)) return null;
  return `+225${digits}`;
}

export function isValidPhoto(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const v = value.trim();
  if (IMAGE_URL.test(v)) return true;
  if (v.length > MAX_IMAGE_CHARS) return false;
  return IMAGE_DATA_URI.test(v);
}

/**
 * Valide les deux photos d'une inscription / mise à jour d'établissement.
 *
 * Photos FACULTATIVES (depuis le 30/09) : une chaîne vide est acceptée, c'est le
 * « Ajouter plus tard » du formulaire (pas de photo sous la main pendant la
 * tournée). Ce qui reste refusé :
 *   - une valeur fournie qui n'est ni une URL http(s) ni une data-URI d'image ;
 *   - deux photos identiques (devanture = vendeur), qui n'apportent rien.
 *
 * @returns {{ok: boolean, error?: string}}
 */
export function validateEstablishmentPhotos(photoDevanture, photoVendeur) {
  const devanture = String(photoDevanture ?? '').trim();
  const vendeur = String(photoVendeur ?? '').trim();

  if (devanture && !isValidPhoto(devanture)) {
    return {
      ok: false,
      error: 'La photo de la devanture n’est pas une image valide (JPEG/PNG ou URL d’image).',
    };
  }
  if (vendeur && !isValidPhoto(vendeur)) {
    return {
      ok: false,
      error: 'La photo du vendeur / gérant n’est pas une image valide (JPEG/PNG ou URL d’image).',
    };
  }
  if (devanture && vendeur && devanture === vendeur) {
    return {
      ok: false,
      error: 'Les deux photos doivent être distinctes (devanture et vendeur/gérant).',
    };
  }
  return { ok: true };
}

/** Nettoie une liste de tags : trim, dédoublonnage insensible à la casse, max 20. */
export function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const t = String(raw || '').trim();
    if (!t || t.length > 40) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

/** Clamp une note d'avis entre 1 et 5. */
export function clampNote(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  if (v < 1 || v > 5) return null;
  return v;
}

/** Texte du bouton d'action dynamique (§5) : "Aller chez Chez Fatou". */
export function buildActionLabel(nom, custom) {
  const clean = String(custom || '').trim();
  if (clean) return clean;
  const n = String(nom || '').trim() || 'cet établissement';
  return `Aller chez ${n}`;
}

/** Échappe une chaîne utilisée dans une RegExp (recherche mot-clé utilisateur). */
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  normalizePhone,
  isValidPhoto,
  validateEstablishmentPhotos,
  sanitizeTags,
  clampNote,
  buildActionLabel,
  escapeRegex,
};
