// ChoisirPosition.jsx — « Je désigne moi-même ma position sur la carte ».
//
// POURQUOI CET ÉCRAN (bloc B)
// Un utilisateur qui a refusé la localisation (ou dont le téléphone refuse le GPS
// dans le navigateur) n'avait AUCUN moyen d'obtenir des distances : l'application
// affichait les fiches sans distance, ce qui rend un annuaire de proximité inutile.
// Ici, il déplace la carte sur son quartier et valide : les distances repartent de
// ce point. C'est un CHOIX déclaré, jamais une mesure déguisée — l'écran l'écrit
// noir sur blanc, et l'origine est mémorisée comme telle (`source: 'manuel'`).
//
// POIDS DE LA CARTE (décision technique)
// Leaflet et ses tuiles pèsent bien plus lourd que tout le reste de l'application :
// ils ne sont donc PAS dans le paquet initial. Ce composant charge Leaflet par
// `import()` dynamique, uniquement quand l'utilisateur ouvre la carte ; les écrans
// qui l'affichent le font en `React.lazy`. Sans réseau, l'import échoue : on
// l'annonce et on laisse fermer, sans jamais bloquer l'écran d'origine.
//
// Aucune icône-image n'est utilisée (les marqueurs Leaflet classiques demandent des
// PNG à recopier dans le build) : le point se dessine en SVG (`circleMarker`), comme
// les icônes maison du reste de l'application.

import { useEffect, useRef, useState } from 'react';

import { Icon } from './Icons.jsx';
import { CENTRE_DEFAUT } from '../utils/position.js';

const ZOOM_INITIAL = 14;
const TUILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * @param {{ ouvert: boolean, onFermer: () => void, onValider: (lat: number, lng: number) => void,
 *   centre?: { lat: number, lng: number }|null, onGps?: () => void }} props
 */
export default function ChoisirPosition({ ouvert, onFermer, onValider, centre = null, onGps }) {
  const conteneur = useRef(null);
  const carte = useRef(null);
  const marqueur = useRef(null);
  const [etatCarte, setEtatCarte] = useState('chargement'); // chargement | prete | echec
  const [point, setPoint] = useState(centre || CENTRE_DEFAUT);

  // Échap ferme la carte : même convention que le menu principal.
  useEffect(() => {
    if (!ouvert) return undefined;
    function surTouche(evt) {
      if (evt.key === 'Escape') onFermer?.();
    }
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [ouvert, onFermer]);

  useEffect(() => {
    if (!ouvert) return undefined;
    let detruit = false;
    const depart = centre || CENTRE_DEFAUT;
    setPoint(depart);
    setEtatCarte('chargement');

    (async () => {
      let L = null;
      try {
        // Feuille de style ET bibliothèque arrivent ensemble, à l'ouverture seulement.
        const [moduleL] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        L = moduleL.default || moduleL;
      } catch {
        if (!detruit) setEtatCarte('echec');
        return;
      }
      if (detruit || !conteneur.current) return;

      const instance = L.map(conteneur.current, {
        center: [depart.lat, depart.lng],
        zoom: ZOOM_INITIAL,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(TUILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(instance);
      marqueur.current = L.circleMarker([depart.lat, depart.lng], {
        radius: 9,
        color: '#b45309',
        weight: 3,
        fillColor: '#f59e0b',
        fillOpacity: 0.85,
      }).addTo(instance);

      // Le point SUIT le centre de la carte : l'utilisateur déplace la carte, pas un pion.
      instance.on('move', () => {
        marqueur.current?.setLatLng(instance.getCenter());
      });
      instance.on('moveend', () => {
        const c = instance.getCenter();
        setPoint({ lat: c.lat, lng: c.lng });
      });

      carte.current = instance;
      setEtatCarte('prete');
      // La carte s'ouvre dans une boîte : Leaflet doit recalculer sa taille après la
      // mise en page, sinon une bande grise reste affichée à droite.
      setTimeout(() => instance.invalidateSize(), 80);
    })();

    return () => {
      detruit = true;
      carte.current?.remove?.();
      carte.current = null;
      marqueur.current = null;
    };
  }, [ouvert, centre]);

  if (!ouvert) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-pop-in"
      role="presentation"
      onClick={onFermer}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choisir ma position sur la carte"
        className="w-full max-w-[480px] rounded-t-xl bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg"
        onClick={(evt) => evt.stopPropagation()}
      >
        <div className="mb-2 flex items-start gap-2">
          <span className="flex-1">
            <span className="block text-sm font-bold text-ink">Ma position sur la carte</span>
            <span className="block text-[11px] leading-snug text-ink/70">
              Déplacez la carte : le point orange reste au centre. Quand il est sur votre quartier,
              validez — les distances partiront de là.
            </span>
          </span>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onFermer}
            className="rounded-full p-1.5 text-ink/70 transition hover:bg-soft"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-md border border-line">
          <div ref={conteneur} className="h-[300px] w-full bg-soft" />
          {etatCarte !== 'prete' && (
            <span className="absolute inset-x-0 top-0 bg-white/90 px-2 py-1 text-center text-[11px] text-ink/80">
              {etatCarte === 'chargement'
                ? 'Chargement de la carte…'
                : 'La carte n’a pas pu se charger — vérifiez la connexion Internet.'}
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-ink/70">
          Point choisi : {point.lat.toFixed(5)}, {point.lng.toFixed(5)} — les distances sont
          calculées à partir de ce point, jusqu’à ce que vous en changiez.
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={etatCarte !== 'prete'}
            onClick={() => onValider?.(point.lat, point.lng)}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            Valider cette position
          </button>
          {onGps && (
            <button
              type="button"
              onClick={() => {
                onFermer?.();
                onGps();
              }}
              className="rounded-md border border-line px-3 py-2 text-sm font-bold text-ink"
            >
              Utiliser mon GPS
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
