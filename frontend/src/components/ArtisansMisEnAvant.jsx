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
//
// CORRECTIF DU 16/11 — « rectangles beiges vides » dans la rangée « Artisans pour… » :
//  1. les cartes de chargement étaient des `div` beiges SANS contenu : à l'arrivée de
//     la position GPS (le hook relance la requête), la rangée repassait en squelette
//     et restait muette plusieurs secondes sur un réseau lent. Le squelette a
//     maintenant la FORME d'une carte (pastille, nom, métier, note, quartier) et
//     porte `role="status"` : il se lit « chargement », il ne ressemble plus à une
//     carte cassée ;
//  2. la rangée n'est plus vidée à chaque rechargement : les cartes déjà affichées
//     restent à l'écran (aucun saut), le squelette ne sert qu'au tout premier
//     chargement (`artisans.length === 0`) ;
//  3. une photo de profil absente OU cassée (URL morte) tombe sur un VRAI état de
//     secours : le dessin crayon du métier (`dessinsContexte.js`), à défaut les
//     initiales — la règle « quel dessin pour quel métier » n'existe qu'une fois
//     dans le projet, elle n'est pas recopiée ici.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from './Icons.jsx';
import StarRating from './StarRating.jsx';
import Illustration from './illustrations/Illustration.jsx';
import { dessinDeContexte } from './illustrations/dessinsContexte.js';
import { api } from '../utils/api/client.js';
import { filtrerArtisansDemo } from '../data/demoData.js';
import { distanceDepuis, formatDistanceKm } from '../utils/distance.js';
import { formaterNomPublic, initiales } from '../utils/format.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

/**
 * Pastille d'un artisan : photo si elle existe ET se charge, sinon dessin crayon du
 * métier, sinon initiales. Le repli est LOCAL au composant (état `cassée`) : une URL
 * de photo morte ne laisse jamais un trou dans la carte.
 */
function PastilleArtisan({ artisan }) {
  const [cassee, setCassee] = useState(false);
  const dessin = dessinDeContexte({ metier: artisan.metier });
  // Un compte dont le « nom » est en réalité un numéro ne l'expose pas ici : c'est
  // l'annuaire public, le contact passe par la mise en relation payante (§2).
  const nom = formaterNomPublic(artisan.nomComplet) || 'Artisan';

  return (
    <span className="relative isolate flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-inset ring-primary/10">
      {artisan.photoProfil && !cassee ? (
        <img
          src={artisan.photoProfil}
          alt={nom}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setCassee(true)}
        />
      ) : dessin ? (
        <Illustration nom={dessin} taille={30} className="opacity-80" />
      ) : (
        initiales(nom)
      )}
    </span>
  );
}

/** Squelette d'une carte : mêmes dimensions, même silhouette, sans texte trompeur. */
function CarteFantome() {
  return (
    <div
      aria-hidden="true"
      className="carte w-[150px] shrink-0 animate-pulse p-2"
      data-carte-chargement=""
    >
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 shrink-0 rounded-full bg-soft" />
        <span className="h-4 w-14 rounded-full bg-soft" />
      </div>
      <div className="mt-2 h-3 w-24 rounded-full bg-soft" />
      <div className="mt-1.5 h-2.5 w-16 rounded-full bg-soft" />
      <div className="mt-2 h-2.5 w-20 rounded-full bg-soft" />
      <div className="mt-2 h-2.5 w-24 rounded-full bg-soft" />
    </div>
  );
}


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
        // Serveur injoignable : on garde les cartes déjà affichées si la liste a
        // déjà été chargée une fois (sinon la rangée « sauterait » en mode démo).
        setArtisans((actuels) =>
          actuels.length > 0 ? actuels : filtrerArtisansDemo({ metier, q: terme })
        );
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

  // Premier chargement seulement : ensuite les cartes restent affichées pendant la
  // re-mesure (arrivée du GPS) — plus de rangée qui se vide puis se remplit.
  const premierChargement = chargement && artisans.length === 0;

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
        {premierChargement ? (
          <>
            <span className="sr-only" role="status">
              Chargement des artisans…
            </span>
            {[0, 1, 2].map((i) => (
              <CarteFantome key={i} />
            ))}
          </>
        ) : (
          artisans.map((artisan) => {
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
                  <PastilleArtisan artisan={artisan} />
                  {artisan.misEnAvant && (
                    <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">
                      Mis en avant
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs font-bold text-ink">
                  {formaterNomPublic(artisan.nomComplet) || 'Artisan'}
                </p>
                <p className="truncate text-[11px] font-semibold text-primary">
                  {artisan.metier || 'Métier à préciser'}
                </p>
                <StarRating note={artisan.noteMoyenne} nombreAvis={artisan.nombreAvis} taille={11} />
                <p className="mt-0.5 truncate text-[10px] text-ink-muted">
                  {[artisan.quartier, artisan.commune].filter(Boolean).join(', ') || 'Abidjan'}
                  {distanceKm != null ? ` · ${formatDistanceKm(distanceKm)}` : ''}
                </p>
                {artisan.contactPublic && artisan.telephone ? (
                  // Consentement explicite (prompt 7) : l'artisan a accepté que son
                  // numéro soit visible, les deux gestes utiles sont donc affichés.
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <a
                      className="btn-health py-1 text-[10px]"
                      href={`tel:${artisan.telephone}`}
                    >
                      <Icon name="phone" size={12} />
                      Appeler
                    </a>
                    <a
                      className="btn-health-ghost py-1 text-[10px]"
                      href={`https://wa.me/${String(artisan.telephone).replace('+', '')}?text=${encodeURIComponent(
                        `Bonjour, je vous contacte via Rejoins'Moi pour vos services de ${
                          artisan.metier || 'votre métier'
                        }.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon name="whatsapp" size={12} />
                      WhatsApp
                    </a>
                  </div>
                ) : (
                  <p className="mt-1 flex items-center gap-1 text-[10px] leading-tight text-ink-muted">
                    <Icon name="lock" size={11} className="shrink-0" />
                    Contact masqué
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>

      <p className="mt-1 text-[10px] leading-snug text-ink-muted">
        Les artisans abonnés apparaissent en tête, puis les mieux notés et les plus proches. Leur numéro
        ne s’affiche que s’ils ont accepté d’être contactés publiquement ; sinon la mise en relation
        passe par la page Jobs.
      </p>
    </section>
  );
}
