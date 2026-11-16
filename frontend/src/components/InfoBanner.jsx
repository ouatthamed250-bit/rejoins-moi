// InfoBanner.jsx — Bandeau d'information (mode démo hors-ligne, avertissement santé,
// erreurs de formulaire...). Un seul style, très visible mais non bloquant.

import { Icon } from './Icons.jsx';
import Illustration from './illustrations/Illustration.jsx';

const STYLES = {
  info: 'bg-soft text-ink border-line',
  succes: 'bg-health-light text-health-dark border-health/30',
  alerte: 'bg-amber-50 text-amber-800 border-amber-200',
  erreur: 'bg-red-50 text-red-700 border-red-200',
  demo: 'bg-primary/10 text-primary-dark border-primary/30',
};

const ICONES = {
  info: 'info',
  succes: 'check',
  alerte: 'alert',
  erreur: 'alert',
  demo: 'wifiOff',
};

/**
 * @param {{ variante?: 'info'|'succes'|'alerte'|'erreur'|'demo', titre?: string,
 *   children?: any, action?: { libelle: string, onClick: () => void },
 *   actions?: Array<{ libelle: string, onClick: () => void }>, className?: string,
 *   illustration?: string|null }} props
 *   illustration : clé de tracesEsquisse.jsx posée en filigrane à DROITE (ex.
 *     « horsLigne » sur un bandeau « serveur injoignable »). Facultatif : sans la
 *     prop, le bandeau est exactement celui d'avant.
 */
export default function InfoBanner({
  variante = 'info',
  titre,
  children,
  action,
  actions,
  className = '',
  illustration = null,
}) {
  // Deux boutons au plus : au-delà, ce n'est plus un bandeau mais un formulaire.
  // `action` reste accepté seul (usages existants), `actions` le remplace quand il y
  // en a deux — cas de la localisation : « Activer » ET « choisir sur la carte ».
  const listeActions = (actions || (action ? [action] : [])).slice(0, 2);
  return (
    <div
      role="status"
      className={`relative isolate flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug ${
        STYLES[variante] || STYLES.info
      } ${className}`}
    >
      <Icon name={ICONES[variante] || 'info'} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        {titre && <p className="font-bold">{titre}</p>}
        {children}
      </div>
      {listeActions.length > 0 && (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {listeActions.map((a) => (
            <button key={a.libelle} type="button" onClick={a.onClick} className="font-bold underline">
              {a.libelle}
            </button>
          ))}
        </span>
      )}
      {/* Filigrane : DERNIER enfant (il ne pousse rien). `-z-10` dans le contexte
          d'empilement de `isolate` → derrière l'icône, le texte et les boutons,
          devant le fond du bandeau. `pointer-events-none` : les boutons restent
          cliquables sur toute leur surface. Posé dans le COIN BAS-DROITE (et non au
          centre) : le titre et les actions d'un bandeau tiennent sur la première
          ligne, le filigrane ne passe donc jamais derrière eux. */}
      {illustration && (
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 right-1 -z-10">
          <Illustration nom={illustration} taille={48} className="opacity-[0.22]" />
        </span>
      )}
    </div>
  );
}

