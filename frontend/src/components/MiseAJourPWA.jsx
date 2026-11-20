// MiseAJourPWA.jsx — « Une nouvelle version est disponible. »
//
// Pourquoi ce bandeau existe (16/11) : plusieurs téléphones continuaient d'afficher
// l'ANCIENNE app (sans la localisation GPS, sans la fiche nettoyée) alors que la
// nouvelle version était bel et bien publiée. Le service worker, lui, se mettait
// bien à jour — mais la page déjà ouverte garde en mémoire l'ancien JavaScript :
// le worker change de version sous ses pieds sans que rien ne le signale, et
// l'utilisateur ne voit la nouveauté qu'après avoir fermé TOUTES les fenêtres de
// l'app (ce que personne ne fait). Ce bandeau rend ce moment visible et donne le
// seul geste qui règle la question : recharger.
//
// Trois sources de détection, volontairement cumulées, car aucun navigateur ne les
// fournit toutes de façon fiable :
//   1. `controllerchange` : un nouveau worker a pris la main (`skipWaiting` dans
//      sw.js) — c'est le cas NORMAL sur cette app ;
//   2. `registration.onupdatefound` + `statechange` : une version est téléchargée
//      et attend son tour (si un jour `skipWaiting` disparaît de sw.js). Le clic
//      sur « Mettre à jour » lui envoie alors `SKIP_WAITING` (déjà écouté par
//      sw.js) avant de recharger ;
//   3. `registration.update()` au retour dans l'app puis toutes les 20 minutes :
//      une app restée ouverte sur son écran d'accueil ne recharge jamais sa page ;
//      sans cette relance manuelle, elle n'apprendrait le déploiement qu'au
//      prochain démarrage à froid.
//
// Ce que le bandeau ne fait JAMAIS : recharger tout seul. Un rechargement surprise
// au milieu d'un formulaire (avis, inscription, paiement) ferait perdre la saisie —
// d'où un bandeau qui attend un clic. « Plus tard » le masque pour la session.
//
// Ouverture manuelle : `?maj=1` affiche le bandeau même sans mise à jour détectée
// (même principe que `?pwa=1` et `?sw=1`, voir utils/pwa.js). C'est le recours
// quand un téléphone semble figé sur une vieille version : le lien « Forcer la
// mise à jour » désinscrit le worker, vide les caches `rejoinsmoi-*` et recharge.
// Aucun cache d'une autre application n'est touché, et rien de tout cela ne
// concerne les données ni les paiements (voir sw.js).

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

/** Fréquence de la relance `registration.update()` (app laissée ouverte). */
const INTERVALLE_VERIFICATION = 20 * 60 * 1000;

/** Délai de secours avant rechargement, si le worker ne répond pas à SKIP_WAITING. */
const DELAI_RECHARGEMENT = 3000;

/** `?maj=1` : le bandeau s'affiche même sans mise à jour détectée (recours manuel). */
function affichageForce() {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(window.location.href).searchParams.get('maj') === '1';
  } catch {
    return false;
  }
}

