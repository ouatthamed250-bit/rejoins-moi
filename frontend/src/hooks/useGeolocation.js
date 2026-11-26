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
// Décisions de terrain :
//  - `enableHighAccuracy: true` (correctif GPS) : la précision réseau donnait des
//    points à plusieurs centaines de mètres, voire au-delà du kilomètre, ce qui
//    n'a aucun sens pour « le commerce le plus proche ». On accepte donc l'accroche
//    plus lente du vrai GPS (10-30 s) — c'est le prix d'une distance utile.
//  - `timeout: 15000` : allongé d'autant, sinon la haute précision n'aurait pas le
//    temps d'accrocher et échouerait plus souvent qu'avant.
//  - `maximumAge: 60 s` : une mesure de moins d'une minute est réutilisée telle
//    quelle (le téléphone la renvoie instantanément) ; au-delà, on re-mesure.
//  - `coords.accuracy` est désormais LU : au-delà de 500 m, la position est
//    conservée mais l'utilisateur est averti (« position approximative ») — voir
//    le callback de succès. Une mauvaise mesure n'est jamais présentée comme sûre.
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
 * Calibrage GPS — la position EXACTE d'un commerce, pas celle de l'utilisateur.
 *
 * `getCurrentPosition` rend la PREMIÈRE mesure disponible : sur un téléphone qui
 * vient de s'allumer, c'est souvent la position réseau (plusieurs centaines de
 * mètres d'erreur), et c'est ce point-là qui se retrouve dans une fiche. En écoutant
 * en continu (`watchPosition`) pendant dix secondes, le vrai GPS a le temps
 * d'accrocher les satellites et d'affiner — on ne garde que la mesure au plus petit
 * `coords.accuracy` (le rayon d'incertitude annoncé par le téléphone), et non la
 * dernière arrivée, qui peut être moins bonne que la précédente.
 *
 * Décisions :
 *  - `maximumAge: 0` : la mesure doit être NEUVE. Réutiliser une position mémorisée
 *    reviendrait à recopier l'ancien point — exactement ce que ce bouton corrige.
 *  - `enableHighAccuracy: true` : sans le vrai GPS, dix secondes de mesures réseau
 *    n'améliorent rien.
 *  - Refus d'autorisation (`code === 1`) : on rejette TOUT DE SUITE, attendre dix
 *    secondes de plus ne produirait aucune mesure.
 *  - Indisponibilité (`2`) et délai (`3`) : on continue d'écouter jusqu'au bout, une
 *    mesure peut arriver entre-temps ; on ne rejette qu'à la fin, faute de mesure.
 *  - Aucune coordonnée inventée : sans mesure, la promesse est rejetée et l'écran
 *    propose le choix manuel sur la carte.
 *
 * @param {number} [dureeMs=10000] durée d'écoute, en millisecondes
 * @returns {Promise<{ lat: number, lng: number, accuracy: number|null }>}
 */
export function calibrerPositionGps(dureeMs = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error("La géolocalisation n'est pas disponible sur cet appareil."));
      return;
    }

    const duree = Math.max(1000, Number(dureeMs) || 10000);
    let meilleure = null;
    let termine = false;
    let veille = null;
    let minuteur = null;

    function arreter() {
      if (veille != null) navigator.geolocation.clearWatch(veille);
      if (minuteur != null) clearTimeout(minuteur);
      veille = null;
      minuteur = null;
    }

    function echouer(message) {
      if (termine) return;
      termine = true;
      arreter();
      reject(new Error(message));
    }

    try {
      veille = navigator.geolocation.watchPosition(
        (pos) => {
          if (termine) return;
          const { latitude, longitude, accuracy } = pos.coords;
          const mesure = {
            lat: latitude,
            lng: longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
          };
          // `?? Infinity` : une mesure sans `accuracy` ne doit jamais battre une
          // mesure chiffrée, même si elle arrive en premier.
          if (!meilleure || (mesure.accuracy ?? Infinity) < (meilleure.accuracy ?? Infinity)) {
            meilleure = mesure;
          }
        },
        (err) => {
          if (err?.code === 1) {
            echouer(
              'Localisation refusée. Autorisez la géolocalisation pour ce site, puis relancez le calibrage.'
            );
          }
        },
        { enableHighAccuracy: true, timeout: duree, maximumAge: 0 }
      );
    } catch (err) {
      echouer(err?.message || 'Impossible de démarrer le calibrage GPS.');
      return;
    }

    minuteur = setTimeout(() => {
      if (termine) return;
      termine = true;
      arreter();
      if (!meilleure) {
        reject(
          new Error(
            "Aucune position reçue pendant le calibrage. Sortez à l'air libre, vérifiez que la localisation du téléphone est activée, puis réessayez — ou choisissez la position sur la carte."
          )
        );
        return;
      }
      resolve(meilleure);
    }, duree);
  });
}

