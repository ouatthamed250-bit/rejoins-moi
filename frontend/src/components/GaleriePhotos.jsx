// GaleriePhotos.jsx — galerie multi-photos d'un établissement (max 8).
//
// Décisions produit :
//  - HUIT photos EN PLUS de la devanture et du vendeur/gérant : la fiche garde ses
//    2 photos « officielles » (en-tête + médaillon) et la galerie raconte le lieu
//    (produits, intérieur, atelier…).
//  - L'ORDRE D'AJOUT EST L'ORDRE D'AFFICHAGE : on ajoute à la fin du tableau, on
//    ne trie jamais. La suppression décale simplement les suivantes.
//  - Compression AVANT envoi (compresserImage, plafond 300 Ko) : une photo de
//    smartphone pèse 3-5 Mo ; sans compression, l'envoi échoue en 3G et coûte
//    cher. C'est la même règle que les deux photos de la fiche.
//  - Envoi DIRECT vers Cloudinary (utils/cloudinary.js) : la photo ne traverse
//    jamais notre API, qui ne reçoit que des URL https.
//  - HEIC/HEIF (iPhone) refusé AVANT toute tentative, avec la marche à suivre :
//    le canvas ne sait pas les décoder (même message que PhotoUploadField).
//
// Le composant est CONTRÔLÉ : il ne détient pas la liste, seulement l'état
// d'envoi. Le parent garde `photos` et l'enregistre (création de fiche, ou
// PATCH /establishments/:id depuis la fiche).

import { useRef, useState } from 'react';

import { Icon } from './Icons.jsx';
import { compresserImage, estPhotoHeic, MESSAGE_HEIC } from './PhotoUploadField.jsx';
import { uploaderPlusieurs } from '../utils/cloudinary.js';

/**
 * Repasse une data-URI compressée en fichier binaire.
 * On envoie du binaire à Cloudinary (et non la chaîne base64) : 300 Ko de photo
 * font ~400 Ko en base64, soit un tiers de données en plus sur le réseau du
 * terrain, pour un résultat identique.
 */
