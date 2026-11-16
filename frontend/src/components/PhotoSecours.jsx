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

//
// 03/10 — Dessin « crayon » de secours (accueil seulement) : une fiche sans photo
// montrait un fond ivoire avec une pastille ; c'est juste, mais muet. Le dessin du
// quartier vient se poser DERRIÈRE la pastille, dans le même volume, quand
// l'appelant passe `categorie`. Le fond, la teinte, les dimensions et la position
// de la pastille ne changent pas d'un pixel, et les autres écrans (fiche, résultats
// de recherche) n'y voient que du feu : sans `categorie`, le rendu est celui d'avant.

import { Icon } from './Icons.jsx';
import Illustration from './illustrations/Illustration.jsx';
import { DESSIN_PAR_CATEGORIE, dessinDeContexte } from './illustrations/dessinsContexte.js';

/**
 * Dessin « crayon » du cas « fiche sans photo », par catégorie.
 *
 * Depuis le 16/11, la table vit dans `illustrations/dessinsContexte.js` : elle est
 * désormais partagée avec les pastilles d'annonces (main-d'œuvre) et les bandeaux,
 * et complétée par des règles MOT-CLÉ (pharmacie, kiosque, coiffure, plomberie…).
 * On la ré-exporte ici pour ne pas casser les appelants historiques.
 */
export const DESSIN_SECOURS_PAR_CATEGORIE = DESSIN_PAR_CATEGORIE;

/**
 * @param {{ nom?: string, className?: string, compact?: boolean, categorie?: string|null,
 *   tags?: string[], sousCategorie?: string }} props
 *   nom          : nom de l'établissement (affiché sur les grands formats)
 *   className    : dimensions et arrondis, imposés par l'appelant (h-44 w-full…)
 *   compact      : true pour une petite vignette (86×86 des résultats de recherche) :
 *                  pastille seule, le nom n'y tiendrait pas lisiblement
 *   categorie    : slug de catégorie → pose le dessin de secours derrière la pastille.
 *                  `null` (défaut) = AUCUN dessin : les appelants qui ne le demandent
 *                  pas (fiche profil, résultats de recherche) gardent le rendu v2.
 *   tags / sousCategorie : affinent le dessin quand la catégorie est trop large
 *                  (« Transfert d'argent » → mobileMoney plutôt que boiteOutils).
 */
export default function PhotoSecours({
  nom = '',
  className = '',
  compact = false,
  categorie = null,
  tags = [],
  sousCategorie = '',
}) {
  const dessin = categorie ? dessinDeContexte({ categorie, tags, sousCategorie }) : null;

  return (
    <div
      data-photo-secours=""
      className={`relative isolate flex flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-b from-soft to-white ring-1 ring-inset ring-line ${className}`}
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
      {/* Dessin de secours : DERNIER enfant du bloc, pour que la pastille reste le
          `firstElementChild` (les contrôles automatiques lisent sa couleur de
          pastille). Il est posé en `-z-10` dans le contexte d'empilement créé par
          `isolate` : il passe donc derrière la pastille et le nom, mais devant le
          fond ivoire de la carte — et il ne peut pas glisser sous la carte
          elle-même. `pointer-events-none` : du décor ne capte jamais le clic
          (toute la surface est le lien vers la fiche). */}
      {dessin && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
          <Illustration nom={dessin} taille={compact ? 56 : 128} className="opacity-[0.18]" />
        </span>
      )}
    </div>
  );
}
