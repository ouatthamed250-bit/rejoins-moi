// Jobs.jsx — Page « Jobs » (cahier des charges, ajout du 29/09).
//
// DISTINCTE de JobBoard.jsx (« Main-d'œuvre & métiers ») :
//   • JobBoard : je poste une annonce OU je parcours les besoins de mon quartier,
//     et je paie 500 FCFA par contact débloqué.
//   • Jobs : LE TABLEAU DE BORD DES ANNONCES, en deux sous-onglets —
//       – « Offres de boulot » : emplois proposés par des employeurs
//       – « Demandes de main-d'œuvre » : missions ponctuelles (artisan, journalier)
//     Un ABONNEMENT actif y débloque les contacts sans frais à l'unité.
//
// Accessible UNIQUEMENT depuis le menu hamburger (MenuPrincipal), pas depuis la
// bottom nav : la barre du bas garde son parcours principal (Accueil, Explorer,
// publier, Messages, Profil).
//
// Règles reprises telles quelles :
//  - Les annonces sont gratuites à publier ; chercher est gratuit.
//  - Le contact n'est révélé que par le serveur (paiement vérifié ou abonnement).
//    Voir hooks/useDeblocageContact.js — logique partagée avec JobBoard.
//  - Hors ligne : annonces de démonstration + bandeau, et aucun déblocage possible.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import InfoBanner from '../components/InfoBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import TagBadge from '../components/TagBadge.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { paiementDisponible, FRAIS_DEBLOCAGE } from '../utils/payment.js';
import { chargerFormules, libellePrix, abonnementLocalActif, lireAbonnementLocal } from '../utils/abonnement.js';
import { ABONNEMENT as MIROIR } from '../config/abonnement.js';
import { distanceDepuis, formatDistanceKm } from '../utils/distance.js';
import { formatDateRelative, formatFcfa, formatTelephone, initiales } from '../utils/format.js';
import { filtrerBesoinsDemo, METIERS } from '../data/demoData.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.js';
import { useDeblocageContact } from '../hooks/useDeblocageContact.js';

/** Les deux sous-onglets. `typeAnnonce` est le nom du champ côté API. */
const SOUS_ONGLETS = [
  {
    cle: 'offre',
    libelle: 'Offres de boulot',
    icone: 'briefcase',
    vide: 'Aucune offre de boulot pour ces critères',
  },
  {
    cle: 'demande',
    libelle: 'Demandes de main-d’œuvre',
    icone: 'users',
    vide: 'Aucune demande de main-d’œuvre pour ces critères',
  },
];

