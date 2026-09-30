// TopBar.jsx — Barre du haut, commune à toutes les pages (sauf profil établissement en plein écran)
// Structure (voir cahier-des-charges §8) :
//   - Icône menu/recherche à gauche
//   - Logo "Rejoins'Moi" + sous-titre contextuel au centre ("Découvre · Soutiens · Connecte-toi" ou nom de la page)
//   - Photo de profil utilisateur à droite (cliquable -> page profil)
//
// Décision d'implémentation : la barre est `sticky` et non `fixed`. Sur les
// navigateurs mobiles Android, une barre `fixed` combinée au clavier virtuel crée
// des sauts de mise en page ; `sticky` reste collée en haut au défilement sans ce
// défaut. Le fond change de couleur selon la section (orange par défaut, vert sur
// Pharmacies & Cliniques).

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import MenuPrincipal from './MenuPrincipal.jsx';
import { initiales } from '../utils/format.js';
import { useAuth } from '../hooks/useAuth.js';

/**
 * @param {{ titre?: string, sousTitre?: string, variante?: 'default'|'health'|'transparent',
 *   retour?: boolean, onMenuClick?: () => void, recherche?: boolean, className?: string }} props
 *
 * Depuis l'ajout du 29/09, le bouton de gauche ouvre le MENU HAMBURGER
 * (MenuPrincipal) par défaut — c'est de là qu'on atteint la page « Jobs ». Une page
 * peut toujours imposer son comportement en passant `onMenuClick`.
 */
export default function TopBar({
  titre,
  sousTitre,
  variante = 'default',
  retour = false,
  onMenuClick,
  recherche = false,
  className = '',
}) {
  const navigate = useNavigate();
  const { profil } = useAuth();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const nom = profil?.nomComplet || '';
  const photo = profil?.photoProfil;

  // v2 du 30/09 : la variante par défaut n'est PLUS un aplat orange (jugé trop
  // agressif) mais un dégradé orange doux qui s'estompe vers le bas
  // (`entete-degrade`, theme.css), avec le texte en encre foncée. La variante
  // santé, elle, garde son vert plein : cette refonte ne la touche pas (§6).
  const fond =
    variante === 'health'
      ? 'bg-health text-white shadow-card-health'
      : variante === 'transparent'
        ? 'bg-white/90 text-ink backdrop-blur border-b border-line'
        : 'entete-degrade text-ink border-b border-line/70';

  // Sur un fond clair, un survol blanc (v1) ne se verrait plus : on l'adapte.
  const survolPuce = variante === 'health' ? 'hover:bg-white/15' : 'hover:bg-primary/10';
  // Cadre de l'avatar : anneau blanc translucide sur le vert santé, liseré +
  // fond pâle sur l'en-tête clair — un anneau blanc disparaîtrait dans l'ivoire.
  const cadreAvatar =
    variante === 'health' ? 'border-white/70 bg-white/20' : 'border-primary/25 bg-white/70';

  return (
    <>
    <header className={`sticky top-0 z-30 ${fond} ${className}`}>
      <div className="ecran flex items-center gap-3 py-3">
        {/* Gauche : retour ou menu */}
        {retour ? (
          <button
            type="button"
            aria-label="Revenir en arrière"
            onClick={() => navigate(-1)}
            className={`-ml-1 rounded-full p-1.5 transition active:scale-95 ${survolPuce}`}
          >
            <Icon name="chevronLeft" size={24} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Ouvrir le menu"
            onClick={() => (onMenuClick ? onMenuClick() : setMenuOuvert(true))}
            className={`-ml-1 rounded-full p-1.5 transition active:scale-95 ${survolPuce}`}
          >
            <Icon name={recherche ? 'search' : 'menu'} size={24} />
          </button>
        )}

        {/* Centre : logo + sous-titre contextuel */}
        <div className="min-w-0 flex-1">
          <Link to="/" className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-bold leading-none tracking-tight">
              {titre || "Rejoins'Moi"}
            </span>
            <span className="hidden text-[10px] font-semibold uppercase tracking-wider opacity-80 sm:inline">
              Abidjan
            </span>
          </Link>
          <p className="truncate text-[11px] leading-tight opacity-90">
            {sousTitre || (titre ? '' : 'Découvre · Soutiens · Connecte-toi')}
          </p>
        </div>

        {/* Droite : profil */}
        <Link
          to="/profil"
          aria-label="Mon profil"
          className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 text-xs font-bold transition active:scale-95 ${cadreAvatar}`}
        >
          {photo ? (
            <img src={photo} alt={nom || 'Profil'} className="h-full w-full object-cover" />
          ) : (
            <span>{nom ? initiales(nom) : <Icon name="user" size={18} />}</span>
          )}
        </Link>
      </div>
    </header>

    {/* Tiroir du menu hamburger : page Jobs, abonnement, sections secondaires. */}
    <MenuPrincipal ouvert={menuOuvert} onFermer={() => setMenuOuvert(false)} />
    </>
  );
}

