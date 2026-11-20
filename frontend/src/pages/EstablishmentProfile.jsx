// EstablishmentProfile.jsx — Fiche profil complet (voir maquette "3. Fiche profil complet")
//
// Contenu : grande photo de devanture, médaillon de la photo du vendeur/gérant,
// nom, pastille « Ouvert / Fermé » calculée en direct (16/11), badge « Vérifié »,
// étoiles + nombre d'avis, catégorie, localisation + distance, pastilles
// produits/services, DEUX compteurs séparés (visites œil / utilisateurs personnes,
// §3), horaires, contact direct, avis clients et gros bouton d'action dynamique
// « Aller chez <nom> » en bas (§5).
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
//  - HIÉRARCHIE (16/11) : quatre boutons d'administration (« Gérer », « Modifier les
//    photos », « Modifier la galerie », « Modifier la fiche ») se disputaient le haut
//    de la fiche ; sur un téléphone la rangée passait à la ligne et venait chevaucher
//    le médaillon du gérant. Ils sont regroupés derrière UN bouton « Modifier ma
//    fiche » qui ouvre un menu — les quatre actions et leurs panneaux sont inchangés.
//  - « Déjà visité » n'est plus une grosse pastille du haut : c'est une coche discrète
//    dans la barre d'action du bas, à côté de « Aller chez <nom> », là où l'on décide
//    qu'on est venu.
//  - La couverture réserve 40 px sous la photo (`pb-10`) : le médaillon rond y
//    termine sa course, plus aucun bouton ne le recouvre.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import BarreActionFixe from '../components/BarreActionFixe.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import PhotoSecours from '../components/PhotoSecours.jsx';
import PhotoUploadField from '../components/PhotoUploadField.jsx';
import GaleriePhotos from '../components/GaleriePhotos.jsx';
import EditeurHoraires from '../components/EditeurHoraires.jsx';
import StarRating from '../components/StarRating.jsx';
import TagBadge from '../components/TagBadge.jsx';
import { CompteursSepares } from '../components/EstablishmentCard.jsx';
import { Icon, IconLoader } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { distanceDepuis, formatDistanceKm, getDistanceKm, urlItineraire } from '../utils/distance.js';
import { formatDateRelative, formatNote, formatTelephone, formaterNomPublic, initiales } from '../utils/format.js';
import { partagerWhatsApp, textePartageFiche, urlPartageFiche } from '../utils/partage.js';
import { estOuvertMaintenant, horairesParDefaut, resumerHoraires } from '../utils/statutHoraire.js';
import { AVIS_DEMO, ETABLISSEMENTS_DEMO, PROFIL_DEMO } from '../data/demoData.js';
import { calibrerPositionGps, useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.js';

/** Leaflet n'arrive que si le gérant ouvre réellement la carte de recalibrage. */
const ChoisirPosition = lazy(() => import('../components/ChoisirPosition.jsx'));

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
  const { connecte, profil, favoris, visites, basculerFavori, basculerVisite, ajouterInteraction } = useAuth();
  const position = useGeolocation();

  const [etablissement, setEtablissement] = useState(null);
  const [avis, setAvis] = useState([]);
  const [chargement, setChargement] = useState(true);
  // « Déjà visité » renvoyé par GET /establishments/:id (optionalAuth) : la fiche
  // reste publique, mais un compte connecté reçoit son propre état de visite.
  const [visiteServeur, setVisiteServeur] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const [introuvable, setIntrouvable] = useState(false);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState('');
  const [envoi, setEnvoi] = useState(false);

  // ── Menu du gérant (16/11) ──
  // Un seul point d'entrée pour les quatre actions d'administration : le bouton
  // « Modifier ma fiche » ouvre ce menu. Les panneaux visés (informations, galerie,
  // photos, gestion) ne changent pas — seul l'accès est regroupé, pour que le haut
  // de la fiche redevienne lisible et que le médaillon du gérant reste dégagé.
  const [menuAdminOuvert, setMenuAdminOuvert] = useState(false);

  // ── Édition des photos par le gérant (ajout du 16/11) ──
  // Jusqu'ici, les seules photos envoyables l'étaient à la CRÉATION de la fiche :
  // une fiche publiée sans photo (ou avec une photo floue) ne pouvait plus jamais
  // être complétée depuis l'application, alors que le serveur l'autorise
  // (PATCH /api/establishments/:id, réservé au gérant propriétaire).
  const [editionPhotos, setEditionPhotos] = useState(false);
  const [photoDevantureEdition, setPhotoDevantureEdition] = useState('');
  const [photoVendeurEdition, setPhotoVendeurEdition] = useState('');
  const [enregistrementPhotos, setEnregistrementPhotos] = useState(false);
  const [erreurPhotos, setErreurPhotos] = useState('');

  // ── Galerie multi-photos (ajout du 16/11) ──
  // Huit photos maximum, EN PLUS de la devanture et du vendeur. Les images sont
  // hébergées chez Cloudinary : la fiche ne transporte que des URL.
  // `galerieEdition` est le brouillon du panneau « Modifier la galerie » : on ne
  // modifie la fiche qu'à l'enregistrement (un ajout annulé ne laisse rien).
  const [editionGalerie, setEditionGalerie] = useState(false);
  const [galerieEdition, setGalerieEdition] = useState([]);
  const [enregistrementGalerie, setEnregistrementGalerie] = useState(false);
  const [erreurGalerie, setErreurGalerie] = useState('');
  // Photo affichée en plein écran (index dans `photosGalerie`, null = fermé).
  const [photoOuverte, setPhotoOuverte] = useState(null);

  // ── Panneau « Gérer mon établissement » (ajout du 16/11) ──
  // Deux gestes du quotidien manquaient au gérant une fois sa fiche publiée :
  //   1. FERMER EN UN CLIC (« rupture de stock », panne, maladie, deuil). Avant,
  //      il n'y avait rien à faire dans l'app : le client se déplaçait pour rien.
  //      La fermeture s'affiche immédiatement sur la fiche (pastille rouge), sans
  //      attendre la nuit ni modifier la grille d'horaires — une fermeture
  //      temporaire n'est pas un changement d'horaires d'ouverture.
  //   2. CORRIGER SES HORAIRES (une heure mal saisie à l'inscription, une nouvelle
  //      amplitude, la pause du midi). Le serveur le permettait déjà (PATCH
  //      /establishments/:id) mais aucun écran ne l'exposait.
  // `gestionOuverte` ouvre la feuille du bas ; `horairesEdition` est son brouillon :
  // rien n'est écrit avant « Enregistrer ».
  const [gestionOuverte, setGestionOuverte] = useState(false);
  const [formulaireFermeture, setFormulaireFermeture] = useState(false);
  const [raisonFermeture, setRaisonFermeture] = useState('');
  const [enregistrementFermeture, setEnregistrementFermeture] = useState(false);
  const [erreurFermeture, setErreurFermeture] = useState('');
  const [horairesEdition, setHorairesEdition] = useState(null);
  const [enregistrementHoraires, setEnregistrementHoraires] = useState(false);
  const [erreurHoraires, setErreurHoraires] = useState('');
  const [messageGestion, setMessageGestion] = useState('');

  // ── Édition des informations de la fiche (ajout du 16/11) ──
  // Une fiche publiée avec un nom mal orthographié, une description vide ou un
  // ancien numéro restait figée : le serveur accepte pourtant ces champs
  // (PATCH /establishments/:id, `champsSimple`). `infosEdition` est le brouillon
  // du panneau « Modifier la fiche » — rien n'est écrit avant « Enregistrer ».
  const [editionInfos, setEditionInfos] = useState(false);
  const [infosEdition, setInfosEdition] = useState({
    nom: '',
    description: '',
    telephone: '',
    whatsapp: '',
    horaires: '',
  });
  const [enregistrementInfos, setEnregistrementInfos] = useState(false);
  const [erreurInfos, setErreurInfos] = useState('');

  // ── Localisation de l'établissement (calibrage GPS du 16/11) ──
  // Une fiche publiée avec un point approximatif envoie les clients au mauvais
  // endroit. Le gérant peut donc re-mesurer sur place : 10 s de GPS, la meilleure
  // mesure, puis confirmation visuelle sur la carte.
  //
  // `localisationEdition` est un BROUILLON (`{ lat, lng, accuracy }`) : rien ne part
  // au serveur avant « Enregistrer », comme le reste du panneau. `positionGps` est
  // la mesure fraîche, utilisée comme centre de la carte ; elle est oubliée dès que
  // la carte se ferme pour ne pas devenir un point de départ trompeur la fois
  // suivante.
  const [localisationEdition, setLocalisationEdition] = useState(null);
  const [positionGps, setPositionGps] = useState(null);
  const [cartePositionOuverte, setCartePositionOuverte] = useState(false);
  const [calibrageEnCours, setCalibrageEnCours] = useState(false);
  const [erreurLocalisation, setErreurLocalisation] = useState('');
  // Jeton de calibrage : fermer le panneau pendant les 10 s doit annuler l'ouverture
  // de la carte (sinon elle surgirait par-dessus un panneau déjà refermé).
  const calibrageId = useRef(0);

  // ── État de secours des PHOTOS (correctif du 16/11) ──
  // Une URL de photo morte (fichier effacé, ancien hébergement) affichait un cadre
  // vide ou l'icône « image brisée » du navigateur, alors que la fiche sait très
  // bien produire un visuel de remplacement (PhotoSecours + dessin de catégorie).
  // On bascule donc sur ce visuel dès que le chargement échoue, sans changer les
  // dimensions (`h-56 w-full` / médaillon `h-20 w-20`) : la mise en page ne bouge pas.
  const [devantureCassee, setDevantureCassee] = useState(false);
  const [vendeurCassee, setVendeurCassee] = useState(false);
  const urlDevanture =
    etablissement?.photoDevantureUrl || etablissement?.photoDevanture || '';
  const urlVendeur = etablissement?.photoVendeurUrl || etablissement?.photoVendeur || '';
  // Galerie : URL https Cloudinary, dans l'ordre d'ajout choisi par le gérant.
  // Une fiche ancienne (ou de démonstration) n'a pas ce champ : tableau vide.
  const photosGalerie = Array.isArray(etablissement?.photos) ? etablissement.photos : [];
  useEffect(() => {
    setDevantureCassee(false);
  }, [urlDevanture]);
  useEffect(() => {
    setVendeurCassee(false);
  }, [urlVendeur]);

  // ── Pastille « Ouvert / Fermé » (16/11) ──
  // Le statut est recalculé à l'instant présent, sans requête : `maintenant` change
  // toutes les 30 s et au retour sur l'onglet (le téléphone a pu dormir une heure,
  // un `setInterval` seul ne se réveille pas toujours). Le calcul lui-même est dans
  // utils/statutHoraire.js — il gère la fermeture après minuit et la fermeture
  // temporaire, et renvoie `connu: false` quand la fiche n'a pas de grille.
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const battement = setInterval(() => setMaintenant(new Date()), 30000);
    const auReveil = () => setMaintenant(new Date());
    document.addEventListener('visibilitychange', auReveil);
    return () => {
      clearInterval(battement);
      document.removeEventListener('visibilitychange', auReveil);
    };
  }, []);
  const statutHoraire = useMemo(
    () => estOuvertMaintenant(etablissement, maintenant),
    [etablissement, maintenant]
  );

  // Garde-fou : on ne compte qu'UNE visite par fiche et par montage (§3).
  const visiteFaite = useRef(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setIntrouvable(false);
    const coords = position.position;
    try {
      const requete = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
      // Jeton ACTIVÉ (défaut du client) : c'est lui qui permet au serveur de
      // répondre `estVisite` pour CE compte. La fiche reste publique — la route est
      // en `optionalAuth`, un visiteur sans jeton reçoit la même fiche, sans le
      // booléen. Sans ce changement (l'appel était en `auth: false`), le serveur ne
      // savait jamais qui regardait et « déjà visité » serait toujours faux.
      const reponse = await api.get(`/establishments/${id}${requete}`);
      setEtablissement(reponse.etablissement);
      setAvis(reponse.avis || []);
      setVisiteServeur(Boolean(reponse.estVisite));
      setHorsLigne(false);
    } catch (err) {
      const demo = ETABLISSEMENTS_DEMO.find((e) => String(e.id) === String(id));
      if (demo) {
        setEtablissement(demo);
        setAvis(AVIS_DEMO);
        setVisiteServeur(false);
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

  // ── Fond de l'écran ──
  // La fiche est blanche de bout en bout : on le déclare sur <html> pour que la
  // réserve d'espace du bas (hauteur mesurée du bloc fixe, theme.css) prolonge ce
  // blanc, au lieu de laisser apparaître un liseré ivoire juste au-dessus de la
  // barre « Aller chez … ».
  useEffect(() => {
    document.documentElement.dataset.fond = 'blanc';
    return () => {
      delete document.documentElement.dataset.fond;
    };
  }, []);

  const estSante = etablissement?.categorie === 'sante';
  const distance = useMemo(
    () => (etablissement ? distanceDepuis(position.position, etablissement) : null),
    [etablissement, position.position]
  );
  const estFavori = favoris.includes(String(etablissement?.id));
  // « Déjà visité » (privé) : `visites` vient du compte (état partagé, mise à jour
  // immédiate au clic) ; `visiteServeur` est le booléen renvoyé par la fiche, utile
  // quand le profil local est encore en cours de rafraîchissement.
  const estVisite =
    visites.includes(String(etablissement?.id || id)) ||
    Boolean(visiteServeur && String(etablissement?.id || id) === String(id));
  // ── Propriétaire de la fiche ? ──
  // Le serveur autorise PATCH /establishments/:id si `createdByUserId` correspond
  // OU si `user.etablissementId` correspond à la fiche (routes/establishments.js).
  // `createdByUserId` n'est pas publié dans la fiche (toCardJSON), mais
  // `etablissementId` l'est sur le profil (User.toPublicJSON) : c'est donc le SEUL
  // critère vérifiable côté application. Il est renseigné à la création de la fiche
  // comme à la reprise d'une fiche importée (POST /:id/reclamer), et AuthContext le
  // relit juste après ces deux actions (rafraichirProfil).
  const estProprietaire = Boolean(
    connecte &&
      !horsLigne &&
      profil?.etablissementId &&
      String(profil.etablissementId) === String(etablissement?.id)
  );
  // Fermeture temporaire en cours : lue DANS la fiche, donc la pastille et le
  // bouton basculent dès que le PATCH a répondu — sans recharger l'écran.
  // (`fermetureTemporaire` est toujours publié par toCardJSON, même inactif.)
  const fermetureTemporaire = etablissement?.fermetureTemporaire || { actif: false, raison: '' };
  const fermetureActive = Boolean(fermetureTemporaire.actif);
  const raisonFermetureActive = String(fermetureTemporaire.raison || '').trim();
  const texteBouton =
    etablissement?.texteBoutonAction || (etablissement ? `Aller chez ${etablissement.nom}` : '');

  /**
   * Gabarit d'une ligne du menu du gérant. Écrit une fois : les quatre actions
   * doivent se ressembler au pixel près, sinon le menu redevient le patchwork de
   * pastilles qu'il remplace.
   */
  const classeLigneMenu =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-bold text-ink transition active:bg-soft';

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

  /**
   * Partage de la fiche : feuille de partage native sur mobile, WhatsApp Web sur
   * desktop (voir utils/partage.js). L'ancienne version se contentait de copier le
   * lien dans le presse-papiers : il fallait ensuite ouvrir WhatsApp et coller —
   * un détour que personne ne fait. Le lien est désormais déjà rédigé dans WhatsApp.
   */
  function partager() {
    if (!etablissement) return;
    partagerWhatsApp({
      texte: textePartageFiche(etablissement),
      url: urlPartageFiche(etablissement.id || etablissement._id),
    });
  }

  /**
   * Coche « Déjà visité » de la barre du bas (16/11).
   *
   * L'action a quitté le haut de la fiche : entre le partage et l'étoile, elle y
   * passait pour un bouton public de plus. Elle est maintenant à côté de « Aller
   * chez … », l'endroit où l'on décide justement qu'on est venu. Sans compte, la
   * marque ne vivrait que sur cet appareil : on invite à se connecter (multi-
   * appareils) au lieu de faire semblant — même règle qu'avant.
   */
  function basculerVisiteDepuisLaBarre() {
    if (!etablissement) return;
    if (!connecte) {
      navigate('/connexion', { state: { depuis: `/etablissement/${id}` } });
      return;
    }
    basculerVisite(etablissement.id || id);
  }

  /**
   * Exécute une action du menu du gérant en refermant le menu : une seule feuille
   * ouverte à la fois (les panneaux sont des surcouches plein écran).
   */
  function actionAdmin(action) {
    setMenuAdminOuvert(false);
    action();
  }

  /** Ouvre le panneau d'édition des photos, pré-rempli avec ce qui est affiché. */
  function ouvrirEditionPhotos() {
    setPhotoDevantureEdition(urlDevanture);
    setPhotoVendeurEdition(urlVendeur);
    setErreurPhotos('');
    setEditionPhotos(true);
  }

  /**
   * Enregistre les photos de la fiche (gérant propriétaire uniquement).
   *
   * On n'envoie QUE les champs réellement modifiés. C'est volontaire : renvoyer
   * `photoDevantureUrl` (l'URL que sert l'API) l'enregistrerait comme valeur de la
   * photo, et la route binaire se redirigerait alors vers elle-même.
   */
  async function enregistrerPhotos(evt) {
    evt.preventDefault();
    if (!etablissement || !estProprietaire) return;
    setErreurPhotos('');

    const modifications = {};
    if (photoDevantureEdition !== urlDevanture) modifications.photoDevanture = photoDevantureEdition;
    if (photoVendeurEdition !== urlVendeur) modifications.photoVendeur = photoVendeurEdition;

    if (Object.keys(modifications).length === 0) {
      setEditionPhotos(false);
      return;
    }
    if (
      photoDevantureEdition &&
      photoVendeurEdition &&
      photoDevantureEdition === photoVendeurEdition
    ) {
      setErreurPhotos('Les deux photos doivent être différentes (devanture et vendeur/gérant).');
      return;
    }

    setEnregistrementPhotos(true);
    try {
      const reponse = await api.patch(`/establishments/${etablissement.id}`, modifications);
      if (reponse?.etablissement) {
        setEtablissement((prec) => ({ ...(prec || {}), ...reponse.etablissement }));
      }
      setEditionPhotos(false);
      setMessage('Photos mises à jour.');
    } catch (err) {
      setErreurPhotos(err?.message || 'Enregistrement impossible pour le moment.');
    } finally {
      setEnregistrementPhotos(false);
    }
  }

  /** Ouvre le panneau « Modifier la galerie », pré-rempli avec la galerie actuelle. */
  function ouvrirEditionGalerie() {
    setGalerieEdition(photosGalerie);
    setErreurGalerie('');
    setEditionGalerie(true);
  }

  /**
   * Enregistre la galerie (gérant propriétaire uniquement).
   *
   * On envoie le TABLEAU COMPLET : c'est ce qui permet la suppression et le
   * réordonnancement (le serveur remplace `doc.photos`). Les photos déjà en ligne
   * gardent leur URL Cloudinary — rien n'est re-téléversé.
   */
  async function enregistrerGalerie(evt) {
    evt.preventDefault();
    if (!etablissement || !estProprietaire) return;
    setErreurGalerie('');
    setEnregistrementGalerie(true);
    try {
      const reponse = await api.patch(`/establishments/${etablissement.id}`, { photos: galerieEdition });
      if (reponse?.etablissement) {
        setEtablissement((prec) => ({ ...(prec || {}), ...reponse.etablissement }));
      } else {
        setEtablissement((prec) => (prec ? { ...prec, photos: galerieEdition } : prec));
      }
      setEditionGalerie(false);
      setMessage('Galerie mise à jour.');
    } catch (err) {
      setErreurGalerie(err?.message || 'Enregistrement impossible pour le moment.');
    } finally {
      setEnregistrementGalerie(false);
    }
  }

  /**
   * Ouvre le panneau « Gérer mon établissement », pré-rempli avec la grille
   * réellement publiée. Une fiche importée n'a AUCUNE grille : on part alors des
   * horaires par défaut (08:00–18:00, dimanche fermé) — le gérant corrige une
   * proposition au lieu de remplir sept lignes vides.
   */
  function ouvrirGestion() {
    setHorairesEdition(etablissement?.horairesStructures || horairesParDefaut());
    setFormulaireFermeture(false);
    setRaisonFermeture('');
    setErreurFermeture('');
    setErreurHoraires('');
    setMessageGestion('');
    setGestionOuverte(true);
  }

  /**
   * FERME la fiche temporairement (« rupture de stock », panne, maladie, deuil).
   *
   * Pourquoi ne pas toucher à la grille : demain matin la boutique rouvre à son
   * heure habituelle. On n'écrit donc QUE `fermetureTemporaire`, qui prime sur les
   * horaires dans `estOuvertMaintenant` — un clic pour fermer, un clic pour
   * rouvrir, la grille d'ouverture reste intacte.
   */
  async function fermerTemporairement(evt) {
    evt.preventDefault();
    if (!etablissement || !estProprietaire) return;
    setErreurFermeture('');
    setEnregistrementFermeture(true);
    // Raison facultative. Le serveur la borne à 160 caractères : on tronque ici
    // pour que l'écran n'annonce jamais plus long que ce qui est réellement stocké.
    const fermeture = { actif: true, raison: raisonFermeture.trim().slice(0, 160) };
    try {
      const reponse = await api.patch(`/establishments/${etablissement.id}`, {
        fermetureTemporaire: fermeture,
      });
      if (reponse?.etablissement) {
        setEtablissement((prec) => ({ ...(prec || {}), ...reponse.etablissement }));
      } else {
        setEtablissement((prec) => (prec ? { ...prec, fermetureTemporaire: fermeture } : prec));
      }
      setFormulaireFermeture(false);
      setRaisonFermeture('');
      setMessageGestion(
        fermeture.raison
          ? `Votre fiche affiche « Fermé (${fermeture.raison}) ».`
          : 'Votre fiche affiche « Fermé (fermeture temporaire) ».'
      );
    } catch (err) {
      setErreurFermeture(err?.message || 'Fermeture non enregistrée. Réessayez dans un instant.');
    } finally {
      setEnregistrementFermeture(false);
    }
  }

  /** ROUVRE la fiche : la pastille repart des horaires, la raison est effacée. */
  async function rouvrirEtablissement() {
    if (!etablissement || !estProprietaire) return;
    setErreurFermeture('');
    setEnregistrementFermeture(true);
    const fermeture = { actif: false, raison: '' };
    try {
      const reponse = await api.patch(`/establishments/${etablissement.id}`, {
        fermetureTemporaire: fermeture,
      });
      if (reponse?.etablissement) {
        setEtablissement((prec) => ({ ...(prec || {}), ...reponse.etablissement }));
      } else {
        setEtablissement((prec) => (prec ? { ...prec, fermetureTemporaire: fermeture } : prec));
      }
      setFormulaireFermeture(false);
      setMessageGestion('Fiche réouverte : la pastille suit de nouveau vos horaires.');
    } catch (err) {
      setErreurFermeture(err?.message || 'Réouverture non enregistrée. Réessayez dans un instant.');
    } finally {
      setEnregistrementFermeture(false);
    }
  }

  /**
   * Enregistre la grille d'horaires corrigée (brouillon `horairesEdition`).
   *
   * On envoie AUSSI le texte historique `horaires`, régénéré depuis la grille :
   * c'est lui qu'affichent la ligne d'horaires de la fiche et l'annuaire, et il
   * ne doit pas contredire la grille que le gérant vient de corriger. Sur une
   * fiche importée, ce PATCH est aussi ce qui fait apparaître la pastille : le
   * serveur enregistre la grille ET son témoin de saisie ensemble.
   */
  async function enregistrerHorairesGestion(evt) {
    evt.preventDefault();
    if (!etablissement || !estProprietaire || !horairesEdition) return;
    setErreurHoraires('');
    setEnregistrementHoraires(true);
    const grille = horairesEdition;
    const resume = resumerHoraires(grille);
    try {
      const reponse = await api.patch(`/establishments/${etablissement.id}`, {
        horairesStructures: grille,
        horaires: resume,
      });
      if (reponse?.etablissement) {
        setEtablissement((prec) => ({ ...(prec || {}), ...reponse.etablissement }));
      } else {
        setEtablissement((prec) =>
          prec ? { ...prec, horairesStructures: grille, horaires: resume } : prec
        );
      }
      setMessageGestion('Horaires enregistrés : la pastille « Ouvert / Fermé » les suit.');
    } catch (err) {
      setErreurHoraires(err?.message || 'Enregistrement impossible pour le moment.');
    } finally {
      setEnregistrementHoraires(false);
    }
  }

  /**
   * Ouvre le panneau « Modifier la fiche », pré-rempli avec ce qui est publié.
   * Le badge « Ouvert / Fermé » ne dépend PAS du champ texte `horaires` mais de
   * la grille (`horairesStructures`) : les deux saisies coexistent donc, et le
   * panneau le dit au gérant pour éviter de croire qu'il règle l'ouverture ici.
   */
  function ouvrirEditionInfos() {
    setInfosEdition({
      nom: etablissement?.nom || '',
      description: etablissement?.description || '',
      telephone: etablissement?.telephone || '',
      whatsapp: etablissement?.whatsapp || '',
      horaires: etablissement?.horaires || '',
    });
    setErreurInfos('');
    // La localisation repart de la fiche publiée : un brouillon abandonné la fois
    // précédente ne doit pas ressurgir.
    setLocalisationEdition(null);
    setPositionGps(null);
    setCartePositionOuverte(false);
    setCalibrageEnCours(false);
    setErreurLocalisation('');
    calibrageId.current += 1;
    setEditionInfos(true);
  }

  /**
   * Ferme le panneau « Modifier la fiche » (et le brouillon de localisation avec).
   * Invalide un calibrage en vol : la promesse de `calibrerPositionGps` se résoudra
   * quand même au bout des 10 s, mais son résultat sera ignoré (jeton différent).
   */
  function fermerEditionInfos() {
    calibrageId.current += 1;
    setCalibrageEnCours(false);
    setCartePositionOuverte(false);
    setPositionGps(null);
    setLocalisationEdition(null);
    setErreurLocalisation('');
    setEditionInfos(false);
  }

  /**
   * Calibrage GPS (10 s) de la position du commerce.
   *
   * Différence avec le hook `useGeolocation` de la fiche : ici, la question n'est pas
   * « où suis-je » mais « où est mon commerce ». Le gérant est sur place, il ouvre ce
   * panneau, lance le calibrage, et la carte s'ouvre sur la mesure la plus précise
   * obtenue pour qu'il confirme du regard avant d'enregistrer.
   */
  async function lancerCalibrageGps() {
    const jeton = calibrageId.current + 1;
    calibrageId.current = jeton;
    setErreurLocalisation('');
    setCalibrageEnCours(true);
    try {
      const mesure = await calibrerPositionGps(10000);
      if (calibrageId.current !== jeton) return; // panneau fermé pendant les 10 s
      setPositionGps(mesure);
      setCartePositionOuverte(true);
    } catch (err) {
      if (calibrageId.current !== jeton) return;
      setErreurLocalisation(
        err?.message || 'Calibrage GPS impossible. Choisissez la position sur la carte.'
      );
    } finally {
      if (calibrageId.current === jeton) setCalibrageEnCours(false);
    }
  }

  /**
   * Option manuelle, gardée en secours : GPS refusé, coupé, ou mesure impossible.
   * La carte part de la position déjà connue (brouillon, sinon fiche publiée).
   */
  function ouvrirCartePosition() {
    setErreurLocalisation('');
    setPositionGps(null);
    setCartePositionOuverte(true);
  }

  /**
   * Enregistre les informations de la fiche (nom, description, contacts, horaires).
   * La LOCALISATION part dans le même PATCH quand elle a été recalibrée (GPS 10 s)
   * ou désignée sur la carte : un seul enregistrement pour tout ce que le gérant a
   * corrigé, et rien n'est écrit tant qu'il n'a pas touché « Enregistrer ».
   *
   * Le serveur n'accepte que ces champs via `champsSimple` (plus `localisation`,
   * validée sur ses bornes) et applique un `trim()` sur chacun : on envoie la
   * version déjà nettoyée, pour que l'écran affiche exactement ce qui est stocké.
   * Le nom est le seul champ obligatoire (c'est lui qui s'affiche partout : fil,
   * favoris, partage WhatsApp).
   */
  async function enregistrerInfos(evt) {
    evt.preventDefault();
    if (!etablissement || !estProprietaire) return;

    const nom = infosEdition.nom.trim();
    if (nom.length < 2) {
      setErreurInfos('Le nom de l’établissement est obligatoire (2 caractères minimum).');
      return;
    }

    setErreurInfos('');
    setEnregistrementInfos(true);
    const modifications = {
      nom,
      description: infosEdition.description.trim(),
      telephone: infosEdition.telephone.trim(),
      whatsapp: infosEdition.whatsapp.trim(),
      horaires: infosEdition.horaires.trim(),
    };

    // La localisation ne part QUE si elle a été recalibrée ou choisie sur la carte,
    // et seulement si elle diffère réellement du point publié : un PATCH qui ne
    // touche qu'au téléphone ne doit pas réécrire le miroir GeoJSON (`position`) ni
    // relancer l'index spatial pour rien.
    const ancienneLocalisation = etablissement.localisation || null;
    const localisationChangee =
      Boolean(localisationEdition) &&
      Number.isFinite(Number(localisationEdition.lat)) &&
      Number.isFinite(Number(localisationEdition.lng)) &&
      (!ancienneLocalisation ||
        Math.abs(Number(localisationEdition.lat) - Number(ancienneLocalisation.lat)) > 1e-7 ||
        Math.abs(Number(localisationEdition.lng) - Number(ancienneLocalisation.lng)) > 1e-7);
    if (localisationChangee) {
      modifications.localisation = {
        lat: Number(localisationEdition.lat),
        lng: Number(localisationEdition.lng),
      };
    }

    try {
      const reponse = await api.patch(`/establishments/${etablissement.id}`, modifications);
      if (reponse?.etablissement) {
        setEtablissement((prec) => ({ ...(prec || {}), ...reponse.etablissement }));
      } else {
        setEtablissement((prec) => (prec ? { ...prec, ...modifications } : prec));
      }
      fermerEditionInfos();
      setMessage('Informations de la fiche mises à jour.');
    } catch (err) {
      setErreurInfos(err?.message || 'Enregistrement impossible pour le moment.');
    } finally {
      setEnregistrementInfos(false);
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
    /* Écran PLEIN (pas de bottom nav) mais avec une barre « Aller chez … » FIXE au
       bas de la fenêtre : `data-fond` prolonge le fond blanc de la fiche sous la
       réserve de pied de page, et BarreActionFixe pose la barre au bas réel de la
       fenêtre en publiant sa hauteur mesurée — le contenu reste donc entièrement
       défilable au-dessus d'elle (correctifs « contenu coupé » du 30/09 et « barre
       flottante » du 08/10). */
    <div className="min-h-full bg-white">
      {/* ── Grande photo de devanture + médaillon du vendeur/gérant ── */}
      <header className="relative pb-10">
        {/* PHOTO + surcouches dans leur propre boîte `relative` : les boutons et les
            pastilles restent collés aux bords de l'IMAGE (pas de la bande blanche
            réservée en dessous, `pb-10`), sinon ils descendraient sur le médaillon. */}
        <div className="relative">
          {/* PHOTO : on préfère l'URL servie par l'API (`photoDevantureUrl`), valable
              quelle que soit la façon dont l'image est stockée (base64 ou URL
              distante). `photoDevanture` reste utilisé en repli. */}
          {urlDevanture && !devantureCassee ? (
            <img
              src={urlDevanture}
              alt={`Devanture de ${etablissement.nom}`}
              className="h-56 w-full bg-soft object-cover"
              onError={() => setDevantureCassee(true)}
            />
          ) : (
            /* v2 : même correctif que la carte du feed — plus de pavé orange plein
               sur l'en-tête d'une fiche sans photo, le fond reste ivoire.
               16/11 : le dessin de la catégorie (affiné par les tags : « Pharmacie »,
               « Coiffeurs(ses) », « Transfert d'argent »…) vient en filigrane, comme
               sur la carte du feed — l'en-tête d'une fiche et sa carte disent
               désormais la même chose. */
            <PhotoSecours
              nom={etablissement.nom}
              categorie={etablissement.categorie}
              tags={etablissement.tags}
              sousCategorie={etablissement.sousCategorie}
              className="h-56 w-full"
            />
          )}

          {/* Barre d'actions flottante — TROIS boutons publics seulement : retour,
              partage, favori. « Déjà visité » est descendu dans la barre du bas (coche),
              et l'administration est derrière l'unique bouton « Modifier ma fiche ». */}
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

          {/* Pastilles du bas de la couverture, empilées À DROITE : le bas-gauche est
              occupé par le médaillon du gérant (juste en dessous), qui doit rester
              entièrement visible. Sans ce déplacement, le médaillon le recouvrirait.
              Elles restent dans la boîte de l'IMAGE : sur un écran étroit, c'est la
              bande blanche réservée sous la photo (`pb-10`) qui reçoit le médaillon. */}
          <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
            {distance != null && (
              <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white">
                <Icon name="mapPin" size={12} />
                {formatDistanceKm(distance)}
              </span>
            )}
            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
              {libelleCategorie}
            </span>
          </div>
        </div>
      </header>

      <div className="ecran">
        {/* Médaillon de la photo du vendeur, chevauchant la devanture.
            16/11 (correctif) : `relative z-10` est INDISPENSABLE. `<header>` est en
            `position: relative`, donc il est peint APRÈS les blocs du flux restés
            non positionnés : sans z-index, la couverture recouvrait le haut du
            médaillon — exactement les 40 px remontés — et le visage du gérant était
            coupé. `.ecran` ne rogne rien (ni overflow, ni hauteur fixe) : aucun
            `overflow-hidden` à corriger.

            16/11 (espace réservé) : la couverture garde 40 px de blanc sous la photo
            (`pb-10`) et la rangée remonte de 80 px (`-mt-20`). Résultat : le médaillon
            chevauche l'image de 40 px, termine sa course dans la bande blanche, et son
            bas coïncide avec la fin du `<header>` — plus aucun bouton ne le masque, et
            il ne mord pas non plus sur le titre. `items-center` centre le bouton
            « Modifier ma fiche » sur la hauteur du médaillon. */}
        <div className="relative z-10 -mt-20 flex items-center justify-between gap-3">
          {urlVendeur && !vendeurCassee ? (
            <img
              src={urlVendeur}
              alt={`Vendeur / gérant de ${etablissement.nom}`}
              className="h-20 w-20 rounded-full border-4 border-white bg-soft object-cover shadow-card"
              onError={() => setVendeurCassee(true)}
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-primary text-xl font-bold text-white shadow-card">
              {initiales(etablissement.nom).slice(0, 2) || 'RM'}
            </span>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* UN SEUL point d'entrée pour l'administration (16/11).
                Avant : quatre pastilles côte à côte (« Gérer », « Modifier les photos »,
                « Modifier la galerie », « Modifier la fiche »). Sur un téléphone elles
                passaient à la ligne, allongeaient la rangée et venaient brouiller le
                médaillon. Le menu propose exactement les mêmes actions, nommées en
                clair, et se referme dès qu'on en choisit une (une seule feuille
                ouverte à la fois). Réservé au gérant de CETTE fiche : le serveur
                refuserait de toute façon en 403. */}
            {estProprietaire && (
              <div
                className="relative"
                onKeyDown={(evt) => {
                  // Échap referme le menu, comme un tiroir : le focus reste sur le
                  // bouton déclencheur, qui est à l'intérieur de ce conteneur.
                  if (evt.key === 'Escape') setMenuAdminOuvert(false);
                }}
              >
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuAdminOuvert}
                  aria-label="Modifier ma fiche"
                  className={`relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-card transition active:scale-95 ${
                    fermetureActive
                      ? 'border-danger/40 bg-danger/10 text-danger'
                      : 'border-line bg-white text-primary'
                  }`}
                  onClick={() => setMenuAdminOuvert((ouvert) => !ouvert)}
                >
                  <Icon name="edit" size={13} />
                  Modifier ma fiche
                </button>

                {menuAdminOuvert && (
                  <>
                    {/* Voile invisible plein écran : un toucher à côté referme le menu.
                        Un `div` comme les autres surcouches de la fiche (voir le panneau
                        photos) : ce n'est pas un contrôle, il n'a rien à faire dans
                        l'ordre de tabulation — Échap ferme le menu au clavier. */}
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-20"
                      onClick={() => setMenuAdminOuvert(false)}
                    />
                    <div
                      role="menu"
                      aria-label="Actions du gérant"
                      className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-white p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className={classeLigneMenu}
                        onClick={() => actionAdmin(ouvrirEditionInfos)}
                      >
                        <Icon name="edit" size={15} />
                        <span className="flex-1 text-left">Modifier les informations</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={classeLigneMenu}
                        onClick={() => actionAdmin(ouvrirEditionGalerie)}
                      >
                        <Icon name="image" size={15} />
                        <span className="flex-1 text-left">Modifier la galerie</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={classeLigneMenu}
                        onClick={() => actionAdmin(ouvrirEditionPhotos)}
                      >
                        <Icon name="camera" size={15} />
                        <span className="flex-1 text-left">Modifier les photos de devanture</span>
                      </button>

                      <div className="my-1 h-px bg-line" aria-hidden="true" />

                      {/* Gestion : fermeture temporaire et horaires. La ligne vire au
                          rouge quand la fiche est fermée — le gérant voit son état
                          sans ouvrir le panneau. */}
                      <button
                        type="button"
                        role="menuitem"
                        className={`${classeLigneMenu} ${fermetureActive ? 'text-danger' : ''}`}
                        onClick={() => actionAdmin(ouvrirGestion)}
                      >
                        <Icon name={fermetureActive ? 'ban' : 'store'} size={15} />
                        <span className="flex-1 text-left">
                          {fermetureActive ? 'Fiche fermée — gérer' : 'Gérer'}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {etablissement.verifie && (
              <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-white">
                <Icon name="verified" size={12} />
                Profil vérifié
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold leading-tight text-ink">{etablissement.nom}</h1>
          {/* Pastille Ouvert / Fermé, calculée à l'instant présent (16/11).
              `connu: false` = la fiche n'a aucune grille d'horaires (les 6 700 fiches
              importées, ou une fiche créée avant cette version) : on n'affiche RIEN
              plutôt que d'annoncer « Fermé » sur un commerce dont on ne sait rien.
              Le vert est ici une COULEUR DE STATUT (ouvert), pas la palette de la
              section « Pharmacies & Cliniques » du §6. */}
          {statutHoraire.connu && (
            <span
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                statutHoraire.ouvert
                  ? 'bg-health-light text-health-dark'
                  : 'bg-danger/10 text-danger'
              }`}
            >
              <span aria-hidden="true">{statutHoraire.ouvert ? '🟢' : '🔴'}</span>
              {statutHoraire.texte}
            </span>
          )}
        </div>

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

        {etablissement.description && (
          <p className="mt-3 text-sm leading-snug text-ink">{etablissement.description}</p>
        )}

        {/* ── Galerie multi-photos (16/11) ────────────────────────────────────
            Grille de 2 colonnes, cases carrées : lisible d'un coup d'œil sur un
            téléphone, dans l'ORDRE D'AJOUT décidé par le gérant. Un toucher ouvre
            la photo en plein écran (sur un terrain, on montre l'écran au client). */}
        {photosGalerie.length > 0 && (
          <section className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">En images</h2>
              <span className="text-[11px] font-semibold text-ink-muted">
                {photosGalerie.length} photo{photosGalerie.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {photosGalerie.map((src, index) => (
                <button
                  key={`${src}-${index}`}
                  type="button"
                  className="relative aspect-square overflow-hidden rounded-md border border-line bg-soft"
                  aria-label={`Agrandir la photo ${index + 1} de ${etablissement.nom}`}
                  onClick={() => setPhotoOuverte(index)}
                >
                  <img
                    src={src}
                    alt={`Photo ${index + 1} de ${etablissement.nom}`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Gérant sans aucune photo de galerie : une invitation visible plutôt
            qu'une section vide (c'est là qu'il découvre la fonction). */}
        {estProprietaire && photosGalerie.length === 0 && (
          <section className="mt-4">
            <button
              type="button"
              className="flex w-full flex-col items-center gap-1 rounded-md border-2 border-dashed border-line px-3 py-4 text-center text-ink-muted"
              onClick={ouvrirEditionGalerie}
            >
              <Icon name="image" size={26} className="text-primary" />
              <span className="text-xs">
                Ajoutez jusqu’à 8 photos : produits, intérieur, atelier…
              </span>
            </button>
          </section>
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
                {avis.map((a, i) => {
                  // Un « nom » qui est en réalité un numéro (« 0707123456 »,
                  // « Sahore Zogbo 0707… ») est masqué : laisser le téléphone d'un
                  // auteur d'avis en clair contournerait la mise en relation payante
                  // (§2) et exposerait son numéro à toute la ville sans son accord.
                  const nomAuteur = formaterNomPublic(a.auteurNom) || 'Client';
                  return (
                    <li key={a.id || a._id || i} className="carte p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-bold text-primary">
                          {initiales(nomAuteur)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-ink">{nomAuteur}</p>
                          <p className="text-[10px] text-ink-muted">{formatDateRelative(a.at || a.createdAt)}</p>
                        </div>
                        <StarRating note={a.note} afficherNombre={false} taille={13} />
                      </div>
                      {a.commentaire && (
                        <p className="mt-2 text-xs leading-snug text-ink">{a.commentaire}</p>
                      )}
                    </li>
                  );
                })}
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

      {/* ── Bouton d'action fixe : le TEXTE est dynamique, « Aller chez <nom> » (§5).
          BarreActionFixe le colle au bas RÉEL de la fenêtre et publie sa hauteur :
          aucun avis, aucun bloc ne reste coincé derrière (barre système comprise).
          La coche « Déjà visité » vit ICI (16/11) : à côté de « Aller chez … », là où
          l'on décide qu'on est venu. Elle est discrète tant qu'elle est vide, verte
          pleine une fois cochée — même signal que l'ancienne pastille du haut, sans
          encombrer l'en-tête. ── */}
      <BarreActionFixe>
        <div className="ecran flex items-center gap-2 py-3">
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
            aria-pressed={estVisite}
            aria-label={
              estVisite
                ? 'Retirer de mes établissements déjà visités'
                : 'Marquer comme déjà visité (privé)'
            }
            title={
              estVisite
                ? 'Déjà visité — conservé dans votre profil, invisible pour les autres'
                : 'Marquer comme déjà visité (privé)'
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition active:scale-95 ${
              estVisite
                ? 'border-health bg-health text-white'
                : 'border-line bg-white text-ink-muted'
            }`}
            onClick={basculerVisiteDepuisLaBarre}
          >
            <Icon name="check" size={18} />
          </button>
          <button
            type="button"
            className={`${estSante ? 'btn-health' : 'bouton-principal'} shrink-0 text-sm`}
            onClick={allerChez}
          >
            <Icon name="route" size={19} />
            {texteBouton}
          </button>
        </div>
      </BarreActionFixe>

      {/* ── Panneau d'édition des photos (gérant uniquement) ──────────────────
          Feuille du bas, dans le style des autres surcouches de l'app : elle
          laisse voir la fiche derrière et se ferme d'un toucher à côté. */}
      {editionPhotos && estProprietaire && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Modifier les photos de la fiche"
          onClick={() => {
            if (!enregistrementPhotos) setEditionPhotos(false);
          }}
        >
          <form
            onSubmit={enregistrerPhotos}
            className="carte max-h-[90vh] w-full max-w-[480px] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">Photos de la fiche</p>
              <button
                type="button"
                className="text-xs font-semibold text-ink-muted underline"
                disabled={enregistrementPhotos}
                onClick={() => setEditionPhotos(false)}
              >
                Fermer
              </button>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-ink-muted">
              Ces photos apparaissent en haut de votre fiche et sur les cartes du fil. Laissez une photo telle
              quelle pour ne pas la modifier ; « Retirer » la supprime.
            </p>

            <div className="flex flex-col gap-4">
              <PhotoUploadField
                label="Photo de la devanture"
                indication="Le local vu de la rue, bien éclairé, sans personne devant."
                value={photoDevantureEdition}
                onChange={setPhotoDevantureEdition}
                requis={false}
              />
              <PhotoUploadField
                label="Photo du vendeur / gérant"
                indication="La personne qui tient le commerce. Photo différente de la devanture."
                value={photoVendeurEdition}
                onChange={setPhotoVendeurEdition}
                requis={false}
              />
            </div>

            {erreurPhotos && <p className="mt-2 text-xs font-semibold text-danger">{erreurPhotos}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-ghost flex-1"
                disabled={enregistrementPhotos}
                onClick={() => setEditionPhotos(false)}
              >
                Annuler
              </button>
              <button type="submit" className="bouton-principal flex-[2]" disabled={enregistrementPhotos}>
                {enregistrementPhotos ? 'Enregistrement…' : 'Enregistrer les photos'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Panneau « Modifier la galerie » (gérant uniquement) ────────────────
          Même feuille du bas que l'édition des deux photos. Les nouveaux envois
          partent directement chez Cloudinary ; « Enregistrer » envoie le tableau
          complet, ce qui applique aussi les suppressions. */}
      {editionGalerie && estProprietaire && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Modifier la galerie de la fiche"
          onClick={() => {
            if (!enregistrementGalerie) setEditionGalerie(false);
          }}
        >
          <form
            onSubmit={enregistrerGalerie}
            className="carte max-h-[90vh] w-full max-w-[480px] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">Galerie de la fiche</p>
              <button
                type="button"
                className="text-xs font-semibold text-ink-muted underline"
                disabled={enregistrementGalerie}
                onClick={() => setEditionGalerie(false)}
              >
                Fermer
              </button>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-ink-muted">
              8 photos maximum, en plus de la devanture et du vendeur. Elles s’affichent dans l’ordre où vous les
              ajoutez ; la croix supprime une photo.
            </p>

            <GaleriePhotos
              photos={galerieEdition}
              onChange={setGalerieEdition}
              max={8}
              desactive={enregistrementGalerie}
            />

            {erreurGalerie && <p className="mt-2 text-xs font-semibold text-danger">{erreurGalerie}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-ghost flex-1"
                disabled={enregistrementGalerie}
                onClick={() => setEditionGalerie(false)}
              >
                Annuler
              </button>
              <button type="submit" className="bouton-principal flex-[2]" disabled={enregistrementGalerie}>
                {enregistrementGalerie ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Panneau « Gérer mon établissement » (gérant uniquement, 16/11) ─────
          Une seule feuille du bas, deux gestes du quotidien :
            a) FERMER / ROUVRIR — « rupture de stock », panne, maladie. La raison
               est facultative et s'affiche telle quelle sur la fiche
               (« Fermé (Rupture de stock) »). La grille d'horaires n'est PAS
               touchée : demain, la boutique rouvre à son heure habituelle.
            b) HORAIRES — la grille de sept jours, corrigeable après publication.
           Rien n'est écrit avant validation : le panneau travaille sur des
           brouillons (`raisonFermeture`, `horairesEdition`), et un appui à côté
           annule tout (sauf pendant un enregistrement). */}
      {gestionOuverte && estProprietaire && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Gérer mon établissement"
          onClick={() => {
            if (!enregistrementFermeture && !enregistrementHoraires) setGestionOuverte(false);
          }}
        >
          <div
            className="carte max-h-[92vh] w-full max-w-[480px] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">Gérer mon établissement</p>
              <button
                type="button"
                className="text-xs font-semibold text-ink-muted underline"
                disabled={enregistrementFermeture || enregistrementHoraires}
                onClick={() => setGestionOuverte(false)}
              >
                Fermer
              </button>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-ink-muted">
              Ces deux réglages sont visibles immédiatement par tous les visiteurs de votre fiche.
            </p>

            {messageGestion && (
              <p className="mb-3 rounded-md bg-health-light px-3 py-2 text-xs font-semibold text-health-dark">
                {messageGestion}
              </p>
            )}

            {/* ── a) FERMETURE TEMPORAIRE ─────────────────────────────────── */}
            <section className="rounded-md border border-line p-3">
              <p className="text-sm font-bold text-ink">Fermeture temporaire</p>
              <p className="mb-2 mt-0.5 text-[11px] leading-snug text-ink-muted">
                Pour aujourd’hui seulement : coupure, rupture de stock, maladie. Vos horaires
                d’ouverture restent enregistrés — un seul clic suffit.
              </p>

              {fermetureActive ? (
                <div className="flex flex-wrap items-center gap-2">
                  {/* Même texte que la pastille publique : ce que le gérant lit ici
                      est exactement ce que lit son client. */}
                  <span className="flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">
                    <span aria-hidden="true">🔴</span>
                    {raisonFermetureActive
                      ? `Fermé (${raisonFermetureActive})`
                      : 'Fermé (fermeture temporaire)'}
                  </span>
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1 rounded-md bg-health px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    disabled={enregistrementFermeture}
                    onClick={rouvrirEtablissement}
                  >
                    <Icon name="unlock" size={14} />
                    {enregistrementFermeture ? 'Réouverture…' : 'Réouvrir'}
                  </button>
                </div>
              ) : formulaireFermeture ? (
                <form onSubmit={fermerTemporairement} className="flex flex-col gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-ink">
                      Raison (facultatif)
                    </span>
                    <input
                      value={raisonFermeture}
                      onChange={(e) => setRaisonFermeture(e.target.value)}
                      maxLength={160}
                      placeholder="Ex. Rupture de stock, panne, maladie"
                      className="w-full rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
                      autoFocus
                    />
                  </label>
                  <p className="text-[11px] leading-snug text-ink-muted">
                    Elle s’affichera sur votre fiche : « Fermé (Rupture de stock) ». Laissez vide
                    pour afficher « Fermé (fermeture temporaire) ».
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost flex-1"
                      disabled={enregistrementFermeture}
                      onClick={() => setFormulaireFermeture(false)}
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="flex flex-[2] items-center justify-center gap-1 rounded-md bg-danger px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                      disabled={enregistrementFermeture}
                    >
                      <Icon name="lock" size={14} />
                      {enregistrementFermeture ? 'Fermeture…' : 'Fermer ma fiche'}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1 rounded-md bg-danger px-3 py-2.5 text-xs font-bold text-white"
                  onClick={() => setFormulaireFermeture(true)}
                >
                  <Icon name="lock" size={14} />
                  Fermer temporairement
                </button>
              )}

              {erreurFermeture && (
                <p className="mt-2 text-xs font-semibold text-danger">{erreurFermeture}</p>
              )}
            </section>

            {/* ── b) HORAIRES D'OUVERTURE ─────────────────────────────────── */}
            <form onSubmit={enregistrerHorairesGestion} className="mt-3">
              <p className="text-sm font-bold text-ink">Horaires d’ouverture</p>
              <p className="mb-2 mt-0.5 text-[11px] leading-snug text-ink-muted">
                Toute correction est immédiate : la pastille « Ouvert / Fermé » de votre fiche suit
                cette grille, heure par heure.
              </p>
              <EditeurHoraires
                valeur={horairesEdition || horairesParDefaut()}
                onChange={setHorairesEdition}
                desactive={enregistrementHoraires}
              />
              {erreurHoraires && (
                <p className="mt-2 text-xs font-semibold text-danger">{erreurHoraires}</p>
              )}
              <button
                type="submit"
                className="bouton-principal mt-3 w-full"
                disabled={enregistrementHoraires}
              >
                {enregistrementHoraires ? 'Enregistrement…' : 'Enregistrer mes horaires'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Panneau « Modifier la fiche » (gérant uniquement, 16/11) ───────────
          Même feuille du bas que la galerie. Ici, uniquement les TEXTES et les
          CONTACTS : les photos ont leur panneau (elles passent par Cloudinary), et
          la grille d'ouverture jour par jour a le sien (« Gérer » → Horaires). */}
      {editionInfos && estProprietaire && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Modifier les informations de la fiche"
          onClick={() => {
            if (!enregistrementInfos) fermerEditionInfos();
          }}
        >
          <form
            onSubmit={enregistrerInfos}
            className="carte max-h-[92vh] w-full max-w-[480px] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">Modifier la fiche</p>
              <button
                type="button"
                className="text-xs font-semibold text-ink-muted underline"
                disabled={enregistrementInfos}
                onClick={fermerEditionInfos}
              >
                Fermer
              </button>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-ink-muted">
              Ces informations sont publiques : elles s’affichent sur votre fiche, dans le fil et
              dans le lien partagé sur WhatsApp.
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-bold text-ink">Nom de l’établissement</span>
              <input
                value={infosEdition.nom}
                onChange={(e) => setInfosEdition((prec) => ({ ...prec, nom: e.target.value }))}
                maxLength={80}
                required
                className="w-full rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-bold text-ink">Description</span>
              <textarea
                value={infosEdition.description}
                onChange={(e) =>
                  setInfosEdition((prec) => ({ ...prec, description: e.target.value }))
                }
                rows={4}
                maxLength={800}
                placeholder="Ce que vous vendez, ce qui vous distingue, comment vous trouver…"
                className="w-full resize-none rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              <span className="mt-1 block text-[10px] text-ink-muted">
                {infosEdition.description.length}/800 caractères
              </span>
            </label>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-ink">Téléphone</span>
                <input
                  value={infosEdition.telephone}
                  onChange={(e) =>
                    setInfosEdition((prec) => ({ ...prec, telephone: e.target.value }))
                  }
                  type="tel"
                  inputMode="tel"
                  maxLength={24}
                  placeholder="07 00 00 00 00"
                  className="w-full rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-ink">WhatsApp</span>
                <input
                  value={infosEdition.whatsapp}
                  onChange={(e) =>
                    setInfosEdition((prec) => ({ ...prec, whatsapp: e.target.value }))
                  }
                  type="tel"
                  inputMode="tel"
                  maxLength={24}
                  placeholder="Vide = le téléphone"
                  className="w-full rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>

            <label className="mb-1 block">
              <span className="mb-1 block text-xs font-bold text-ink">Horaires affichés</span>
              <input
                value={infosEdition.horaires}
                onChange={(e) => setInfosEdition((prec) => ({ ...prec, horaires: e.target.value }))}
                maxLength={120}
                placeholder="Ex. Lun–Sam 08:00–18:00"
                className="w-full rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>
            <p className="mb-3 text-[11px] leading-snug text-ink-muted">
              Ce texte est la ligne d’horaires de la fiche. La pastille « Ouvert / Fermé », elle, se
              règle jour par jour dans « Gérer » → Horaires d’ouverture.
            </p>

            {/* ── Localisation de l'établissement (16/11) ──────────────────────
                Une fiche au point approximatif envoie les clients ailleurs. Le
                gérant re-mesure donc sur place : 10 s d'écoute GPS (on garde la
                meilleure mesure), puis la carte s'ouvre pour confirmation
                visuelle — centrée sur cette mesure fraîche. Un écart de plus d'un
                kilomètre y déclenche le bandeau « êtes-vous sûr d'être sur
                place ? ». Rien n'est écrit en base avant « Enregistrer ». */}
            <div className="mb-3 rounded-md border border-line p-3">
              <p className="mb-1 text-xs font-bold text-ink">Localisation de l’établissement</p>
              <p className="mb-2 text-[11px] leading-snug text-ink-muted">
                Position enregistrée :{' '}
                <span className="font-semibold text-ink">
                  {etablissement?.localisation?.lat != null &&
                  etablissement?.localisation?.lng != null
                    ? `${Number(etablissement.localisation.lat).toFixed(5)}, ${Number(
                        etablissement.localisation.lng
                      ).toFixed(5)}`
                    : 'non renseignée'}
                </span>
              </p>

              {localisationEdition && (
                <p className="mb-2 rounded-md bg-primary-pale px-2 py-1.5 text-[11px] font-semibold leading-snug text-ink">
                  Nouvelle position prête : {Number(localisationEdition.lat).toFixed(5)},{' '}
                  {Number(localisationEdition.lng).toFixed(5)}
                  {localisationEdition.accuracy
                    ? ` (précision ±${Math.round(localisationEdition.accuracy)} m)`
                    : ''}
                  . Elle sera enregistrée avec le bouton « Enregistrer ».
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={lancerCalibrageGps}
                  disabled={calibrageEnCours || enregistrementInfos}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  {calibrageEnCours ? (
                    <IconLoader size={16} />
                  ) : (
                    <Icon name="refresh" size={16} />
                  )}
                  {calibrageEnCours
                    ? 'Calibrage GPS en cours (10s)…'
                    : 'Actualiser ma position GPS'}
                </button>
                <button
                  type="button"
                  onClick={ouvrirCartePosition}
                  disabled={calibrageEnCours || enregistrementInfos}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-bold text-ink disabled:opacity-60"
                >
                  <Icon name="mapPin" size={16} />
                  Choisir sur la carte
                </button>
              </div>

              {calibrageEnCours && (
                <p className="mt-2 text-[11px] leading-snug text-ink-muted" aria-live="polite">
                  Restez sur place, téléphone à l’air libre : le GPS affine la mesure pendant ces
                  10 secondes. La carte s’ouvrira ensuite pour confirmation.
                </p>
              )}

              {erreurLocalisation && (
                <p className="mt-2 text-[11px] font-semibold leading-snug text-danger" role="alert">
                  {erreurLocalisation}
                </p>
              )}
            </div>

            {erreurInfos && <p className="mb-2 text-xs font-semibold text-danger">{erreurInfos}</p>}

            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className="btn-ghost flex-1"
                disabled={enregistrementInfos}
                onClick={fermerEditionInfos}
              >
                Annuler
              </button>
              <button type="submit" className="bouton-principal flex-[2]" disabled={enregistrementInfos}>
                {enregistrementInfos ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Carte de confirmation de la localisation (16/11) ──────────────────
          Ouverte soit par le calibrage GPS (centrée sur la mesure fraîche), soit
          par « Choisir sur la carte ». Rendue APRÈS le panneau dans le DOM : à
          z-index égal, elle se pose au-dessus. `reference` est la position
          actuelle (brouillon s'il existe, sinon fiche publiée) : c'est elle qui
          alimente le garde-fou « à plus d'un kilomètre ». Valider écrit le
          brouillon, pas la base — l'enregistrement reste le bouton du panneau. */}
      {cartePositionOuverte && (
        <Suspense fallback={null}>
          <ChoisirPosition
            ouvert={cartePositionOuverte}
            titre="Position de l’établissement"
            aide="Faites glisser le repère orange sur l’emplacement exact du commerce (ou touchez la carte : le repère s’y place). Puis validez — c’est ce point que verront les clients."
            onFermer={() => {
              setCartePositionOuverte(false);
              setPositionGps(null);
            }}
            centre={positionGps || localisationEdition || etablissement?.localisation || null}
            reference={localisationEdition || etablissement?.localisation || null}
            onValider={(lat, lng) => {
              // La précision annoncée n'a de sens QU'AU point mesuré : si le gérant
              // déplace le repère de plus de 30 m, la valeur GPS ne décrit plus ce
              // point et on ne l'affiche pas (mieux vaut aucune précision qu'une
              // précision fausse).
              const ecartGpsKm = positionGps
                ? getDistanceKm(lat, lng, positionGps.lat, positionGps.lng)
                : null;
              const precisionGps =
                ecartGpsKm != null && ecartGpsKm <= 0.03 ? positionGps?.accuracy ?? null : null;
              setLocalisationEdition({ lat, lng, accuracy: precisionGps });
              setCartePositionOuverte(false);
              setPositionGps(null);
              setErreurLocalisation('');
            }}
          />
        </Suspense>
      )}

      {/* ── Photo en plein écran (lecture seule) ───────────────────────────────
          Sur le terrain, on montre l'écran au client : la photo occupe tout, et
          les flèches font défiler la galerie sans fermer. */}
      {photoOuverte != null && photosGalerie[photoOuverte] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Photo en plein écran"
          onClick={() => setPhotoOuverte(null)}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">
              {photoOuverte + 1} / {photosGalerie.length}
            </span>
            <button
              type="button"
              aria-label="Fermer la photo"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white"
              onClick={(e) => {
                e.stopPropagation();
                setPhotoOuverte(null);
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center py-2" onClick={(e) => e.stopPropagation()}>
            <img
              src={photosGalerie[photoOuverte]}
              alt={`Photo ${photoOuverte + 1} de ${etablissement?.nom || 'l’établissement'}`}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          </div>

          <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Photo précédente"
              disabled={photoOuverte === 0}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white disabled:opacity-30"
              onClick={() => setPhotoOuverte((i) => Math.max(0, Number(i) - 1))}
            >
              <Icon name="chevronLeft" size={20} />
            </button>
            <button
              type="button"
              aria-label="Photo suivante"
              disabled={photoOuverte >= photosGalerie.length - 1}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white disabled:opacity-30"
              onClick={() => setPhotoOuverte((i) => Math.min(photosGalerie.length - 1, Number(i) + 1))}
            >
              <Icon name="chevronRight" size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

