// PharmaciesCliniques.jsx — Section séparée (voir maquette "4. Pharmacies & Cliniques")
//
// IMPORTANT — traitement volontairement différent du reste de l'app (§6) :
// - Design vert/blanc (couleurs --color-health-*, PAS les couleurs orange)
// - PAS de notes, PAS d'avis, PAS de commentaires ici (déontologie médicale)
// - Affichage minimal : nom, type (avec icône distincte), badge De garde / Non de garde,
//   distance, boutons Appeler / Itinéraire
// - Bascule Liste / Carte
// - Mention discrète en bas : « Statut mis à jour par l'établissement, à confirmer
//   par téléphone en cas d'urgence. »
//
// DÉCISIONS À SIGNALER :
//  - Le « mode Carte » affiche une carte schématique (positionnement relatif sur un
//    canevas), PAS un fond de plan cartographique : aucune librairie de cartographie
//    n'est installée (la stack du README n'en prévoit pas) et le chargement de tuiles
//    Google/OSM coûte cher en données mobiles. Le bouton « Itinéraire » ouvre
//    Google Maps, ce qui est l'usage réel sur le terrain.
//  - Aucun compteur de visites/utilisateurs, aucun classement par popularité :
//    l'ordre est « de garde d'abord », puis distance croissante (cf. backend).
//  - Le statut de garde est auto-déclaré par l'établissement : d'où l'avertissement
//    de responsabilité, obligatoire.

import { useCallback, useEffect, useMemo, useState } from 'react';

import HealthListItem from '../components/HealthListItem.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import PromptLocalisation from '../components/PromptLocalisation.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { urlItineraire, distanceDepuis } from '../utils/distance.js';
import { AVERTISSEMENT_GARDE, filtrerSanteDemo } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

const FILTRES_TYPE = [
  { cle: 'tous', libelle: 'Tout' },
  { cle: 'pharmacie', libelle: 'Pharmacies' },
  { cle: 'clinique', libelle: 'Cliniques' },
];

