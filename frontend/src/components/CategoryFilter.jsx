// CategoryFilter.jsx — Filtres horizontaux par catégorie (Tous / Alimentation / Beauté / Services / Artisanat)
// La liste est EXTENSIBLE (§4) : elle est définie une seule fois dans
// src/data/demoData.js (CATEGORIES) et reflétée par l'API
// (GET /api/establishments/categories). Pour ajouter une catégorie, il faut :
//   1. l'ajouter dans CATEGORIES (frontend) ET dans backend/src/routes/establishments.js ;
//   2. vérifier qu'elle figure dans l'enum du modèle Establishment.
// Les icônes sont des SVG maison (voir Icons.jsx).

import { CATEGORIES } from '../data/demoData.js';
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
  const liste = categories?.length ? categories : CATEGORIES;
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

