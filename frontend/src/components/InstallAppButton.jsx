// InstallAppButton.jsx — Invitation d'installation de l'app (PWA, sans APK).
//
// Décisions (revues le 16/11, correction « la bannière masque le contenu ») :
//  - BANDEAU DANS LE FLUX DE LA PAGE, en tête du contenu — plus une surface
//    FLOTTANTE au-dessus du bloc fixe du bas. Une bannière `position: fixed` posée
//    sur une page qui défile recouvre forcément ce qui se trouve dessous : sur
//    /recherche, une carte de résultat (et jusqu'au texte de l'état vide) passait
//    sous elle. On ne compense pas ça avec une marge de pied de page : celle-ci ne
//    protège que la FIN du document. Un bandeau dans le flux ne recouvre RIEN, par
//    construction, et reste vu dès le premier écran puisqu'il est en tête.
//  - Quatre vérités différentes, quatre messages (voir hooks/useInstallation.js) :
//      'disponible' -> on peut vraiment installer ici, le clic le fait ;
//      'ios'        -> Safari n'a pas d'invite : « Partager → Sur l'écran d'accueil » ;
//      'manuel'     -> pas d'invite : on indique où se trouve le bouton du navigateur ;
//      'installee'  -> l'app tourne déjà depuis l'écran d'accueil : le bandeau
//                      DISPARAÎT (correctif du 30/09).
//  - L'utilisateur ferme le bandeau : il disparaît pour la session, et pour de bon
//    après IGNORANCES_MAX fermetures (compteur en localStorage). L'installation
//    reste accessible en permanence dans le menu hamburger (MenuPrincipal) : plus
//    besoin de la pastille flottante « Installer l'app », qui était un second
//    élément fixe susceptible de recouvrir un bouton.
//  - Charte v2 respectée : surface blanche/ivoire, l'orange ne revient que par un
//    liseré vertical, la pastille d'icône et le bouton « Installer ».
//  - Petits écrans Android (360 px) : le texte secondaire est limité à deux lignes
//    (`line-clamp-2`), le bouton et la croix ne se compriment jamais (`shrink-0`),
//    et les marges se resserrent (`p-2 sm:p-2.5`). Rien ne peut être coupé.

import { useCallback, useState } from 'react';
import { Icon } from './Icons.jsx';
import { useInstallation } from '../hooks/useInstallation.js';
import { IGNORANCES_MAX, ignorerInvitation, invitationMasquee } from '../utils/pwa.js';

/**
 * @param {{ className?: string }} props
 */
export default function InstallAppButton({ className = '' }) {
  // État partagé avec le menu hamburger : l'installation se propose désormais des
  // deux endroits, la règle (invite du navigateur, messages, action) ne doit
  // exister qu'une fois.
  const { contenu, installee, installer, enCours, note, forcee, diagnostic } = useInstallation();
  const [masquee, setMasquee] = useState(() => invitationMasquee());
  const [fermeeSession, setFermeeSession] = useState(false);

  const fermer = useCallback(() => {
    const total = ignorerInvitation();
    setFermeeSession(true);
    // Après plusieurs refus, on arrête de proposer : c'est définitif pour cet appareil.
    if (total >= IGNORANCES_MAX) setMasquee(true);
  }, []);

  // ── App DÉJÀ INSTALLÉE : rien, jamais ──
  // C'est le correctif du 30/09 : une app installée continuait d'afficher le
  // bandeau « Installer Rejoins'Moi » au-dessus du contenu. Une fois installée,
  // l'option d'installation n'a plus rien à faire dans le fil des pages : elle vit
  // dans le menu hamburger (MenuPrincipal), sous forme d'un simple repère
  // « app installée ».
  if (installee) return null;

  // ── Invitation fermée (session ou compteur de refus) ──
  // `?pwa=1` force le retour du bandeau : c'est le chemin de diagnostic expliqué
  // dans docs/DEPLOIEMENT.md et vérifié par `npm run verifier:pwa`.
  if ((masquee || fermeeSession) && !forcee) return null;


  return (
    <section
      data-banniere-installation=""
      role="region"
      aria-label="Installer l’application"
      className={`ecran mb-2 ${className}`}
    >
      {diagnostic && (
        <p className="mb-1 rounded-md bg-white/95 px-2 py-1 text-[10px] leading-snug text-ink-muted shadow-card">
          Diagnostic PWA — {diagnostic}
        </p>
      )}

      <div className="relative flex items-center gap-2.5 overflow-hidden rounded-md border border-line bg-white py-2 pl-3 pr-2 text-ink shadow-card animate-fade-up sm:gap-3 sm:pl-4 sm:pr-3">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary-light to-primary"
        />

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-primary sm:h-9 sm:w-9">
          <Icon name={contenu.icone} size={17} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold leading-tight text-ink">{contenu.titre}</p>
          <p className="line-clamp-3 text-[10px] leading-snug text-ink-muted sm:text-[11px]">
            {note || contenu.texte}
          </p>
        </div>

        {contenu.action && (
          <button
            type="button"
            onClick={installer}
            disabled={enCours}
            className="bouton-principal shrink-0 px-2.5 py-2 text-[11px] sm:px-3 sm:text-xs"
          >
            {enCours ? 'Ouverture…' : contenu.action}
          </button>
        )}

        <button
          type="button"
          onClick={fermer}
          data-fermer-invitation=""
          aria-label="Masquer l’invitation d’installation"
          className="-mr-1 shrink-0 rounded-full p-1 text-ink-muted transition hover:bg-soft active:scale-90"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </section>
  );
}
