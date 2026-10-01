// PhotoSecours.jsx — Visuel de remplacement quand un établissement n'a PAS de photo.
//
// Pourquoi un composant séparé ? Le cas se produit à DEUX endroits (la carte du
// feed/résultats et l'en-tête de la fiche) et la consigne visuelle est la même :
// plus jamais d'aplat orange plein.
//
// v2 (30/09) : AVANT, l'absence de photo affichait un dégradé orange PLEIN
// (`from-primary-light to-primary-dark`) sur toute la surface. Or la grande
// majorité des fiches importées n'ont pas de photo : le feed devenait une
// succession de gros pavés orange — exactement ce que la refonte veut supprimer.
// MAINTENANT le fond reste ivoire (ivoire pâle qui glisse vers le blanc) et
// l'orange ne revient que par trois petites touches : la pastille d'icône, son
// liseré et le nom.
//
// L'attribut `data-photo-secours` est un repère stable : il documente le cas dans
// le DOM et permet aux vérifications automatiques (scripts/capture-ecrans.mjs) de
// prouver qu'aucun pavé orange ne subsiste.

import { Icon } from './Icons.jsx';

/**
 * @param {{ nom?: string, className?: string, compact?: boolean }} props
 *   nom       : nom de l'établissement (affiché sur les grands formats)
 *   className : dimensions et arrondis, imposés par l'appelant (h-44 w-full…)
 *   compact   : true pour une petite vignette (86×86 des résultats de recherche) :
 *               pastille seule, le nom n'y tiendrait pas lisiblement
 */
export default function PhotoSecours({ nom = '', className = '', compact = false }) {
  return (
    <div
      data-photo-secours=""
      className={`flex flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-b from-soft to-white ring-1 ring-inset ring-line ${className}`}
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-card ring-1 ring-primary/20 ${
          compact ? 'h-8 w-8' : 'h-14 w-14'
        }`}
      >
        <Icon name="store" size={compact ? 16 : 26} />
      </span>
      {!compact && (
        <span className="max-w-[85%] text-center text-sm font-bold uppercase leading-tight tracking-wide text-primary-dark">
          {nom}
        </span>
      )}
    </div>
  );
}