async function dataUriVersFichier(dataUri, nom) {
  const reponse = await fetch(dataUri);
  const blob = await reponse.blob();
  const type = blob.type || 'image/jpeg';
  const nomFichier = String(nom || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
  if (typeof File === 'function') return new File([blob], nomFichier, { type });
  return blob; // navigateurs sans constructeur File : un Blob suffit à FormData
}

/**
 * @param {{ photos?: string[], onChange: (photos: string[]) => void, max?: number,
 *   desactive?: boolean }} props
 * `desactive` bloque ajout et suppression pendant que le parent enregistre.
 */
export default function GaleriePhotos({ photos = [], onChange, max = 8, desactive = false }) {
  const champ = useRef(null);
  const [envoi, setEnvoi] = useState(false);
  const [etape, setEtape] = useState('');
  const [erreur, setErreur] = useState('');

  const liste = Array.isArray(photos) ? photos : [];
  const restantes = Math.max(0, max - liste.length);
  const complet = restantes === 0;
  const bloque = desactive || envoi;

  function viderChamp() {
    if (champ.current) champ.current.value = '';
  }

  function ouvrirSelecteur() {
    if (bloque || complet || !champ.current) return;
    setErreur('');
    champ.current.click();
  }

  async function gererFichiers(evt) {
    const choisis = Array.from(evt.target.files || []);
    viderChamp();
    if (choisis.length === 0) return;
    setErreur('');

    // HEIC/HEIF : on écarte ces fichiers sans rien tenter (le canvas ne les décode pas).
    const utilisables = choisis.filter((f) => !estPhotoHeic(f));
    const nbHeic = choisis.length - utilisables.length;

    // Jamais plus de `restantes` photos : le parent enverrait un tableau de plus
    // de 8 URL, que le serveur refuserait (et l'utilisateur perdrait tout l'envoi).
    const retenus = utilisables.slice(0, restantes);

    if (retenus.length === 0) {
      if (nbHeic > 0) setErreur(MESSAGE_HEIC);
      else if (complet) setErreur(`Maximum ${max} photos : supprimez-en une pour en ajouter une autre.`);
      return;
    }

    setEnvoi(true);
    const avertissements = [];
    if (nbHeic > 0) avertissements.push(MESSAGE_HEIC);
    if (utilisables.length > retenus.length) {
      avertissements.push(`Seules ${retenus.length} photo(s) ont été ajoutées (maximum ${max}).`);
    }

    try {
      setEtape(`Compression de ${retenus.length} photo(s)…`);
      const fichiers = [];
      for (const fichier of retenus) {
        if (!String(fichier.type || '').startsWith('image/')) {
          throw new Error('Choisissez des images (photos).');
        }
        const dataUri = await compresserImage(fichier);
        fichiers.push(await dataUriVersFichier(dataUri, fichier.name));
      }

      setEtape(`Envoi de ${fichiers.length} photo(s)…`);
      const urls = await uploaderPlusieurs(fichiers);

      // Ajout À LA FIN : l'ordre d'ajout est l'ordre d'affichage.
      onChange([...liste, ...urls]);

      if (urls.length < fichiers.length) {
        avertissements.push(
          `${fichiers.length - urls.length} photo(s) n’ont pas pu être envoyées. Réessayez-les.`
        );
      }
      if (avertissements.length > 0) setErreur(avertissements.join(' '));
    } catch (err) {
      setErreur(err?.message || 'Envoi impossible pour le moment. Vérifiez votre connexion et réessayez.');
    } finally {
      setEnvoi(false);
      setEtape('');
    }
  }

  function retirer(index) {
    if (bloque) return;
    setErreur('');
    onChange(liste.filter((_, i) => i !== index));
  }

  return (
    <div className="w-full">
      {liste.length === 0 ? (
        <button
          type="button"
          onClick={ouvrirSelecteur}
          disabled={bloque}
          className="flex w-full flex-col items-center gap-1 rounded-md border-2 border-dashed border-line px-3 py-4 text-center text-ink-muted disabled:opacity-60"
        >
          <Icon name="image" size={26} className="text-primary" />
          <span className="text-xs">Produits, intérieur, atelier… jusqu’à {max} photos</span>
        </button>
      ) : (
        /* Grille de 2 colonnes, cases carrées : la même vignette sur tous les
           téléphones, quelle que soit la photo (portrait ou paysage). */
        <div className="grid grid-cols-2 gap-2">
          {liste.map((src, index) => (
            <div
              key={`${src}-${index}`}
              className="relative aspect-square overflow-hidden rounded-md border border-line bg-soft"
            >
              <img
                src={src}
                alt={`Photo ${index + 1}`}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label={`Supprimer la photo ${index + 1}`}
                disabled={bloque}
                onClick={() => retirer(index)}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-50"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-ink">
          {liste.length} / {max} photos
        </span>
        <button
          type="button"
          onClick={ouvrirSelecteur}
          disabled={bloque || complet}
          className="btn-ghost px-2 py-2 text-xs disabled:opacity-60"
        >
          <Icon name="plus" size={14} />
          {envoi ? 'Envoi…' : 'Ajouter une photo'}
        </button>
      </div>

      {envoi && (
        <p className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-ink-muted">
          <Icon name="loader" size={14} />
          {etape || 'Envoi en cours…'}
        </p>
      )}
      {!envoi && erreur && <p className="mt-1 text-xs font-semibold text-danger">{erreur}</p>}

      {/* `multiple` : on peut prendre plusieurs photos d'un coup ; chacune est
          compressée puis envoyée séparément (8 maximum, voir uploaderPlusieurs). */}
      <input
        ref={champ}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={gererFichiers}
      />
    </div>
  );
}
