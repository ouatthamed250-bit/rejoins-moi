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
import BlocDepot from '../components/BlocDepot.jsx';
import { Icon } from '../components/Icons.jsx';
import Illustration from '../components/illustrations/Illustration.jsx';
import { dessinDeContexte } from '../components/illustrations/dessinsContexte.js';
import { api } from '../utils/api/client.js';
import { paiementDisponible, FRAIS_DEBLOCAGE } from '../utils/payment.js';
import { abonnementLocalActif, lireAbonnementLocal } from '../utils/abonnement.js';
import { ABONNEMENT as MIROIR } from '../config/abonnement.js';
import { distanceDepuis, formatDistanceKm } from '../utils/distance.js';
import { formatDateRelative, formatFcfa, formatTelephone, formaterNomPublic, initiales } from '../utils/format.js';
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

  // Signalements (prompt 7) : mémorisés par identifiant d'annonce, le temps de la
  // visite, pour ne pas envoyer deux fois le même signalement depuis cet écran.
  const [signalements, setSignalements] = useState({});
  const [signalementEnCours, setSignalementEnCours] = useState('');

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
    maDemande,
    demanderDepot,
    verifierMaDemande,
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


  /**
   * Signale une annonce (prompt 7). Aucun compte n'est exigé côté serveur : le
   * signalement est compté puis examiné dans le back-office, qui retire l'annonce.
   * On met à jour le compteur local pour que la carte reflète l'envoi sans recharger.
   */
  async function signaler(annonce) {
    const cle = String(annonce.id);
    if (signalements[cle]) return;
    setSignalementEnCours(cle);
    try {
      const reponse = await api.post(`/jobs/${annonce.id}/signaler`, {});
      setSignalements((prec) => ({ ...prec, [cle]: true }));
      setAnnonces((prec) =>
        prec.map((a) =>
          String(a.id) === cle
            ? {
                ...a,
                signalements: Number(reponse?.signalements) || (Number(a.signalements) || 0) + 1,
              }
            : a
        )
      );
      setMessage(reponse?.message || 'Merci : votre signalement a été transmis à notre équipe.');
    } catch (err) {
      setErreur(err?.message || 'Signalement impossible pour le moment.');
    } finally {
      setSignalementEnCours('');
    }
  }

  /**
   * Charge les annonces du sous-onglet actif (offres ou demandes).
   */
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

  // Paiement : le serveur dit si la gratuité court (`modeGratuit`). Aucun catalogue
  // d'abonnement n'est chargé ici : plus aucun prix n'est affiché sur cette page.
  useEffect(() => {
    let annule = false;
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
          sous-onglets.
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

      {/* Aucun bandeau de tarif ni de gratuité : l'accès au contact est direct. */}

      {horsLigne && (
        <InfoBanner variante="demo" titre="Annonces d’exemple" className="mb-3" illustration="horsLigne">
          Serveur injoignable : les annonces ci-dessous viennent du jeu de démonstration et leurs
          contacts ne peuvent pas être débloqués.
        </InfoBanner>
      )}

      {paiementInfo.gratuit === false && paiementInfo.configure === false && !horsLigne && !abonnement.actif && (
        <InfoBanner variante="info" titre="Payer par dépôt mobile money" className="mb-3" illustration="mobileMoney">
          La passerelle automatique n’est pas encore branchée : envoyez les{' '}
          {formatFcfa(paiementInfo.frais)} au numéro Wave / Orange Money / MTN MoMo affiché sur
          l’annonce, puis déclarez votre paiement. Notre équipe le vérifie et le numéro de contact
          s’affiche ensuite dans l’app. Aucun paiement n’est simulé.
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
              position.position && !position.depuisCache ? ' · du plus proche au plus loin' : ''
            }`}
        {position.depuisCache && !chargement && ' · distances basées sur votre dernière position'}
      </p>

      {chargement ? (
        <EmptyState chargement titre="Recherche des annonces du quartier…" />
      ) : liste.length === 0 ? (
        <EmptyState
          icone={ongletActif.icone}
          titre={ongletActif.vide}
          description="Essayez un autre métier, élargissez le mot-clé ou décochez le filtre « Urgents »."
          action={{
            libelle: 'Publier une annonce',
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
              gratuit={paiementInfo.gratuit !== false}
              indisponible={horsLigne || estDemo}
              modeDepot={paiementInfo.mode === 'depot' && paiementInfo.gratuit === false && !abonnement.actif}
              depots={paiementInfo.depots}
              support={paiementInfo.support}
              demande={maDemande(annonce.id)}
              onDeclarerDepot={(infos) => demanderDepot(annonce, infos)}
              onVerifierDepot={() => verifierMaDemande(annonce)}
              onDebloquer={() => debloquer(annonce)}
              onVerifier={() => verifierPaiement(annonce)}
              onSignaler={() => signaler(annonce)}
              signale={Boolean(signalements[String(annonce.id)])}
              envoiSignalement={signalementEnCours === String(annonce.id)}
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
          Les numéros ne s’affichent qu’après votre demande de contact, vérifiée côté serveur.
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
  gratuit,
  indisponible,
  modeDepot,
  depots,
  support,
  demande,
  onDeclarerDepot,
  onVerifierDepot,
  onDebloquer,
  onVerifier,
  onSignaler,
  signale,
  envoiSignalement,
}) {
  const stage = annonce.typeAnnonce === 'stage';
  const offre = (annonce.typeAnnonce || 'demande') === 'offre' || stage;
  const titre = annonce.titre || annonce.metier || 'Annonce';
  // Pastille de l'annonce : le dessin du MÉTIER (« Plombier » → plomberie,
  // « Coiffeur » → salonBeaute…) plutôt qu'une icône générique. Repli sur l'icône
  // quand le métier n'a pas de trace dédiée : aucun trou, aucun cadre vide.
  const dessinMetier = dessinDeContexte({ metier: annonce.metier });
  const montant = Number(annonce.budgetFcfa) > 0 ? formatFcfa(annonce.budgetFcfa) : '';
  // Nom affiché de l'auteur : un compte créé avec son NUMÉRO dans le champ « nom »
  // ne doit pas l'exposer ici — le contact passe par le déblocage payant (§2).
  const nomPosteurPublic = formaterNomPublic(annonce.nomPosteur);
  // Numéro affichable tout de suite : soit il vient du déblocage côté serveur, soit
  // l'auteur a coché « J'accepte que mon numéro soit visible » (contactPublic). Un
  // numéro jamais consenti reste masqué : le drapeau vient du serveur, pas du client.
  const numeroAffiche = telephone || (annonce.contactPublic ? annonce.telephoneContact : '');

  return (
    <article className="carte p-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            offre ? 'bg-primary/10 text-primary' : 'bg-health-light text-health-dark'
          }`}
        >
          {dessinMetier ? (
            <Illustration nom={dessinMetier} taille={26} trait={1.2} className="opacity-90" />
          ) : (
            <Icon name={offre ? 'briefcase' : 'tools'} size={17} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-ink">{titre}</span>
            {annonce.urgence && <TagBadge label="Urgent" taille="sm" icone="alert" />}
          </p>
          <p className="text-[11px] font-semibold text-primary">
            {stage ? 'Offre de stage' : offre ? 'Offre de boulot' : 'Demande de main-d’œuvre'} · {annonce.metier}
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
          <TagBadge label="1er contact inclus" taille="sm" icone="check" />
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
          {initiales(nomPosteurPublic || 'Habitant')}
        </span>
        Publié par <span className="font-semibold text-ink">{nomPosteurPublic || 'un habitant'}</span>
      </p>

      {numeroAffiche ? (
        <div className="mt-2 rounded-md border border-health/40 bg-health-light p-2">
          <p className="flex items-center gap-1 text-[11px] font-bold text-health-dark">
            <Icon name="check" size={14} />
            {telephone
              ? abonnementActif
                ? 'Contact inclus dans votre abonnement'
                : 'Contact débloqué'
              : 'Numéro publié par l’auteur'}
          </p>
          <p className="text-base font-bold text-ink">{formatTelephone(numeroAffiche)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a className="btn-health py-2 text-xs" href={`tel:${numeroAffiche}`}>
              <Icon name="phone" size={16} />
              Appeler
            </a>
            <a
              className="btn-health-ghost py-2 text-xs"
              href={`https://wa.me/${String(numeroAffiche).replace('+', '')}?text=${encodeURIComponent(
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
            {gratuit
              ? 'Contact masqué : cliquez pour le voir'
              : abonnementActif
                ? 'Contact masqué : inclus dans votre abonnement'
                : `Contact masqué : ${formatFcfa(frais)} pour le voir`}
          </p>

          {gratuit ? (
            <button
              type="button"
              className="bouton-principal mt-2 w-full text-sm"
              onClick={onDebloquer}
              disabled={enCours || indisponible}
            >
              <Icon name="unlock" size={17} />
              {enCours ? 'Ouverture du contact…' : 'Voir le contact'}
            </button>
          ) : modeDepot ? (
            <BlocDepot
              montant={frais}
              depots={depots}
              support={support}
              demande={demande}
              enCours={enCours}
              onDeclarer={onDeclarerDepot}
              onVerifier={onVerifierDepot}
            />
          ) : verifEnAttente ? (
            <button type="button" className="bouton-principal mt-2 w-full text-sm" onClick={onVerifier} disabled={enCours}>
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
                : abonnementActif
                  ? 'Débloquer le contact (inclus)'
                  : `Débloquer le contact — ${formatFcfa(frais)}`}
            </button>
          )}

          <p className="mt-1 text-center text-[10px] text-ink-muted">
            {gratuit
              ? 'La révélation du numéro est enregistrée côté serveur.'
              : modeDepot
                ? 'Le déblocage est vérifié par notre équipe avant toute révélation du numéro.'
                : 'Wave · Orange Money · MTN MoMo · Moov. Le déblocage est vérifié côté serveur avant toute révélation du numéro.'}
          </p>
        </div>
      )}

      {/* Signalement (prompt 7) : accessible à tous, sans quitter la liste. Le
          serveur ne garde qu'un compteur — le back-office examine et retire. */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <p className="text-[10px] leading-snug text-ink-muted">
          {Number(annonce.signalements) > 0
            ? `Annonce signalée ${annonce.signalements} fois`
            : 'Annonce douteuse ? Signalez-la.'}
        </p>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-ink-muted underline disabled:opacity-60"
          onClick={onSignaler}
          disabled={signale || envoiSignalement}
        >
          <Icon name="flag" size={12} />
          {signale ? 'Signalée' : envoiSignalement ? 'Envoi…' : 'Signaler'}
        </button>
      </div>
    </article>
  );
}

