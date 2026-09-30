// TagBadge.jsx — Pastille de tag produit/service (ex: "Spaghetti", "Café serré")
// Deux états : lecture seule (fiche profil) et cliquable/sélectionnable (inscription établissement).
//
// Décision produit : sur la fiche profil, cliquer une pastille lance directement une
// recherche sur ce produit (comportement "TikTok/Instagram" attendu par les jeunes
// utilisateurs) — c'est pour cela que `onClick` est aussi disponible en lecture.

import { Icon } from './Icons.jsx';

/**
 * @param {{ label: string, selected?: boolean, onClick?: () => void,
 *   taille?: 'sm' | 'md', icone?: string|null, className?: string }} props
 */
export default function TagBadge({ label, selected = false, onClick, taille = 'md', icone = null, className = '' }) {
  const cliquable = typeof onClick === 'function';
  const classes = [
    'inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap transition',
    taille === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
    selected
      ? 'border-primary bg-primary text-white shadow-card'
      : 'border-line bg-white text-ink hover:border-primary/50 hover:bg-soft',
    cliquable ? 'active:scale-95 cursor-pointer' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (cliquable) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-pressed={selected}>
        {icone && <Icon name={icone} size={12} />}
        {selected && !icone && <Icon name="check" size={12} />}
        {label}
      </button>
    );
  }

  return (
    <span className={classes}>
      {icone && <Icon name={icone} size={12} />}
      {label}
    </span>
  );
}

