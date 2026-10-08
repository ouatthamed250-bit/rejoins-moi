// useGeolocation.js — Position de l'utilisateur, exposée aux écrans.
//
// RÉÉCRITURE DU BLOC B (correction de lancement) : le hook ne demande plus la
// position « au chargement, sans explication ». Il LIT d'abord l'autorisation
// (utils/position.js → decisionPosition) et en tire quatre comportements :
//
//   granted  → la demande part automatiquement : aucun message du navigateur ne
//              s'affichera, il n'y a donc rien à expliquer ;
//   prompt   → on NE demande PAS : l'écran affiche un bandeau qui dit à quoi sert la
//              localisation, avec un bouton. La demande part d'un geste, avec son
//              contexte — c'est ce qui manquait pour que les gens acceptent ;
//   denied   → on n'appelle plus du tout (l'appel échouait instantanément à chaque
//              visite) ; l'écran explique comment débloquer et propose de DÉSIGNER
//              sa position sur la carte ;
//   inconnue → navigateur sans Permissions API (Safari) : comportement d'hier
//              (appel direct), mais si le refus survient alors qu'aucun refus n'était
//              enregistré, on propose le geste au lieu de dire « refusé ».
//
// Et surtout : dès que l'utilisateur revient des réglages du navigateur avec
// « Autoriser », la position est obtenue SANS qu'il ait à retoucher l'écran
// (`surChangementPermission` + retour au premier plan).
//
// Décisions de terrain conservées :
//  - `enableHighAccuracy: false` : le GPS haute précision met 20-30 s à accrocher et
//    vide la batterie ; pour trier des commerces de quartier, la précision réseau suffit.
//  - `timeout: 8000` : au-delà, `position` reste inchangée.
//  - AUCUN point inventé : on ne fabrique jamais une position « au cas où » (des
//    distances fausses, ex. « 236 m » pour un lieu à 22 km, sont pires qu'aucune
//    distance).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  decisionPosition,
  enregistrerPosition,
  etatPermissionGeo,
  lirePositionMemorisee,
  oublierPosition,
  surChangementPermission,
  surPosition,
} from '../utils/position.js';

/**
 * @param {{ auto?: boolean }} [options] `auto: false` = ne rien demander au montage
 *   (l'écran pilote lui-même la demande).
 * @returns {{ lat: number|null, lng: number|null, position: {lat:number,lng:number}|null,
 *   loading: boolean, error: string|null, depuisCache: boolean, refuser: boolean,
 *   permission: 'granted'|'denied'|'prompt'|'inconnue', demandeRequise: boolean,
 *   gesteRequis: boolean, source: 'gps'|'manuel'|null, ageMinutes: number|null,
 *   relancer: () => void, choisirPosition: (lat: number, lng: number) => void,
 *   oublier: () => void }}
 */
