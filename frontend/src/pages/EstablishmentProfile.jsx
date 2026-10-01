// EstablishmentProfile.jsx — Fiche profil complet (voir maquette "3. Fiche profil complet")
//
// Contenu : grande photo de devanture, médaillon de la photo du vendeur/gérant,
// nom, badge « Vérifié », étoiles + nombre d'avis, catégorie, localisation +
// distance, pastilles produits/services, DEUX compteurs séparés (visites œil /
// utilisateurs personnes, §3), horaires, contact direct, avis clients et gros
// bouton d'action dynamique « Aller chez <nom> » en bas (§5).
//
// Décisions :
//  - La fiche est en PLEIN ÉCRAN (voir App.jsx) : elle porte donc son propre
//    bouton retour et son bouton de partage (c'est la page qu'on envoie sur WhatsApp).
//  - POST /:id/visit est appelé UNE SEULE FOIS au montage (garde-fou useRef) :
//    rafraîchir la fiche ne doit pas gonfler le compteur de visites.
//  - Le bouton d'action incrémente le compteur d'UTILISATEURS (POST /:id/action)
//    et ouvre l'itinéraire. Il ne touche JAMAIS au compteur de visites (§3).
//  - Catégorie « santé » : ni étoiles ni avis (§6, on ne note pas des actes
//    médicaux). On redirige vers la section Pharmacies & Cliniques, palette verte.
//  - Hors ligne : la fiche de démonstration correspondante s'affiche et on le dit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import PhotoSecours from '../components/PhotoSecours.jsx';
import StarRating from '../components/StarRating.jsx';
import TagBadge from '../components/TagBadge.jsx';
import { CompteursSepares } from '../components/EstablishmentCard.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { distanceDepuis, formatDistanceKm, urlItineraire } from '../utils/distance.js';
import { formatDateRelative, formatNote, formatTelephone, initiales } from '../utils/format.js';
import { AVIS_DEMO, ETABLISSEMENTS_DEMO, PROFIL_DEMO } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.js';

/** Miroir des libellés de catégories (data/demoData.js). */
const LIBELLES_CATEGORIES = {
  alimentation: 'Alimentation',
  beaute: 'Beauté',
  services: 'Services',
  artisanat: 'Artisanat',
  commerce: 'Commerce',
  sante: 'Santé',
  spiritualite: 'Spiritualité',
  autre: 'Autre',
};

