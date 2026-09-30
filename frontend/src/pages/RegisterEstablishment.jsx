// RegisterEstablishment.jsx — Inscription établissement (voir maquette "5. Inscription établissement")
//
// Parcours en 3 étapes avec barre de progression :
//  Étape 1 : upload des 2 photos OBLIGATOIRES et DISTINCTES (§5)
//            - "Photo de la devanture" (le local)
//            - "Photo du vendeur / gérant"
//  Étape 2 : catégorie + sélection de tags produits/services façon TikTok
//            - bulles cliquables, sélection multiple, MINIMUM 3 tags (§5)
//            - la liste s'adapte à la catégorie (TAGS_PAR_CATEGORIE)
//  Étape 3 : nom, description, localisation (géoloc ou saisie), texte du bouton
//            d'action personnalisé, téléphone/WhatsApp
//
// Décisions :
//  - On ne laisse PAS passer à l'étape suivante si les 2 photos ne sont pas
//    distinctes : l'API le refuserait de toute façon (validateEstablishmentPhotos),
//    autant le dire tout de suite plutôt qu'après l'envoi.
//  - Le texte du bouton d'action est pré-rempli avec « Aller chez <nom> » mais
//    reste modifiable (§5).
//  - La position GPS est reprise du hook useGeolocation ; l'utilisateur peut la
//    remplacer par une saisie manuelle de quartier/commune (tout le monde n'a pas
//    le GPS actif).
//  - Envoi : POST /api/establishments (authentifié). Sans compte, on redirige vers
//    /connexion en mémorisant la destination.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import PhotoUploadField from '../components/PhotoUploadField.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { Icon } from '../components/Icons.jsx';
import TagBadge from '../components/TagBadge.jsx';
import { api } from '../utils/api/client.js';
import { CATEGORIES, TAGS_PAR_CATEGORIE } from '../data/demoData.js';
import { useAuth } from '../hooks/useAuth.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

const ETAPES = ['Photos', 'Produits', 'Infos'];
const CATEGORIES_INSCRIPTION = CATEGORIES.filter((c) => c.slug !== 'tous' && c.slug !== 'sante');

