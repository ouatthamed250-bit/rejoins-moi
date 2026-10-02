// MenuPrincipal.jsx — Menu hamburger (tiroir latéral).
//
// Pourquoi ici et pas dans la bottom nav ? Le cahier des charges (ajout du 29/09)
// demande que la page « Jobs » soit accessible depuis le MENU HAMBURGER et pas
// depuis la barre du bas : la bottom nav reste le parcours principal (4 onglets +
// bouton publier), le menu accueille les sections secondaires.
//
// Décisions :
//  - Le tiroir est monté par TopBar : n'importe quel écran en dispose, sans que
//    chaque page ait à gérer son état.
//  - Il se ferme au clic sur un lien, au clic sur le fond, ou avec la touche Échap
//    (accessibilité minimale : `role="dialog"`, `aria-modal`).
//  - « Abonnement artisan » est visible par tout le monde, mais mis en valeur :
//    c'est l'écran qui explique ce que l'abonnement débloque.

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Icon } from './Icons.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useInstallation } from '../hooks/useInstallation.js';
import { CATALOGUE, libellePrixListe } from '../config/abonnement.js';
import { formatTelephone, initiales } from '../utils/format.js';

const SECTIONS = [
  {
    titre: 'Découvrir',
    liens: [
      { to: '/', icone: 'home', libelle: 'Accueil' },
      { to: '/recherche', icone: 'search', libelle: 'Explorer les commerces' },
      { to: '/pharmacies-cliniques', icone: 'pharmacy', libelle: 'Pharmacies & cliniques' },
    ],
  },
  {
    titre: 'Boulot',
    liens: [
      { to: '/jobs', icone: 'briefcase', libelle: 'Jobs — offres & demandes' },
      { to: '/main-doeuvre', icone: 'tools', libelle: 'Main-d’œuvre & métiers' },
      { to: '/main-doeuvre?mode=poster', icone: 'plus', libelle: 'Publier une annonce (gratuit)' },
    ],
  },
  {
    titre: 'Mon compte',
    liens: [
      { to: '/profil', icone: 'user', libelle: 'Mon profil' },
      { to: '/messages', icone: 'message', libelle: 'Messages & mises en relation' },
      { to: '/inscription', icone: 'store', libelle: 'Inscrire mon établissement' },
    ],
  },
];

/**
 * @param {{ ouvert: boolean, onFermer: () => void }} props
 */
