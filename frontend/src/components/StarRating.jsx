// StarRating.jsx — Affichage et saisie de notes par étoiles.
//
// ⚠️ Ce composant ne doit JAMAIS être utilisé dans la section Pharmacies & Cliniques
// (cahier des charges §6 : pas de notation publique des actes médicaux). Il est
// réservé aux établissements (alimentation, beauté, services...) et à la
// réputation des ouvriers/artisans.
//
// Deux usages :
//  - lecture seule : <StarRating note={4.6} taille={16} /> + « 4,6 (128 avis) »
//  - saisie :        <StarRating note={note} onChange={setNote} interactif />
// Les étoiles pleines/halves sont dessinées via un dégradé SVG plutôt qu'avec deux
// couches superposées, ce qui reste net à toutes les tailles.

import { useState } from 'react';
import { Icon } from './Icons.jsx';
import { formatNote } from '../utils/format.js';

function Etoile({ remplissage, taille }) {
  // `remplissage` : 0 = vide, 0.5 = moitié, 1 = pleine.
  const id = `demi-${Math.random().toString(36).slice(2, 8)}`;
  if (remplissage === 1) return <Icon name="star" size={taille} filled className="text-star" />;
  if (remplissage === 0) return <Icon name="star" size={taille} className="text-line" />;
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id}>
          <stop offset="50%" stopColor="var(--color-star)" />
          <stop offset="50%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z"
        fill={`url(#${id})`}
        stroke="var(--color-star)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * @param {{ note?: number, nombreAvis?: number, taille?: number, interactif?: boolean,
 *   onChange?: (note:number)=>void, afficherNombre?: boolean, className?: string }} props
 */
export default function StarRating({
  note = 0,
  nombreAvis = null,
  taille = 16,
  interactif = false,
  onChange,
  afficherNombre = true,
  className = '',
}) {
  const [survol, setSurvol] = useState(0);
  const valeur = Math.max(0, Math.min(5, Number(note) || 0));
  const affichee = survol || valeur;

  function rendreCliquable(i, evt) {
    if (!interactif) return;
    // Support du clavier (accessibilité) : flèches gauche/droite.
    if (evt?.key === 'ArrowRight' && onChange) return onChange(Math.min(5, valeur + 1));
    if (evt?.key === 'ArrowLeft' && onChange) return onChange(Math.max(1, valeur - 1));
    if (evt?.key && !['Enter', ' '].includes(evt.key)) return;
    onChange?.(i + 1);
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <div
        className={`flex items-center gap-0.5 ${interactif ? 'cursor-pointer' : ''}`}
        role={interactif ? 'radiogroup' : 'img'}
        aria-label={`Note : ${formatNote(affichee)} sur 5`}
        onMouseLeave={() => setSurvol(0)}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const reste = affichee - i;
          const remplissage = reste >= 1 ? 1 : reste >= 0.25 ? 0.5 : 0;
          return (
            <button
              key={i}
              type="button"
              disabled={!interactif}
              tabIndex={interactif ? 0 : -1}
              aria-label={`${i + 1} étoile${i > 0 ? 's' : ''}`}
              className={`transition ${interactif ? 'hover:scale-110 active:scale-95' : 'cursor-default'} ${
                interactif ? 'p-0.5' : ''
              }`}
              onMouseEnter={() => interactif && setSurvol(i + 1)}
              onClick={() => rendreCliquable(i)}
              onKeyDown={(evt) => rendreCliquable(i, evt)}
            >
              <Etoile remplissage={remplissage} taille={taille} />
            </button>
          );
        })}
      </div>

      {afficherNombre && (
        <span className="text-xs font-semibold text-ink-muted">
          {formatNote(affichee)}
          {nombreAvis != null && ` (${nombreAvis} avis)`}
        </span>
      )}
    </div>
  );
}
