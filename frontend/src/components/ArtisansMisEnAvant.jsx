// ArtisansMisEnAvant.jsx — Bandeau « Artisans mis en avant » (feed & recherche).
//
// C'est la contrepartie visible de l'abonnement (cahier des charges, ajout du
// 29/09) : un artisan abonné voit son profil remonter en tête du feed et de la
// recherche. Le serveur renvoie déjà la liste triée (abonnés d'abord, puis note,
// puis proximité) — le frontend n'a AUCUNE règle de priorité à recalculer, ce qui
// évite qu'un tri « payant » soit appliqué à un endroit et pas à un autre.
//
// Décisions :
//  - Le numéro de téléphone n'est JAMAIS communiqué par l'annuaire : la mise en
//    relation passe par la page Jobs (annonces), où le déblocage est tracé. Ici, on
//    rend seulement les artisans visibles.
//  - Si l'API est injoignable, on affiche les artisans de démonstration en le disant.
//  - Le bandeau disparaît s'il n'y a aucun artisan : jamais de section vide.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from './Icons.jsx';
import StarRating from './StarRating.jsx';
import { api } from '../utils/api/client.js';
import { filtrerArtisansDemo } from '../data/demoData.js';
import { distanceDepuis, formatDistanceKm } from '../utils/distance.js';
import { initiales } from '../utils/format.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

/**
 * @param {{ limite?: number, titre?: string, metier?: string, terme?: string, className?: string }} props
 */
export default function ArtisansMisEnAvant({
  limite = 8,
  titre = 'Artisans mis en avant',
  metier = 'tous',
  terme = '',
  className = '',
}) {
  const navigate = useNavigate();
  const position = useGeolocation();
  const [artisans, setArtisans] = useState([]);
  const [horsLigne, setHorsLigne] = useState(false);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    async function charger() {
      setChargement(true);
      const coords = position.position;
      try {
        const requete = new URLSearchParams({ limit: String(limite) });
        if (metier && metier !== 'tous') requete.set('metier', metier);
        if (terme.trim()) requete.set('q', terme.trim());
        if (coords) {
          requete.set('lat', coords.lat);
          requete.set('lng', coords.lng);
        }
        const reponse = await api.get(`/users/artisans?${requete.toString()}`, { auth: false });
        if (annule) return;
        setArtisans(reponse.items || []);
        setHorsLigne(false);
      } catch {
        if (annule) return;
        setArtisans(filtrerArtisansDemo({ metier, q: terme }));
        setHorsLigne(true);
      } finally {
        if (!annule) setChargement(false);
      }
    }
    charger();
    return () => {
      annule = true;
    };
  }, [limite, metier, terme, position.position]);

  if (!chargement && artisans.length === 0) return null;

  return (
    <section className={`mb-3 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Icon name="star" size={15} filled className="text-primary" />
          {titre}
        </h2>
        <button
          type="button"
          className="text-[11px] font-semibold text-primary underline"
          onClick={() => navigate('/jobs')}
        >
          Voir la page Jobs
        </button>
      </div>

      {horsLigne && (
        <p className="mb-2 text-[10px] text-ink-muted">
          Serveur injoignable : artisans d’exemple (numéros non communiqués).
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {chargement
          ? [0, 1, 2].map((i) => (
              <div key={i} className="carte h-[136px] w-[150px] shrink-0 bg-soft" />
            ))
          : artisans.map((artisan) => {
              const distanceKm =
                artisan.distanceKm ?? distanceDepuis(position.position, artisan.localisation || artisan);
              return (
                <article
                  key={artisan.id}
                  className={`carte w-[150px] shrink-0 p-2 ${
                    artisan.misEnAvant ? 'border-primary/60 bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                      {artisan.photoProfil ? (
                        <img
                          src={artisan.photoProfil}
                          alt={artisan.nomComplet || 'Artisan'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initiales(artisan.nomComplet || 'Artisan')
                      )}
                    </span>
                    {artisan.misEnAvant && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">
                        Mis en avant
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs font-bold text-ink">
                    {artisan.nomComplet || 'Artisan'}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-primary">
                    {artisan.metier || 'Métier à préciser'}
                  </p>
                  <StarRating note={artisan.noteMoyenne} nombreAvis={artisan.nombreAvis} taille={11} />
                  <p className="mt-0.5 truncate text-[10px] text-ink-muted">
                    {[artisan.quartier, artisan.commune].filter(Boolean).join(', ') || 'Abidjan'}
                    {distanceKm != null ? ` · ${formatDistanceKm(distanceKm)}` : ''}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] leading-tight text-ink-muted">
                    <Icon name="lock" size={11} className="shrink-0" />
                    Contact via la page Jobs
                  </p>
                </article>
              );
            })}
      </div>

      <p className="mt-1 text-[10px] leading-snug text-ink-muted">
        Les artisans abonnés apparaissent en tête, puis les mieux notés et les plus proches. Leurs
        numéros ne sont communiqués que lors d’une mise en relation (page Jobs).
      </p>
    </section>
  );
}