export function useGeolocation({ auto = true } = {}) {
  const memoireInitiale = typeof window === 'undefined' ? null : lirePositionMemorisee();
  const [position, setPosition] = useState(
    memoireInitiale ? { lat: memoireInitiale.lat, lng: memoireInitiale.lng } : null
  );
  const [source, setSource] = useState(memoireInitiale?.source || null);
  const [ageMinutes, setAgeMinutes] = useState(memoireInitiale?.ageMinutes ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [depuisCache, setDepuisCache] = useState(Boolean(memoireInitiale));
  // `refuser` = refus ENREGISTRÉ par le navigateur : l'écran donne la marche à suivre.
  const [refuser, setRefuser] = useState(false);
  // `gesteRequis` = un appel a échoué faute de geste utilisateur (Safari) : on demande
  // simplement de toucher « Activer », sans parler de réglages.
  const [gesteRequis, setGesteRequis] = useState(false);
  const [permission, setPermission] = useState('inconnue');
  const [demandeRequise, setDemandeRequise] = useState(false);
  const monte = useRef(true);
  const positionRef = useRef(position);
  positionRef.current = position;

  /**
   * Demande la position au téléphone. C'est le SEUL appel à `getCurrentPosition`
   * du module : il n'est déclenché que par une décision explicite (autorisation
   * déjà accordée) ou par un geste de l'utilisateur.
   */
  const demander = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      setDemandeRequise(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!monte.current) return;
        const { latitude, longitude } = pos.coords;
        const memorisee = enregistrerPosition(latitude, longitude, 'gps');
        setPosition({ lat: latitude, lng: longitude });
        setSource('gps');
        setAgeMinutes(memorisee?.ageMinutes ?? 0);
        setDepuisCache(false);
        setRefuser(false);
        setGesteRequis(false);
        setPermission('granted');
        setDemandeRequise(false);
        setLoading(false);
      },
      async (err) => {
        if (!monte.current) return;
        setLoading(false);
        if (err.code === 1) {
          // PERMISSION_DENIED. Deux causes très différentes, à ne pas confondre :
          // soit le refus est ENREGISTRÉ (il faut passer par les réglages du site),
          // soit le navigateur exige un geste (Safari) et l'appel automatique vient
          // d'échouer en silence — dire « refusé » serait alors un mensonge.
          const etat = await etatPermissionGeo();
          if (!monte.current) return;
          setPermission(etat);
          if (etat === 'denied') {
            setRefuser(true);
            setGesteRequis(false);
            setError("Localisation refusée pour ce site. Aucune distance n'est affichée tant qu'elle n'est pas autorisée.");
          } else {
            setRefuser(false);
            setGesteRequis(true);
            setError("Touchez « Activer » : le navigateur doit vous demander l'autorisation avant de donner la position.");
          }
          setDemandeRequise(true);
          return;
        }
        // 2 = POSITION_UNAVAILABLE (GPS coupé), 3 = TIMEOUT : rien d'inventé, on le dit.
        setGesteRequis(false);
        setError(
          err.code === 3
            ? 'Le téléphone met trop de temps à trouver la position. Réessayez à l’extérieur.'
            : 'Localisation indisponible. Vérifiez que la localisation est activée sur le téléphone.'
        );
        setDemandeRequise(true);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  /**
   * Relit l'autorisation et en tire la conduite à tenir. Appelée au montage, quand
   * le navigateur signale un changement, et au retour au premier plan (le seul moyen
   * de voir un changement sur les navigateurs sans `onchange`).
   */
  const rafraichirPermission = useCallback(async () => {
    const etat = await etatPermissionGeo();
    if (!monte.current) return etat;
    setPermission(etat);
    const decision = decisionPosition(etat);
    setDemandeRequise(decision.actionRequise);
    setRefuser(decision.refus);
    if (decision.demanderMaintenant && !positionRef.current) {
      // `positionRef` évite de relancer une mesure alors qu'une position (mémoire
      // récente ou point choisi sur la carte) est déjà utilisable.
      demander();
    } else if (!decision.actionRequise) {
      setGesteRequis(false);
    }
    return etat;
  }, [demander]);

  /** Point choisi par l'utilisateur sur la carte : un choix, pas une mesure. */
  const choisirPosition = useCallback((lat, lng) => {
    const memorisee = enregistrerPosition(lat, lng, 'manuel');
    setPosition({ lat: Number(lat), lng: Number(lng) });
    setSource('manuel');
    setAgeMinutes(0);
    setDepuisCache(false);
    setGesteRequis(false);
    setDemandeRequise(false);
    setError(null);
    return memorisee;
  }, []);

  /** L'utilisateur ne veut (ou ne peut) plus utiliser sa position : on l'oublie. */
  const oublier = useCallback(() => {
    oublierPosition();
    setPosition(null);
    setSource(null);
    setAgeMinutes(null);
    setDepuisCache(false);
  }, []);

  useEffect(() => {
    monte.current = true;
    let desabonner = () => {};

    (async () => {
      // Décision du montage : autorisation connue → on agit ; demande à faire ou
      // refus enregistré → message + bouton, et AUCUN appel automatique.
      const decision = decisionPosition(await rafraichirPermission());
      if (decision.explication === 'etat_inconnu' && auto && !positionRef.current) {
        // Cas `granted` : `rafraichirPermission` a déjà lancé la demande.
        // Cas `inconnue` (Safari) : on tente l'appel comme avant, sans bloquer l'écran.
        demander();
      }
      // Changement d'autorisation signalé par le navigateur (retour des réglages
      // avec « Autoriser ») : la position arrive sans autre geste de l'utilisateur.
      desabonner = await surChangementPermission((etat) => {
        if (!monte.current) return;
        setPermission(etat);
        const d = decisionPosition(etat);
        setDemandeRequise(d.actionRequise);
        setRefuser(d.refus);
        if (d.demanderMaintenant) demander();
      });
    })();

    // Retour au premier plan : dernier filet pour les navigateurs qui ne signalent
    // pas le changement d'autorisation (WebView Android, anciens Chrome).
    function surVisibilite() {
      if (document.visibilityState === 'visible' && !positionRef.current) rafraichirPermission();
    }
    document.addEventListener('visibilitychange', surVisibilite);

    // Un autre écran a choisi une position (ou l'a oubliée) : on s'aligne SANS
    // rechargement, pour que distances et tri restent cohérents partout.
    const desabonnerPosition = surPosition((p) => {
      if (!monte.current) return;
      if (p) {
        setPosition({ lat: Number(p.lat), lng: Number(p.lng) });
        setSource(p.source);
        setAgeMinutes(p.ageMinutes ?? 0);
        setDepuisCache(false);
        setError(null);
      } else {
        setPosition(null);
        setSource(null);
        setAgeMinutes(null);
        setDepuisCache(false);
      }
    });

    return () => {
      monte.current = false;
      desabonner();
      desabonnerPosition();
      document.removeEventListener('visibilitychange', surVisibilite);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
    position,
    loading,
    error,
    depuisCache,
    refuser,
    permission,
    demandeRequise,
    gesteRequis,
    source,
    ageMinutes,
    relancer: demander,
    choisirPosition,
    oublier,
  };
}

export default useGeolocation;
