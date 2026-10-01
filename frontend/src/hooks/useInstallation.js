// useInstallation.js — État d'installation de l'app (PWA), logique PARTAGÉE.
//
// Pourquoi un hook ? Deux endroits proposent désormais l'installation :
//   - la bannière flottante (InstallAppButton), qui n'apparaît QUE tant que l'app
//     n'est pas installée ;
//   - le menu hamburger (MenuPrincipal), qui affiche l'action d'installation — ou
//     un simple repère « Rejoins'Moi est installée » — une fois l'app installée.
// La règle (ce que le navigateur propose, ce que l'utilisateur doit lire, ce qui
// se passe au clic) ne doit exister qu'UNE fois, sinon les deux écrans finiront
// par diverger : c'est exactement le défaut signalé le 30/09 — le bandeau
// d'installation flottait encore au-dessus du contenu alors que l'app était
// déjà installée sur le téléphone.
//
// Ce que le hook ne fait PAS : il ne simule jamais une installation. Sans invite
// du navigateur (`beforeinstallprompt`), il le dit et explique la marche à suivre
// (voir utils/pwa.js, demanderInstallation).

import { useCallback, useEffect, useState } from 'react';

import {
  CHEMIN_SERVICE_WORKER,
  demanderInstallation,
  ecouterInvitation,
  etatInvitation,
  etatServiceWorker,
  invitationForcee,
  lireIgnorances,
} from '../utils/pwa.js';

/**
 * Libellés et icône pour chaque état. Un seul endroit à relire pour le support.
 * `action: null` signifie que le navigateur ne sait pas installer tout seul : le
 * texte explique alors le geste à faire (iOS, menu du navigateur).
 */
export const CONTENUS_INSTALLATION = {
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
 * État d'installation, à jour en direct (installation lancée depuis l'onglet,
 * invite reçue après le montage, retour dans l'onglet après avoir quitté l'app
 * installée : voir `ecouterInvitation`).
 *
 * @returns {{
 *   etat: 'installee'|'disponible'|'ios'|'manuel',
 *   contenu: {icone: string, titre: string, texte: string, action: string|null},
 *   installee: boolean,
 *   installable: boolean,
 *   installer: () => Promise<void>,
 *   enCours: boolean,
 *   note: string|null,
 *   forcee: boolean,
 *   diagnostic: string|null,
 * }}
 */
export function useInstallation() {
  // État lu directement à la première peinture (pwa.js a déjà capturé l'invite,
  // s'il y en avait une) : pas de clignotement, pas de mauvaise promesse.
  const [etat, setEtat] = useState(() => etatInvitation());
  const [enCours, setEnCours] = useState(false);
  const [note, setNote] = useState(null);
  // `?pwa=1` dans l'adresse : diagnostic à l'écran (voir pwa.js). C'est aussi la
  // sortie de secours si l'invitation a été fermée trois fois. Le diagnostic est
  // partagé comme le reste : app installée, la bannière n'existe plus, mais le
  // menu hamburger continue de l'afficher si on l'a demandé.
  const [forcee] = useState(invitationForcee);
  const [etatSw, setEtatSw] = useState(null);

  useEffect(() => ecouterInvitation(setEtat), []);

  // Diagnostic demandé explicitement : on affiche ce que le navigateur voit vraiment
  // (service worker enregistré ? jusqu'où son périmètre s'étend ?), au lieu de deviner.
  useEffect(() => {
    if (!forcee) return undefined;
    let monte = true;
    etatServiceWorker().then((reponse) => {
      if (monte) setEtatSw(reponse);
    });
    return () => {
      monte = false;
    };
  }, [forcee]);

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

  const contenu = CONTENUS_INSTALLATION[etat] || CONTENUS_INSTALLATION.manuel;
  // Phrase lisible pour le support : ce que le navigateur a réellement répondu.
  const diagnostic = forcee
    ? `état : ${etat} · invitations fermées : ${lireIgnorances()} · service worker : ${
        etatSw || 'vérification…'
      } · worker attendu : ${CHEMIN_SERVICE_WORKER}`
    : null;

  return {
    etat,
    contenu,
    installee: etat === 'installee',
    installable: etat === 'disponible',
    installer,
    enCours,
    note,
    forcee,
    diagnostic,
  };
}

export default useInstallation;
