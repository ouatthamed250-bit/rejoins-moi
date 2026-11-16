// cloudinary.js — envoi direct des photos vers Cloudinary (upload NON SIGNÉ).
//
// POURQUOI un hébergeur d'images : jusqu'ici les photos partaient dans l'API en
// base64 et dormaient dans MongoDB — chaque liste de fiches transportait alors
// des mégaoctets. Désormais la photo va du téléphone vers Cloudinary, et le
// serveur ne stocke qu'une URL https (champ `photos` du modèle Establishment).
//
// POURQUOI non signé : le bundle JavaScript est téléchargeable par n'importe qui.
// Aucune clé secrète (api_secret) ne peut donc y vivre. Le preset `rejoinsmoi_unsigned`
// est public, mais il est limité côté compte Cloudinary (dossier imposé, format).
// Les règles produit (8 photos maximum, 300 Ko) sont, elles, tenues par
// l'application (compression avant envoi) et par les routes POST/PATCH.

const CLOUD_NAME = 'f4iwk8g6';
const UPLOAD_PRESET = 'rejoinsmoi_unsigned';
const URL_UPLOAD = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

/**
 * Envoie UNE image vers Cloudinary.
 *
 * @param {string|File} source data-URI (sortie de compresserImage) ou fichier
 * @returns {Promise<string>} l'URL https définitive (`secure_url`)
 * @throws {Error} message lisible par l'utilisateur si l'envoi échoue
 */
export async function uploaderVersCloudinary(source) {
  const formData = new FormData();
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', 'rejoinsmoi/photos');

  if (typeof source === 'string' || source instanceof File) {
    formData.append('file', source);
  } else {
    throw new Error('Source invalide pour l\'upload.');
  }

  const reponse = await fetch(URL_UPLOAD, { method: 'POST', body: formData });
  if (!reponse.ok) {
    const erreur = await reponse.json().catch(() => ({}));
    throw new Error(erreur?.error?.message || `Upload échoué (${reponse.status})`);
  }
  const donnees = await reponse.json();
  // Une réponse 200 sans `secure_url` ne sert à rien : on préfère une erreur
  // explicite à un lien mort enregistré dans la fiche.
  if (!donnees?.secure_url) throw new Error('Cloudinary n’a pas renvoyé d’URL pour cette photo.');
  return donnees.secure_url;
}

/**
 * Envoie plusieurs images en parallèle (max 8 par envoi).
 *
 * Tolérance aux pannes partielles : sur une connexion 3G de terrain, une photo
 * peut échouer seule. On garde celles qui sont passées et on ne lève une erreur
 * que si TOUTES ont échoué — sinon l'utilisateur perdrait son envoi entier alors
 * que la moitié était déjà téléversée.
 *
 * @param {Array<string|File>} sources
 * @returns {Promise<string[]>} les URL des photos réussies (dans l'ordre)
 */
export async function uploaderPlusieurs(sources) {
  if (sources.length > 8) throw new Error('Maximum 8 photos par envoi.');
  const resultats = await Promise.allSettled(sources.map((s) => uploaderVersCloudinary(s)));
  const urls = [];
  const erreurs = [];
  resultats.forEach((r, i) => {
    if (r.status === 'fulfilled') urls.push(r.value);
    else erreurs.push(`Photo ${i + 1} : ${r.reason?.message || 'échec'}`);
  });
  if (erreurs.length === sources.length) {
    throw new Error('Toutes les photos ont échoué : ' + erreurs.join(', '));
  }
  return urls;
}
