// BarreActionFixe.jsx — Barre d'action fixe, POSÉE sur la navigation basse.
//
// Un seul endroit pour la règle « aucun interstice entre la barre et la
// navigation » : la barre se place en `bottom: var(--hauteur-nav)`, c'est-à-dire
// sur le haut RÉEL de la navigation (mesuré, voir hooks/useMesureBlocBas.js),
// sur fond opaque, et elle publie sa propre hauteur pour que le contenu réserve
// l'espace correspondant. Sur un écran sans navigation basse (fiche partagée, en
// plein écran), la variable vaut 0 : la barre est alors collée au bas de la
// fenêtre et porte elle-même la marge de la barre système.
//
// Utilisée par les 3 étapes de l'inscription (et le profil simple) et par la fiche
// établissement « Aller chez … » : une seule géométrie, partout. La mise en forme
// (position, fond opaque, trait supérieur, marge de barre système) vit dans
// theme.css, section « Bloc fixe du bas » — jamais dans les pages.

import { useRef } from 'react';
import { useMesureBarreAction } from '../hooks/useMesureBlocBas.js';

/**
 * @param {{ children: React.ReactNode, className?: string }} props
 *   `className` ne sert qu'au remplissage interne (px-4 py-3, etc.) : la
 *   position et le fond sont imposés par .barre-action-fixe.
 */
export default function BarreActionFixe({ children, className = '' }) {
  const barre = useRef(null);
  useMesureBarreAction(barre);
  return (
    <div ref={barre} className={`barre-action-fixe ${className}`.trim()}>
      {children}
    </div>
  );
}
