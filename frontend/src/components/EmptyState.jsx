// EmptyState.jsx — État vide / chargement / erreur réutilisable.
// Objectif : ne jamais montrer un écran blanc. Sur un téléphone, un écran vide est
// interprété comme "l'app ne marche pas" ; on affiche donc toujours soit un
// indicateur de chargement, soit une explication avec une action.
//
// 03/10 — `illustration` (facultatif) : un état vide peut porter un dessin
// « crayon » en filigrane, très pâle, DERRIÈRE la pastille d'icône et le texte
// (calque `-z-10` enfermé par `isolate`). Rien d'autre ne change : ni la taille,
// ni les marges, ni l'animation. Sans la prop, le rendu est celui d'avant — les
// états vides de la recherche et de la section santé restent donc intacts.

import { Icon, IconLoader } from './Icons.jsx';
import Illustration from './illustrations/Illustration.jsx';

/**
 * @param {{ icone?: string, titre: string, description?: string,
 *   action?: { libelle: string, onClick: () => void }, chargement?: boolean,
 *   illustration?: string|null, classeIllustration?: string }} props
 *   illustration : clé de tracesEsquisse.jsx (ex. « maison ») posée en filigrane.
 *     Prévu pour l'accueil ; à ne pas employer quand un dessin ne dit rien de plus
 *     que le texte (un titre suffit alors).
 *   classeIllustration : teinte du filigrane (ex. « text-health » sur l'écran
 *     Pharmacies & Cliniques, où le vert est la seule couleur autorisée).
 */
export default function EmptyState({
  icone = 'search',
  titre,
  description = '',
  action,
  chargement = false,
  illustration = null,
  classeIllustration = '',
}) {
  return (
    <div className="relative isolate flex flex-col items-center justify-center gap-2 px-6 py-12 text-center animate-fade-up">
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
        <button type="button" className="bouton-principal mt-2" onClick={action.onClick}>
          {action.libelle}
        </button>
      )}
      {/* Filigrane (dernier enfant : il ne pousse rien, il ne recouvre rien) */}
      {illustration && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
          <Illustration nom={illustration} taille={140} className={`opacity-[0.16] ${classeIllustration}`} />
        </span>
      )}
    </div>
  );
}
