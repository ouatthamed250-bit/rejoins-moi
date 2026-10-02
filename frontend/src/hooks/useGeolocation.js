// useGeolocation.js — Récupère la position de l'utilisateur (API navigateur navigator.geolocation)
// et expose { lat, lng, loading, error }. Utilisé par Search, Feed et PharmaciesCliniques
// pour calculer/trier par distance (voir utils/distance.js).
//
// Décisions importantes pour le terrain ivoirien :
//  - `enableHighAccuracy: false` : le GPS haute précision met 20-30 s à accrocher et
//    vide la batterie. Pour trier des commerces de quartier, la précision réseau
//    (quelques centaines de mètres) suffit largement.
//  - `timeout: 8000` : au-delà, `position` reste `null`. On n'invente AUCUN repli :
//    l'ancien repli (centre d'Abidjan, Plateau) affichait des distances précises mais
//    FAUSSES (ex. « 236 m » pour un lieu en réalité à 22 km) — trompeur, pas imprécis.
//  - La position est mise en cache dans localStorage : au 2e lancement, les
//    distances s'affichent immédiatement même sans réseau.

import { useCallback, useEffect, useRef, useState } from 'react';

const CLE_CACHE = 'rejoinsmoi.position';
const DUREE_CACHE_MS = 30 * 60 * 1000; // 30 min : la position d'hier soir n'est plus fiable

function lireCache() {
  try {
    const brut = localStorage.getItem(CLE_CACHE);
    if (!brut) return null;
    const { lat, lng, at } = JSON.parse(brut);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Date.now() - Number(at) > DUREE_CACHE_MS) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function ecrireCache(lat, lng) {
  try {
    localStorage.setItem(CLE_CACHE, JSON.stringify({ lat, lng, at: Date.now() }));
  } catch {
    /* navigation privée */
  }
}

/**
 * @param {{ auto?: boolean }} [options]
 * @returns {{ lat: number|null, lng: number|null, position: object|null, loading: boolean,
 *   error: string|null, depuisCache: boolean, refuser: boolean, relancer: () => void }}
 */
export function useGeolocation({ auto = true } = {}) {
  const cache = typeof window === 'undefined' ? null : lireCache();
  const [position, setPosition] = useState(cache ? { lat: cache.lat, lng: cache.lng } : null);
  const [loading, setLoading] = useState(auto && !cache);
  const [error, setError] = useState(null);
  const [depuisCache, setDepuisCache] = useState(Boolean(cache));
  const [refuser, setRefuser] = useState(false);
  const monte = useRef(true);

  const demander = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      setRefuser(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!monte.current) return;
        const { latitude, longitude } = pos.coords;
        setPosition({ lat: latitude, lng: longitude });
        setDepuisCache(false);
        setRefuser(false);
        setLoading(false);
        ecrireCache(latitude, longitude);
      },
      (err) => {
        if (!monte.current) return;
        // 1 = PERMISSION_DENIED : l'utilisateur a refusé (ou le navigateur in-app bloque).
        setRefuser(err.code === 1);
        setError(
          err.code === 1
            ? "Localisation refusée. Aucune distance n'est affichée tant qu'elle n'est pas activée."
            : 'Localisation indisponible. Activez-la pour voir les distances.'
        );
        // Pas de repli : on conserve la position existante (dernière position RÉELLE en
        // cache, ou null). Aucun point inventé, donc aucune distance trompeuse.
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  useEffect(() => {
    monte.current = true;
    if (auto && !cache) demander();
    return () => {
      monte.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return {
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
    position,
    loading,
    error,
    depuisCache,
    refuser,
    relancer: demander,
  };
}

export default useGeolocation;