export default function Jobs() {
  const navigate = useNavigate();
  const { profil, connecte, estDemo } = useAuth();
  const position = useGeolocation();

  // L'onglet vit dans l'URL : un lien WhatsApp vers les demandes du quartier
  // (?onglet=demande) ouvre directement le bon sous-onglet.
  const [parametres, setParametres] = useSearchParams();
  const onglet = parametres.get('onglet') === 'demande' ? 'demande' : 'offre';

  const [annonces, setAnnonces] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [metier, setMetier] = useState('tous');
  const [terme, setTerme] = useState('');
  const [urgentsSeulement, setUrgentsSeulement] = useState(false);
  const [paiementInfo, setPaiementInfo] = useState({ configure: null, frais: FRAIS_DEBLOCAGE });
  const [abonnement, setAbonnement] = useState(() => ({
    actif: Boolean(profil?.abonnementActif) || abonnementLocalActif(),
    libelle: profil?.abonnement?.libelle || lireAbonnementLocal()?.libelle || MIROIR.libelle,
    finAt: profil?.abonnement?.finAt || lireAbonnementLocal()?.finAt || null,
  }));
  const [formule, setFormule] = useState(MIROIR);

  const {
    enCours,
    erreur,
    message,
    setErreur,
    setMessage,
    telephoneDebloque,
    debloquer,
    verifierPaiement,
    contacts,
  } = useDeblocageContact({
    horsLigne,
    cheminConnexion: '/jobs',
    onDebloque: (besoin, { telephone }) => {
      setAnnonces((prec) =>
        prec.map((a) =>
          String(a.id) === String(besoin.id)
            ? { ...a, telephoneContact: telephone, contactMasque: false, dejaDebloque: true }
            : a
        )
      );
    },
  });


  /** Charge les annonces du sous-onglet actif (offres ou demandes). */
  const charger = useCallback(async () => {
    setChargement(true);
    const coords = position.position;
    try {
      const requete = new URLSearchParams({
        limit: '40',
        statut: 'ouvert',
        typeAnnonce: onglet,
      });
      if (coords) {
        requete.set('lat', coords.lat);
        requete.set('lng', coords.lng);
      }
      const reponse = await api.get(`/jobs?${requete.toString()}`);
      setAnnonces(reponse.items || []);
      setHorsLigne(false);
      if (reponse.abonnementActif !== undefined) {
        setAbonnement({
          actif: Boolean(reponse.abonnementActif),
          libelle: reponse.abonnement?.libelle || MIROIR.libelle,
          finAt: reponse.abonnement?.finAt || null,
        });
      }
    } catch {
      setAnnonces(filtrerBesoinsDemo({ typeAnnonce: onglet }));
      setHorsLigne(true);
    } finally {
      setChargement(false);
    }
  }, [onglet, position.position]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Prix/périodicité de l'abonnement : toujours lus depuis le serveur (source de
  // vérité = backend/src/config/abonnement.js) ; le miroir ne sert qu'hors ligne.
  useEffect(() => {
    let annule = false;
    chargerFormules().then((catalogue) => {
      if (annule) return;
      const serveur = catalogue.formules?.[0];
      if (serveur) setFormule({ ...MIROIR, ...serveur });
    });
    paiementDisponible().then((info) => {
      if (!annule) setPaiementInfo(info);
    });
    return () => {
      annule = true;
    };
  }, []);

  /** Filtres puis tri par proximité (le serveur trie déjà, on reste maître à l'écran). */
  const liste = useMemo(() => {
    const base = horsLigne ? filtrerBesoinsDemo({ metier, q: terme, typeAnnonce: onglet }) : annonces;
    const filtres = base.filter((a) => {
      if (!horsLigne) {
        if (metier !== 'tous' && a.metier !== metier) return false;
        const t = terme.trim().toLowerCase();
        const sac = [a.titre, a.metier, a.description, a.commune, a.quartier].join(' ').toLowerCase();
        if (t && !sac.includes(t)) return false;
      }
      if (urgentsSeulement && !a.urgence) return false;
      return true;
    });
    return filtres
      .map((a) => ({ ...a, distanceKm: a.distanceKm ?? distanceDepuis(position.position, a) }))
      .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }, [annonces, horsLigne, metier, terme, urgentsSeulement, onglet, position.position]);

  const ongletActif = SOUS_ONGLETS.find((o) => o.cle === onglet) || SOUS_ONGLETS[0];

  function changerOnglet(cle) {
    const suivant = new URLSearchParams(parametres);
    suivant.set('onglet', cle);
    setParametres(suivant, { replace: true });
  }

  return (
    <div className="ecran py-3">
      <header className="mb-3">
        <h1 className="text-xl font-bold text-ink">Jobs</h1>
        <p className="text-sm text-ink-muted">
          Les offres de boulot et les demandes de main-d’œuvre autour de vous, dans deux
          sous-onglets. Publier est gratuit ; avec un abonnement, les contacts sont inclus.
        </p>
      </header>

      {/* Sous-onglets : offres de boulot / demandes de main-d'œuvre */}
      <div className="mb-3 grid grid-cols-2 gap-2" role="tablist" aria-label="Type d’annonce">
        {SOUS_ONGLETS.map((sousOnglet) => (
          <button
            key={sousOnglet.cle}
            type="button"
            role="tab"
            aria-selected={onglet === sousOnglet.cle}
            onClick={() => changerOnglet(sousOnglet.cle)}
            className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] font-bold leading-tight transition active:scale-[0.98] ${
              onglet === sousOnglet.cle
                ? 'border-primary bg-primary text-white shadow-card'
                : 'border-line bg-white text-ink hover:bg-soft'
            }`}
          >
            <Icon name={sousOnglet.icone} size={18} />
            {sousOnglet.libelle}
          </button>
        ))}
      </div>

      {/* Abonnement : ce qu'il change pour l'utilisateur, dit franchement. */}
      {abonnement.actif ? (
        <InfoBanner variante="succes" titre={`${abonnement.libelle} actif`} className="mb-3">
          Les contacts de cette page sont inclus : plus de frais à l’unité
          {abonnement.finAt ? ` jusqu’au ${new Date(abonnement.finAt).toLocaleDateString('fr-FR')}` : ''}.
        </InfoBanner>
      ) : (
        <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-2 text-xs font-bold text-ink">
            <Icon name="wallet" size={16} className="text-primary" />
            {formule.libelle} — {libellePrix(formule)}
            {formule.aConfirmer ? ' (tarif provisoire)' : ''}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-ink-muted">
            Sans abonnement, chaque contact reste à {formatFcfa(paiementInfo.frais)}. Avec, les
            offres de boulot et les demandes sont incluses, et votre profil d’artisan est mis en
            avant.
          </p>
          <button
            type="button"
            className="btn-primary mt-2 w-full py-2 text-xs"
            onClick={() =>
              navigate(connecte ? '/profil?section=abonnement' : '/connexion', {
                state: { depuis: '/jobs' },
              })
            }
          >
            <Icon name="unlock" size={16} />
            {connecte ? 'Voir l’abonnement' : 'Se connecter pour s’abonner'}
          </button>
        </div>
      )}

      {horsLigne && (
        <InfoBanner variante="demo" titre="Annonces d’exemple" className="mb-3">
          Serveur injoignable : les annonces ci-dessous viennent du jeu de démonstration et leurs
          contacts ne peuvent pas être débloqués.
        </InfoBanner>
      )}

      {paiementInfo.configure === false && !horsLigne && !abonnement.actif && (
        <InfoBanner variante="alerte" titre="Paiement mobile money non activé" className="mb-3">
          La passerelle Wave / Orange Money n’est pas branchée sur cet environnement : les annonces
          restent consultables, mais aucun contact ne peut être débloqué — et aucun paiement n’est
          simulé.
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
            placeholder={
              onglet === 'offre' ? 'Vendeuse, chauffeur, Zone 4…' : 'Plombier, déchargement, Angré…'
            }
            aria-label="Rechercher une annonce"
            className="w-full rounded-md border border-line bg-white py-2.5 pl-10 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-primary"
          />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            Métier
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
          ? 'Chargement des annonces…'
          : `${liste.length} ${onglet === 'offre' ? 'offre' : 'demande'}${liste.length > 1 ? 's' : ''}${
              position.position && !position.approximatif ? ' · du plus proche au plus loin' : ''
            }`}
        {position.approximatif && !chargement && ' · distances approximatives (Plateau)'}
      </p>

      {chargement ? (
        <EmptyState chargement titre="Recherche des annonces du quartier…" />
      ) : liste.length === 0 ? (
        <EmptyState
          icone={ongletActif.icone}
          titre={ongletActif.vide}
          description="Essayez un autre métier, élargissez le mot-clé ou décochez le filtre « Urgents »."
          action={{
            libelle: 'Publier une annonce (gratuit)',
            onClick: () =>
              navigate(
                `/main-doeuvre?mode=poster&typeAnnonce=${onglet === 'offre' ? 'offre' : 'demande'}`
              ),
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {liste.map((annonce) => (
            <CarteAnnonce
              key={annonce.id}
              annonce={annonce}
              telephone={telephoneDebloque(annonce.id)}
              verifEnAttente={Boolean(contacts[String(annonce.id)]?.transactionId)}
              enCours={enCours === String(annonce.id)}
              frais={paiementInfo.frais}
              abonnementActif={abonnement.actif}
              indisponible={horsLigne || estDemo}
              onDebloquer={() => debloquer(annonce)}
              onVerifier={() => verifierPaiement(annonce)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn-ghost mt-4 w-full text-sm"
        onClick={() =>
          navigate(`/main-doeuvre?mode=poster&typeAnnonce=${onglet === 'offre' ? 'offre' : 'demande'}`)
        }
      >
        <Icon name="plus" size={18} />
        {onglet === 'offre' ? 'Publier une offre de boulot' : 'Publier une demande de main-d’œuvre'}
      </button>

      <p className="mt-3 text-center text-[11px] leading-snug text-ink-muted">
        Les numéros ne sont révélés qu’après un déblocage vérifié côté serveur, ou parce qu’ils sont
        inclus dans votre abonnement.
      </p>
    </div>
  );
}


/**
 * Carte d'annonce (offre de boulot ou demande de main-d'œuvre).
 * Le numéro de contact reste MASQUÉ tant que le serveur ne l'a pas révélé
 * (paiement vérifié ou abonnement actif) — jamais de dissimulation « cosmétique ».
 */
function CarteAnnonce({
  annonce,
  telephone,
  verifEnAttente,
  enCours,
  frais,
  abonnementActif,
  indisponible,
  onDebloquer,
  onVerifier,
}) {
  const offre = (annonce.typeAnnonce || 'demande') === 'offre';
  const titre = annonce.titre || annonce.metier || 'Annonce';
  const montant = Number(annonce.budgetFcfa) > 0 ? formatFcfa(annonce.budgetFcfa) : '';

  return (
    <article className="carte p-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            offre ? 'bg-primary/10 text-primary' : 'bg-health-light text-health-dark'
          }`}
        >
          <Icon name={offre ? 'briefcase' : 'tools'} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-ink">{titre}</span>
            {annonce.urgence && <TagBadge label="Urgent" taille="sm" icone="alert" />}
          </p>
          <p className="text-[11px] font-semibold text-primary">
            {offre ? 'Offre de boulot' : 'Demande de main-d’œuvre'} · {annonce.metier}
          </p>
          <p className="text-[11px] text-ink-muted">
            {[annonce.quartier, annonce.commune].filter(Boolean).join(', ') || 'Abidjan'}
            {annonce.distanceKm != null && ` · ${formatDistanceKm(annonce.distanceKm)}`}
            {annonce.createdAt && ` · ${formatDateRelative(annonce.createdAt)}`}
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs leading-snug text-ink">{annonce.description}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {annonce.duree && <TagBadge label={annonce.duree} taille="sm" icone="clock" />}
        {montant && <TagBadge label={montant} taille="sm" icone="wallet" />}
        {annonce.premierContactGratuit && (
          <TagBadge label="1er contact offert" taille="sm" icone="check" />
        )}
        {Number(annonce.nombreDeblocages) > 0 && (
          <TagBadge
            label={`${annonce.nombreDeblocages} contact${annonce.nombreDeblocages > 1 ? 's' : ''} débloqué${
              annonce.nombreDeblocages > 1 ? 's' : ''
            }`}
            taille="sm"
            icone="unlock"
          />
        )}
        {annonce.debloqueViaAbonnement && (
          <TagBadge label="Inclus dans l’abonnement" taille="sm" icone="wallet" />
        )}
      </div>

      <p className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-soft text-[9px] font-bold text-primary">
          {initiales(annonce.nomPosteur || 'Habitant')}
        </span>
        Publié par <span className="font-semibold text-ink">{annonce.nomPosteur || 'un habitant'}</span>
      </p>

      {telephone ? (
        <div className="mt-2 rounded-md border border-health/40 bg-health-light p-2">
          <p className="flex items-center gap-1 text-[11px] font-bold text-health-dark">
            <Icon name="check" size={14} />
            {abonnementActif ? 'Contact inclus dans votre abonnement' : 'Contact débloqué'}
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
                `Bonjour, je vous contacte via Rejoins'Moi au sujet de « ${titre} ».`
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
            {abonnementActif
              ? 'Inclus dans votre abonnement : débloquez sans payer'
              : `Numéro masqué : ${formatFcfa(frais)} pour le révéler`}
          </p>

          {verifEnAttente ? (
            <button type="button" className="btn-primary mt-2 w-full text-sm" onClick={onVerifier} disabled={enCours}>
              <Icon name="unlock" size={17} />
              {enCours ? 'Vérification du paiement…' : 'J’ai payé — vérifier mon paiement'}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary mt-2 w-full text-sm"
              onClick={onDebloquer}
              disabled={enCours || indisponible}
            >
              <Icon name="unlock" size={17} />
              {enCours
                ? 'Ouverture du paiement…'
                : abonnementActif
                  ? 'Débloquer le contact (inclus)'
                  : `Débloquer le contact — ${formatFcfa(frais)}`}
            </button>
          )}

          <p className="mt-1 text-center text-[10px] text-ink-muted">
            Wave · Orange Money · MTN MoMo · Moov. Le déblocage est vérifié côté serveur avant toute
            révélation du numéro.
          </p>
        </div>
      )}
    </article>
  );
}

