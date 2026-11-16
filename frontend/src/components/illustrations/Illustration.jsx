// Illustration.jsx — Rendu d'une illustration « crayon » de tracesEsquisse.jsx.
//
// Contrat d'appel :
//   <Illustration nom="palmier" taille={96} className="text-ink-muted" />
//
// Choix, et pourquoi :
//   • DÉCORATIVE par défaut (`aria-hidden`, `focusable="false"`) : une
//     illustration ne doit JAMAIS porter seule une information — un lecteur
//     d'écran n'en ferait rien et annoncerait du bruit au milieu de la liste.
//     Là où le dessin porte vraiment un sens (état vide), l'appelant passe
//     `decoratif={false} etiquette="..."` : l'image devient `role="img"` et
//     annonçable.
//   • `useId()` : une trace pose un `<pattern>` dans `<defs>` (le motif wax).
//     Sans identifiant unique, deux exemplaires du MÊME dessin sur un écran
//     porteraient le même `id`, et le second ne serait plus peint (le
//     navigateur résout `url(#…)` sur le premier trouvé). Les deux-points
//     renvoyés par React 18 sont retirés : l'identifiant sert dans une URL.
//   • `viewBox` figé à 120×120 et taille imposée par l'appelant : le dessin
//     s'adapte à la pastille de 32 px comme à l'illustration de 160 px, sans
//     version séparée à maintenir.
//   • `currentColor` : la couleur est celle du parent (classe Tailwind
//     `text-…`), comme pour les icônes. Aucune illustration n'impose sa teinte,
//     ce qui permet de la passer en vert dans la santé sans la dupliquer.
//   • `contraste` : épaisseur du trait, en unités de la boîte 120×120. Le trait
//     ne s'épaissit pas avec la taille (voir `vector-effect` dans
//     styles/esquisse.css) : 1,6 convient du petit au grand format.

import { useId } from 'react';
import { TRACES_ESQUISSE } from './tracesEsquisse.jsx';

/**
 * @param {{ nom: string, taille?: number, trait?: number, className?: string,
 *   decoratif?: boolean, etiquette?: string }} props
 *   nom       : clé de TRACES_ESQUISSE (« palmier », « barbecue »…)
 *   taille    : côté en pixels (le dessin est carré)
 *   trait     : épaisseur du trait principal
 *   className : classes ajoutées (couleur via `text-…`, marges, opacité…)
 *   decoratif : true (défaut) = masquée aux lecteurs d'écran
 *   etiquette : libellé prononcé quand decoratif={false}
 */
export default function Illustration({
  nom,
  taille = 96,
  trait = 1.6,
  className = '',
  decoratif = true,
  etiquette = '',
  ...reste
}) {
  const Trace = TRACES_ESQUISSE[nom];
  const idUnique = `esq${useId().replace(/:/g, '')}`;

  // Nom inconnu : on n'affiche RIEN plutôt qu'un cadre vide. Une faute de frappe
  // dans une clé doit être visible en relecture, pas produire un trou mystérieux.
  if (!Trace) return null;

  return (
    <svg
      data-illustration={nom}
      viewBox="0 0 120 120"
      width={taille}
      height={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth={trait}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`illustration-esquisse ${className}`}
      {...(decoratif
        ? { 'aria-hidden': 'true', focusable: 'false' }
        : { role: 'img', 'aria-label': etiquette || nom })}
      {...reste}
    >
      <Trace id={idUnique} />
    </svg>
  );
}
