// InstallAppButton.jsx — Invitation d'installation de l'app (PWA, sans APK).
//
// Décisions :
//  - BANNIÈRE FLOTTANTE au-dessus de la bottom nav, jamais un simple lien perdu
//    en bas de page : l'installation est un geste rare, il faut la rendre visible
//    sur le premier écran, sans gêner la navigation (elle se ferme en un clic).
//  - Charte v2 respectée : la bannière n'est plus un bandeau orange PLEIN (elle
//    pesait lourd au-dessus de la bottom nav, sur toutes les pages). C'est
//    désormais une surface blanche/ivoire sur fond clair : l'orange ne revient
//    que par un liseré vertical, la pastille d'icône et le bouton « Installer ».
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
  CHEMIN_SERVICE_WORKER,
  IGNORANCES_MAX,
  demanderInstallation,
  ecouterInvitation,
  etatInvitation,
  etatServiceWorker,
  ignorerInvitation,
  invitationForcee,
  invitationMasquee,
  lireIgnorances,
  reinitialiserInvitation,
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
  // `?pwa=1` dans l'adresse : affichage forcé + diagnostic à l'écran (voir pwa.js).
  // C'est aussi la sortie de secours si l'invitation a été fermée trois fois.
  const [forcee] = useState(invitationForcee);
  const [diagnostic, setDiagnostic] = useState(null);
  const banniere = useRef(null);

  useEffect(() => ecouterInvitation(setEtat), []);

  // Diagnostic demandé explicitement : on affiche ce que le navigateur voit vraiment
  // (service worker enregistré ? jusqu'où son périmètre s'étend ?), au lieu de deviner.
  useEffect(() => {
    if (!forcee) return undefined;
    let monte = true;
    etatServiceWorker().then((etatSw) => {
      if (monte) setDiagnostic(etatSw);
    });
    return () => {
      monte = false;
    };
  }, [forcee]);

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

  // ── Invitation fermée trop de fois (3 refus, compteur localStorage) ──
  // Avant, on renvoyait carrément `null` : le bouton d'installation disparaissait
  // DÉFINITIVEMENT de l'app (bug signalé le 30/09 : « le bandeau ne s'affiche plus
  // du tout »), alors que le service worker, lui, n'était pas en cause. On affiche
  // donc une pastille discrète : l'invitation automatique reste retirée, mais
  // l'installation reste accessible en un clic si l'utilisateur la cherche.
  if ((masquee || fermeeSession) && !forcee) {
    return (
      <button
        type="button"
        onClick={() => {
          reinitialiserInvitation();
          setFermeeSession(false);
          setMasquee(false);
        }}
        aria-label="Réafficher l’invitation d’installation"
        className="fixed right-3 z-30 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-white px-3 py-2 text-[11px] font-bold text-primary-dark shadow-card transition hover:bg-soft active:scale-95"
        // Même marge que la bannière : au-dessus de la bottom nav (§8).
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}
      >
        <Icon name="download" size={14} />
        Installer l’app
      </button>
    );
  }

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
        {forcee && (
          <p className="mb-1 rounded-md bg-white/95 px-2 py-1 text-center text-[10px] leading-snug text-ink-muted shadow-card">
            Diagnostic PWA — état : {etat} · invitations fermées : {lireIgnorances()} · service worker :{' '}
            {diagnostic || 'vérification…'} · worker attendu : {CHEMIN_SERVICE_WORKER}
          </p>
        )}

        {/* v2 : surface blanche/ivoire, l'orange réduit à un accent — un liseré
            vertical, la pastille de l'icône et le bouton d'action. */}
        <div
          data-banniere-installation=""
          className="relative flex items-center gap-3 overflow-hidden rounded-md border border-line bg-white py-2 pl-4 pr-3 text-ink shadow-card animate-fade-up"
        >
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-1 ${
              installee ? 'bg-health' : 'bg-gradient-to-b from-primary-light to-primary'
            }`}
          />

          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              installee ? 'bg-health-light text-health-dark' : 'bg-soft text-primary'
            }`}
          >
            <Icon name={contenu.icone} size={18} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-tight text-ink">{contenu.titre}</p>
            <p className="text-[11px] leading-snug text-ink-muted">{note || contenu.texte}</p>
          </div>

          {contenu.action && (
            <button
              type="button"
              onClick={installer}
              disabled={enCours}
              className="bouton-principal shrink-0 px-3 py-2 text-xs"
            >
              {enCours ? 'Ouverture…' : contenu.action}
            </button>
          )}

          <button
            type="button"
            onClick={fermer}
            aria-label="Masquer l’invitation d’installation"
            className="-mr-1 shrink-0 rounded-full p-1 text-ink-muted transition hover:bg-soft active:scale-90"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
