// Profile.jsx — Profil de l'utilisateur connecté (écran complémentaire).
//
// Rôle : permettre à un ouvrier/artisan de compléter son profil (métier, segment,
// quartier), d'atteindre ses favoris et ses besoins publiés, et de se déconnecter.
//
// Décisions :
//  - Consultable sans compte, mais on invite alors à se connecter pour retrouver
//    ses favoris sur un autre appareil.
//  - Le segment « journalier » vs « spécialisé » est modifiable ici : c'est lui qui
//    conditionne la variante de gratuité du premier contact (§2).
//  - Les favoris sont affichés depuis l'état local (profil.favoris) : aucune requête
//    supplémentaire n'est nécessaire.
//  - « Mes visites » (ajout du 17/11) suit la même logique, mais le carnet ne
//    contient que des IDENTIFIANTS : nom et photo de chaque fiche sont relus auprès
//    de l'API (voir l'effet `chargerFichesVisites`). Ce carnet est PRIVÉ.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import AbonnementArtisan from '../components/AbonnementArtisan.jsx';
import PhotoUploadField from '../components/PhotoUploadField.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatFcfa, formatTelephone, initiales } from '../utils/format.js';
import { METIERS, ETABLISSEMENTS_DEMO } from '../data/demoData.js';
import { TEXTE_DONNEES, LIEN_DONNEES } from '../config/legal.js';

const FORMULAIRE_VIDE = {
  // Photo de profil (ajout du 16/11) : elle était affichée depuis le début
  // (en-tête de /profil, barre du haut, annuaire des artisans) mais AUCUN écran
  // ne permettait de la choisir — l'avatar restait donc toujours aux initiales.
  photoProfil: '',
  prenom: '',
  nom: '',
  metier: '',
  segment: 'specialise',
  quartier: '',
  commune: '',
  // Capacités du compte unifié (ajout du 29/09) : ce sont elles qui décident si
  // l'utilisateur est trouvable comme artisan et s'il reçoit les annonces.
  estArtisan: false,
  chercheTravail: true,
};

/**
 * Carte compacte d'une fiche, partagée par « Mes favoris » et « Mes visites » :
 * une seule définition, donc un rendu identique dans les deux sections.
 * L'image préfère l'URL servie par l'API (`photoDevantureUrl`) et retombe sur la
 * photo des données de démonstration.
 */
function CarteFicheListe({ fiche }) {
  const lieu = [fiche.quartier, fiche.commune].filter(Boolean).join(', ');
  return (
    <Link to={`/etablissement/${fiche.id}`} className="carte flex items-center gap-3 p-2">
      <img
        src={fiche.photoDevantureUrl || fiche.photoDevanture}
        alt={fiche.nom}
        loading="lazy"
        decoding="async"
        className="h-12 w-12 rounded-md object-cover"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{fiche.nom}</span>
        <span className="block text-[11px] text-ink-muted">{lieu || 'Adresse non précisée'}</span>
      </span>
      <Icon name="chevronRight" size={18} className="text-ink-muted" />
    </Link>
  );
}

/**
 * Met à jour l'application « de force » (17/11) : désinscrit le service worker,
 * supprime les caches `rejoinsmoi-*`, puis recharge la page.
 *
 * Même recette que le lien du bandeau (components/MiseAJourPWA.jsx) et que
 * l'entrée du menu principal (components/MenuPrincipal.jsx) : les trois copies
 * doivent rester identiques. Elle n'est pas factorisée dans utils/pwa.js pour ne
 * pas élargir le périmètre de cette livraison.
 *
 * Pourquoi ce bouton ici aussi : c'est le profil qu'un utilisateur ouvre quand
 * « l'app fait n'importe quoi » (photos anciennes, boutons absents). Le geste
 * habituel — désinstaller puis réinstaller — efface l'installation, l'invitation
 * et les réglages du navigateur pour la même application. Un clic suffit.
 *
 * Ne touche JAMAIS : les données du compte (elles sont sur le serveur), la saisie
 * en cours (le rechargement n'a lieu qu'après le clic), les caches d'autres
 * applications (filtre strict `rejoinsmoi-`) ni les règles de paiement (voir sw.js).
 */