export default function MiseAJourPWA() {
  /** Une version plus récente que celle qui sert la page a été détectée. */
  const [versionPrete, setVersionPrete] = useState(false);
  /** « Plus tard » : on n'insiste pas pendant cette session. */
  const [ignoree, setIgnoree] = useState(false);
  /** Mise à jour lancée : le bouton se verrouille (« Mise à jour… »). */
  const [enCours, setEnCours] = useState(false);

  /** Vrai dès que l'on a demandé au worker d'attente de prendre la main. */
  const attendLeControleur = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    let vivant = true;
    let enregistrement = null;
    let minuterie = null;

    // Une page qui n'est pas encore contrôlée voit arriver le TOUT PREMIER worker :
    // ce n'est pas une mise à jour, c'est l'installation. Sans ce témoin, un
    // premier lancement afficherait « nouvelle version » alors que rien n'a changé.
    let versionServie = Boolean(navigator.serviceWorker.controller);

    const signaler = () => {
      if (vivant && versionServie) setVersionPrete(true);
    };

    const surChangementDeControleur = () => {
      // Le clic « Mettre à jour » attend exactement cet instant : le nouveau worker
      // est aux commandes, le rechargement servira donc la nouvelle page.
      if (attendLeControleur.current) {
        attendLeControleur.current = false;
        window.location.reload();
        return;
      }
      if (!versionServie) {
        versionServie = true;
        return;
      }
      signaler();
    };

    const verifier = () => {
      if (!enregistrement) return;
      // `update()` interroge le serveur (sw.js est toujours revalidé par le
      // navigateur) : c'est ce qui révèle un déploiement pendant que l'app tourne.
      enregistrement.update().catch(() => {
        /* hors ligne : la prochaine relance réessaiera */
      });
    };

    const surRetourDansLApp = () => {
      if (document.visibilityState === 'visible') verifier();
    };

    const brancher = (reg) => {
      enregistrement = reg;

      // Une version déjà téléchargée mais pas encore active (worker « en attente »).
      if (reg.waiting && navigator.serviceWorker.controller) setVersionPrete(true);

      reg.addEventListener('updatefound', () => {
        const nouveau = reg.installing;
        if (!nouveau) return;
        nouveau.addEventListener('statechange', () => {
          // `installed` + une page déjà contrôlée = nouvelle version prête.
          // (Sur une première installation, il n'y a pas encore de contrôleur.)
          if (nouveau.state === 'installed' && navigator.serviceWorker.controller) signaler();
        });
      });

      verifier();
      minuterie = setInterval(verifier, INTERVALLE_VERIFICATION);
      document.addEventListener('visibilitychange', surRetourDansLApp);
    };

    navigator.serviceWorker.addEventListener('controllerchange', surChangementDeControleur);
    navigator.serviceWorker.ready
      .then((reg) => {
        if (vivant) brancher(reg);
      })
      .catch(() => {
        /* service worker refusé : l'app fonctionne sans, aucun bandeau à afficher */
      });

    return () => {
      vivant = false;
      navigator.serviceWorker.removeEventListener('controllerchange', surChangementDeControleur);
      document.removeEventListener('visibilitychange', surRetourDansLApp);
      if (minuterie) clearInterval(minuterie);
    };
  }, []);

  /** Met à jour : on recharge sur la nouvelle version. */
  async function appliquerMiseAJour() {
    setEnCours(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.waiting) {
        // Version encore en attente : on lui demande la main, et c'est
        // `controllerchange` qui déclenchera le rechargement.
        attendLeControleur.current = true;
        reg.waiting.postMessage('SKIP_WAITING');
        setTimeout(() => {
          if (attendLeControleur.current) window.location.reload();
        }, DELAI_RECHARGEMENT);
        return;
      }
    } catch {
      /* enregistrement illisible : on recharge, ce sera déjà mieux */
    }
    // Version déjà active : un simple rechargement suffit (le nouveau cache sert
    // la nouvelle page). C'est le cas courant, `skipWaiting` étant dans sw.js.
    window.location.reload();
  }

  /** Dernier recours : on jette worker et caches, puis on repart du réseau. */
  async function forcerMiseAJour() {
    setEnCours(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
    } catch {
      /* rien à désinscrire */
    }
    try {
      if (typeof caches !== 'undefined') {
        const noms = await caches.keys();
        await Promise.all(
          // Uniquement les caches de cette app : jamais ceux d'une autre origine.
          noms.filter((nom) => nom.startsWith('rejoinsmoi-')).map((nom) => caches.delete(nom))
        );
      }
    } catch {
      /* stockage refusé (navigation privée) : le rechargement fera l'affaire */
    }
    window.location.reload();
  }
  const afficher = (versionPrete || affichageForce()) && !ignoree;
  if (!afficher) return null;

  return (
    /* En HAUT de l'écran : le bas est occupé, selon la page, par la navigation
       principale ou par la barre « Aller chez … » de la fiche. Le bandeau couvre
       la barre du haut tant qu'il est là — c'est voulu : il est éphémère, il se
       ferme, et il ne pousse pas le contenu (aucun décalage de mise en page). */
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-40 animate-fade-up border-b border-primary-dark/40 bg-primary text-white shadow-card"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="ecran flex items-center gap-2 py-2">
        <Icon name="refresh" size={16} className="shrink-0" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[11px] font-bold">Une nouvelle version est disponible</p>
          <p className="text-[10px] text-white/85">Rechargez pour en profiter.</p>
        </div>
        <button
          type="button"
          disabled={enCours}
          className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-primary-dark transition active:scale-95 disabled:opacity-60"
          onClick={appliquerMiseAJour}
        >
          {enCours ? 'Mise à jour…' : 'Mettre à jour'}
        </button>
        <button
          type="button"
          aria-label="Plus tard"
          title="Plus tard"
          className="shrink-0 rounded-full p-1 text-white/80 transition active:scale-95"
          onClick={() => setIgnoree(true)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="ecran pb-2">
        <button
          type="button"
          disabled={enCours}
          className="text-[10px] font-bold text-white/80 underline disabled:opacity-60"
          onClick={forcerMiseAJour}
        >
          L’app reste bloquée sur l’ancienne version ? Forcer la mise à jour
        </button>
      </div>
    </div>
  );
}
