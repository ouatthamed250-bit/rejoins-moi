// CategoryFilter.jsx — Filtres horizontaux par catégorie (Tous / Restauration et boissons / Commerces / …)
// La liste est EXTENSIBLE (§4) : elle est définie une seule fois dans
// src/config/categories.js (FAMILLES) et reflétée par l'API
// (GET /api/establishments/categories). Pour ajouter une catégorie, il faut :
//   1. l'ajouter dans FAMILLES (frontend) ET dans backend/src/config/categories.js ;
//   2. vérifier qu'elle figure dans l'enum du modèle Establishment.
// Les icônes sont des SVG maison (voir Icons.jsx).
//
// ONGLETS AFFICHÉS = FAMILLES_VISIBLES, et non toutes les familles : depuis la
// migration complète des 6 719 fiches (26/11), des familles historiques ne portent
// plus que 0 à 2 fiches (alimentation, commerce au singulier, sante, spiritualite,
// cultes, autre) et encombraient la barre pour rien. Elles restent déclarées dans
// la taxonomie (libellés, inscription, fiches anciennes) mais n'ont plus d'onglet.
// Ne JAMAIS y inclure beaute / services / artisanat : encore 1 398 fiches réelles.

import { FAMILLES_VISIBLES } from '../config/categories.js';
import { Icon } from './Icons.jsx';

/**
 * @param {{ valeur?: string, onChange?: (slug:string)=>void,
 *   variante?: 'default' | 'health', categories?: Array<{slug:string,label:string,icone:string}>,
 *   sticky?: boolean }} props
 */
export default function CategoryFilter({
  valeur = 'tous',
  onChange,
  variante = 'default',
  categories = null,
  sticky = false,
}) {
  const liste = categories?.length ? categories : FAMILLES_VISIBLES;
  // La section santé est verte (§6) : on ne réutilise jamais l'orange ici.
  const actif =
    variante === 'health'
      ? 'border-health bg-health text-white shadow-card-health'
      : 'border-primary bg-primary text-white shadow-card';

  return (
    <nav
      aria-label="Filtrer par catégorie"
      className={`puces ${sticky ? 'sticky top-0 z-20 bg-white/95 py-2 backdrop-blur' : ''}`}
    >
      {liste.map((cat) => {
        const selectionne = cat.slug === valeur;
        return (
          <button
            key={cat.slug}
            type="button"
            aria-pressed={selectionne}
            onClick={() => onChange?.(cat.slug)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition active:scale-95 ${
              selectionne ? actif : 'border-line bg-white text-ink-muted hover:border-primary/40 hover:text-ink'
            }`}
          >
            <Icon name={cat.icone || 'dot'} size={15} />
            {cat.label}
          </button>
        );
      })}
    </nav>
  );
}