async function forcerMiseAJour() {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const enregistrement = await navigator.serviceWorker.getRegistration();
      if (enregistrement) await enregistrement.unregister();
    }
  } catch {
    /* rien à désinscrire : on continue, le rechargement reste utile */
  }
  try {
    if (typeof caches !== 'undefined') {
      const noms = await caches.keys();
      await Promise.all(
        noms.filter((nom) => nom.startsWith('rejoinsmoi-')).map((nom) => caches.delete(nom))
      );
    }
  } catch {
    /* stockage refusé (navigation privée) : le rechargement fera l'affaire */
  }
  if (typeof window !== 'undefined') window.location.reload();
}

export default function Profile() {
  const navigate = useNavigate();
  const { profil, connecte, estDemo, deconnexion, mettreAJourProfil, supprimerMonCompte, favoris, visites } = useAuth();
  const [edition, setEdition] = useState(false);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [message, setMessage] = useState('');
  /** « Forcer la mise à jour » en cours : le libellé se verrouille le temps du rechargement. */
  const [majEnCours, setMajEnCours] = useState(false);
  const [mesBesoins, setMesBesoins] = useState([]);
  // ── « Mes visites » (privé, ajout du 17/11) ──
  // Le compte ne stocke que des IDENTIFIANTS : nom et photo sont relus fiche par
  // fiche. Un carnet réel contient quelques fiches, pas des centaines ; les fiches
  // de démonstration sont résolues localement, sans appel réseau.
  const [fichesVisites, setFichesVisites] = useState([]);
  const [chargementVisites, setChargementVisites] = useState(false);
  // ── Droit à l'effacement (20/11) ──
  // La fenêtre de confirmation est LOCALE à cet écran : rien n'est envoyé tant que
  // le mot de passe n'a pas été saisi, et un échec (mot de passe faux) laisse la
  // session intacte. `suppressionEnCours` verrouille le bouton pour éviter un
  // double envoi sur réseau lent.
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  const [motDePasseSuppression, setMotDePasseSuppression] = useState('');
  const [erreurSuppression, setErreurSuppression] = useState('');
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  useEffect(() => {
    if (!profil) return;
    setFormulaire({
      photoProfil: profil.photoProfil || '',
      prenom: profil.prenom || '',
      nom: profil.nom || '',
      metier: profil.metier || '',
      segment: profil.segment || 'specialise',
      quartier: profil.quartier || '',
      commune: profil.commune || '',
      estArtisan: Boolean(profil.estArtisan),
      chercheTravail: profil.chercheTravail !== false,
    });
  }, [profil]);

  // Besoins publiés par l'utilisateur connecté (encart non critique).
  useEffect(() => {
    let annule = false;
    async function chargerMesBesoins() {
      if (!connecte || estDemo || !profil?.id) return;
      try {
        const reponse = await api.get('/jobs?limit=50');
        if (annule) return;
        setMesBesoins(
          (reponse.items || []).filter((j) => String(j.posteParUserId || '') === String(profil.id))
        );
      } catch {
        /* silencieux */
      }
    }
    chargerMesBesoins();
    return () => {
      annule = true;
    };
  }, [connecte, estDemo, profil?.id]);

  // Résolution des fiches visitées : le carnet ne contient que des identifiants.
  // Les plus récentes d'abord (on ajoute en fin de tableau côté serveur).
  useEffect(() => {
    let annule = false;
    async function chargerFichesVisites() {
      const ids = visites.slice(-30).reverse();
      if (ids.length === 0) {
        setFichesVisites([]);
        return;
      }
      setChargementVisites(true);
      const fiches = await Promise.all(
        ids.map(async (unId) => {
          const demonstration = ETABLISSEMENTS_DEMO.find((e) => String(e.id) === String(unId));
          if (demonstration) return demonstration;
          try {
            const reponse = await api.get(`/establishments/${unId}`);
            return reponse.etablissement || null;
          } catch {
            // Fiche retirée, ou API endormie : on n'affiche pas de trou dans la liste.
            return null;
          }
        })
      );
      if (annule) return;
      setFichesVisites(fiches.filter(Boolean));
      setChargementVisites(false);
    }
    chargerFichesVisites();
    return () => {
      annule = true;
    };
  }, [visites]);

  async function enregistrer(evt) {
    evt.preventDefault();
    setMessage('');
    try {
      // `photoProfil` part avec le reste du formulaire : PATCH /users/me le contrôle
      // (data-URI JPEG ≤ 300 Ko ou URL http(s)) et renvoie le profil à jour, que
      // AuthContext mémorise — l'avatar change donc sans rechargement.
      await mettreAJourProfil({ ...formulaire, photoProfil: formulaire.photoProfil || '' });
      setEdition(false);
      setMessage('Profil mis à jour.');
    } catch (err) {
      setMessage(err?.message || 'Mise à jour impossible pour le moment.');
    }
  }

  function lancerMiseAJour() {
    setMajEnCours(true);
    forcerMiseAJour();
  }

  /** Ouvre la confirmation d'effacement (champs remis à zéro à chaque ouverture). */
  function ouvrirSuppression() {
    setMotDePasseSuppression('');
    setErreurSuppression('');
    setSuppressionOuverte(true);
  }

  /** Ferme la fenêtre — interdit pendant l'envoi (on ne masque pas une requête en cours). */
  function fermerSuppression() {
    if (suppressionEnCours) return;
    setSuppressionOuverte(false);
    setMotDePasseSuppression('');
    setErreurSuppression('');
  }

  /**
   * Confirme l'effacement : le MOT DE PASSE est la preuve que c'est bien le
   * titulaire (un téléphone prêté ne suffit pas à effacer un compte).
   *
   * En cas de succès, AuthContext nous a déconnectés : on repart vers l'accueil
   * avec un message de confirmation. En cas d'échec, la fenêtre reste ouverte avec
   * l'erreur du serveur : rien n'a été supprimé, la session continue.
   */
  async function confirmerSuppression(evt) {
    evt.preventDefault();
    if (!motDePasseSuppression || suppressionEnCours) return;
    setSuppressionEnCours(true);
    setErreurSuppression('');
    try {
      await supprimerMonCompte(motDePasseSuppression);
      setSuppressionOuverte(false);
      // Message court : le détail (ce qui est conservé) est déjà annoncé dans la zone
      // DANGER du profil, et un bandeau d'accueil de 5 lignes ne se lit pas.
      navigate('/', {
        replace: true,
        state: {
          message:
            'Votre compte a été supprimé. Vos avis restent en ligne sous le nom « Utilisateur supprimé ».',
        },
      });
    } catch (err) {
      setErreurSuppression(err?.message || 'Suppression impossible pour le moment. Réessayez.');
      setSuppressionEnCours(false);
    }
  }

  if (!connecte) {
    return (
      <div className="ecran py-6">
        <EmptyState
          icone="user"
          titre="Votre profil Rejoins’Moi"
          description="Connectez-vous avec votre numéro de téléphone pour enregistrer vos favoris, publier un besoin ou inscrire votre établissement."
          action={{ libelle: 'Se connecter', onClick: () => navigate('/connexion', { state: { depuis: '/profil' } }) }}
          // Le profil, c'est « chez soi » : la maison en filigrane, pas un cadenas.
          illustration="maison"
        />
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/main-doeuvre')}>
            <Icon name="briefcase" size={18} />
            Voir les besoins de main-d’œuvre
          </button>
          <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/pharmacies-cliniques')}>
            <Icon name="pharmacy" size={18} />
            Pharmacies & Cliniques
          </button>
        </div>

        {/* Secours « mise à jour » (17/11). Aussi pour les comptes déconnectés : un
            téléphone bloqué sur une vieille version l'est avant même de se connecter,
            et c'est l'écran qu'on ouvre quand « l'app ne ressemble plus à rien ». */}
        <div className="mt-5 text-center">
          <button
            type="button"
            disabled={majEnCours}
            onClick={lancerMiseAJour}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted underline transition active:scale-95 disabled:opacity-60"
          >
            <Icon name="refresh" size={14} className="text-primary" />
            {majEnCours ? 'Mise à jour en cours…' : 'Problème d’affichage ? Forcer la mise à jour'}
          </button>
        </div>
      </div>
    );
  }

  const etablissementsFavoris = ETABLISSEMENTS_DEMO.filter((e) => favoris.includes(String(e.id)));
  // Compte unifié : le libellé se déduit des CAPACITÉS, pas d'un type de compte.
  const libelleType = [
    profil.estArtisan ? `Artisan · ${profil.metier || 'métier à préciser'}` : null,
    profil.chercheTravail ? 'Cherche du travail' : null,
    'Peut employer (publier une offre ou un besoin)',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="ecran py-3">
      {/* En-tête du profil */}
      <section className="carte flex items-center gap-3 p-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-lg font-bold text-primary">
          {profil.photoProfil ? (
            <img src={profil.photoProfil} alt={profil.nomComplet} className="h-full w-full object-cover" />
          ) : (
            initiales(profil.nomComplet || 'Utilisateur')
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-ink">{profil.nomComplet || 'Mon profil'}</h1>
          <p className="text-xs font-semibold text-ink-muted">{formatTelephone(profil.telephone)}</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {libelleType}
            {profil.segment === 'journalier' ? ' · journalier' : ''}
          </p>
        </div>
        <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setEdition((v) => !v)}>
          {edition ? 'Annuler' : 'Modifier'}
        </button>
      </section>

      {/* Mon établissement (16/11) : le gérant n'avait AUCUN chemin vers sa propre
          fiche depuis son profil — il devait retrouver sa boutique dans le fil.
          La carte n'apparaît que si le compte est rattaché à une fiche
          (`profil.etablissementId`), et mène directement à l'écran de gestion. */}
      {profil.etablissementId && (
        <section className="carte mt-3 flex items-center gap-3 border-l-4 border-l-primary p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="store" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Mon établissement</p>
            <p className="text-[11px] leading-snug text-ink-muted">
              Modifier le nom, la description, les horaires, les photos — ou fermer temporairement.
            </p>
          </div>
          <Link
            to={`/etablissement/${profil.etablissementId}`}
            className="bouton-principal shrink-0 px-3 py-2 text-xs"
          >
            Gérer
          </Link>
        </section>
      )}

      {/* Abonnement (ajout du 29/09) : l'option qui débloque en une fois les offres de
          boulot, les demandes de main-d'œuvre et la mise en avant du profil artisan. */}
      <div className="mt-3">
        <AbonnementArtisan />
      </div>

      {message && !edition && (
        <InfoBanner variante="succes" className="mt-3" action={{ libelle: 'OK', onClick: () => setMessage('') }}>
          {message}
        </InfoBanner>
      )}

      {estDemo && (
        <InfoBanner variante="demo" titre="Compte de démonstration" className="mt-3">
          Ce profil n’existe pas côté serveur : les modifications ne sont pas conservées.
        </InfoBanner>
      )}
      {message && (
        <InfoBanner variante="succes" className="mt-3" action={{ libelle: 'OK', onClick: () => setMessage('') }}>
          {message}
        </InfoBanner>
      )}

      {/* Portefeuille : solde interne utilisé pour les mises en relation (§2) */}
      <section className="carte mt-3 flex items-center gap-3 p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name="wallet" size={20} />
        </span>
        <div className="flex-1">
          <p className="text-xs font-semibold text-ink-muted">Solde de mise en relation</p>
          <p className="text-base font-bold text-ink">{formatFcfa(profil.solde || 0)}</p>
        </div>
        <button type="button" className="bouton-principal px-3 py-2 text-xs" onClick={() => navigate('/main-doeuvre')}>
          Débloquer un contact
        </button>
      </section>

      {edition && (
        <form onSubmit={enregistrer} className="carte mt-3 flex flex-col gap-3 p-4">
          {/* Photo de profil : AVANT l'identité, parce que c'est la première chose
              que voient les clients (avis, annuaire, barre du haut). Facultative et
              compressée sous 300 Ko par PhotoUploadField (plafond serveur identique). */}
          <PhotoUploadField
            label="Ma photo de profil"
            indication="Elle apparaît sur vos avis et dans l’annuaire. Facultative."
            value={formulaire.photoProfil || ''}
            onChange={(dataUri) => setFormulaire((prec) => ({ ...prec, photoProfil: dataUri }))}
            requis={false}
            libellePlusTard="Ajouter plus tard"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Prénom</span>
              <input
                value={formulaire.prenom}
                onChange={(e) => setFormulaire({ ...formulaire, prenom: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Nom</span>
              <input
                value={formulaire.nom}
                onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-bold text-ink">Métier (artisan / ouvrier)</span>
            <select
              value={formulaire.metier}
              onChange={(e) => setFormulaire({ ...formulaire, metier: e.target.value })}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-primary"
            >
              <option value="">Non renseigné</option>
              {METIERS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="mb-1 text-xs font-bold text-ink">Type de travail recherché</legend>
            <div className="flex gap-2">
              {[
                { cle: 'specialise', libelle: 'Missions spécialisées' },
                { cle: 'journalier', libelle: 'Journalier' },
              ].map((s) => (
                <button
                  key={s.cle}
                  type="button"
                  onClick={() => setFormulaire({ ...formulaire, segment: s.cle })}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-bold transition ${
                    formulaire.segment === s.cle ? 'border-primary bg-primary/10 text-primary-dark' : 'border-line'
                  }`}
                >
                  {s.libelle}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              En tant que journalier, votre premier contact sur une mission d’une journée est gratuit.
            </p>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Quartier</span>
              <input
                value={formulaire.quartier}
                onChange={(e) => setFormulaire({ ...formulaire, quartier: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Commune</span>
              <input
                value={formulaire.commune}
                onChange={(e) => setFormulaire({ ...formulaire, commune: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <fieldset className="rounded-md border border-line p-2.5">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              Ce que je fais avec ce compte
            </legend>
            <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={formulaire.estArtisan}
                onChange={(e) => setFormulaire((prec) => ({ ...prec, estArtisan: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Je propose mes services (artisan / prestataire)
                <span className="block text-[10px] font-normal text-ink-muted">
                  Mon profil apparaît dans l’annuaire des artisans et dans le feed.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={formulaire.chercheTravail}
                onChange={(e) =>
                  setFormulaire((prec) => ({ ...prec, chercheTravail: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Je cherche du travail
                <span className="block text-[10px] font-normal text-ink-muted">
                  Je parcours les offres de boulot et les demandes de mon quartier.
                </span>
              </span>
            </label>
            <p className="pt-1 text-[10px] font-normal normal-case text-ink-muted">
              Un seul compte suffit : publier une offre ou un besoin est ouvert à tout le monde.
            </p>
          </fieldset>

          <button type="submit" className="bouton-principal w-full">
            Enregistrer
          </button>
        </form>
      )}

      {/* Favoris */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Mes favoris ({favoris.length})</h2>
        {etablissementsFavoris.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Touchez le bouton d’action d’une fiche pour ajouter un établissement à vos favoris.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {etablissementsFavoris.map((e) => (
              <li key={e.id}>
                <CarteFicheListe fiche={e} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mes visites (privé) — juste après les favoris : deux carnets personnels
          voisins. Le libellé et la phrase d'aide rappellent que ces fiches ne sont
          visibles que par l'utilisateur, pour ne pas le laisser croire qu'il
          « note » publiquement un établissement. */}
      <section className="mt-4">
        <h2 className="mb-1 text-sm font-bold text-ink">Mes visites ({visites.length})</h2>
        <p className="mb-2 text-[11px] text-ink-muted">
          Carnet privé : ces fiches ne sont visibles que par vous.
        </p>
        {chargementVisites ? (
          <p className="text-xs text-ink-muted">Chargement de vos fiches…</p>
        ) : visites.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Vous n’avez pas encore marqué d’établissement comme visité.
          </p>
        ) : fichesVisites.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Vos fiches visitées sont momentanément indisponibles (réseau lent). Elles
            réapparaîtront au prochain chargement.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {fichesVisites.map((e) => (
              <li key={e.id}>
                <CarteFicheListe fiche={e} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mes besoins publiés */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Mes besoins publiés ({mesBesoins.length})</h2>
        {mesBesoins.length === 0 ? (
          <button
            type="button"
            className="btn-ghost w-full text-sm"
            onClick={() => navigate('/main-doeuvre?mode=poster')}
          >
            <Icon name="plus" size={18} />
            Poster un besoin (gratuit)
          </button>
        ) : (
          <ul className="flex flex-col gap-2">
            {mesBesoins.map((j) => (
              <li key={j.id} className="carte p-3">
                <p className="text-sm font-bold text-ink">{j.metier}</p>
                <p className="text-[11px] text-ink-muted">{j.description}</p>
                <p className="mt-1 text-[11px] font-semibold text-primary">
                  {j.nombreDeblocages} déblocage{j.nombreDeblocages > 1 ? 's' : ''} · statut {j.statut}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5 flex flex-col gap-2">
        <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/inscription')}>
          <Icon name="store" size={18} />
          Inscrire un établissement
        </button>
        <button
          type="button"
          className="btn w-full bg-red-50 text-sm text-danger"
          onClick={() => {
            deconnexion();
            navigate('/');
          }}
        >
          <Icon name="close" size={18} />
          Se déconnecter
        </button>
      </div>

      {/* Droit à l'effacement (20/11) — zone DANGER, volontairement séparée de la
          déconnexion : la déconnexion est réversible, l'effacement ne l'est pas.
          On annonce d'abord CE QUI PART et CE QUI RESTE (dépôts/abonnements payés
          conservés pour la comptabilité, sans donnée personnelle) : la personne doit
          comprendre avant de cliquer, pas découvrir après.
          Masquée en mode démonstration : ce profil n'existe que sur ce téléphone.
          `estDemo` est déjà déduit de `profil.demo` par AuthContext. */}
      {!estDemo && (
        <section className="mt-4 rounded-md border border-red-200 bg-red-50/60 p-3">
          <h2 className="text-sm font-bold text-danger">Supprimer mon compte</h2>
          <p className="mt-1 text-[11px] leading-snug text-ink-muted">
            Efface votre nom, votre numéro, votre photo, vos favoris, vos visites et
            votre mot de passe. Vos avis restent en ligne, signés «&nbsp;Utilisateur
            supprimé&nbsp;» (ils informent encore les autres). Vos dépôts et abonnements
            déjà payés sont conservés pour la comptabilité, sans votre nom. Un retrait
            de fiche d'établissement vous appartient : supprimez-la d'abord si besoin.
          </p>
          <button
            type="button"
            className="btn mt-2 w-full bg-white text-sm text-danger"
            onClick={ouvrirSuppression}
          >
            <Icon name="close" size={18} />
            Supprimer définitivement mon compte
          </button>
        </section>
      )}

      {/* Confirmation par MOT DE PASSE. Une feuille en bas d'écran (même motif que
          components/ChoisirPosition.jsx) : elle se ferme d'un clic à côté, mais
          jamais pendant l'envoi. */}
      {suppressionOuverte && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-pop-in"
          role="presentation"
          onClick={fermerSuppression}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-suppression"
            className="w-full max-w-[480px] rounded-t-xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg"
            onClick={(evt) => evt.stopPropagation()}
          >
            <h2 id="titre-suppression" className="text-base font-bold text-ink">
              Confirmer la suppression
            </h2>
            <p className="mt-1 text-xs leading-snug text-ink-muted">
              Saisissez votre mot de passe pour prouver que c'est bien vous. Votre compte
              sera effacé immédiatement et vous serez déconnecté.
            </p>
            <form onSubmit={confirmerSuppression} className="mt-3 flex flex-col gap-2">
              <label className="block text-[11px] font-semibold text-ink" htmlFor="mot-de-passe-suppression">
                Mot de passe
                <input
                  id="mot-de-passe-suppression"
                  type="password"
                  autoComplete="current-password"
                  value={motDePasseSuppression}
                  onChange={(evt) => setMotDePasseSuppression(evt.target.value)}
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
                  autoFocus
                  disabled={suppressionEnCours}
                />
              </label>
              {erreurSuppression && (
                <p role="alert" className="text-[11px] font-semibold text-danger">
                  {erreurSuppression}
                </p>
              )}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  className="btn-ghost flex-1 text-sm"
                  onClick={fermerSuppression}
                  disabled={suppressionEnCours}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn flex-1 bg-danger text-sm text-white"
                  disabled={suppressionEnCours || !motDePasseSuppression}
                >
                  {suppressionEnCours ? 'Suppression…' : 'Supprimer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Suppression / correction des données (bloc G) : un VRAI moyen de contact, et
          non plus « depuis l'onglet Messages » (cet écran ne permet rien de tel).
          Le numéro et le lien viennent de config/legal.js : une seule source. */}
      <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
        <a
          className="font-semibold text-primary underline"
          href={LIEN_DONNEES}
          target="_blank"
          rel="noopener noreferrer"
        >
          {TEXTE_DONNEES}
        </a>
        .{' '}
        <Link to="/mentions-legales" className="font-semibold text-primary underline">
          Mentions légales
        </Link>
      </p>

      {/* Secours « mise à jour » (17/11) : tout en bas, en petit. C'est le geste de
          la dernière chance quand l'app reste figée sur une vieille version (téléphone
          installé avant le bandeau « nouvelle version », Safari iOS capricieux). Il
          remplace le réflexe « désinstaller puis réinstaller », qui efface l'installation. */}
      <div className="mt-4 text-center">
        <button
          type="button"
          disabled={majEnCours}
          onClick={lancerMiseAJour}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted underline transition active:scale-95 disabled:opacity-60"
        >
          <Icon name="refresh" size={14} className="text-primary" />
          {majEnCours ? 'Mise à jour en cours…' : 'Problème d’affichage ? Forcer la mise à jour'}
        </button>
      </div>
    </div>
  );
}
