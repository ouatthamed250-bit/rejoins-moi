// Feed.jsx — Écran d'accueil / Feed (voir maquette "1. Écran d'accueil / Feed")
//
// Contenu :
//  - Défilement vertical façon Facebook de cartes d'établissements
//  - Chaque carte : photo devanture, nom, catégorie, étoiles + nb avis, tags en pastilles
//  - DEUX compteurs affichés séparément : visites (œil) ET utilisateurs (personnes)
//  - Filtres rapides en haut : Tous / Alimentation / Beauté / Services / Artisanat
//  - Message de bienvenue personnalisé ("Bonjour Awa")
//  - L'ordre des cartes est piloté par useFeedAlgorithm (proximité + note, puis
//    apprentissage progressif à partir des vues/recherches/clics — §3)
//
// Décisions produit :
//  - Le bouton d'action « Aller chez <nom> » ouvre l'itinéraire ET incrémente le
//    compteur d'UTILISATEURS (POST /api/establishments/:id/action). Il n'incrémente
//    PAS le compteur de visites : les deux restent strictement indépendants (§3).
//  - L'incrément de visites (POST /:id/visit) se fait à l'ouverture de la FICHE
//    profil, pas au survol du feed — sinon le compteur gonflerait artificiellement.
//  - En cas d'API injoignable, on bascule sur les données de démonstration et on
//    l'indique en haut de page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CategoryFilter from '../components/CategoryFilter.jsx';
import ArtisansMisEnAvant from '../components/ArtisansMisEnAvant.jsx';
import EstablishmentCard from '../components/EstablishmentCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { urlItineraire } from '../utils/distance.js';
import { filtrerEtablissementsDemo } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useFeedAlgorithm } from '../hooks/useFeedAlgorithm.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatCompteur } from '../utils/format.js';

