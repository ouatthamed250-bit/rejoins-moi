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
import PromptLocalisation from '../components/PromptLocalisation.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { urlItineraire } from '../utils/distance.js';
import { filtrerEtablissementsDemo } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useFeedAlgorithm } from '../hooks/useFeedAlgorithm.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatCompteur } from '../utils/format.js';

/**
 * Nombre de fiches chargées par page. L'API plafonne à 60 (voir LIMITE_MAX côté
 * backend) : 30 tient dans un écran de smartphone sans monopoliser la 4G.
 */
const TAILLE_PAGE = 30;

export default function Feed() {
  const navigate = useNavigate();
  const { profil, favoris, historique, ajouterInteraction } = useAuth();
  const position = useGeolocation();
  const [categorie, setCategorie] = useState('tous');
  const [bruts, setBruts] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [encore, setEncore] = useState(false);
  const [chargementPlus, setChargementPlus] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [message, setMessage] = useState('');

  /**
   * Charge une page du feed. `numeroPage > 1` AJOUTE la page à la suite (bouton
   * « Afficher plus ») au lieu de remplacer la liste.
   */
  const charger = useCallback(
    async (numeroPage = 1) => {
      if (numeroPage === 1) setChargement(true);
      else setChargementPlus(true);

      const coords = position.position || null;

      try {
        const requete = new URLSearchParams({
          limit: String(TAILLE_PAGE),
          page: String(numeroPage),
        });
        // La catégorie est filtrée par le SERVEUR (indexé en base), pas sur les 30
        // cartes déjà reçues : avec 6 719 fiches importées, filtrer côté client
        // revenait à chercher « Beauté » parmi 30 fiches choisies par proximité —
        // résultat presque toujours vide. Correction du 30/09.
        if (categorie !== 'tous') {
          requete.set('categorie', categorie);
        } else {
          // Onglet « Tous » : PROXIMITÉ PURE sur toute la base (décision de lancement).
          // `diversite=0` = pas de mélange par catégorie : le serveur renvoie les fiches
          // strictement du plus proche au plus loin (départage stable par `_id`), et la
          // pagination couvre alors l'intégralité de l'annuaire sans doublon ni trou.
          requete.set('diversite', '0');
        }
        if (coords) {
          requete.set('lat', coords.lat);
          requete.set('lng', coords.lng);
        }
        const reponse = await api.get(`/establishments?${requete.toString()}`, { auth: false });
        const items = reponse.items || [];
        // Anti-doublon de sécurité : on n'ajoute jamais une fiche déjà chargée. Le
        // serveur garantit déjà l'unicité (départage `_id`), mais un scroll long ne doit
        // jamais afficher deux fois le même établissement, même en cas de réponse rejouée.
        setBruts((precedents) => {
          const base = numeroPage > 1 ? precedents : [];
          const vus = new Set(base.map((e) => String(e.id)));
          const ajouts = items.filter((e) => !vus.has(String(e.id)));
          return [...base, ...ajouts];
        });
        setTotal(Number(reponse.total) || 0);
        setPage(numeroPage);
        setEncore(reponse.hasMore !== false);
        setHorsLigne(false);
      } catch {
        if (numeroPage === 1) {
          // Repli : données de démonstration (jamais d'écran vide, cf. tournée terrain).
          setBruts(filtrerEtablissementsDemo({ categorie }));
          setTotal(0);
          setEncore(false);
        } else {
          setMessage('La suite n’a pas pu être chargée — vérifiez votre connexion.');
        }
        setHorsLigne(true);
      } finally {
        if (numeroPage === 1) setChargement(false);
        else setChargementPlus(false);
      }
    },
    [position.position, categorie]
  );

  /**
   * On attend que la position soit réglée (position réelle obtenue, ou échec
   * constaté au bout de 8 s). Sans coordonnées, l'API trie par récence et renvoie
   * les fiches SANS distance : on affiche alors le bandeau « Activez la
   * localisation » (PromptLocalisation) au lieu d'une distance trompeuse. L'écran ne
   * reste donc jamais bloqué. Correction du 01/10.
   */
  const positionPrete = Boolean(position.position) || !position.loading;

  useEffect(() => {
    if (!positionPrete) return;
    charger(1);
  }, [charger, positionPrete]);

  // Filet de sécurité côté client : la catégorie est déjà filtrée par l'API (et par
  // `filtrerEtablissementsDemo` en repli), mais pendant un changement d'onglet la
  // réponse précédente peut encore être affichée un instant.
  const filtres = useMemo(
    () => (categorie === 'tous' ? bruts : bruts.filter((e) => e.categorie === categorie)),
    [bruts, categorie]
  );

  const { orderedEstablishments: ordonnesAlgo, personnalise } = useFeedAlgorithm(filtres, {
    userId: profil?.id,
    position: position.position,
    interactions: historique,
    favoris,
  });

  // Onglet « Tous » : on conserve STRICTEMENT l'ordre renvoyé par le serveur (proximité
  // pure, départage `_id`). Toute re-personnalisation côté client recollerait des fiches
  // et casserait la garantie de lancement « du plus proche au plus loin ». La
  // personnalisation (§3) reste active sur les onglets de catégorie.
  const orderedEstablishments = categorie === 'tous' ? filtres : ordonnesAlgo;

  // Pagination COMPLÈTE (décision de lancement) : l'onglet « Tous » étant désormais en
  // proximité pure (ordre total stable, départage `_id`), on peut demander les pages
  // suivantes jusqu'à avoir parcouru TOUTE la base — sans doublon ni fiche sautée.
  const peutChargerPlus = encore;

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
    <div className="ecran py-3 fond-traits-fins">
      {/* Bannière d'accueil : plus de fond propre (correctif du 30/09). Elle
          portait `entete-degrade`, c'est-à-dire une DEUXIÈME rampe orange
          repartant de 16 % juste sous la barre du haut — c'est ce redémarrage,
          séparé par un liseré et une marge, qui produisait la « coupure » nette
          au milieu du fondu. La teinte orange lui vient désormais de la bande
          `.fondu-entete` de la barre du haut, qui s'éteint ici en douceur.
          `-mx-4` + `px-4` : la bannière occupe toute la largeur malgré la
          gouttière de `.ecran`. */}
      <section data-banniere-accueil="" className="-mx-4 mb-3 px-4 py-3">

        <h1 className="text-xl font-bold text-ink">{prenom ? `Bonjour ${prenom} 👋` : 'Bonjour 👋'}</h1>
        <p className="text-sm text-ink-muted">
          {bruts.length > 0
            ? `${total || bruts.length} établissements autour de vous${
                categorie === 'tous'
                  ? position.position
                    ? ', du plus proche au plus loin'
                    : ''
                  : personnalise
                    ? ', triés pour vous'
                    : ''
              } — ${bruts.length} affichés.`
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

      <PromptLocalisation position={position} className="mb-3" />

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

      {/* Pagination serveur (correction du 30/09) : l'annuaire compte des milliers de
          fiches, on n'en charge que 30 à la fois — « Afficher plus » en ajoute 30.
          Sur l'onglet « Tous », on s'arrête tant que l'API garde le mélange
          équilibré ; ensuite on renvoie vers les onglets de catégorie, qui vont, eux,
          jusqu'au bout de chaque catégorie. */}
      {!chargement && orderedEstablishments.length > 0 && peutChargerPlus && (
        <button
          type="button"
          className="btn-ghost mt-4 w-full py-3 text-sm"
          onClick={() => charger(page + 1)}
          disabled={chargementPlus}
        >
          <Icon name="grid" size={16} />
          {chargementPlus ? 'Chargement…' : `Afficher plus (${Math.max(total - bruts.length, 0)} restants)`}
        </button>
      )}

      {!chargement && orderedEstablishments.length > 0 && categorie === 'tous' && !peutChargerPlus && (
        <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
          Vous avez parcouru tous les établissements. Choisissez une catégorie juste au-dessus pour affiner.
        </p>
      )}

      {/* Explicabilité : on dit franchement comment ça trie (§3). */}
      {orderedEstablishments.length > 0 && (
        <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
          {categorie === 'tous'
            ? position.position
              ? 'Triés du plus proche au plus loin.'
              : 'Les établissements les plus récents. Activez la localisation pour trier par distance.'
            : personnalise
              ? 'Ordre personnalisé selon vos recherches et visites récentes.'
              : 'Ordre basé sur la proximité et les notes. Il s’affinera au fil de vos recherches.'}
        </p>
      )}
    </div>
  );
}