export default function PharmaciesCliniques() {
  const position = useGeolocation();
  const [type, setType] = useState('tous');
  const [deGardeSeulement, setDeGardeSeulement] = useState(false);
  const [affichage, setAffichage] = useState('liste'); // 'liste' | 'carte'
  const [bruts, setBruts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [avertissement, setAvertissement] = useState(AVERTISSEMENT_GARDE);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const requete = new URLSearchParams({ limit: '60' });
      if (position.position) {
        requete.set('lat', position.position.lat);
        requete.set('lng', position.position.lng);
      }
      const reponse = await api.get(`/health-facilities?${requete.toString()}`, { auth: false });
      setBruts(reponse.items || []);
      if (reponse.avertissement) setAvertissement(reponse.avertissement);
      setHorsLigne(false);
    } catch {
      setBruts(filtrerSanteDemo({ type: 'tous' }));
      setHorsLigne(true);
    } finally {
      setChargement(false);
    }
  }, [position.position]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Filtres + tri « de garde d'abord, puis distance » (§6).
  const liste = useMemo(() => {
    const filtres = bruts.filter((s) => {
      if (type !== 'tous' && s.type !== type) return false;
      if (deGardeSeulement && !s.deGarde) return false;
      return true;
    });
    const avecDistance = filtres.map((s) => ({
      ...s,
      distanceKm: s.distanceKm ?? (position.position ? distanceDepuis(position.position, s) : null),
    }));
    return avecDistance.sort((a, b) => {
      if (a.deGarde !== b.deGarde) return a.deGarde ? -1 : 1;
      return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
    });
  }, [bruts, type, deGardeSeulement, position.position]);

  const nombreDeGarde = liste.filter((s) => s.deGarde).length;

  function appeler(s) {
    if (!s.telephone) return;
    window.location.href = `tel:${String(s.telephone).replace(/\s/g, '')}`;
  }

  function itineraire(s) {
    const loc = s.localisation;
    if (!loc) return;
    window.open(urlItineraire(loc.lat, loc.lng), '_blank', 'noopener,noreferrer');
  }

  /** Carte schématique : les points sont placés selon leurs coordonnées relatives. */
  function CarteSchematique() {
    const points = liste.filter((s) => s.localisation);
    if (points.length === 0) {
      return <EmptyState icone="mapPin" titre="Aucune coordonnée disponible" />;
    }
    const lats = points.map((p) => p.localisation.lat);
    const lngs = points.map((p) => p.localisation.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const etendueLat = maxLat - minLat || 0.01;
    const etendueLng = maxLng - minLng || 0.01;

    return (
      <div
        className="relative h-80 w-full overflow-hidden rounded-lg border border-health/30 bg-health-light"
        aria-label="Carte schématique des pharmacies et cliniques"
        role="img"
      >
        {points.map((s) => {
          const x = 6 + (1 - (s.localisation.lng - minLng) / etendueLng) * 88;
          const y = 6 + (1 - (s.localisation.lat - minLat) / etendueLat) * 88;
          return (
            <button
              key={s.id}
              type="button"
              title={`${s.nom}${s.distanceKm != null ? ` · ${s.distanceKm.toFixed(1)} km` : ''}`}
              onClick={() => itineraire(s)}
              style={{ left: `${x}%`, top: `${y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow ${
                  s.deGarde ? 'bg-health text-white' : 'bg-white text-health-dark'
                }`}
              >
                <Icon name={s.type === 'pharmacie' ? 'pharmacy' : 'hospital'} size={16} />
              </span>
            </button>
          );
        })}

        {/* Position de l'utilisateur */}
        {position.position && (
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${6 + (1 - (position.lng - minLng) / etendueLng) * 88}%`,
              top: `${6 + (1 - (position.lat - minLat) / etendueLat) * 88}%`,
            }}
            title="Votre position"
          >
            <span className="block h-3 w-3 animate-breathe rounded-full bg-primary ring-4 ring-primary/25" />
          </span>
        )}

        <p className="absolute bottom-1 left-2 text-[10px] font-semibold text-health-dark/70">
          Vue schématique — touchez un repère pour l’itinéraire
        </p>
      </div>
    );
  }

  return (
    <div className="ecran py-3">
      {/* En-tête vert (§6) — aucune note, aucun avis, aucune étoile sur cette page */}
      <section className="mb-3">
        <h1 className="text-xl font-bold text-health-dark">Pharmacies & Cliniques</h1>
        <p className="text-sm text-ink-muted">
          {chargement
            ? 'Recherche des établissements autour de vous…'
            : `${liste.length} établissement${liste.length > 1 ? 's' : ''}, dont ${nombreDeGarde} de garde.`}
        </p>
      </section>

      {/* Filtres : type + statut de garde + bascule liste/carte */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md bg-health-light p-1">
          {FILTRES_TYPE.map((f) => (
            <button
              key={f.cle}
              type="button"
              onClick={() => setType(f.cle)}
              className={`rounded-sm px-3 py-1.5 text-xs font-bold transition ${
                type === f.cle ? 'bg-health text-white' : 'text-health-dark'
              }`}
            >
              {f.libelle}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDeGardeSeulement((v) => !v)}
          aria-pressed={deGardeSeulement}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            deGardeSeulement ? 'border-health bg-health text-white' : 'border-health/40 text-health-dark'
          }`}
        >
          De garde uniquement
        </button>

        <div className="ml-auto flex gap-1 rounded-md bg-health-light p-1">
          {[
            { cle: 'liste', libelle: 'Liste', icone: 'grid' },
            { cle: 'carte', libelle: 'Carte', icone: 'mapPin' },
          ].map((v) => (
            <button
              key={v.cle}
              type="button"
              onClick={() => setAffichage(v.cle)}
              className={`flex items-center gap-1 rounded-sm px-2.5 py-1.5 text-xs font-bold transition ${
                affichage === v.cle ? 'bg-white text-health-dark shadow-card-health' : 'text-health-dark'
              }`}
            >
              <Icon name={v.icone} size={14} />
              {v.libelle}
            </button>
          ))}
        </div>
      </div>

      {horsLigne && (
        <InfoBanner variante="demo" titre="Données d’exemple" className="mb-3">
          Serveur injoignable : les établissements affichés proviennent du jeu de démonstration.
        </InfoBanner>
      )}

      <PromptLocalisation position={position} className="mb-3" />

      {position.depuisCache && position.position && !chargement && (
        <InfoBanner variante="info" className="mb-3">
          Distances basées sur votre dernière position enregistrée.
        </InfoBanner>
      )}

      {chargement && liste.length === 0 ? (
        <EmptyState chargement titre="Recherche des établissements de santé…" />
      ) : liste.length === 0 ? (
        <EmptyState
          icone="pharmacy"
          titre="Aucun établissement trouvé"
          description="Essayez de désactiver le filtre « De garde uniquement » ou changez de type."
        />
      ) : affichage === 'carte' ? (
        <CarteSchematique />
      ) : (
        <div className="flex flex-col gap-2">
          {liste.map((s) => (
            <HealthListItem
              key={s.id}
              etablissement={s}
              onAppeler={() => appeler(s)}
              onItineraire={() => itineraire(s)}
            />
          ))}
        </div>
      )}

      {/* Mention de responsabilité obligatoire (§6) */}
      <p className="mt-4 rounded-md bg-health-light px-3 py-2 text-center text-[11px] leading-snug text-health-dark">
        {avertissement}
      </p>
    </div>
  );
}

