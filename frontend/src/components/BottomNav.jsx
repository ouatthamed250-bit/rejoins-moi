// BottomNav.jsx — Navigation basse fixe
// Onglets (voir maquettes) : Accueil, Explorer, + (bouton central publier/poster, surélevé), Messages, Profil
//
// Décisions :
//  - Le bouton central "+" n'est pas un onglet mais un déclencheur d'actions : il
//    ouvre une feuille de choix (poster un besoin de main-d'œuvre / inscrire mon
//    établissement / chercher du travail). C'est cohérent avec les deux usages de
//    l'app et évite un onglet "Publier" vide de sens.
//  - Un badge rouge signale les messages non lus. Comme il n'y a pas encore de
//    messagerie serveur, la valeur vient du hook useAuth (compteur local, mis à
//    zéro à l'ouverture). Le code reste prêt pour un vrai compteur API.
//  - L'onglet actif reste orange partout : le vert est réservé à la section santé
//    (§6) pour ne pas brouiller le repère de navigation.
//  - GÉOMÉTRIE MESURÉE (correctif du 08/10) : la hauteur de cette navigation n'est
//    jamais supposée. Elle est mesurée (ResizeObserver) et publiée en variables CSS
//    par hooks/useMesureBlocBas.js, parce que la barre système du téléphone, le
//    zoom de police et la police réellement chargée la font varier. C'est ce qui
//    permet à la barre d'action (components/BarreActionFixe.jsx) de s'y poser
//    EXACTEMENT, sans interstice. Le fond est opaque et les classes de position
//    vivent dans theme.css (.nav-basse), pas ici.

import { useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useMesureNavBas } from '../hooks/useMesureBlocBas.js';

const ONGLETS = [
  { to: '/', label: 'Accueil', icone: 'home' },
  { to: '/recherche', label: 'Explorer', icone: 'search' },
  { to: '/messages', label: 'Messages', icone: 'message', badge: true },
  { to: '/profil', label: 'Profil', icone: 'user' },
];

const ACTIONS = [
  {
    to: '/main-doeuvre?mode=poster',
    icone: 'briefcase',
    titre: 'Poster un besoin',
    detail: 'Gratuit — trouvez un artisan près de vous',
  },
  {
    to: '/inscription',
    icone: 'store',
    titre: 'Inscrire mon établissement',
    detail: 'Photos facultatives + vos produits/services',
  },
  {
    to: '/main-doeuvre?mode=chercher',
    icone: 'hammer',
    titre: 'Je cherche du travail',
    detail: 'Voir les besoins dans mon quartier',
  },
];

export default function BottomNav() {
  const [feuilleOuverte, setFeuilleOuverte] = useState(false);
  const navigate = useNavigate();
  const { messagesNonLus } = useAuth();
  // Mesure de la navigation (hauteur réelle → variables CSS du bloc du bas).
  const nav = useRef(null);
  useMesureNavBas(nav);

  function aller(chemin) {
    setFeuilleOuverte(false);
    navigate(chemin);
  }

  return (
    <>
      {feuilleOuverte && (
        <div
          className="fixed inset-0 z-40 bg-black/40 animate-pop-in"
          onClick={() => setFeuilleOuverte(false)}
          role="presentation"
        >
          <div
            className="au-dessus-du-bloc absolute left-1/2 w-[92%] max-w-[420px] -translate-x-1/2 rounded-lg bg-white p-3 shadow-lg"
            onClick={(evt) => evt.stopPropagation()}
            role="menu"
          >
            <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
              Que voulez-vous faire ?
            </p>
            {ACTIONS.map((action) => (
              <button
                key={action.to}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-soft"
                onClick={() => aller(action.to)}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon name={action.icone} size={20} />
                </span>
                <span>
                  <span className="block text-sm font-bold text-ink">{action.titre}</span>
                  <span className="block text-xs text-ink-muted">{action.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <nav ref={nav} aria-label="Navigation principale" className="nav-basse">
        <div className="mx-auto flex max-w-[480px] items-center justify-between px-2">
          {ONGLETS.slice(0, 2).map((onglet) => (
            <Onglet key={onglet.to} {...onglet} />
          ))}

          {/* Bouton central surélevé */}
          <button
            type="button"
            aria-label="Publier"
            onClick={() => setFeuilleOuverte((v) => !v)}
            className="-mt-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-fab transition hover:bg-primary-dark active:scale-95"
          >
            <Icon name="plus" size={28} strokeWidth={2.4} />
          </button>

          {ONGLETS.slice(2).map((onglet) => (
            <Onglet key={onglet.to} {...onglet} badge={onglet.badge ? messagesNonLus : 0} />
          ))}
        </div>
      </nav>
    </>
  );
}

function Onglet({ to, label, icone, badge = 0 }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-bold transition ${
          isActive ? 'text-primary' : 'text-ink-muted hover:text-ink'
        }`
      }
    >
      <span className="relative">
        <Icon name={icone} size={23} />
        {badge > 0 && (
          <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {label}
    </NavLink>
  );
}

