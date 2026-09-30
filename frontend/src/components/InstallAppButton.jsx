// InstallAppButton.jsx — Invitation d'installation de l'app (PWA, sans APK).
//
// Décisions :
//  - BANNIÈRE FLOTTANTE au-dessus de la bottom nav, jamais un simple lien perdu
//    en bas de page : l'installation est un geste rare, il faut la rendre visible
//    sur le premier écran, sans gêner la navigation (elle se ferme en un clic).
//  - Charte respectée : bandeau orange, texte blanc, bouton blanc à texte orange.
//  - Trois vérités différentes, trois messages (voir pwa.js) :
//      'disponible' -> on peut vraiment installer ici, le clic le fait ;
//      'ios'        -> Safari n'a pas d'invite : « Partager → Sur l'écran d'accueil » ;
//      'manuel'     -> pas d'invite : on indique où se trouve le bouton du navigateur ;
//      'installee'  -> l'app tourne déjà depuis l'écran d'accueil : on NE CACHE PAS
//                      le bouton (c'est demandé), on le rassure et il reste discret.
//  - L'utilisateur ferme la bannière : elle disparaît pour la session, et pour de
//    bon après IGNORANCES_MAX fermetures (compteur en localStorage).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import {
  IGNORANCES_MAX,
  demanderInstallation,
  ecouterInvitation,
  etatInvitation,
  ignorerInvitation,
  invitationMasquee,
} from '../utils/pwa.js';

/** Libellés et icône pour chaque état. Un seul endroit à relire pour le support. */
const CONTENUS = {
  disponible: {
    icone: 'download',
    titre: 'Installer Rejoins’Moi',
    texte: 'Un raccourci sur votre écran d’accueil : plus rapide, et ça s’ouvre même sans réseau.',
    action: 'Installer',
  },
  ios: {
    icone: 'share',
    titre: 'Ajouter à l’écran d’accueil',
    texte: 'Appuyez sur Partager puis « Sur l’écran d’accueil ». Rejoins’Moi s’ouvrira en plein écran.',
    action: null,
  },
  manuel: {
    icone: 'download',
    titre: 'Installer Rejoins’Moi',
    texte: 'Menu du navigateur (⋮) → « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
    action: null,
  },
  installee: {
    icone: 'check',
    titre: 'Rejoins’Moi est installée',
    texte: 'Ouvrez-la depuis votre écran d’accueil : elle s’affiche en plein écran, sans barre d’adresse.',
    action: null,
  },
};

/**
 * @param {{ className?: string }} props
 */
export default function InstallAppButton({ className = '' }) {
  // État lu directement à la première peinture (pwa.js a déjà capturé l'invite,
  // s'il y en avait une) : pas de clignotement, pas de mauvaise promesse.
  const [etat, setEtat] = useState(() => etatInvitation());
  const [masquee, setMasquee] = useState(() => invitationMasquee());
  const [fermeeSession, setFermeeSession] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [note, setNote] = useState(null);
  const banniere = useRef(null);

  useEffect(() => ecouterInvitation(setEtat), []);

  // ── Réserve d'espace sous la page (correctif du 29/09) ──
  // La bannière est en `position: fixed` : elle ne pousse pas le contenu, elle
  // le recouvre. Sur une page chargée, elle cachait donc ses derniers boutons.
  // On annonce sa hauteur réelle au CSS (--reserve-banniere, utilisée par le
  // padding-bottom du corps) et on la remet à zéro dès qu'elle disparaît.
  useEffect(() => {
    const racine = document.documentElement;
    if (masquee || fermeeSession) {
      racine.style.removeProperty('--reserve-banniere');
      return undefined;
    }
    // + 12px : une respiration entre le dernier élément et la bannière.
    racine.style.setProperty('--reserve-banniere', `${(banniere.current?.offsetHeight || 0) + 12}px`);
    return () => racine.style.removeProperty('--reserve-banniere');
  }, [masquee, fermeeSession, etat, note]);

  const installer = useCallback(async () => {
    setEnCours(true);
    setNote(null);
    const resultat = await demanderInstallation();
    setEnCours(false);
    if (resultat === 'acceptee') {
      setNote('Installation lancée : cherchez « Rejoins’Moi » sur votre écran d’accueil.');
    } else if (resultat === 'refusee') {
      setNote('Installation annulée. Vous pourrez réessayer quand vous voulez.');
    } else {
      // Aucune invite du navigateur (elle a déjà servi, ou n'est pas disponible ici).
      setNote('Utilisez le menu du navigateur : « Installer l’application ».');
    }
  }, []);

  const fermer = useCallback(() => {
    const total = ignorerInvitation();
    setFermeeSession(true);
    // Après plusieurs refus, on arrête de proposer : c'est définitif pour cet appareil.
    if (total >= IGNORANCES_MAX) setMasquee(true);
  }, []);

  if (masquee || fermeeSession) return null;

  const contenu = CONTENUS[etat] || CONTENUS.manuel;
  const installee = etat === 'installee';

  return (
    <div
      ref={banniere}
      role="region"
      aria-label="Installer l’application"
      className={`fixed left-0 right-0 z-30 ${className}`}
      // 96px = hauteur de la bottom nav + le bouton central surélevé (§8).
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}
    >
      <div className="ecran">
        <div
          className={`flex items-center gap-3 rounded-md border px-3 py-2 shadow-card animate-fade-up ${
            installee ? 'border-line bg-white text-ink' : 'border-primary-dark bg-primary text-white'
          }`}
        >
          <Icon
            name={contenu.icone}
            size={22}
            className={`shrink-0 ${installee ? 'text-health-dark' : 'text-white'}`}
          />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-tight">{contenu.titre}</p>
            <p className={`text-[11px] leading-snug ${installee ? 'text-ink-muted' : 'text-white/90'}`}>
              {note || contenu.texte}
            </p>
          </div>

          {contenu.action && (
            <button
              type="button"
              onClick={installer}
              disabled={enCours}
              className="shrink-0 rounded-md bg-white px-3 py-2 text-xs font-bold text-primary-dark transition hover:bg-soft active:scale-95 disabled:opacity-60"
            >
              {enCours ? 'Ouverture…' : contenu.action}
            </button>
          )}

          <button
            type="button"
            onClick={fermer}
            aria-label="Masquer l’invitation d’installation"
            className={`-mr-1 shrink-0 rounded-full p-1 transition active:scale-90 ${
              installee ? 'hover:bg-soft' : 'hover:bg-white/20'
            }`}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