/**
 * @param {{ auto?: boolean }} [options] `auto: false` = ne rien demander au montage
 *   (l'écran pilote lui-même la demande).
 * @returns {{ lat: number|null, lng: number|null, position: {lat:number,lng:number}|null,
 *   loading: boolean, error: string|null, depuisCache: boolean, refuser: boolean,
 *   permission: 'granted'|'denied'|'prompt'|'inconnue', demandeRequise: boolean,
 *   gesteRequis: boolean, source: 'gps'|'manuel'|null, ageMinutes: number|null,
 *   precisionMetres: number|null, precisionFaible: boolean,
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
  // `precisionMetres` : rayon d'incertitude annoncé par le téléphone (`coords.accuracy`),
  // arrondi au mètre. Exposé à l'écran d'inscription, qui doit pouvoir dire noir sur
  // blanc « cette position peut être fausse de X mètres » : une mesure réseau reçue
  // dans un mauvais réseau dérive de plusieurs kilomètres, et c'est ce point-là qui
  // finit dans une fiche. Un point CHOISI sur la carte n'est pas une mesure : `null`,
  // jamais « 0 m » (qui laisserait croire à une exactitude parfaite).
  const [precisionMetres, setPrecisionMetres] = useState(() => {
    const brute = memoireInitiale?.accuracy;
    return brute != null && Number.isFinite(Number(brute)) ? Math.round(Number(brute)) : null;
  });
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
        const { latitude, longitude, accuracy } = pos.coords;
        const memorisee = enregistrerPosition(latitude, longitude, 'gps', accuracy);
        setPosition({ lat: latitude, lng: longitude });
        setSource('gps');
        setAgeMinutes(memorisee?.ageMinutes ?? 0);
        setPrecisionMetres(Number.isFinite(accuracy) ? Math.round(accuracy) : null);
        setDepuisCache(false);
        setRefuser(false);
        setGesteRequis(false);
        setPermission('granted');
        setDemandeRequise(false);
        setLoading(false);
        // Contrôle de précision, APRÈS le succès : la position est conservée (mieux
        // vaut une distance annoncée comme approximative qu'aucune distance), mais on
        // dit à l'utilisateur à quel point elle est incertaine, et comment faire mieux.
        // `accuracy` est le rayon d'incertitude en mètres annoncé par le téléphone.
        if (accuracy && accuracy > 500) {
          setError(
            `Position approximative (±${Math.round(accuracy)} m). ` +
              `Pour plus de précision, essayez à l'extérieur ou choisissez votre position sur la carte.`
          );
        }
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
      // Haute précision + délai allongé : voir l'en-tête du module. Un `maximumAge`
      // d'une minute laisse le téléphone réutiliser une mesure fraîche au lieu de
      // relancer une accroche GPS à chaque écran.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60 * 1000 }
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
    setPrecisionMetres(null); // un choix n'est pas une mesure : aucune précision à annoncer
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
    setPrecisionMetres(null);
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
        setPrecisionMetres(
          p.accuracy != null && Number.isFinite(Number(p.accuracy))
            ? Math.round(Number(p.accuracy))
            : null
        );
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
    precisionMetres,
    // Seuil de 500 m : au-delà, ce n'est plus « une position un peu floue », c'est
    // un point qui peut être dans un autre quartier. L'écran d'inscription s'en sert
    // pour afficher une alerte visible, avec la marche à suivre (« Placer sur la
    // carte »), au lieu de laisser croire à une position fiable.
    precisionFaible: precisionMetres != null && precisionMetres > 500,
    relancer: demander,
    choisirPosition,
    oublier,
  };
}

export default useGeolocation;
