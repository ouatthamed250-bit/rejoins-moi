// JobBoard.jsx — Volet mise en relation main-d'œuvre / métiers (voir docs/cahier-des-charges.md §1-2)
//
// Contenu :
//  - Deux modes : « Je cherche du travail » (parcourir les besoins postés) et
//    « Je cherche de la main-d'œuvre » (poster un besoin, GRATUIT).
//  - Filtres : métier, mot-clé (quartier/comune/description), urgents seulement.
//  - Côté ouvrier/artisan : les besoins proches, triés par proximité, avec le
//    nombre de personnes ayant déjà débloqué le contact.
//  - Le numéro de contact est MASQUÉ jusqu'au déblocage. Déblocage = 500 FCFA via
//    Wave / Orange Money (passerelle CinetPay, voir utils/payment.js). Aucun faux
//    paiement : si la passerelle n'est pas configurée côté serveur, on le dit.
//
// Décisions :
//  - Point ouvert §2 (segment « journalier ») tranché ainsi : pour les missions
//    journalières, le backend offre le PREMIER CONTACT et n'exige les 500 FCFA
//    qu'après confirmation de la mission. Le frontend ne fait que refléter ce que
//    renvoie l'API (`gratuit: true`) — il ne décide jamais qu'un paiement est passé.
//  - Poster un besoin demande une connexion ; chercher du travail n'en demande pas.
//  - Hors ligne : besoins de démonstration + bandeau, et le déblocage est refusé
//    (pas de faux succès).
//  - Les contacts débloqués sont mémorisés localement pour rester visibles, en plus
//    de l'historique serveur (§8 : « retrouver ses mises en relation »).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import StarRating from '../components/StarRating.jsx';
import TagBadge from '../components/TagBadge.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { paiementDisponible, FRAIS_DEBLOCAGE } from '../utils/payment.js';
import { CENTRE_ABIDJAN, distanceDepuis, formatDistanceKm } from '../utils/distance.js';
import { formatDateRelative, formatFcfa, formatTelephone, initiales } from '../utils/format.js';
import { METIERS, filtrerBesoinsDemo } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.js';
import { useDeblocageContact } from '../hooks/useDeblocageContact.js';

const MODES = [
  { cle: 'travail', libelle: 'Je cherche du travail', icone: 'tools' },
  { cle: 'besoin', libelle: 'Je cherche de la main-d’œuvre', icone: 'briefcase' },
];