export default function MenuPrincipal({ ouvert, onFermer }) {
  const navigate = useNavigate();
  const { profil, connecte, estDemo, deconnexion } = useAuth();
  // État d'installation PARTAGÉ avec la bannière flottante (InstallAppButton).
  const { contenu, installee, installer, enCours, note, diagnostic } = useInstallation();

  // Échap ferme le tiroir : réflexe attendu par les utilisateurs au clavier.
  useEffect(() => {
    if (!ouvert) return undefined;
    function surTouche(evt) {
      if (evt.key === 'Escape') onFermer?.();
    }
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [ouvert, onFermer]);

  if (!ouvert) return null;

  function aller(chemin) {
    onFermer?.();
    navigate(chemin);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-pop-in"
      role="presentation"
      onClick={onFermer}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu principal"
        className="absolute left-0 top-0 h-full w-[86%] max-w-[340px] overflow-y-auto bg-white pb-[env(safe-area-inset-bottom)] shadow-lg"
        onClick={(evt) => evt.stopPropagation()}
      >
        {/* En-tête du tiroir : même dégradé descendant que la barre du haut (v2)
            au lieu de l'aplat orange — plus aucune grande surface orange. */}
        <header className="entete-degrade flex items-center gap-3 border-b border-line/70 px-4 py-4 text-ink">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/25 bg-white/70 text-sm font-bold">
            {profil?.photoProfil ? (
              <img
                src={profil.photoProfil}
                alt={profil.nomComplet || 'Profil'}
                className="h-full w-full object-cover"
              />
            ) : profil?.nomComplet ? (
              initiales(profil.nomComplet)
            ) : (
              <Icon name="user" size={20} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{profil?.nomComplet || 'Bonjour'}</span>
            <span className="block truncate text-[11px] opacity-90">
              {connecte
                ? formatTelephone(profil?.telephone) || 'Compte Rejoins’Moi'
                : 'Navigation libre — compte facultatif'}
            </span>
          </span>
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={onFermer}
            className="rounded-full p-1.5 transition hover:bg-primary/10"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        {estDemo && (
          <p className="border-b border-line bg-primary/10 px-4 py-2 text-[11px] font-semibold text-primary-dark">
            Mode démonstration : rien n’est enregistré sur le serveur.
          </p>
        )}

        <nav className="px-2 py-3">
          {SECTIONS.map((section) => (
            <div key={section.titre} className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                {section.titre}
              </p>
              {section.liens.map((lien) => (
                <Link
                  key={lien.to}
                  to={lien.to}
                  onClick={() => onFermer?.()}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-semibold text-ink transition hover:bg-soft"
                >
                  <Icon name={lien.icone} size={19} className="text-primary" />
                  {lien.libelle}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* ── Application : installer l'app, ou constater qu'elle l'est déjà ──
            Correctif du 30/09 — avant, l'installation n'existait que sous forme
            d'un bandeau FLOTTANT au-dessus du contenu, qui restait affiché même
            quand l'app était installée (bouton « Installer l'app » fantôme).
            Désormais : la bannière disparaît dès que l'app est installée, et
            c'est ICI, dans le menu hamburger, que l'information reste — bouton
            d'installation tant que l'app n'est pas installée, simple repère
            « App installée » ensuite. */}
        <div
          data-option-installation=""
          className="mx-3 mb-3 rounded-md border border-line bg-white p-3"
        >
          <p className="flex items-center gap-2 text-xs font-bold text-ink">
            <Icon
              name={contenu.icone}
              size={16}
              className={installee ? 'text-health' : 'text-primary'}
            />
            {contenu.titre}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-ink-muted">{note || contenu.texte}</p>

          {installee && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-health-light px-2 py-1 text-[10px] font-bold text-health-dark">
              <Icon name="check" size={12} />
              App installée
            </p>
          )}

          {!installee && contenu.action && (
            <button
              type="button"
              className="bouton-principal mt-2 w-full py-2 text-xs"
              onClick={installer}
              disabled={enCours}
            >
              <Icon name="download" size={16} />
              {enCours ? 'Ouverture…' : contenu.action}
            </button>
          )}

          {/* `?pwa=1` : le diagnostic que la bannière affichait, désormais
              consultable même app installée (support téléphone). */}
          {diagnostic && (
            <p className="mt-2 text-[10px] leading-snug text-ink-muted">Diagnostic PWA — {diagnostic}</p>
          )}
        </div>

        {/* Back-office : visible UNIQUEMENT pour les comptes administrateur. L'accès
            reste de toute façon refusé côté serveur (protectAdmin relit estAdmin). */}
        {profil?.estAdmin && (
          <div className="mx-3 mb-3 rounded-md border border-line bg-white p-3">
            <p className="flex items-center gap-2 text-xs font-bold text-ink">
              <Icon name="lock" size={16} className="text-primary" />
              Back-office administrateur
            </p>
            <p className="mt-1 text-[11px] leading-snug text-ink-muted">
              Valider les dépôts mobile money, gérer les comptes inscrits.
            </p>
            <button
              type="button"
              className="bouton-principal mt-2 w-full py-2 text-xs"
              onClick={() => aller('/admin')}
            >
              <Icon name="grid" size={16} />
              Ouvrir l’administration
            </button>
          </div>
        )}

        {/* Abonnement : l'option qui débloque Jobs + la mise en avant du profil artisan. */}
        <div className="mx-3 mb-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-2 text-xs font-bold text-ink">
            <Icon name="wallet" size={16} className="text-primary" />
            {CATALOGUE.titre}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-ink-muted">
            {CATALOGUE.sousTitre}.{' '}
            <span className="font-semibold text-ink">{libellePrixListe()}</span>{' '}
            <span>({CATALOGUE.mentionProvisoire})</span>.
          </p>
          <button
            type="button"
            className="bouton-principal mt-2 w-full py-2 text-xs"
            onClick={() => aller(connecte ? '/profil?section=abonnement' : '/connexion')}
          >
            <Icon name={connecte ? 'unlock' : 'lock'} size={16} />
            {connecte ? 'Gérer mon abonnement' : 'Se connecter pour s’abonner'}
          </button>
        </div>

        <div className="border-t border-line px-3 py-3">
          {connecte ? (
            <button
              type="button"
              className="btn-ghost w-full py-2 text-xs text-danger"
              onClick={() => {
                deconnexion();
                onFermer?.();
                navigate('/');
              }}
            >
              <Icon name="close" size={16} />
              Se déconnecter
            </button>
          ) : (
            <button
              type="button"
              className="bouton-principal w-full py-2 text-xs"
              onClick={() => aller('/connexion')}
            >
              <Icon name="user" size={16} />
              Se connecter / créer mon compte
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
