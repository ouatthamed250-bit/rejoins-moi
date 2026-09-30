// EmptyState.jsx — État vide / chargement / erreur réutilisable.
// Objectif : ne jamais montrer un écran blanc. Sur un téléphone, un écran vide est
// interprété comme "l'app ne marche pas" ; on affiche donc toujours soit un
// indicateur de chargement, soit une explication avec une action.

import { Icon, IconLoader } from './Icons.jsx';

/**
 * @param {{ icone?: string, titre: string, description?: string,
 *   action?: { libelle: string, onClick: () => void }, chargement?: boolean }} props
 */
export default function EmptyState({ icone = 'search', titre, description = '', action, chargement = false }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center animate-fade-up">
      {chargement ? (
        <IconLoader size={28} className="text-primary" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-soft text-primary">
          <Icon name={icone} size={26} />
        </span>
      )}
      <h3 className="text-base font-bold text-ink">{titre}</h3>
      {description && <p className="max-w-xs text-sm text-ink-muted">{description}</p>}
      {action && (
        <button type="button" className="btn-primary mt-2" onClick={action.onClick}>
          {action.libelle}
        </button>
      )}
    </div>
  );
}
