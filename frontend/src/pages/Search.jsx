// Search.jsx — Recherche par catégorie (voir maquette "2. Recherche par catégorie")
//
// Contenu :
//  - Barre de recherche en haut (mot-clé libre, ex: "kiosque")
//  - Filtres par catégorie identiques au Feed
//  - Résultats sous forme de liste de cartes, triés par proximité (distance en km)
//  - Réutilise EstablishmentCard en version compacte (variant="list")
//  - Géolocalisation via hooks/useGeolocation.js pour calculer les distances
//
// Décisions :
//  - La recherche est « instantanée » mais DÉBOUNCÉE de 350 ms : sur un réseau 3G,
//    envoyer une requête à chaque frappe sature la connexion et vide la batterie.
//  - Le terme recherché est enregistré comme interaction (`recherche`) : c'est ce
//    qui permet au feed de s'affiner progressivement (§3).
//  - L'URL porte le terme (`?q=...`) : un lien de recherche peut être partagé sur
//    WhatsApp, qui est le canal de diffusion naturel ici.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import CategoryFilter from '../components/CategoryFilter.jsx';
import ArtisansMisEnAvant from '../components/ArtisansMisEnAvant.jsx';
import EstablishmentCard from '../components/EstablishmentCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import PromptLocalisation from '../components/PromptLocalisation.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { filtrerEtablissementsDemo, TAGS_PAR_CATEGORIE } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.js';
import { trierParProximite } from '../utils/distance.js';

export default function Search() {
  const navigate = useNavigate();
  const [parametres, setParametres] = useSearchParams();
  const { ajouterInteraction } = useAuth();
  const position = useGeolocation();

  const [terme, setTerme] = useState(parametres.get('q') || '');
  const [categorie, setCategorie] = useState(parametres.get('categorie') || 'tous');
  const [resultats, setResultats] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const minuteur = useRef(null);

  const chercher = useCallback(async () => {
    setChargement(true);
    const coords = position.position || null;
    try {
      const requete = new URLSearchParams({ limit: '40' });
      if (terme.trim()) {
        requete.set('q', terme.trim());
        // Recherche par mot-clé = PROXIMITÉ PURE. On désactive le mélange équilibré
        // par catégorie (diversite=0, voir backend/src/routes/establishments.js) pour
        // que les fiches les PLUS PROCHES correspondantes sortent en premier, au lieu
        // d'un échantillon par catégorie. Le tri client (trierParProximite) les
        // ordonne ensuite par distance croissante.
        requete.set('diversite', '0');
      }
      if (categorie !== 'tous') requete.set('categorie', categorie);
      if (coords) {
        requete.set('lat', coords.lat);
        requete.set('lng', coords.lng);
        requete.set('sort', 'proximity');
      }
      const reponse = await api.get(`/establishments?${requete.toString()}`, { auth: false });
      setResultats(reponse.items || []);
      setHorsLigne(false);
    } catch {
      setResultats(filtrerEtablissementsDemo({ categorie, q: terme }));
      setHorsLigne(true);
    } finally {
      setChargement(false);
    }
  }, [terme, categorie, position.position]);

  // Débounce : on attend 350 ms après la dernière frappe avant d'appeler l'API.
  useEffect(() => {
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(chercher, 350);
    return () => clearTimeout(minuteur.current);
  }, [chercher]);

  // Le terme reste dans l'URL (partage WhatsApp) sans recharger la page.
  useEffect(() => {
    const params = {};
    if (terme.trim()) params.q = terme.trim();
    if (categorie !== 'tous') params.categorie = categorie;
    setParametres(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme, categorie]);

  // Enregistre la recherche comme signal d'apprentissage (§3), une fois stabilisée.
  useEffect(() => {
    const propre = terme.trim();
    if (propre.length < 3) return undefined;
    const t = setTimeout(() => {
      ajouterInteraction({ type: 'recherche', terme: propre, categorie: categorie === 'tous' ? '' : categorie });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme, categorie]);

  // Tri final par proximité côté client (le backend trie déjà, on garantit l'ordre).
  const ordonnes = useMemo(() => trierParProximite(resultats, position.position), [resultats, position.position]);

  // Suggestions de produits/services selon la catégorie active (§5 : vocabulaire local).
  const suggestions = useMemo(() => {
    const liste =
      categorie === 'tous' ? Object.values(TAGS_PAR_CATEGORIE).flat() : TAGS_PAR_CATEGORIE[categorie] || [];
    return liste.slice(0, 10);
  }, [categorie]);

  return (
    <div className="ecran py-3 fond-traits-fins">
      {/* Barre de recherche */}
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
          <Icon name="search" size={19} />
        </span>
        <input
          type="search"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
          placeholder="Kiosque, café, tresses, plombier…"
          aria-label="Rechercher un établissement ou un produit"
          className="w-full rounded-md border border-line bg-white py-3 pl-10 pr-10 text-sm font-semibold text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {terme && (
          <button
            type="button"
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-muted hover:bg-soft"
            onClick={() => setTerme('')}
          >
            <Icon name="close" size={17} />
          </button>
        )}
      </div>

      <CategoryFilter valeur={categorie} onChange={setCategorie} className="mb-3" />

      {/* Les artisans abonnés remontent ici aussi : même liste que le feed (§3 ajout 29/09). */}
      <ArtisansMisEnAvant
        titre={terme.trim() ? `Artisans pour « ${terme.trim()} »` : 'Artisans mis en avant'}
        terme={terme}
        className="mb-3"
      />

      {suggestions.length > 0 && !terme && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTerme(s)}
              className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-semibold text-ink-muted transition hover:border-primary/40 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {horsLigne && (
        <InfoBanner variante="demo" titre="Résultats d’exemple" className="mb-3">
          Serveur injoignable : ces résultats proviennent du jeu de données de démonstration.
        </InfoBanner>
      )}

      <PromptLocalisation position={position} className="mb-3" />

      <p className="mb-2 text-[11px] font-semibold text-ink-muted">
        {chargement
          ? 'Recherche…'
          : `${ordonnes.length} résultat${ordonnes.length > 1 ? 's' : ''}${
              position.position && !position.depuisCache ? ' · triés par distance' : ''
            }`}
        {position.depuisCache && !chargement && ' · distance basée sur votre dernière position'}
      </p>

      {chargement && ordonnes.length === 0 ? (
        <EmptyState chargement titre="Recherche en cours…" />
      ) : ordonnes.length === 0 ? (
        <EmptyState
          icone="search"
          titre="Aucun résultat"
          description="Essayez un autre mot (« attiéké », « tresses », « vidange ») ou changez de catégorie."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {ordonnes.map((e) => (
            <EstablishmentCard key={e.id} variant="list" etablissement={e} />
          ))}
        </div>
      )}

      <button type="button" className="btn-ghost mt-4 w-full text-sm" onClick={() => navigate('/pharmacies-cliniques')}>
        <Icon name="pharmacy" size={18} />
        Chercher une pharmacie ou une clinique
      </button>
    </div>
  );
}

