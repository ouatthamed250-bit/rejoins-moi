// useMesureBlocBas.js — Mesure RÉELLE du bloc fixe du bas d'écran.
//
// POURQUOI CE FICHIER (bug confirmé sur un vrai téléphone, Chrome Android, 08/10)
// La barre « Retour / Suivant » de l'inscription était posée à `bottom-[68px]`,
// une valeur ÉCRITE EN DUR censée représenter la navigation basse. Or cette
// navigation n'a PAS de hauteur fixe : elle dépend de la barre système
// (env(safe-area-inset-bottom)), du zoom de police du téléphone, de la police
// réellement chargée (Poppins/Nunito viennent de Google Fonts) et du bouton « + »
// surélevé de 24 px. Constat sur le téléphone : la barre flottait au-dessus de la
// navigation, avec un interstice où le contenu restait visible — et la fin du
// contenu passait sous la barre, car la réserve d'espace de la page
// (`espace-barre-action`) était elle-même écrasée par le `py-3` de Tailwind,
// écrit plus loin dans la feuille de style.
//
// LA RÈGLE, DÉSORMAIS : on ne devine plus aucune hauteur, on la MESURE.
// Deux observateurs (ResizeObserver) alimentent des variables CSS posées sur
// `:root`, seules sources de vérité pour le positionnement du bloc ET pour la
// réserve d'espace sous le contenu :
//   --hauteur-nav          boîte de la navigation basse. La barre d'action s'y pose
//                          exactement (`bottom: var(--hauteur-nav)`) : aucun
//                          interstice, quelle que soit la barre système.
//   --hauteur-barre-action hauteur de la barre d'action posée sur la navigation.
//   --debord-nav           remontée MESURÉE du bouton « + » au-dessus du contenu de
//                          la navigation (voir debordBoutonPlus plus bas). Sert à
//                          dégager le bouton quand une barre d'action se pose : sans
//                          cela, la barre lui tranchait le haut et « Suivant »
//                          semblait appuyé dessus (bug du 16/11, étape Photos).
//   --hauteur-bloc-bas     hauteur du bloc TEL QU'IL EST DESSINÉ :
//                            · avec une barre d'action : nav + barre (la barre,
//                              opaque, recouvre le bouton « + » surélevé) ;
//                            · sans barre d'action : nav + bouton « + » surélevé.
//                          C'est cette valeur (plus --marge-securite-bas) que le
//                          corps réserve en bas de page : le dernier élément est
//                          donc entièrement défilable AU-DESSUS du bloc.
//
// Les mesures sont refaites à chaque changement de taille (ResizeObserver), de
// fenêtre, de rotation et à l'arrivée des polices : une hauteur mesurée une seule
// fois au montage serait aussi fausse qu'une constante écrite en dur.

import { useCallback, useLayoutEffect } from 'react';

/** Mesures courantes, partagées par tous les écrans (une seule source de vérité). */
const mesures = { navBoite: 0, navVisuelle: 0, barreAction: 0, debordNav: 0 };

/** Hauteur de la boîte d'un élément (bordures et remplissage compris).
 *  ARRONDI AU-DESSUS : une valeur arrondie au plus proche pourrait publier 1px de
 *  MOINS que la réalité, et le dernier élément de la page empiéterait alors sur le
 *  bloc (mesuré : 15,7px de marge au lieu des 16px exigés). On réserve toujours un
 *  peu plus que le bloc, jamais un peu moins. */
function hauteurBoite(element) {
  if (!element) return 0;
  return Math.max(0, Math.ceil(element.getBoundingClientRect().height));
}

/**
 * Hauteur VISIBLE depuis le bas de la fenêtre : la boîte, mais aussi ce qui en
 * dépasse vers le haut — le bouton « + » de la navigation est remonté de 24 px
 * (`-mt-6`) et recouvre le contenu : il fait partie du bloc.
 */
function hauteurVisuelle(element) {
  if (!element) return 0;
  let haut = element.getBoundingClientRect().top;
  for (const enfant of element.querySelectorAll('*')) {
    const boite = enfant.getBoundingClientRect();
    if (boite.width > 0 && boite.height > 0) haut = Math.min(haut, boite.top);
  }
  return Math.max(0, Math.ceil(window.innerHeight - haut));
}

/**
 * Débord du bouton « + » AU-DESSUS du haut du CONTENU de la navigation.
 *
 * Le bouton central est remonté de quelques dizaines de pixels (`-mt-6`) et
 * flotte au-dessus de la boîte de la navigation. Tant qu'aucune barre d'action
 * n'est là, c'est voulu : il ressort du bloc, sur le contenu. Dès qu'une barre
 * d'action se pose, en revanche, elle se posait sur le haut de la BOÎTE et lui
 * tranchait le haut — mesuré sur la capture du 16/11 (inscription, étape Photos) :
 * le « + » était coupé net, juste sous le bouton « Suivant ». theme.css utilise
 * donc cette valeur pour dégager la navigation sous la barre (padding-top) : sa
 * boîte englobe le bouton, la barre se pose au-dessus de lui, rien n'est recouvert.
 *
 * POURQUOI DEPUIS LE CONTENU (et non depuis la boîte) : la navigation est ancrée
 * en bas, donc un `padding-top` la fait grandir VERS LE HAUT sans déplacer son
 * contenu. Mesurer depuis la boîte aurait créé une boucle — le remplissage
 * agrandit la boîte, ce qui réduit le débord mesuré, ce qui réduit le remplissage
 * — et la barre aurait oscillé d'une image à l'autre. Depuis le haut du contenu,
 * la valeur est stable et le dégagement ne se mesure pas lui-même.
 */
