// ChoisirPosition.jsx — « Je désigne moi-même ma position sur la carte ».
//
// POURQUOI CET ÉCRAN (bloc B)
// Un utilisateur qui a refusé la localisation (ou dont le téléphone refuse le GPS
// dans le navigateur) n'avait AUCUN moyen d'obtenir des distances : l'application
// affichait les fiches sans distance, ce qui rend un annuaire de proximité inutile.
// Ici, il place un repère sur son quartier et valide : les distances repartent de
// ce point. C'est un CHOIX déclaré, jamais une mesure déguisée — l'écran l'écrit
// noir sur blanc, et l'origine est mémorisée comme telle (`source: 'manuel'`).
//
// GARDE-FOU (16/11) : quand l'écran fournit `reference` (la position déjà
// enregistrée), l'écart entre le repère et elle est calculé à chaque déplacement.
// Au-delà d'un kilomètre, un bandeau demande « êtes-vous sûr d'être sur place ? » :
// un calibrage fait depuis un autre quartier enverrait tous les clients au mauvais
// endroit. L'avertissement n'interdit pas de valider, il oblige à regarder.
//
// POIDS DE LA CARTE (décision technique)
// Leaflet et ses tuiles pèsent bien plus lourd que tout le reste de l'application :
// ils ne sont donc PAS dans le paquet initial. Ce composant charge Leaflet par
// `import()` dynamique, uniquement quand l'utilisateur ouvre la carte ; les écrans
// qui l'affichent le font en `React.lazy`. Sans réseau, l'import échoue : on
// l'annonce et on laisse fermer, sans jamais bloquer l'écran d'origine.
//
// Aucune icône-image n'est utilisée (les marqueurs Leaflet classiques demandent des
// PNG à recopier dans le build) : le repère se dessine en SVG (`divIcon`), comme les
// icônes maison du reste de l'application. Ce repère est DÉPLAÇABLE (exigence B2) :
// ce sont SES coordonnées qui sont enregistrées, pas le centre de la carte.

import { useEffect, useRef, useState } from 'react';

import { Icon } from './Icons.jsx';
import { CENTRE_DEFAUT } from '../utils/position.js';
import { formatDistanceKm, getDistanceKm } from '../utils/distance.js';

const ZOOM_INITIAL = 14;
const TUILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Écart au-delà duquel on demande confirmation explicite (garde-fou anti-erreur).
 * Un gérant qui recalibre sa position reste à quelques mètres de son commerce :
 * au-delà d'un kilomètre, c'est presque toujours une erreur (mauvais GPS, mauvaise
 * ville, calibrage fait depuis chez soi) et le point enverrait les clients ailleurs.
 */
const SEUIL_ALERTE_KM = 1;

/**
 * Repère dessiné en SVG — le `mapPin` de l'application (Icons.jsx), en orange, avec la
 * pointe qui marque le lieu exact. Rendu par `divIcon` : aucun PNG à recopier dans le
 * build. La classe `repere-position` sert aussi de sélecteur aux preuves automatisées.
 */
const ICONE_REPERE = `<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style="display:block">
  <path d="M12 22s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" fill="#f59e0b" stroke="#b45309" stroke-width="1.6" stroke-linejoin="round" />
  <circle cx="12" cy="10" r="2.6" fill="#ffffff" />
</svg>`;

/**
 * @param {{ ouvert: boolean, onFermer: () => void, onValider: (lat: number, lng: number) => void,
 *   centre?: { lat: number, lng: number }|null, onGps?: () => void,
 *   reference?: { lat: number, lng: number }|null, seuilAlerteKm?: number,
 *   titre?: string, aide?: string }} props
 */
export default function ChoisirPosition({
  ouvert,
  onFermer,
  onValider,
  centre = null,
  onGps,
  reference = null,
  seuilAlerteKm = SEUIL_ALERTE_KM,
  titre = 'Ma position sur la carte',
  aide = 'Faites glisser le repère orange sur votre quartier (ou touchez la carte : le repère s’y place). Puis validez — les distances partiront de ce point.',
}) {
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
      // Le repère est DÉPLAÇABLE : c'est lui qui porte les coordonnées enregistrées,
      // jamais le centre de la carte (exigence B2).
      marqueur.current = L.marker([depart.lat, depart.lng], {
        draggable: true,
        keyboard: true,
        title: 'Ma position',
        icon: L.divIcon({
          className: 'repere-position',
          html: ICONE_REPERE,
          iconSize: [30, 30],
          iconAnchor: [15, 28],
        }),
      }).addTo(instance);

      // Deux façons de placer le repère, au doigt : le glisser, ou toucher la carte
      // (l'appui amène le repère à cet endroit). Dans les deux cas, le point affiché
      // et validé est celui du repère.
      marqueur.current.on('dragend', () => {
        const p = marqueur.current?.getLatLng();
        if (p) setPoint({ lat: p.lat, lng: p.lng });
      });
      instance.on('click', (evt) => {
        marqueur.current?.setLatLng(evt.latlng);
        setPoint({ lat: evt.latlng.lat, lng: evt.latlng.lng });
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

  // Garde-fou : écart entre le repère posé et la position actuellement enregistrée.
  // `getDistanceKm` rend `null` si un des points est invalide → pas d'alerte plutôt
  // qu'une alerte sur une distance fabriquée.
  const distanceReferenceKm = reference
    ? getDistanceKm(point.lat, point.lng, reference.lat, reference.lng)
    : null;
  const alerteDistance = distanceReferenceKm != null && distanceReferenceKm > seuilAlerteKm;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-pop-in"
      role="presentation"
      onClick={onFermer}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="w-full max-w-[480px] rounded-t-xl bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg"
        onClick={(evt) => evt.stopPropagation()}
      >
        <div className="mb-2 flex items-start gap-2">
          <span className="flex-1">
            <span className="block text-sm font-bold text-ink">{titre}</span>
            <span className="block text-[11px] leading-snug text-ink/70">{aide}</span>
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

        {/* Bandeau de garde-fou, AU-DESSUS de la carte (dans le flux, pas en overlay :
            les contrôles Leaflet montent à z-index 1000 et passeraient par-dessus un
            avertissement posé à l'intérieur). Il n'empêche pas de valider — il
            demande de regarder avant. */}
        {alerteDistance && (
          <p
            role="alert"
            className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] font-semibold leading-snug text-danger"
          >
            Attention, cette position est à {formatDistanceKm(distanceReferenceKm)} de la position
            actuelle. Êtes-vous sûr d’être sur place ?
          </p>
        )}

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
