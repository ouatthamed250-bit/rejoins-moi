// Ornement.jsx — Pose une illustration dans une mise en page sans jamais gêner
// le contenu.
//
// Règle de conduite de ce composant : un ornement est du DÉCOR. Il ne capte donc
// jamais le clic (`pointer-events: none`), jamais la sélection de texte
// (`user-select: none`), et jamais le lecteur d'écran (`aria-hidden`). Tout ce
// qui porte une information reste du texte HTML, posé À CÔTÉ de l'ornement.
//
// Cinq variantes, une par besoin réel de l'interface :
//   • coin        illustration très pâle dans un coin du bloc PARENT (qui doit
//                 être `position: relative`) : `cote` = "droite" (défaut),
//                 "gauche", "bas-droite", "bas-gauche" ;
//   • medaillon   pastille ronde en pointillés autour d'une illustration : état
//                 vide, en-tête de section ;
//   • separateur  trait de séparation dessiné (festons), à la place d'un
//                 <hr> : deux traits qui se rejoignent à la main ;
//   • frise       bandeau de motifs répétés (pied du tiroir du menu, haut d'une
//                 feuille) ;
//   • motif       champ de motifs très pâle en fond (parent `relative`).
//
// Les variantes `frise`, `separateur` et `motif` ne sont pas des SVG dans le
// DOM : ce sont des bandes de fond (voir styles/esquisse.css). C'est volontaire —
// une frise doit s'étirer sur toute une largeur d'écran sans déformer ses
// losanges, ce qu'une tuile de fond fait naturellement et qu'un SVG étiré ne
// fait pas.

import Illustration from './Illustration.jsx';

/**
 * @param {{ variante?: 'coin'|'medaillon'|'separateur'|'frise'|'motif',
 *   illustration?: string, cote?: string, taille?: number, className?: string }} props
 *   variante     : voir la liste ci-dessus
 *   illustration : clé passée à Illustration.jsx (coin et medaillon)
 *   cote         : coin seulement
 *   taille       : côté du dessin (coin : 120 par défaut, medaillon : 44)
 *   className    : placement fin (Tailwind) et opacité, au choix de l'appelant
 */
export default function Ornement({
  variante = 'coin',
  illustration,
  cote = 'droite',
  taille,
  className = '',
  ...reste
}) {
  if (variante === 'frise' || variante === 'separateur' || variante === 'motif') {
    return (
      <span
        aria-hidden="true"
        data-ornement={variante}
        className={`esquisse-${variante} ${className}`}
        {...reste}
      />
    );
  }

  if (variante === 'medaillon') {
    return (
      <span
        aria-hidden="true"
        data-ornement="medaillon"
        className={`esquisse-medaillon ${className}`}
        {...reste}
      >
        <Illustration nom={illustration} taille={taille || 44} />
      </span>
    );
  }

  // Coin (variante par défaut) : la couleur et l'opacité viennent de la feuille
  // annexe, de sorte qu'un seul réglage éclaircisse tous les coins de l'app.
  return (
    <span
      aria-hidden="true"
      data-ornement="coin"
      className={`esquisse-coin esquisse-coin--${cote} ${className}`}
      {...reste}
    >
      <Illustration nom={illustration} taille={taille || 120} />
    </span>
  );
}