function debordBoutonPlus(nav) {
  const bouton = nav?.querySelector('[data-bouton-plus]');
  if (!bouton) return 0;
  const style = getComputedStyle(nav);
  // getBoundingClientRect englobe bordures et remplissage : le haut du CONTENU est
  // donc le haut de la boîte + bordure du haut + remplissage du haut.
  const hautContenu =
    nav.getBoundingClientRect().top +
    (parseFloat(style.borderTopWidth) || 0) +
    (parseFloat(style.paddingTop) || 0);
  return Math.max(0, Math.ceil(hautContenu - bouton.getBoundingClientRect().top));
}

/** Publie les mesures dans les variables CSS lues par theme.css. */
function publier() {
  const racine = document.documentElement;
  // Bloc « tel qu'il est dessiné » : dès qu'une barre d'action existe, elle est
  // au-dessus de la navigation dans l'empilement (z-index 35 > 30). La navigation
  // a alors été dégagée du bouton « + » (padding-top, voir theme.css) : sa boîte
  // contient donc déjà le bouton, et le bloc est simplement nav + barre.
  const bloc = mesures.barreAction > 0 ? mesures.navBoite + mesures.barreAction : mesures.navVisuelle;
  racine.style.setProperty('--hauteur-nav', `${mesures.navBoite}px`);
  racine.style.setProperty('--hauteur-barre-action', `${mesures.barreAction}px`);
  racine.style.setProperty('--debord-nav', `${mesures.debordNav}px`);
  racine.style.setProperty('--hauteur-bloc-bas', `${bloc}px`);
}

/** Re-mesure au fil de l'eau : boîte observée, fenêtre, rotation, polices. */
function useRemesure(mesurer, ref) {
  // useLayoutEffect : la mesure est posée AVANT la première peinture, sinon les
  // éléments posés sur le bloc (bannière d'installation, feuille du « + ») sont
  // dessinés une image au mauvais endroit puis sautent.
  useLayoutEffect(() => {
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    if (ref.current) {
      // `box: 'border-box'` est essentiel : sans lui, ResizeObserver ne surveille
      // que la boîte de CONTENU, et un changement de remplissage — la marge de la
      // barre système qui s'ajoute, par exemple — ne déclencherait aucune re-mesure
      // (mesuré dans Chrome : la barre d'action ne suivait pas).
      observateur.observe(ref.current, { box: 'border-box' });
      // Les enfants comptent aussi : le libellé d'un onglet, un badge ou le bouton
      // « + » peuvent changer la hauteur VISIBLE sans changer la boîte.
      for (const enfant of ref.current.querySelectorAll('*')) observateur.observe(enfant, { box: 'border-box' });
    }
    window.addEventListener('resize', mesurer);
    window.addEventListener('orientationchange', mesurer);
    // Les polices web arrivent après le premier rendu : sans cette re-mesure, la
    // hauteur publiée serait celle de la police de secours.
    document.fonts?.ready?.then(mesurer).catch(() => {});
    return () => {
      observateur.disconnect();
      window.removeEventListener('resize', mesurer);
      window.removeEventListener('orientationchange', mesurer);
    };
  }, [mesurer, ref]);
}

/** À poser sur la navigation basse (BottomNav) : elle est collée en bas d'écran. */
export function useMesureNavBas(ref) {
  const mesurer = useCallback(() => {
    if (!ref.current) return;
    mesures.navBoite = hauteurBoite(ref.current);
    mesures.navVisuelle = hauteurVisuelle(ref.current);
    mesures.debordNav = debordBoutonPlus(ref.current);
    publier();
  }, [ref]);

  // L'attribut sur <html> dit au CSS qu'une navigation basse est à l'écran : c'est
  // elle qui est au contact de la barre système, la barre d'action posée dessus ne
  // doit donc pas réserver cette marge une seconde fois (voir theme.css). Il est
  // posé AVANT la mesure, sinon la hauteur mesurée serait celle de l'ancienne mise
  // en page (marge absente) : deux images de réserve fausse.
  useLayoutEffect(() => {
    document.documentElement.dataset.navBasse = 'oui';
    return () => {
      delete document.documentElement.dataset.navBasse;
      mesures.navBoite = 0;
      mesures.navVisuelle = 0;
      mesures.debordNav = 0;
      publier();
    };
  }, []);

  useRemesure(mesurer, ref);
}

/** À poser sur une barre d'action fixe (composant BarreActionFixe). */
export function useMesureBarreAction(ref) {
  const mesurer = useCallback(() => {
    if (!ref.current) return;
    mesures.barreAction = hauteurBoite(ref.current);
    publier();
  }, [ref]);

  // Même principe : l'attribut permet de supprimer le trait de séparation entre la
  // barre et la navigation, pour qu'elles forment UN SEUL bloc (voir theme.css).
  useLayoutEffect(() => {
    document.documentElement.dataset.barreAction = 'oui';
    return () => {
      delete document.documentElement.dataset.barreAction;
      mesures.barreAction = 0;
      publier();
    };
  }, []);

  useRemesure(mesurer, ref);
}
