// RegisterEstablishment.jsx — Créer un profil (voir maquette "5. Inscription établissement")
//
// PARCOURS (revu le 29/09) : l'écran s'ouvre sur UNE question, pas sur la photo.
//  1. « Avez-vous un établissement ? » — Oui / Non.
//     • OUI  → 3 étapes, avec barre de progression :
//          Étape 1 : photos de la devanture + du vendeur/gérant (RECOMMANDÉES,
//                    plus obligatoires : bouton « Ajouter plus tard » ; la fiche
//                    peut être publiée sans photo et complétée ensuite, §5)
//          Étape 2 : catégorie + tags produits/services façon TikTok
//                    - bulles cliquables, sélection multiple, MINIMUM 3 tags (§5)
//                    - la liste s'adapte à la catégorie (TAGS_PAR_CATEGORIE)
//          Étape 3 : nom, description, localisation (géoloc ou saisie), texte du
//                    bouton d'action personnalisé, téléphone/WhatsApp
//     • NON  → profil simple (chercheur d'emploi / employeur) : une seule étape,
//              sans jamais montrer les photos d'établissement. C'est le compte
//              unifié du §10 : les capacités (chercheTravail / estArtisan) sont
//              enregistrées tout de suite et restent modifiables depuis /profil.
//
// Décisions :
//  - La question d'entrée évite d'imposer un parcours « commerce » à quelqu'un
//    qui vient chercher du travail : c'était la première cause d'abandon.
//  - On ne bloquait qu'un seul cas : deux photos identiques. L'API refuse la
//    même chose (validateEstablishmentPhotos), mieux vaut le dire avant l'envoi.
//  - Le texte du bouton d'action est pré-rempli avec « Aller chez <nom> » mais
//    reste modifiable (§5).
//  - La position GPS est reprise du hook useGeolocation ; l'utilisateur peut la
//    remplacer par une saisie manuelle de quartier/commune (tout le monde n'a pas
//    le GPS actif).
//  - Envoi établissement : POST /api/establishments (authentifié). Sans compte, on
//    redirige vers /connexion en mémorisant la destination.
//  - Profil simple sans compte : on crée le compte ici même (POST /users/register,
//    qui accepte déjà chercheTravail / estArtisan) puis on ouvre /profil. Un champ
//    de moins à une étape de plus : le compte se crée là où on en a besoin.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import PhotoUploadField from '../components/PhotoUploadField.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import { Icon } from '../components/Icons.jsx';
import TagBadge from '../components/TagBadge.jsx';
import { api } from '../utils/api/client.js';
import { CATEGORIES, METIERS, TAGS_PAR_CATEGORIE } from '../data/demoData.js';
import { useAuth } from '../hooks/useAuth.js';
import { useGeolocation } from '../hooks/useGeolocation.js';

const ETAPES_ETABLISSEMENT = ['Photos', 'Produits', 'Infos'];
const CATEGORIES_INSCRIPTION = CATEGORIES.filter((c) => c.slug !== 'tous' && c.slug !== 'sante');

/**
 * Les deux profils « sans établissement » de la première question. Une seule
 * différence technique entre les deux : `chercheTravail` (capacité du compte
 * unifié). Un « employeur » peut tout de même publier une offre ou un besoin :
 * c'est un droit implicite de tout compte (models/User.js).
 */
const ROLES_SIMPLE = [
  {
    valeur: 'chercheur',
    icone: 'briefcase',
    titre: 'Je cherche du travail',
    detail: 'Missions, petits boulots et offres de mon quartier.',
    chercheTravail: true,
  },
  {
    valeur: 'employeur',
    icone: 'store',
    titre: 'J’embauche (employeur)',
    detail: 'Je recrute ou je propose un emploi : publier une offre est gratuit.',
    chercheTravail: false,
  },
];