export default function JobBoard() {
  const navigate = useNavigate();
  const { connecte, profil, estDemo } = useAuth();
  const position = useGeolocation();

  // Les paramètres d'URL pilotent l'écran : `?mode=poster` ouvre directement le
  // formulaire (c'est ce que fait le bouton « + » de la barre du bas) et
  // `?typeAnnonce=offre|demande` présélectionne le type d'annonce — la page Jobs
  // renvoie ici pour publier. Sans ce lecture, les liens arrivaient sur le mauvais onglet.
  const [parametres] = useSearchParams();
  const [mode, setMode] = useState(parametres.get('mode') === 'poster' ? 'besoin' : 'travail');
  const typeAnnonceInitial = parametres.get('typeAnnonce') === 'offre' ? 'offre' : 'demande';

  const [besoins, setBesoins] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [metier, setMetier] = useState('tous');
  const [terme, setTerme] = useState('');
  const [urgentsSeulement, setUrgentsSeulement] = useState(false);
  const [paiementInfo, setPaiementInfo] = useState({ configure: null, frais: FRAIS_DEBLOCAGE });

  // Déblocage du contact : logique PARTAGÉE avec la page Jobs (hooks/useDeblocageContact.js),
  // pour que les deux écrans appliquent exactement les mêmes règles de paiement.
  const {
    contacts,
    enCours,
    erreur,
    message,
    setErreur,
    setMessage,
    telephoneDebloque,
    debloquer,
    verifierPaiement,
  } = useDeblocageContact({
    horsLigne,
    cheminConnexion: '/main-doeuvre',
    onDebloque: (besoin, { telephone }) => {
      setBesoins((prec) =>
        prec.map((b) =>
          String(b.id) === String(besoin.id)
            ? { ...b, telephoneContact: telephone, contactMasque: false, dejaDebloque: true }
            : b
        )
      );
    },
  });

  const charger = useCallback(async () => {
    setChargement(true);
    const coords = position.position;
    try {
      const requete = new URLSearchParams({ limit: '40', statut: 'ouvert' });
      if (coords) {
        requete.set('lat', coords.lat);
        requete.set('lng', coords.lng);
      }
      const reponse = await api.get(`/jobs?${requete.toString()}`);
      setBesoins(reponse.items || []);
      setHorsLigne(false);
    } catch {
      setBesoins(filtrerBesoinsDemo({ metier: 'tous' }));
      setHorsLigne(true);
    } finally {
      setChargement(false);
    }
  }, [position.position]);

  useEffect(() => {
    charger();
  }, [charger]);

  // La passerelle de paiement est-elle branchée ? On l'affiche franchement plutôt
  // que de laisser l'utilisateur buter sur une erreur au dernier moment (§2).
  useEffect(() => {
    let annule = false;
    paiementDisponible().then((info) => {
      if (!annule) setPaiementInfo(info);
    });
    return () => {
      annule = true;
    };
  }, []);

  /** Filtres (métier, mot-clé, urgents) puis tri par proximité. */
  const liste = useMemo(() => {
    const base = horsLigne
      ? filtrerBesoinsDemo({ metier, q: terme })
      : besoins.filter((b) => {
          if (metier !== 'tous' && b.metier !== metier) return false;
          const t = terme.trim().toLowerCase();
          if (!t) return true;
          return [b.metier, b.description, b.commune, b.quartier].join(' ').toLowerCase().includes(t);
        });

    const filtres = urgentsSeulement ? base.filter((b) => b.urgence) : base;
    return filtres
      .map((b) => ({ ...b, distanceKm: b.distanceKm ?? distanceDepuis(position.position, b) }))
      .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }, [besoins, horsLigne, metier, terme, urgentsSeulement, position.position]);

  return (
    <div className="ecran py-3">
      <header className="mb-3">
        <h1 className="text-xl font-bold text-ink">Main-d’œuvre &amp; métiers</h1>
        <p className="text-sm text-ink-muted">
          Trouvez un plombier, une couturière ou un journalier près de chez vous — et pour les
          artisans, les besoins publiés dans le quartier.
        </p>
      </header>

      {/* Les deux usages du volet (§1-2) */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {MODES.map((m) => (
          <button
            key={m.cle}
            type="button"
            aria-pressed={mode === m.cle}
            onClick={() => setMode(m.cle)}
            className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] font-bold leading-tight transition active:scale-[0.98] ${
              mode === m.cle
                ? 'border-primary bg-primary text-white shadow-card'
                : 'border-line bg-white text-ink hover:bg-soft'
            }`}
          >
            <Icon name={m.icone} size={18} />
            {m.libelle}
          </button>
        ))}
      </div>

      <InfoBanner variante="info" titre="Chercher est gratuit ; seul le contact coûte" className="mb-3">
        Poster un besoin et consulter les offres sont gratuits. Les {formatFcfa(paiementInfo.frais)} ne
        servent qu’à débloquer le numéro : c’est ce qui limite les appels inutiles. Pour les missions
        journalières, le premier contact est offert.
      </InfoBanner>

      {horsLigne && (
        <InfoBanner variante="demo" titre="Besoins d’exemple" className="mb-3">
          Serveur injoignable : les besoins ci-dessous viennent du jeu de démonstration et leurs
          contacts ne peuvent pas être débloqués.
        </InfoBanner>
      )}

      {paiementInfo.configure === false && !horsLigne && (
        <InfoBanner variante="alerte" titre="Paiement mobile money non activé" className="mb-3">
          La passerelle Wave / Orange Money n’est pas encore branchée sur cet environnement. Les
          besoins restent consultables, mais aucun contact ne peut être débloqué — et aucun paiement
          n’est simulé.
        </InfoBanner>
      )}

      {erreur && (
        <InfoBanner
          variante="erreur"
          titre="Action impossible"
          className="mb-3"
          action={{ libelle: 'OK', onClick: () => setErreur('') }}
        >
          {erreur}
        </InfoBanner>
      )}

      {message && (
        <InfoBanner
          variante="succes"
          titre="Rejoins’Moi"
          className="mb-3"
          action={{ libelle: 'OK', onClick: () => setMessage('') }}
        >
          {message}
        </InfoBanner>
      )}

      {mode === 'besoin' ? (
        <FormulaireBesoin
          profil={profil}
          position={position.position}
          connecte={connecte}
          horsLigne={horsLigne}
          typeAnnonceInitial={typeAnnonceInitial}
          onSeConnecter={() => navigate('/connexion', { state: { depuis: '/main-doeuvre' } })}
          onPublie={async () => {
            setMode('travail');
            setMessage(
              'Votre besoin est publié : les artisans et journaliers du quartier peuvent désormais le voir.'
            );
            await charger();
          }}
        />
      ) : (
        <>
          {/* Réputation de l'ouvrier/artisan connecté (§1) : la note vient du
              serveur (toPublicJSON → noteMoyenne/nombreAvis), pas du navigateur. */}
          {connecte && (
            <section className="carte mb-3 flex items-center gap-3 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon name="star" size={17} filled />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-ink">Votre réputation</p>
                <StarRating note={profil?.noteMoyenne} nombreAvis={profil?.nombreAvis} taille={14} />
                <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">
                  Les clients vous notent après une mission réalisée. Une bonne note vous fait
                  remonter dans les recherches du quartier.
                </p>
              </div>
            </section>
          )}

          {/* Filtres */}
          <div className="mb-3 flex flex-col gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <Icon name="search" size={18} />
              </span>
              <input
                type="search"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                placeholder="Plombier, déchargement, Angré…"
                aria-label="Rechercher un besoin de main-d’œuvre"
                className="w-full rounded-md border border-line bg-white py-2.5 pl-10 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-primary"
              />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                Métier recherché
                <select
                  value={metier}
                  onChange={(e) => setMetier(e.target.value)}
                  className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2 text-xs font-semibold normal-case text-ink outline-none focus:border-primary"
                >
                  <option value="tous">Tous les métiers</option>
                  {METIERS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={urgentsSeulement}
                  onChange={(e) => setUrgentsSeulement(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Urgents
              </label>
            </div>
          </div>

          <p className="mb-2 text-[11px] font-semibold text-ink-muted">
            {chargement
              ? 'Chargement des besoins…'
              : `${liste.length} besoin${liste.length > 1 ? 's' : ''} ouvert${
                  liste.length > 1 ? 's' : ''
                }${
                  position.position && !position.approximatif
                    ? ' · du plus proche au plus loin'
                    : ''
                }`}
            {position.approximatif && !chargement && ' · distances approximatives (Plateau)'}
          </p>

          {chargement ? (
            <EmptyState chargement titre="Recherche des besoins du quartier…" />
          ) : liste.length === 0 ? (
            <EmptyState
              icone="briefcase"
              titre="Aucun besoin pour ces critères"
              description="Essayez un autre métier, élargissez le mot-clé ou décochez le filtre « Urgents »."
              action={{
                libelle: 'Tout voir',
                onClick: () => {
                  setMetier('tous');
                  setTerme('');
                  setUrgentsSeulement(false);
                },
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {liste.map((b) => (
                <CarteBesoin
                  key={b.id}
                  besoin={b}
                  telephone={telephoneDebloque(b.id)}
                  verifEnAttente={Boolean(contacts[String(b.id)]?.transactionId)}
                  enCours={enCours === String(b.id)}
                  indisponible={paiementInfo.configure === false || horsLigne}
                  onDebloquer={() => debloquer(b)}
                  onVerifier={() => verifierPaiement(b)}
                />
              ))}
            </div>
          )}

          <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
            Le numéro reste masqué jusqu’au déblocage. Une fois débloqué, il s’affiche ici et dans
            l’onglet Messages : appelez ou écrivez sur WhatsApp pour convenir de la mission.
          </p>

          <button
            type="button"
            className="btn-ghost mt-3 w-full text-sm"
            onClick={() => setMode('besoin')}
          >
            <Icon name="plus" size={18} />
            Poster un besoin (gratuit)
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Carte d'un besoin : le numéro est masqué tant qu'il n'a pas été débloqué.
 * Aucun état « payé » n'est déduit côté client : tant que le serveur n'a pas
 * renvoyé le numéro, on affiche le cadenas.
 */
function CarteBesoin({
  besoin,
  telephone,
  verifEnAttente,
  enCours,
  indisponible,
  onDebloquer,
  onVerifier,
}) {
  const b = besoin || {};
  const premierContactOffert = b.segment === 'journalier' && b.premierContactGratuit;
  const nombreDeblocages = Number(b.nombreDeblocages) || 0;

  return (
    <article className="carte animate-fade-up p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name={(b.typeAnnonce || 'demande') === 'offre' ? 'briefcase' : 'tools'} size={16} />
          </span>
          <span className="truncate">
            {b.titre || b.metier || 'Main-d’œuvre'}
            {(b.typeAnnonce || 'demande') === 'offre' && (
              <span className="ml-1 align-middle text-[9px] font-bold uppercase text-primary">
                Offre
              </span>
            )}
          </span>
        </h3>
        {b.urgence && (
          <span className="shrink-0 rounded-full bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger">
            URGENT
          </span>
        )}
      </div>

      <p className="mt-1 text-[11px] text-ink-muted">
        {[b.quartier, b.commune].filter(Boolean).join(', ') || 'Abidjan'}
        {b.distanceKm != null && ` · ${formatDistanceKm(b.distanceKm)}`}
        {b.createdAt && ` · ${formatDateRelative(b.createdAt)}`}
      </p>

      <p className="mt-2 text-xs leading-snug text-ink">{b.description}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {b.duree && <TagBadge label={b.duree} taille="sm" icone="clock" />}
        {Number(b.budgetFcfa) > 0 && (
          <TagBadge label={formatFcfa(b.budgetFcfa)} taille="sm" icone="wallet" />
        )}
        {premierContactOffert && <TagBadge label="1er contact offert" taille="sm" icone="check" />}
        {nombreDeblocages > 0 && (
          <TagBadge
            label={`${nombreDeblocages} contact${nombreDeblocages > 1 ? 's' : ''} débloqué${
              nombreDeblocages > 1 ? 's' : ''
            }`}
            taille="sm"
            icone="unlock"
          />
        )}
      </div>

      <p className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-soft text-[9px] font-bold text-primary">
          {initiales(b.nomPosteur || 'Habitant')}
        </span>
        Publié par <span className="font-semibold text-ink">{b.nomPosteur || 'un habitant'}</span>
      </p>

      {telephone ? (
        <div className="mt-2 rounded-md border border-health/40 bg-health-light p-2">
          <p className="flex items-center gap-1 text-[11px] font-bold text-health-dark">
            <Icon name="check" size={14} />
            Contact débloqué
          </p>
          <p className="text-base font-bold text-ink">{formatTelephone(telephone)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a className="btn-health py-2 text-xs" href={`tel:${telephone}`}>
              <Icon name="phone" size={16} />
              Appeler
            </a>
            <a
              className="btn-health-ghost py-2 text-xs"
              href={`https://wa.me/${String(telephone).replace('+', '')}?text=${encodeURIComponent(
                `Bonjour, je vous contacte via Rejoins'Moi pour la mission « ${b.metier} ».`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="whatsapp" size={16} />
              WhatsApp
            </a>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="flex items-center gap-2 rounded-md border border-line bg-soft px-2 py-2 text-[11px] font-semibold text-ink-muted">
            <Icon name="lock" size={16} />
            Numéro masqué : {formatFcfa(FRAIS_DEBLOCAGE)} pour le révéler
          </p>

          {verifEnAttente ? (
            <button
              type="button"
              className="bouton-principal mt-2 w-full text-sm"
              onClick={onVerifier}
              disabled={enCours}
            >
              <Icon name="unlock" size={17} />
              {enCours ? 'Vérification du paiement…' : 'J’ai payé — vérifier mon paiement'}
            </button>
          ) : (
            <button
              type="button"
              className="bouton-principal mt-2 w-full text-sm"
              onClick={onDebloquer}
              disabled={enCours || indisponible}
            >
              <Icon name="unlock" size={17} />
              {enCours
                ? 'Ouverture du paiement…'
                : `Débloquer le contact — ${formatFcfa(FRAIS_DEBLOCAGE)}`}
            </button>
          )}

          <p className="mt-1 text-center text-[10px] text-ink-muted">
            Wave · Orange Money · MTN MoMo · Moov. Le paiement est vérifié côté serveur avant toute
            révélation du numéro.
          </p>
        </div>
      )}
    </article>
  );
}


/**
 * Formulaire de publication d'une annonce. GRATUIT (§2) : aucun paiement ici.
 * La position GPS est obligatoire côté serveur (tri par proximité) : si la
 * géolocalisation est refusée, on publie depuis le centre d'Abidjan en le disant
 * clairement, pour que l'utilisateur corrige le quartier à la main.
 *
 * `typeAnnonceInitial` ('offre' | 'demande') vient de l'URL : la page Jobs renvoie
 * ici avec le bon type déjà choisi — offrir un emploi et chercher un artisan ne
 * remplissent pas le même formulaire dans la tête de l'utilisateur.
 */
function FormulaireBesoin({
  profil,
  position,
  connecte,
  horsLigne,
  typeAnnonceInitial = 'demande',
  onSeConnecter,
  onPublie,
}) {
  const [typeAnnonce, setTypeAnnonce] = useState(typeAnnonceInitial);
  const [form, setForm] = useState({
    metier: METIERS[0] || 'Autre',
    intitule: '',
    description: '',
    urgence: false,
    budgetFcfa: '',
    duree: '',
    commune: '',
    quartier: '',
    telephoneContact: '',
  });
  const [segment, setSegment] = useState('specialise');
  const [envoi, setEnvoi] = useState(false);
  const [retour, setRetour] = useState({ type: '', texte: '' });

  function maj(champ, valeur) {
    setForm((prec) => ({ ...prec, [champ]: valeur }));
  }

  async function publier(evt) {
    evt.preventDefault();
    if (!connecte) {
      onSeConnecter?.();
      return;
    }
    if (form.description.trim().length < 10) {
      setRetour({
        type: 'erreur',
        texte:
          'Décrivez le besoin en une phrase (10 caractères minimum) : c’est ce que liront les artisans.',
      });
      return;
    }
    if (horsLigne) {
      setRetour({
        type: 'erreur',
        texte:
          'Serveur injoignable : le besoin n’a pas été enregistré. Réessayez quand la connexion revient.',
      });
      return;
    }

    setEnvoi(true);
    setRetour({ type: '', texte: '' });
    try {
      const coords = position || CENTRE_ABIDJAN;
      await api.post('/jobs', {
        typeAnnonce,
        metier: form.metier,
        intitule: form.intitule.trim(),
        description: form.description.trim(),
        localisation: { lat: coords.lat, lng: coords.lng },
        urgence: Boolean(form.urgence),
        budgetFcfa: Number(form.budgetFcfa) || 0,
        duree: form.duree,
        commune: form.commune,
        quartier: form.quartier,
        segment,
        telephoneContact: form.telephoneContact.trim() || profil?.telephone,
      });
      setForm((prec) => ({ ...prec, description: '', urgence: false, budgetFcfa: '', duree: '' }));
      await onPublie?.();
    } catch (err) {
      setRetour({
        type: 'erreur',
        texte: err?.message || 'Publication impossible pour le moment.',
      });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={publier} className="flex flex-col gap-3">
      {/* Type d'annonce (ajout du 29/09) : offrir un emploi n'est pas la même
          démarche que chercher un artisan — les deux alimentent la page Jobs. */}
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          Type d’annonce
        </legend>
        <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
          <input
            type="radio"
            name="typeAnnonce"
            value="offre"
            checked={typeAnnonce === 'offre'}
            onChange={() => setTypeAnnonce('offre')}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Offre de boulot
            <span className="block text-[10px] font-normal text-ink-muted">
              J’embauche : poste, salaire et durée (apparaît sous l’onglet « Offres de boulot »).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
          <input
            type="radio"
            name="typeAnnonce"
            value="demande"
            checked={typeAnnonce === 'demande'}
            onChange={() => setTypeAnnonce('demande')}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Demande de main-d’œuvre
            <span className="block text-[10px] font-normal text-ink-muted">
              Je cherche un artisan ou un journalier pour une mission (onglet « Demandes »).
            </span>
          </span>
        </label>
      </fieldset>

      <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
        {typeAnnonce === 'offre' ? 'Intitulé du poste' : 'Intitulé de la mission (facultatif)'}
        <input
          type="text"
          value={form.intitule}
          onChange={(e) => maj('intitule', e.target.value)}
          placeholder={
            typeAnnonce === 'offre' ? 'Vendeuse en boutique' : 'Réparation d’une fuite, 1 journée'
          }
          className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
        />
      </label>
      <InfoBanner variante="succes" titre="Publier un besoin est gratuit">
        Rejoins’Moi ne prend rien sur la publication : vous ne payez que si vous débloquez un
        contact, et les artisans ne paient que le contact qu’ils choisissent.
      </InfoBanner>

      {!position && (
        <InfoBanner variante="alerte" titre="Position GPS indisponible">
          Votre position n’a pas pu être lue : le besoin sera publié depuis le Plateau. Indiquez la
          commune et le quartier pour que les artisans vous situent correctement.
        </InfoBanner>
      )}

      {retour.texte && (
        <InfoBanner
          variante={retour.type === 'erreur' ? 'erreur' : 'succes'}
          titre={retour.type === 'erreur' ? 'Publication impossible' : 'Besoin publié'}
          action={{ libelle: 'OK', onClick: () => setRetour({ type: '', texte: '' }) }}
        >
          {retour.texte}
        </InfoBanner>
      )}

      <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
        Métier recherché
        <select
          value={form.metier}
          onChange={(e) => maj('metier', e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
        >
          {METIERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
        Décrivez le besoin *
        <textarea
          value={form.description}
          onChange={(e) => maj('description', e.target.value)}
          rows={4}
          maxLength={600}
          required
          placeholder="Ex : réparer une fuite sous l’évier de la cuisine, outils non fournis."
          className="mt-1 w-full rounded-md border border-line bg-white p-2 text-sm normal-case text-ink outline-none focus:border-primary"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          Budget (FCFA)
          <input
            type="number"
            min="0"
            step="500"
            inputMode="numeric"
            value={form.budgetFcfa}
            onChange={(e) => maj('budgetFcfa', e.target.value)}
            placeholder="15000"
            className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
          />
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          Durée estimée
          <input
            type="text"
            value={form.duree}
            onChange={(e) => maj('duree', e.target.value)}
            placeholder="2 heures, 1 journée…"
            className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          Commune
          <input
            type="text"
            value={form.commune}
            onChange={(e) => maj('commune', e.target.value)}
            placeholder="Cocody"
            className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
          />
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          Quartier
          <input
            type="text"
            value={form.quartier}
            onChange={(e) => maj('quartier', e.target.value)}
            placeholder="Angré 7e tranche"
            className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
          />
        </label>
      </div>

      <label className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
        Numéro à contacter
        <input
          type="tel"
          value={form.telephoneContact}
          onChange={(e) => maj('telephoneContact', e.target.value)}
          placeholder={profil?.telephone || '+225 07 00 00 00 00'}
          className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2.5 text-sm font-semibold normal-case text-ink outline-none focus:border-primary"
        />
        <span className="mt-1 block text-[10px] font-normal normal-case text-ink-muted">
          Laissez vide pour utiliser le numéro de votre profil.
        </span>
      </label>

      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          Type de mission
        </legend>
        <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
          <input
            type="radio"
            name="segment"
            value="specialise"
            checked={segment === 'specialise'}
            onChange={() => setSegment('specialise')}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Prestation spécialisée
            <span className="block text-[10px] font-normal text-ink-muted">
              Le contact coûte {formatFcfa(FRAIS_DEBLOCAGE)} à la personne qui le débloque.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
          <input
            type="radio"
            name="segment"
            value="journalier"
            checked={segment === 'journalier'}
            onChange={() => setSegment('journalier')}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Mission journalière
            <span className="block text-[10px] font-normal text-ink-muted">
              Le premier contact est offert : le paiement n’intervient qu’après confirmation de la
              mission.
            </span>
          </span>
        </label>
      </fieldset>

      <label className="flex items-center gap-2 text-xs font-semibold text-ink">
        <input
          type="checkbox"
          checked={form.urgence}
          onChange={(e) => maj('urgence', e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        C’est urgent (le besoin remonte en haut de la liste)
      </label>

      <button type="submit" className="bouton-principal w-full text-sm" disabled={envoi}>
        <Icon name="briefcase" size={18} />
        {envoi ? 'Publication…' : connecte ? 'Publier mon besoin' : 'Se connecter pour publier'}
      </button>

      <p className="text-center text-[10px] leading-snug text-ink-muted">
        Votre numéro n’est jamais affiché publiquement : il n’est révélé qu’aux personnes qui
        débloquent le contact.
      </p>
    </form>
  );
}

