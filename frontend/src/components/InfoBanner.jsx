// InfoBanner.jsx — Bandeau d'information (mode démo hors-ligne, avertissement santé,
// erreurs de formulaire...). Un seul style, très visible mais non bloquant.

import { Icon } from './Icons.jsx';

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
 *   children?: any, action?: { libelle: string, onClick: () => void }, className?: string }} props
 */
export default function InfoBanner({ variante = 'info', titre, children, action, className = '' }) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug ${
        STYLES[variante] || STYLES.info
      } ${className}`}
    >
      <Icon name={ICONES[variante] || 'info'} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        {titre && <p className="font-bold">{titre}</p>}
        {children}
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="shrink-0 font-bold underline">
          {action.libelle}
        </button>
      )}
    </div>
  );
}