export default function RegisterEstablishment() {
  const navigate = useNavigate();
  const { connecte, estDemo, profil, inscription, mettreAJourProfil } = useAuth();
  const position = useGeolocation();

  // null = la question d'entrée n'a pas encore de réponse : c'est le PREMIER
  // écran affiché. true = parcours « établissement » (3 étapes, photo,
  // produits, infos) ; false = profil simple (chercheur d'emploi / employeur).
  const [aEtablissement, setAEtablissement] = useState(null);
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
  // ── Parcours « Non » : profil simple, jamais de photo d'établissement ──
  const [roleSimple, setRoleSimple] = useState('chercheur');
  const [metierSimple, setMetierSimple] = useState('');
  const [prenom, setPrenom] = useState('');
  const [nomPersonne, setNomPersonne] = useState('');
  const [telephoneCompte, setTelephoneCompte] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
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

  // Étapes du parcours « établissement » (le parcours « Non » n'en a qu'une).
  const etapes = ETAPES_ETABLISSEMENT;
  const roleChoisi = ROLES_SIMPLE.find((r) => r.valeur === roleSimple) || ROLES_SIMPLE[0];

  function basculerTag(tag) {
    setTags((prec) => (prec.includes(tag) ? prec.filter((t) => t !== tag) : [...prec, tag]));
  }

  /** Réponse à la première question : on ouvre le parcours correspondant. */
  function choisirParcours(avecEtablissement) {
    setErreur('');
    setAEtablissement(avecEtablissement);
    setEtape(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Retour à la question d'entrée, depuis n'importe quelle étape. */
  function revenirQuestion() {
    setErreur('');
    setAEtablissement(null);
    setEtape(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Validation d'une étape avant de passer à la suivante (§5). */
  function validerEtape(index) {
    if (aEtablissement && index === 0) {
      // Les photos sont RECOMMANDÉES mais jamais bloquantes (29/09) : pendant la
      // tournée terrain, mieux vaut une fiche sans photo qu'un compte perdu.
      // Seul cas refusé : deux fois la même image, que l'API refuse aussi.
      if (photoDevanture && photoVendeur && photoDevanture === photoVendeur) {
        return 'Les deux photos doivent être différentes (devanture et vendeur/gérant).';
      }
    }
    if (aEtablissement && index === 1) {
      if (!categorie) return 'Choisissez la catégorie de votre établissement.';
      if (tags.length < 3) return 'Sélectionnez au moins 3 produits ou services.';
    }
    if (aEtablissement && index === 2) {
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
    if (etape < ETAPES_ETABLISSEMENT.length - 1) {
      setEtape(etape + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    envoyer();
  }

  /**
   * Parcours « Non » : enregistre un profil simple (chercheur d'emploi ou
   * employeur). Sans compte, le compte est créé ici même : `POST /users/register`
   * accepte déjà `chercheTravail` / `estArtisan`, donc les capacités sont posées
   * en une seule requête (aucun risque de jeton pas encore enregistré).
   */
  async function enregistrerProfilSimple() {
    if (!connecte) {
      if (!prenom.trim() && !nomPersonne.trim()) {
        setErreur('Indiquez au moins votre prénom : les gens doivent pouvoir vous reconnaître.');
        return;
      }
      if (!telephoneCompte.trim()) {
        setErreur('Indiquez votre numéro de téléphone (ex. 07 07 12 34 56).');
        return;
      }
      if (String(motDePasse).length < 6) {
        setErreur('Le mot de passe doit contenir au moins 6 caractères.');
        return;
      }
    }
    setErreur('');
    setEnCours(true);
    try {
      if (!connecte) {
        await inscription({
          telephone: telephoneCompte.trim(),
          motDePasse,
          prenom: prenom.trim(),
          nom: nomPersonne.trim(),
          metier: metierSimple,
          chercheTravail: roleChoisi.chercheTravail,
        });
      } else {
        // Compte déjà ouvert : on ne touche qu'aux capacités concernées.
        const patch = { chercheTravail: roleChoisi.chercheTravail };
        if (metierSimple) patch.metier = metierSimple;
        await mettreAJourProfil(patch);
      }
      navigate('/profil', { replace: true });
    } catch (err) {
      setErreur(err?.message || 'Enregistrement impossible pour le moment. Réessayez dans un instant.');
    } finally {
      setEnCours(false);
    }
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
        Recommandées, jamais obligatoires : elles rassurent vos clients et permettent de vous retrouver facilement
        dans le quartier. Pas de photo sous la main ? Touchez « Ajouter plus tard », la fiche se publiera quand même et
        vous pourrez les ajouter depuis votre fiche.
      </p>
      <PhotoUploadField
        label="Photo de la devanture"
        indication="Le local vu de la rue, bien éclairé, sans personne devant."
        value={photoDevanture}
        onChange={setPhotoDevanture}
        requis={false}
        libellePlusTard="Ajouter plus tard"
      />
      <PhotoUploadField
        label="Photo du vendeur / gérant"
        indication="La personne qui tient le commerce. Photo différente de la devanture."
        value={photoVendeur}
        onChange={setPhotoVendeur}
        requis={false}
        libellePlusTard="Ajouter plus tard"
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

  // ── Écran d'entrée : LA question, avant toute photo ──────────────────────
  // C'est la toute première chose demandée. Quelqu'un qui vient chercher du
  // travail ne doit jamais voir une étape « photo de devanture » : c'était la
  // première cause d'abandon sur le terrain.
  const ecranQuestion = (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => choisirParcours(true)}
        className="flex items-start gap-3 rounded-md border-2 border-primary/40 bg-primary/5 p-4 text-left transition hover:border-primary active:scale-[0.99]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <Icon name="store" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">Oui, j’ai un établissement</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
            Kiosque, boutique, atelier, salon, église… Je veux une fiche que les clients trouvent dans le quartier.
          </span>
        </span>
        <Icon name="chevronRight" size={18} className="mt-1 shrink-0 text-primary" />
      </button>

      <button
        type="button"
        onClick={() => choisirParcours(false)}
        className="flex items-start gap-3 rounded-md border-2 border-line bg-white p-4 text-left transition hover:border-primary/60 active:scale-[0.99]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-soft text-primary">
          <Icon name="user" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">Non, pas d’établissement</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
            Je cherche du travail ou j’embauche. Aucune photo de local ne me sera demandée.
          </span>
        </span>
        <Icon name="chevronRight" size={18} className="mt-1 shrink-0 text-ink-muted" />
      </button>

      <p className="mt-1 text-[11px] leading-snug text-ink-muted">
        Gratuit dans les deux cas, et modifiable plus tard : vous pourrez ouvrir la fiche d’un établissement depuis
        votre profil, même si vous répondez « Non » aujourd’hui.
      </p>
    </div>
  );

  // ── Parcours « Non » : profil simple (chercheur d'emploi / employeur), ────
  // sans jamais montrer une photo d'établissement.
  const etapeProfilSimple = (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-bold text-ink">Je suis…</p>
        <div className="flex flex-col gap-2">
          {ROLES_SIMPLE.map((role) => {
            const actif = role.valeur === roleSimple;
            return (
              <button
                key={role.valeur}
                type="button"
                onClick={() => setRoleSimple(role.valeur)}
                aria-pressed={actif}
                className={`flex items-start gap-3 rounded-md border-2 p-3 text-left transition ${
                  actif ? 'border-primary bg-primary/5' : 'border-line bg-white'
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    actif ? 'bg-primary text-white' : 'bg-soft text-primary'
                  }`}
                >
                  <Icon name={role.icone} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{role.titre}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">{role.detail}</span>
                </span>
                {actif && <Icon name="check" size={17} className="mt-1 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-bold text-ink">
          Mon métier <span className="font-normal text-ink-muted">(facultatif)</span>
        </span>
        <select
          value={metierSimple}
          onChange={(e) => setMetierSimple(e.target.value)}
          className="w-full rounded-md border border-line bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-primary"
        >
          <option value="">Choisir…</option>
          {METIERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[10px] leading-snug text-ink-muted">
          Renseignez-le si vous proposez vos services : votre profil devient visible dans l’annuaire.
        </span>
      </label>

      {connecte ? (
        <InfoBanner variante="info" titre="Votre compte est déjà ouvert">
          Le profil de {profil?.nomComplet || 'votre compte'} sera complété avec ces choix. Aucune photo de local ne
          vous est demandée.
        </InfoBanner>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-ink">Prénom</span>
              <input
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                placeholder="Awa"
                className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-ink">Nom</span>
              <input
                value={nomPersonne}
                onChange={(e) => setNomPersonne(e.target.value)}
                placeholder="Traoré"
                className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink">
              Téléphone <span className="text-danger">*</span>
            </span>
            <input
              type="tel"
              value={telephoneCompte}
              onChange={(e) => setTelephoneCompte(e.target.value)}
              placeholder="07 07 12 34 56"
              className="w-full rounded-md border border-line px-3 py-3 text-sm font-semibold outline-none focus:border-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink">
              Mot de passe <span className="text-danger">*</span>
            </span>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="6 caractères minimum"
              className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
            />
          </label>

          <p className="text-[11px] leading-snug text-ink-muted">
            Un seul compte pour tout : chercher du travail, publier une offre, proposer vos services. Votre numéro sert
            d’identifiant et n’est jamais publié sans votre accord.
          </p>
        </>
      )}
    </div>
  );

  // La question d'entrée n'a pas encore de réponse : on n'affiche ni formulaire
  // d'établissement, ni barre d'action (le choix se fait dans la carte).
  const question = aEtablissement === null;

  return (
    <div className={`ecran py-3 ${question ? '' : 'espace-barre-action'}`}>
      <h1 className="text-xl font-bold text-ink">
        {question ? 'Créer mon profil' : aEtablissement ? 'Inscrire mon établissement' : 'Mon profil'}
      </h1>
      <p className="mb-3 text-sm text-ink-muted">
        {question
          ? 'Une question pour commencer : elle décide de la suite, et elle reste modifiable plus tard.'
          : aEtablissement
            ? 'Gratuit. Photos facultatives (ajoutables plus tard), vos produits, votre numéro.'
            : 'Gratuit. Votre profil suffit pour être contacté : aucune photo d’établissement.'}
      </p>

      {/* Barre de progression : uniquement pour le parcours « Oui » (3 étapes). */}
      {aEtablissement && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            <span>
              Étape {etape + 1}/{etapes.length} · {etapes[etape]}
            </span>
            <span>{Math.round(((etape + 1) / etapes.length) * 100)} %</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-soft">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((etape + 1) / etapes.length) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between">
            {etapes.map((libelle, i) => (
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
      )}

      {/* La question est mise en évidence juste au-dessus des deux réponses. */}
      {question && <h2 className="mb-2 text-base font-bold text-ink">Avez-vous un établissement ?</h2>}

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
        {question && ecranQuestion}
        {aEtablissement === false && etapeProfilSimple}
        {aEtablissement === true && etape === 0 && etapePhotos}
        {aEtablissement === true && etape === 1 && etapeTags}
        {aEtablissement === true && etape === 2 && etapeInfos}
      </section>

      {/* Le formulaire n'est pas connecté à un compte : on l'indique avant l'envoi. */}
      {aEtablissement && !connecte && etape === 2 && (
        <InfoBanner variante="info" titre="Un compte est nécessaire" className="mt-3">
          Créez votre compte (numéro + mot de passe) pour publier la fiche : cela vous permettra de la modifier plus
          tard.
        </InfoBanner>
      )}

      {/* Barre d'action fixe — absente sur l'écran de question : le choix se fait
          dans la carte, il n'y a rien à valider. La réserve `espace-barre-action`
          du conteneur garantit que les derniers champs restent atteignables. */}
      {!question && (
        <div
          className="fixed bottom-[68px] left-0 right-0 z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto flex max-w-[480px] gap-2">
            <button
              type="button"
              className="btn-ghost flex-1"
              disabled={enCours}
              onClick={() => (aEtablissement && etape > 0 ? setEtape(etape - 1) : revenirQuestion())}
            >
              <Icon name="chevronLeft" size={18} />
              Retour
            </button>
            {/* Le halo `bouton-principal--cta-majeur` est réservé au TOUT PREMIER
                CTA de l'onboarding : l'étape 0, juste après la question d'entrée
                (et l'unique bouton du parcours « profil simple »). La consigne
                est explicite : pas de halo sur tous les boutons principaux. */}
            {aEtablissement ? (
              <button
                type="button"
                className={`bouton-principal flex-[2] ${etape === 0 ? 'bouton-principal--cta-majeur' : ''}`}
                onClick={suivant}
                disabled={enCours}
              >
                {enCours ? 'Envoi…' : etape === etapes.length - 1 ? 'Publier ma fiche' : 'Suivant'}
                {!enCours && etape < etapes.length - 1 && <Icon name="chevronRight" size={18} />}
              </button>
            ) : (
              <button
                type="button"
                className={`bouton-principal flex-[2] ${etape === 0 ? 'bouton-principal--cta-majeur' : ''}`}
                onClick={enregistrerProfilSimple}
                disabled={enCours}
              >
                {enCours ? 'Enregistrement…' : 'Enregistrer mon profil'}
                {!enCours && <Icon name="check" size={18} />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