export default function EstablishmentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { connecte, profil, favoris, basculerFavori, ajouterInteraction } = useAuth();
  const position = useGeolocation();

  const [etablissement, setEtablissement] = useState(null);
  const [avis, setAvis] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [introuvable, setIntrouvable] = useState(false);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [retourPartage, setRetourPartage] = useState('');

  // Garde-fou : on ne compte qu'UNE visite par fiche et par montage (§3).
  const visiteFaite = useRef(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setIntrouvable(false);
    const coords = position.position;
    try {
      const requete = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
      const reponse = await api.get(`/establishments/${id}${requete}`, { auth: false });
      setEtablissement(reponse.etablissement);
      setAvis(reponse.avis || []);
      setHorsLigne(false);
    } catch (err) {
      const demo = ETABLISSEMENTS_DEMO.find((e) => String(e.id) === String(id));
      if (demo) {
        setEtablissement(demo);
        setAvis(AVIS_DEMO);
        setHorsLigne(true);
      } else {
        setIntrouvable(true);
      }
    } finally {
      setChargement(false);
    }
  }, [id, position.position]);

  useEffect(() => {
    charger();
  }, [charger]);

  // ── Compteur de VISITES : une seule fois par fiche (§3) ──
  useEffect(() => {
    if (!etablissement) return;
    if (visiteFaite.current === etablissement.id) return;
    visiteFaite.current = etablissement.id;

    if (horsLigne) {
      // Mode démo : on incrémente localement pour que le comportement reste lisible.
      setEtablissement((prec) => (prec ? { ...prec, compteurVisites: (prec.compteurVisites || 0) + 1 } : prec));
      return;
    }
    api
      .post(`/establishments/${etablissement.id}/visit`, {})
      .then((r) =>
        setEtablissement((prec) =>
          prec && Number.isFinite(Number(r?.compteurVisites))
            ? { ...prec, compteurVisites: Number(r.compteurVisites) }
            : prec
        )
      )
      .catch(() => {
        /* une visite non comptée n'est pas une raison de gêner la lecture */
      });
  }, [etablissement, horsLigne]);

  const estSante = etablissement?.categorie === 'sante';
  const distance = useMemo(
    () => (etablissement ? distanceDepuis(position.position, etablissement) : null),
    [etablissement, position.position]
  );
  const estFavori = favoris.includes(String(etablissement?.id));
  const texteBouton =
    etablissement?.texteBoutonAction || (etablissement ? `Aller chez ${etablissement.nom}` : '');
  const lienFiche = typeof window !== 'undefined' ? window.location.href : '';

  /** Clic sur le gros bouton : +1 UTILISATEUR (§3) puis ouverture de l'itinéraire. */
  async function allerChez() {
    if (!etablissement) return;
    ajouterInteraction({
      type: 'clic',
      establishmentId: etablissement.id,
      terme: etablissement.nom,
    });

    if (horsLigne) {
      setEtablissement((prec) =>
        prec ? { ...prec, compteurUtilisateurs: (prec.compteurUtilisateurs || 0) + 1 } : prec
      );
    } else {
      try {
        const r = await api.post(`/establishments/${etablissement.id}/action`, {});
        setEtablissement((prec) =>
          prec && Number.isFinite(Number(r?.compteurUtilisateurs))
            ? {
                ...prec,
                compteurUtilisateurs: Number(r.compteurUtilisateurs),
                // Le libellé reste dynamique, comme le renvoie l'API (§5).
                telephone: r.telephone || prec.telephone,
              }
            : prec
        );
      } catch {
        setMessage('Serveur injoignable : le compteur d’utilisateurs n’a pas pu être mis à jour.');
      }
    }

    const url = urlItineraire(etablissement.localisation?.lat, etablissement.localisation?.lng);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /** Partage (WhatsApp natif sur mobile, copie du lien sinon). */
  async function partager() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: etablissement?.nom,
          text: `${etablissement?.nom} sur Rejoins’Moi`,
          url: lienFiche,
        });
        return;
      }
      await navigator.clipboard.writeText(lienFiche);
      setRetourPartage('Lien copié, prêt à envoyer sur WhatsApp.');
    } catch {
      setRetourPartage('Copiez le lien depuis la barre d’adresse pour le partager.');
    }
  }

  /** Publication d'un avis noté (§5). La note est obligatoire. */
  async function publierAvis(evt) {
    evt.preventDefault();
    if (!connecte) {
      navigate('/connexion', { state: { depuis: `/etablissement/${id}` } });
      return;
    }
    if (!note) {
      setMessage('Choisissez d’abord une note de 1 à 5 étoiles.');
      return;
    }
    setEnvoi(true);
    try {
      if (horsLigne) {
        setAvis((prec) => [
          {
            id: `local-${Date.now()}`,
            auteurNom: profil?.nomComplet || PROFIL_DEMO.nomComplet,
            note,
            commentaire,
            at: new Date().toISOString(),
          },
          ...prec,
        ]);
        setMessage('Mode démonstration : votre avis reste sur cet appareil et n’est pas publié.');
      } else {
        const r = await api.post(`/establishments/${id}/reviews`, { note, commentaire });
        setAvis(r.avis || []);
        setEtablissement((prec) =>
          prec ? { ...prec, noteMoyenne: r.noteMoyenne, nombreAvis: r.nombreAvis } : prec
        );
        setMessage('Merci ! Votre avis est publié.');
      }
      setNote(0);
      setCommentaire('');
    } catch (err) {
      setMessage(err?.message || 'Avis non enregistré. Réessayez dans un instant.');
    } finally {
      setEnvoi(false);
    }
  }

  // ── États non nominaux : chargement / fiche inconnue ──
  if (chargement) {
    return (
      <div className="ecran py-3">
        <button type="button" className="btn-ghost mb-3 px-3 py-2 text-xs" onClick={() => navigate(-1)}>
          <Icon name="chevronLeft" size={16} />
          Retour
        </button>
        <EmptyState chargement titre="Ouverture de la fiche…" />
      </div>
    );
  }

  if (introuvable || !etablissement) {
    return (
      <div className="ecran py-3">
        <EmptyState
          icone="alert"
          titre="Fiche introuvable"
          description="Ce profil n’existe plus ou le lien est incomplet. Revenez au feed pour découvrir les commerces autour de vous."
          action={{ libelle: 'Retour au feed', onClick: () => navigate('/') }}
        />
      </div>
    );
  }

  const tags = etablissement.tags || [];
  const libelleCategorie = LIBELLES_CATEGORIES[etablissement.categorie] || 'Autre';
  const whatsapp = etablissement.whatsapp || etablissement.telephone;

  return (
    /* `espace-barre-fixe` (theme.css) : cet écran est en plein écran (pas de bottom
       nav) mais sa barre « Aller chez … » est FIXE au bas de la fenêtre. Sans cette
       réserve, les derniers avis / le dernier bloc restaient coincés derrière la
       barre, impossible à atteindre (correctif « contenu coupé » du 30/09). */
    <div className="espace-barre-fixe min-h-full bg-white">
      {/* ── Grande photo de devanture + médaillon du vendeur/gérant ── */}
      <header className="relative">
        {etablissement.photoDevanture ? (
          <img
            src={etablissement.photoDevanture}
            alt={`Devanture de ${etablissement.nom}`}
            className="h-56 w-full object-cover"
          />
        ) : (
          /* v2 : même correctif que la carte du feed — plus de pavé orange plein
             sur l'en-tête d'une fiche sans photo, le fond reste ivoire. */
          <PhotoSecours nom={etablissement.nom} className="h-56 w-full" />
        )}

        {/* Barre d'actions flottante : retour, partage, favori */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <button
            type="button"
            aria-label="Retour"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-ink shadow-card transition active:scale-95"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          >
            <Icon name="chevronLeft" size={19} />
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Partager la fiche"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-ink shadow-card transition active:scale-95"
              onClick={partager}
            >
              <Icon name="share" size={18} />
            </button>
            <button
              type="button"
              aria-pressed={estFavori}
              aria-label={estFavori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              className={`flex h-9 w-9 items-center justify-center rounded-full shadow-card transition active:scale-95 ${
                estFavori ? 'bg-primary text-white' : 'bg-white/95 text-ink'
              }`}
              onClick={() => basculerFavori(etablissement.id)}
            >
              <Icon name="star" size={18} filled={estFavori} />
            </button>
          </div>
        </div>

        <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
          {libelleCategorie}
        </span>
        {distance != null && (
          <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white">
            <Icon name="mapPin" size={12} />
            {formatDistanceKm(distance)}
          </span>
        )}
      </header>

      <div className="ecran">
        {/* Médaillon de la photo du vendeur, chevauchant la devanture */}
        <div className="-mt-10 flex items-end justify-between gap-3">
          {etablissement.photoVendeur ? (
            <img
              src={etablissement.photoVendeur}
              alt={`Vendeur / gérant de ${etablissement.nom}`}
              className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-card"
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-primary text-xl font-bold text-white shadow-card">
              {initiales(etablissement.nom).slice(0, 2) || 'RM'}
            </span>
          )}
          {etablissement.verifie && (
            <span className="mb-1 flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-white">
              <Icon name="verified" size={12} />
              Profil vérifié
            </span>
          )}
        </div>

        <h1 className="mt-2 text-2xl font-bold leading-tight text-ink">{etablissement.nom}</h1>

        <div className="mt-1">
          {estSante ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-health-dark">
              <Icon name="heart" size={14} />
              Établissement de santé — sans notation publique
            </span>
          ) : (
            <StarRating
              note={etablissement.noteMoyenne}
              nombreAvis={etablissement.nombreAvis}
              taille={17}
            />
          )}
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <Icon name="mapPin" size={14} />
            {[etablissement.quartier, etablissement.commune].filter(Boolean).join(', ') || 'Abidjan'}
          </span>
          {etablissement.horaires && (
            <span className="flex items-center gap-1">
              <Icon name="clock" size={14} />
              {etablissement.horaires}
            </span>
          )}
        </p>

        {/* ── LES DEUX COMPTEURS, SÉPARÉS ET EXPLICITES (§3) ── */}
        <div className="mt-3 rounded-md border border-line bg-soft px-3 py-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            Ce profil en chiffres
          </p>
          <CompteursSepares
            visites={etablissement.compteurVisites}
            utilisateurs={etablissement.compteurUtilisateurs}
          />
          <p className="mt-1 text-[10px] leading-snug text-ink-muted">
            À gauche les <strong>visites</strong> de cette fiche, à droite les <strong>utilisateurs</strong>{' '}
            venus grâce à elle. Ce sont deux mesures distinctes : elles ne sont jamais additionnées.
          </p>
        </div>

        {horsLigne && (
          <InfoBanner variante="demo" titre="Fiche d’exemple" className="mt-3">
            Serveur injoignable : cette fiche provient du jeu de données de démonstration. Les compteurs
            évoluent localement mais rien n’est enregistré.
          </InfoBanner>
        )}

        {message && (
          <InfoBanner
            variante="info"
            className="mt-3"
            action={{ libelle: 'OK', onClick: () => setMessage('') }}
          >
            {message}
          </InfoBanner>
        )}

        {retourPartage && (
          <InfoBanner
            variante="succes"
            className="mt-3"
            action={{ libelle: 'OK', onClick: () => setRetourPartage('') }}
          >
            {retourPartage}
          </InfoBanner>
        )}

        {etablissement.description && (
          <p className="mt-3 text-sm leading-snug text-ink">{etablissement.description}</p>
        )}

        {/* ── Pastilles produits/services (§5) : cliquer relance une recherche ── */}
        {tags.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-2 text-sm font-bold text-ink">Produits &amp; services</h2>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagBadge
                  key={tag}
                  label={tag}
                  taille="sm"
                  onClick={() => {
                    ajouterInteraction({ type: 'recherche', terme: tag });
                    navigate(`/recherche?q=${encodeURIComponent(tag)}`);
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Contact direct : appel et WhatsApp ── */}
        {etablissement.telephone && (
          <section className="mt-4 grid grid-cols-2 gap-2">
            <a className="btn-ghost text-sm" href={`tel:${etablissement.telephone}`}>
              <Icon name="phone" size={17} />
              Appeler
            </a>
            <a
              className="btn-ghost text-sm"
              href={`https://wa.me/${String(whatsapp).replace('+', '')}?text=${encodeURIComponent(
                `Bonjour, je vous contacte via Rejoins'Moi au sujet de ${etablissement.nom}.`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="whatsapp" size={17} />
              WhatsApp
            </a>
          </section>
        )}

        {/* ── Avis clients (§5) — jamais pour la santé (§6) ── */}
        {estSante ? (
          <section className="mt-4">
            <InfoBanner variante="info" titre="Pas de note pour les lieux de soins">
              Rejoins’Moi ne note pas les actes médicaux : cette fiche n’affiche donc ni étoile ni avis. Les
              horaires, le statut de garde et les numéros se consultent dans la section dédiée.
            </InfoBanner>
            <button
              type="button"
              className="btn-health-ghost mt-2 w-full text-sm"
              onClick={() => navigate('/pharmacies-cliniques')}
            >
              <Icon name="pharmacy" size={18} />
              Voir Pharmacies &amp; Cliniques
            </button>
          </section>
        ) : (
          <section className="mt-4">
            <h2 className="text-sm font-bold text-ink">
              Avis clients
              {avis.length > 0 && <span className="font-normal text-ink-muted"> ({avis.length})</span>}
            </h2>
            <p className="mb-2 text-[11px] text-ink-muted">
              Moyenne {formatNote(etablissement.noteMoyenne)}/5 sur {etablissement.nombreAvis} avis.
            </p>

            {/* Formulaire : note obligatoire, commentaire facultatif */}
            <form onSubmit={publierAvis} className="rounded-md border border-line p-3">
              <p className="text-xs font-bold text-ink">Notez votre expérience</p>
              <div className="mt-1">
                <StarRating
                  note={note}
                  onChange={setNote}
                  interactif
                  afficherNombre={false}
                  taille={26}
                />
              </div>
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                rows={3}
                maxLength={600}
                placeholder="Ce que vous avez aimé, ce qui peut être amélioré…"
                className="mt-2 w-full rounded-md border border-line bg-white p-2 text-sm text-ink outline-none transition focus:border-primary"
              />
              <button type="submit" className="bouton-principal mt-2 w-full text-sm" disabled={envoi}>
                {envoi ? 'Envoi…' : connecte ? 'Publier mon avis' : 'Se connecter pour noter'}
              </button>
              <p className="mt-1 text-[10px] text-ink-muted">
                Un seul avis par personne : publier à nouveau remplace votre avis précédent.
              </p>
            </form>

            {avis.length === 0 ? (
              <p className="mt-3 text-xs text-ink-muted">
                Aucun avis pour l’instant — soyez la première personne à donner le vôtre.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {avis.map((a, i) => (
                  <li key={a.id || a._id || i} className="carte p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-bold text-primary">
                        {initiales(a.auteurNom || 'Client')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-ink">{a.auteurNom || 'Client'}</p>
                        <p className="text-[10px] text-ink-muted">{formatDateRelative(a.at || a.createdAt)}</p>
                      </div>
                      <StarRating note={a.note} afficherNombre={false} taille={13} />
                    </div>
                    {a.commentaire && (
                      <p className="mt-2 text-xs leading-snug text-ink">{a.commentaire}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="mt-5 flex justify-center">
          <Link to="/" className="text-xs font-bold text-primary underline">
            Explorer d’autres établissements
          </Link>
        </div>
      </div>

      {/* ── Bouton d'action fixe : le TEXTE est dynamique, « Aller chez <nom> » (§5) ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="ecran flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              {estSante
                ? 'Lieu de soins'
                : `${formatNote(etablissement.noteMoyenne)}/5 · ${etablissement.nombreAvis} avis`}
            </p>
            <p className="truncate text-[11px] text-ink-muted">
              {distance != null ? `À ${formatDistanceKm(distance)} de vous` : 'Itinéraire et contact direct'}
            </p>
          </div>
          <button
            type="button"
            className={`${estSante ? 'btn-health' : 'bouton-principal'} shrink-0 text-sm`}
            onClick={allerChez}
          >
            <Icon name="route" size={19} />
            {texteBouton}
          </button>
        </div>
      </div>
    </div>
  );
}

