// useGeolocation.js — Récupère la position de l'utilisateur (API navigateur navigator.geolocation)
// et expose { lat, lng, loading, error }. Utilisé par Search, Feed et PharmaciesCliniques
// pour calculer/trier par distance (voir utils/distance.js).
//
// Décisions importantes pour le terrain ivoirien :
//  - `enableHighAccuracy: false` : le GPS haute précision met 20-30 s à accrocher et
//    vide la batterie. Pour trier des commerces de quartier, la précision réseau
//    (quelques centaines de mètres) suffit largement.
//  - `timeout: 8000` : au-delà, on affiche un repli (centre d'Abidjan, Plateau) au
//    lieu de laisser l'utilisateur devant un écran qui tourne indéfiniment.
//  - La position est mise en cache dans localStorage : au 2e lancement, les
//    distances s'affichent immédiatement même sans réseau.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CENTRE_ABIDJAN } from '../utils/distance.js';

const CLE_CACHE = 'rejoinsmoi.position';
const DUREE_CACHE_MS = 30 * 60 * 1000; // 30 min : la position d'hier soir n'est plus fiable

function lireCache() {
  try {
    const brut = localStorage.getItem(CLE_CACHE);
    if (!brut) return null;
    const { lat, lng, at } = JSON.parse(brut);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Date.now() - Number(at) > DUREE_CACHE_MS) return null;
    return { lat, lng, approximatif: true };
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
 * @param {{ auto?: boolean, fallback?: {lat:number, lng:number} }} [options]
 * @returns {{ lat: number|null, lng: number|null, position: object|null, loading: boolean,
 *   error: string|null, approximatif: boolean, refuser: boolean, relancer: () => void }}
 */
export function useGeolocation({ auto = true, fallback = CENTRE_ABIDJAN } = {}) {
  const cache = typeof window === 'undefined' ? null : lireCache();
  const [position, setPosition] = useState(cache ? { lat: cache.lat, lng: cache.lng } : null);
  const [loading, setLoading] = useState(auto && !cache);
  const [error, setError] = useState(null);
  const [approximatif, setApproximatif] = useState(Boolean(cache?.approximatif));
  const [refuser, setRefuser] = useState(false);
  const monte = useRef(true);

  const demander = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      setPosition(fallback);
      setApproximatif(true);
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
        setApproximatif(false);
        setRefuser(false);
        setLoading(false);
        ecrireCache(latitude, longitude);
      },
      (err) => {
        if (!monte.current) return;
        // 1 = PERMISSION_DENIED : l'utilisateur a refusé (ou le navigateur in-app bloque)
        setRefuser(err.code === 1);
        setError(
          err.code === 1
            ? "Position refusée — les distances sont calculées depuis le Plateau."
            : 'Position indisponible — distances calculées depuis le Plateau.'
        );
        // Repli : centre d'Abidjan, pour que l'app reste utilisable sans GPS.
        setPosition(fallback);
        setApproximatif(true);
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  }, [fallback.lat, fallback.lng]);

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
    approximatif,
    refuser,
    relancer: demander,
  };
}

export default useGeolocation;

