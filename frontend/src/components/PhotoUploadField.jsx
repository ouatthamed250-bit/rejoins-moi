// PhotoUploadField.jsx — Champ d'upload d'une photo (utilisé 2 fois à l'inscription, §5).
//
// Contrainte produit : l'inscription établissement demande DEUX photos (devanture
// du local + personne qui vend). Depuis le 29/09, elles ne sont PLUS bloquantes :
// pendant la tournée terrain, il arrive qu'on n'ait pas la photo sous la main
// (ou que le réseau lâche au moment de l'envoi) — un compte ou une fiche ne doit
// jamais être perdu pour ça. Le champ propose donc « Ajouter plus tard » à côté
// de l'upload ; la photo pourra être ajoutée depuis la fiche, par le gérant.
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
 *   requis?: boolean, erreur?: string, libellePlusTard?: string, onPlusTard?: () => void }} props
 * `libellePlusTard` affiche un bouton d'échappement (« Ajouter plus tard ») : le
 * champ se replie et le parent reçoit une chaîne vide, donc aucune photo exigée.
 */
export default function PhotoUploadField({
  label,
  indication = '',
  value = '',
  onChange,
  requis = true,
  erreur = '',
  libellePlusTard = '',
  onPlusTard = null,
}) {
  const champ = useRef(null);
  const [enCours, setEnCours] = useState(false);
  const [erreurLocale, setErreurLocale] = useState('');
  // Le champ a été volontairement reporté : on ne montre plus l'énorme zone
  // d'upload, juste un rappel discret et un moyen de revenir en arrière.
  const [reporte, setReporte] = useState(false);

  async function gererFichier(evt) {
    const fichier = evt.target.files?.[0];
    if (!fichier) return;
    setErreurLocale('');
    setEnCours(true);
    try {
      if (!fichier.type.startsWith('image/')) throw new Error('Choisissez une image (photo).');
      const compressee = await compresserImage(fichier);
      setReporte(false);
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

      {reporte && !value ? (
        /* Échappement « Ajouter plus tard » : le champ se replie, la photo n'est
           pas exigée. On garde un moyen évident de revenir en arrière. */
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-line bg-soft/60 px-3 py-2.5">
          <span className="text-xs text-ink-muted">
            <span className="font-semibold text-ink">{label}</span> : à ajouter plus tard.
          </span>
          <button
            type="button"
            className="shrink-0 text-xs font-bold text-primary underline"
            onClick={() => setReporte(false)}
          >
            Ajouter maintenant
          </button>
        </div>
      ) : (
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
      )}

      {!value && !reporte && libellePlusTard && (
        /* Échappement visible : une photo manquante ne doit JAMAIS bloquer la
           création d'un compte ou d'une fiche (tournée terrain, réseau instable).
           On en fait un vrai bouton, pas un lien discret qu'on ne voit pas. */
        <button
          type="button"
          className="btn-ghost mt-2 w-full py-2 text-xs"
          onClick={() => {
            setReporte(true);
            if (onPlusTard) onPlusTard();
          }}
        >
          {libellePlusTard}
        </button>
      )}

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
