// PhotoUploadField.jsx — Champ d'upload d'une photo (utilisé 2 fois à l'inscription, §5).
//
// Contrainte produit : l'inscription établissement exige DEUX photos distinctes et
// obligatoires (devanture du local + personne qui vend). Ce composant est donc
// appelé deux fois avec des libellés différents, et le formulaire refuse de passer
// à l'étape suivante si l'une des deux manque.
//
// Décisions techniques pour le terrain :
//  - `capture="environment"` : sur Android, ouvre directement l'appareil photo
//    arrière (le gérant prend sa devanture sur place pendant la tournée terrain).
//  - Compression côté navigateur AVANT envoi (max 1000 px, JPEG qualité 0,72) :
//    une photo de smartphone pèse 3-5 Mo ; compressée elle passe sous 250 Ko, ce
//    qui la rend envoyable en 3G et évite de saturer la limite de 12 Mo de l'API.
//  - Aperçu immédiat avec possibilité de retirer/remplacer : indispensable quand
//    la photo prise est floue.

import { useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

const TAILLE_MAX_PX = 1000;
const QUALITE_JPEG = 0.72;

/**
 * Redimensionne et compresse une image en data-URI JPEG.
 * @returns {Promise<string>} data-URI prête à envoyer à l'API
 */
export function compresserImage(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    lecteur.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Fichier image illisible.'));
      image.onload = () => {
        const ratio = Math.min(1, TAILLE_MAX_PX / Math.max(image.width, image.height));
        const largeur = Math.round(image.width * ratio);
        const hauteur = Math.round(image.height * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = largeur;
        canvas.height = hauteur;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, largeur, hauteur);
        resolve(canvas.toDataURL('image/jpeg', QUALITE_JPEG));
      };
      image.src = String(lecteur.result);
    };
    lecteur.readAsDataURL(fichier);
  });
}

/**
 * @param {{ label: string, indication?: string, value?: string, onChange: (dataUri:string)=>void,
 *   requis?: boolean, erreur?: string }} props
 */
export default function PhotoUploadField({
  label,
  indication = '',
  value = '',
  onChange,
  requis = true,
  erreur = '',
}) {
  const champ = useRef(null);
  const [enCours, setEnCours] = useState(false);
  const [erreurLocale, setErreurLocale] = useState('');

  async function gererFichier(evt) {
    const fichier = evt.target.files?.[0];
    if (!fichier) return;
    setErreurLocale('');
    setEnCours(true);
    try {
      if (!fichier.type.startsWith('image/')) throw new Error('Choisissez une image (photo).');
      const compressee = await compresserImage(fichier);
      onChange(compressee);
    } catch (err) {
      setErreurLocale(err.message || "Impossible de traiter cette photo.");
    } finally {
      setEnCours(false);
      // Permet de re-sélectionner le même fichier après une erreur.
      if (champ.current) champ.current.value = '';
    }
  }

  const message = erreur || erreurLocale;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-sm font-bold text-ink">
          {label} {requis && <span className="text-danger">*</span>}
        </label>
        {value && (
          <button
            type="button"
            className="text-xs font-semibold text-primary underline"
            onClick={() => onChange('')}
          >
            Retirer
          </button>
        )}
      </div>
      {indication && <p className="mb-2 text-xs text-ink-muted">{indication}</p>}

      <button
        type="button"
        onClick={() => champ.current?.click()}
        className={`relative flex w-full items-center justify-center overflow-hidden rounded-md border-2 border-dashed transition ${
          value ? 'border-primary/40' : 'border-line hover:border-primary/60'
        } ${message ? 'border-danger' : ''}`}
        style={{ minHeight: 168 }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="h-44 w-full object-cover" />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
              Remplacer
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 py-8 text-ink-muted">
            <Icon name="camera" size={28} className="text-primary" />
            <span className="text-sm font-semibold">
              {enCours ? 'Traitement de la photo…' : 'Prendre une photo ou en choisir une'}
            </span>
            <span className="text-xs">JPEG/PNG — compressée automatiquement</span>
          </span>
        )}
        {enCours && <span className="absolute inset-0 animate-pulse bg-white/70" />}
      </button>

      {message && <p className="mt-1 text-xs font-semibold text-danger">{message}</p>}

      <input
        ref={champ}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={gererFichier}
      />
    </div>
  );
}
