// RaccourcisUtiles.jsx — Rangée « Utile près de moi » (accueil + recherche).
//
// POURQUOI : un habitant ne cherche pas « Services de proximité », il cherche
// « un WC public » ou « une clé minute ». Ces quatre raccourcis sont les recherches
// réelles du terrain (prompt 6) ; ils appliquent une SOUS-CATÉGORIE, pas une famille,
// et relancent la géolocalisation — « près de moi » n'a de sens qu'avec une position.
//
// Les raccourcis qui ne vivent pas dans l'annuaire (pharmacie de garde → écran santé)
// portent une `route` : le parent navigue au lieu de filtrer (voir config/categories.js).
//
// Rendu volontairement séparé de CategoryFilter : deux intentions différentes
// (« je cherche un type de commerce » vs « j'ai un besoin précis maintenant »),
// donc deux rangées, et la rangée de raccourcis ne colle pas en haut de l'écran.

import { RACCOURCIS_UTILES } from '../config/categories.js';
import { Icon } from './Icons.jsx';

/**
 * @param {{ actif?: string, onChoisir?: (raccourci: object|null) => void,
 *   className?: string }} props
 *   `actif` = slug du raccourci appliqué ('' si aucun). Re-cliquer dessus le retire.
 */
export default function RaccourcisUtiles({ actif = '', onChoisir, className = '' }) {
  return (
    <section aria-label="Utile près de moi" className={className}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
        <Icon name="mapPin" size={12} />
        Utile près de moi
      </p>
      <div className="puces">
        {RACCOURCIS_UTILES.map((raccourci) => {
          const selectionne = raccourci.slug === actif;
          return (
            <button
              key={raccourci.slug}
              type="button"
              aria-pressed={selectionne}
              // Un second appui sur le raccourci actif le retire : pas besoin de
              // chercher une petite croix pour revenir à l'annuaire complet.
              onClick={() => onChoisir?.(selectionne ? null : raccourci)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition active:scale-95 ${
                selectionne
                  ? 'border-primary bg-primary text-white shadow-card'
                  : 'border-dashed border-primary/40 bg-primary/5 text-ink hover:border-primary hover:text-primary'
              }`}
            >
              <Icon name={raccourci.icone || 'dot'} size={15} />
              {raccourci.label}
              {selectionne && <Icon name="close" size={12} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