export default function RegisterEstablishment() {
  const navigate = useNavigate();
  const { connecte, estDemo } = useAuth();
  const position = useGeolocation();

  const [etape, setEtape] = useState(0);
  const [photoDevanture, setPhotoDevanture] = useState('');
  const [photoVendeur, setPhotoVendeur] = useState('');
  const [nom, setNom] = useState('');
  const [categorie, setCategorie] = useState('alimentation');
  const [tags, setTags] = useState([]);
  const [description, setDescription] = useState('');
  const [quartier, setQuartier] = useState('');
  const [commune, setCommune] = useState('');
  const [coords, setCoords] = useState(null);
  const [telephone, setTelephone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [horaires, setHoraires] = useState('');
  const [texteBoutonAction, setTexteBoutonAction] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  // Reprend automatiquement la position détectée si l'utilisateur n'en a pas saisi.
  useEffect(() => {
    if (position.position && !coords) {
      setCoords({ lat: position.position.lat, lng: position.position.lng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.position]);

  // Le libellé du bouton suit le nom saisi tant que l'utilisateur ne l'a pas personnalisé.
  useEffect(() => {
    if (!texteBoutonAction.startsWith('Aller chez ') || !nom) return;
    setTexteBoutonAction(`Aller chez ${nom}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nom]);

  const tagsDisponibles = useMemo(() => TAGS_PAR_CATEGORIE[categorie] || [], [categorie]);

  function basculerTag(tag) {
    setTags((prec) => (prec.includes(tag) ? prec.filter((t) => t !== tag) : [...prec, tag]));
  }

  /** Validation d'une étape avant de passer à la suivante (§5). */
  function validerEtape(index) {
    if (index === 0) {
      if (!photoDevanture) return 'Ajoutez la photo de la devanture du local.';
      if (!photoVendeur) return 'Ajoutez la photo du vendeur / gérant.';
      if (photoDevanture === photoVendeur) return 'Les deux photos doivent être différentes.';
    }
    if (index === 1) {
      if (!categorie) return 'Choisissez la catégorie de votre établissement.';
      if (tags.length < 3) return 'Sélectionnez au moins 3 produits ou services.';
    }
    if (index === 2) {
      if (!nom.trim()) return 'Indiquez le nom de votre établissement.';
      if (!coords) return 'Localisation obligatoire : activez la position ou renseignez votre quartier.';
      if (!telephone.trim() && !whatsapp.trim()) return 'Indiquez un numéro de téléphone ou WhatsApp.';
    }
    return '';
  }

  function suivant() {
    const probleme = validerEtape(etape);
    if (probleme) {
      setErreur(probleme);
      return;
    }
    setErreur('');
    if (etape < ETAPES.length - 1) {
      setEtape(etape + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    envoyer();
  }

  async function envoyer() {
    if (!connecte) {
      navigate('/connexion', { state: { depuis: '/inscription' } });
      return;
    }
    setEnCours(true);
    setErreur('');
    try {
      const reponse = await api.post('/establishments', {
        nom: nom.trim(),
        categorie,
        description: description.trim(),
        photoDevanture,
        photoVendeur,
        tags,
        localisation: coords,
        quartier,
        commune,
        telephone: telephone.trim() || whatsapp.trim(),
        whatsapp: whatsapp.trim() || telephone.trim(),
        horaires,
        texteBoutonAction: texteBoutonAction.trim() || `Aller chez ${nom.trim()}`,
      });
      const id = reponse?.etablissement?.id;
      navigate(id ? `/etablissement/${id}` : '/', { replace: true });
    } catch (err) {
      setErreur(err?.message || 'Inscription impossible pour le moment. Réessayez dans quelques instants.');
    } finally {
      setEnCours(false);
    }
  }

  // ── Étape 1 : photos ──
  const etapePhotos = (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-snug text-ink-muted">
        Les deux photos sont obligatoires : elles rassurent vos clients et permettent de vous retrouver facilement dans
        le quartier.
      </p>
      <PhotoUploadField
        label="Photo de la devanture"
        indication="Le local vu de la rue, bien éclairé, sans personne devant."
        value={photoDevanture}
        onChange={setPhotoDevanture}
      />
      <PhotoUploadField
        label="Photo du vendeur / gérant"
        indication="La personne qui tient le commerce. Photo différente de la devanture."
        value={photoVendeur}
        onChange={setPhotoVendeur}
        erreur={photoDevanture && photoVendeur && photoDevanture === photoVendeur ? 'Les deux photos doivent être différentes.' : ''}
      />
    </div>
  );

  // ── Étape 2 : catégorie + tags produits/services (§5, « façon TikTok ») ──
  const etapeTags = (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-bold text-ink">Catégorie de l’établissement</p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES_INSCRIPTION.map((c) => {
            const actif = c.slug === categorie;
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => {
                  setCategorie(c.slug);
                  setTags([]);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold transition ${
                  actif ? 'border-primary bg-primary text-white' : 'border-line bg-white text-ink-muted'
                }`}
              >
                <Icon name={c.icone} size={14} />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <p className="text-sm font-bold text-ink">Vos produits / services</p>
          <span className={`text-xs font-bold ${tags.length >= 3 ? 'text-health-dark' : 'text-danger'}`}>
            {tags.length}/3 minimum
          </span>
        </div>
        <p className="mb-2 text-[11px] text-ink-muted">
          Touchez ce que vous vendez. Ce sont ces pastilles que les clients verront et rechercheront.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tagsDisponibles.map((tag) => (
            <TagBadge key={tag} label={tag} selected={tags.includes(tag)} onClick={() => basculerTag(tag)} />
          ))}
        </div>

        {tags.length > 0 && (
          <p className="mt-3 text-[11px] text-ink-muted">
            Sélection : <span className="font-semibold text-ink">{tags.join(' · ')}</span>
          </p>
        )}
      </div>
    </div>
  );

  // ── Étape 3 : informations pratiques ──
  const etapeInfos = (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1 block text-sm font-bold text-ink">
          Nom de l’établissement <span className="text-danger">*</span>
        </span>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Ex. Chez Fatou"
          className="w-full rounded-md border border-line px-3 py-3 text-sm font-semibold outline-none focus:border-primary"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-bold text-ink">Description courte</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Ce que vous proposez, en une phrase."
          className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
        />
      </label>

      {/* Localisation : GPS ou saisie manuelle */}
      <div className="rounded-md border border-line p-3">
        <p className="mb-1 text-sm font-bold text-ink">Localisation</p>
        {coords ? (
          <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-health-dark">
            <Icon name="mapPin" size={13} />
            Position enregistrée ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
            {position.approximatif ? ' — approximative (Plateau)' : ''}
          </p>
        ) : (
          <p className="mb-2 text-[11px] text-danger">Position non détectée : autorisez la géolocalisation.</p>
        )}
        <button type="button" className="btn-ghost w-full py-2 text-xs" onClick={position.relancer}>
          <Icon name="mapPin" size={15} />
          {coords ? 'Actualiser ma position' : 'Détecter ma position'}
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            value={quartier}
            onChange={(e) => setQuartier(e.target.value)}
            placeholder="Quartier"
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={commune}
            onChange={(e) => setCommune(e.target.value)}
            placeholder="Commune"
            className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-ink">Téléphone</span>
          <input
            type="tel"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
            placeholder="07 07 12 34 56"
            className="w-full rounded-md border border-line px-3 py-3 text-sm font-semibold outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-ink">WhatsApp</span>
          <input
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="Si différent"
            className="w-full rounded-md border border-line px-3 py-3 text-sm font-semibold outline-none focus:border-primary"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-bold text-ink">Horaires</span>
        <input
          value={horaires}
          onChange={(e) => setHoraires(e.target.value)}
          placeholder="Ex. Lun - Sam 7h - 21h"
          className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-bold text-ink">Texte du bouton d’action</span>
        <input
          value={texteBoutonAction}
          onChange={(e) => setTexteBoutonAction(e.target.value)}
          placeholder={`Aller chez ${nom || 'mon établissement'}`}
          className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
        />
        <span className="mt-1 block text-[11px] text-ink-muted">
          C’est le bouton que les clients toucheront sur votre fiche (§5).
        </span>
      </label>
    </div>
  );

  return (
    <div className="ecran py-3">
      <h1 className="text-xl font-bold text-ink">Inscrire mon établissement</h1>
      <p className="mb-3 text-sm text-ink-muted">
        Gratuit. Comptez 3 minutes : deux photos, vos produits, votre numéro.
      </p>

      {/* Barre de progression */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          <span>
            Étape {etape + 1}/3 · {ETAPES[etape]}
          </span>
          <span>{Math.round(((etape + 1) / 3) * 100)} %</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-soft">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${((etape + 1) / 3) * 100}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between">
          {ETAPES.map((libelle, i) => (
            <button
              key={libelle}
              type="button"
              disabled={i > etape}
              onClick={() => i <= etape && setEtape(i)}
              className={`text-[11px] font-bold ${
                i <= etape ? 'text-primary' : 'text-ink-muted/60'
              } ${i < etape ? 'underline' : ''}`}
            >
              {libelle}
            </button>
          ))}
        </div>
      </div>

      {estDemo && (
        <InfoBanner variante="demo" titre="Mode démonstration" className="mb-3">
          Le serveur est injoignable : l’inscription ne pourra pas être enregistrée maintenant.
        </InfoBanner>
      )}

      {erreur && (
        <InfoBanner variante="erreur" titre="Vérifiez ce point" className="mb-3">
          {erreur}
        </InfoBanner>
      )}

      <section className="carte p-4">
        {etape === 0 && etapePhotos}
        {etape === 1 && etapeTags}
        {etape === 2 && etapeInfos}
      </section>

      {/* Le formulaire n'est pas connecté à un compte : on l'indique avant l'étape 3. */}
      {!connecte && etape === 2 && (
        <InfoBanner variante="info" titre="Un compte est nécessaire" className="mt-3">
          Créez votre compte (numéro + mot de passe) pour publier la fiche : cela vous permettra de la modifier plus
          tard.
        </InfoBanner>
      )}

      {/* Barre d'action sticky */}
      <div
        className="fixed bottom-[68px] left-0 right-0 z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-[480px] gap-2">
          {etape > 0 && (
            <button type="button" className="btn-ghost flex-1" onClick={() => setEtape(etape - 1)}>
              <Icon name="chevronLeft" size={18} />
              Retour
            </button>
          )}
          <button type="button" className="btn-primary flex-[2]" onClick={suivant} disabled={enCours}>
            {enCours ? 'Envoi…' : etape === 2 ? 'Publier ma fiche' : 'Suivant'}
            {!enCours && etape < 2 && <Icon name="chevronRight" size={18} />}
          </button>
        </div>
      </div>

      {etape === 0 && !photoDevanture && !photoVendeur && (
        <div className="mt-4">
          <EmptyState
            icone="camera"
            titre="Deux photos, pas plus"
            description="Une devanture + une personne : c’est ce qui distingue une vraie adresse d’un profil anonyme."
          />
        </div>
      )}
    </div>
  );
}