export default function Feed() {
  const navigate = useNavigate();
  const { profil, favoris, historique, ajouterInteraction } = useAuth();
  const position = useGeolocation();
  const [categorie, setCategorie] = useState('tous');
  const [bruts, setBruts] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [message, setMessage] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    const coords = position.position || null;

    try {
      const requete = new URLSearchParams({ limit: '30' });
      // La catégorie est filtrée par le SERVEUR (indexé en base), pas sur les 30
      // cartes déjà reçues : avec 6 719 fiches importées, filtrer côté client
      // revenait à chercher « Beauté » parmi 30 fiches choisies par proximité —
      // résultat presque toujours vide. Correction du 30/09.
      if (categorie !== 'tous') requete.set('categorie', categorie);
      if (coords) {
        requete.set('lat', coords.lat);
        requete.set('lng', coords.lng);
      }
      const reponse = await api.get(`/establishments?${requete.toString()}`, { auth: false });
      setBruts(reponse.items || []);
      setHorsLigne(false);
    } catch {
      // Repli : données de démonstration (jamais d'écran vide, cf. tournée terrain).
      setBruts(filtrerEtablissementsDemo({ categorie }));
      setHorsLigne(true);
    } finally {
      setChargement(false);
    }
  }, [position.position, categorie]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Filet de sécurité côté client : la catégorie est déjà filtrée par l'API (et par
  // `filtrerEtablissementsDemo` en repli), mais pendant un changement d'onglet la
  // réponse précédente peut encore être affichée un instant.
  const filtres = useMemo(
    () => (categorie === 'tous' ? bruts : bruts.filter((e) => e.categorie === categorie)),
    [bruts, categorie]
  );

  const { orderedEstablishments, personnalise } = useFeedAlgorithm(filtres, {
    userId: profil?.id,
    position: position.position,
    interactions: historique,
    favoris,
  });

  // ── Bouton d'action : « Aller chez <nom> » ──
  const ouvrirItineraire = useCallback(
    async (etablissement) => {
      const loc = etablissement?.localisation;
      if (loc) window.open(urlItineraire(loc.lat, loc.lng), '_blank', 'noopener,noreferrer');

      ajouterInteraction({
        type: 'itineraire',
        establishmentId: etablissement?.id,
        categorie: etablissement?.categorie,
      });

      // Compteur d'UTILISATEURS uniquement (jamais celui des visites, §3).
      if (horsLigne || String(etablissement?.id || '').startsWith('demo-')) {
        setMessage("Mode démonstration : le compteur d'utilisateurs n'est pas enregistré.");
        return;
      }
      try {
        const reponse = await api.post(`/establishments/${etablissement.id}/action`, {});
        setBruts((prec) =>
          prec.map((e) =>
            String(e.id) === String(etablissement.id)
              ? {
                  ...e,
                  compteurUtilisateurs: reponse.compteurUtilisateurs,
                  compteurVisites: reponse.compteurVisites,
                }
              : e
          )
        );
        setMessage(`Itinéraire lancé — ${reponse.texteBoutonAction}`);
      } catch {
        setMessage('Itinéraire lancé (compteur non mis à jour, réseau instable).');
      }
    },
    [ajouterInteraction, horsLigne]
  );

  const prenom = profil?.prenom || (profil?.nomComplet || '').split(' ')[0] || '';
  const totalUtilisateurs = orderedEstablishments.reduce((s, e) => s + (e.compteurUtilisateurs || 0), 0);

  return (
    <div className="ecran py-3">
      <section className="mb-3">
        <h1 className="text-xl font-bold text-ink">{prenom ? `Bonjour ${prenom} 👋` : 'Bonjour 👋'}</h1>
        <p className="text-sm text-ink-muted">
          {bruts.length > 0
            ? `${bruts.length} établissements autour de vous${personnalise ? ', triés pour vous' : ''}.`
            : 'Découvrez les commerces et artisans de votre quartier.'}
        </p>
      </section>

      {/* Accès rapides : la section santé est SÉPARÉE du feed social (§6) */}
      <div className="mb-3 flex gap-2">
        <button type="button" className="btn-health-ghost flex-1 py-2 text-xs" onClick={() => navigate('/pharmacies-cliniques')}>
          <Icon name="pharmacy" size={16} />
          Pharmacies & Cliniques
        </button>
        <button type="button" className="btn-ghost flex-1 py-2 text-xs" onClick={() => navigate('/main-doeuvre')}>
          <Icon name="briefcase" size={16} />
          Main-d’œuvre
        </button>
      </div>

      {horsLigne && (
        <InfoBanner variante="demo" titre="Données d’exemple" className="mb-3">
          Le serveur Rejoins’Moi est injoignable pour le moment. Les profils ci-dessous servent à tester l’application.
        </InfoBanner>
      )}

      {message && (
        <InfoBanner variante="info" className="mb-3" action={{ libelle: 'OK', onClick: () => setMessage('') }}>
          {message}
        </InfoBanner>
      )}

      <CategoryFilter valeur={categorie} onChange={setCategorie} sticky className="mb-3" />

      {/* Artisans mis en avant (abonnés) : contrepartie visible de l'abonnement. */}
      <ArtisansMisEnAvant className="mb-3" />

      {/* Vue synthétique : uniquement le compteur UTILISATEURS, jamais fusionné
          avec les visites (les deux restent strictement séparés, §3). */}
      {orderedEstablishments.length > 0 && (
        <p className="mb-2 text-[11px] font-semibold text-ink-muted">
          <Icon name="users" size={12} className="mr-1 inline align-[-2px]" />
          {formatCompteur(totalUtilisateurs)} utilisateurs ont contacté ces établissements
        </p>
      )}

      {chargement ? (
        <EmptyState chargement titre="Chargement du quartier…" />
      ) : orderedEstablishments.length === 0 ? (
        <EmptyState
          icone="grid"
          titre="Aucun établissement dans cette catégorie"
          description="Essayez une autre catégorie : de nouveaux commerces s’inscrivent chaque semaine."
          action={{ libelle: 'Voir tout', onClick: () => setCategorie('tous') }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {orderedEstablishments.map((e) => (
            <EstablishmentCard
              key={e.id}
              variant="feed"
              etablissement={e}
              position={position.position}
              onAction={ouvrirItineraire}
              onTagClick={(tag) => navigate(`/recherche?q=${encodeURIComponent(tag)}`)}
            />
          ))}
        </div>
      )}

      {/* Explicabilité de l'algorithme (§3) : on dit franchement comment ça trie. */}
      {orderedEstablishments.length > 0 && (
        <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
          {personnalise
            ? 'Ordre personnalisé selon vos recherches et visites récentes.'
            : 'Ordre basé sur la proximité et les notes. Il s’affinera au fil de vos recherches.'}
        </p>
      )}
    </div>
  );
}

