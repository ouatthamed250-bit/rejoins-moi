// AgentApp.jsx — ESPACE AGENT DE TERRAIN (route /agent).
//
// Ce que fait cet écran, et rien d'autre :
//   1. CONNEXION / ACTIVATION : l'agent se connecte avec son numéro et son mot de
//      passe. Si son compte est encore « en attente », le champ « code
//      d'activation » apparaît : ce code est remis par l'administrateur (voir
//      Admin → Agents de terrain → « Générer un code »). Sans lui, le compte ne
//      s'ouvre pas — c'est ce qui empêche quelqu'un de se proclamer agent.
//   2. PRISE DE SERVICE : un bouton demande la position GPS et prévient le
//      back-office (`enService: true`). Pendant le service, la position est
//      renvoyée toutes les 5 minutes, ce qui alimente la carte des agents.
//   3. INSCRIRE UN COMMERCE : nom, catégorie, téléphone, photos, position GPS,
//      produits/services, puis le bloc « compte du gérant » (nom, téléphone,
//      mot de passe). Le mot de passe est TAPÉ PAR LE COMMERÇANT : l'agent ne le
//      connaît jamais.
//   4. AUTO-DÉCONNEXION : après création, l'écran affiche « Fiche créée avec
//      succès. Le gérant peut se connecter. » et la session agent est vidée
//      (localStorage). Le téléphone est ainsi prêt pour le commerce suivant.
//
// Pourquoi aucun BottomNav : un agent en tournée n'a rien à faire dans
// l'annuaire public. L'écran est plein écran et sa navigation est réduite aux
// gestes de la tournée (service, fiche, mes fiches, déconnexion).

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';

import PhotoUploadField from '../components/PhotoUploadField.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import { Icon } from '../components/Icons.jsx';
import {
  agentsApi,
  deconnexionAgent,
  getAgentProfil,
  getAgentToken,
  setAgentProfil,
  setAgentToken,
} from '../utils/api/agents.js';
import { FAMILLES_VISIBLES, sousCategoriesDe } from '../config/categories.js';
import { TAGS_PAR_CATEGORIE } from '../data/demoData.js';
import { formatTelephone } from '../utils/format.js';

// Leaflet ne descend PAS dans le paquet initial : l'agent n'ouvre la carte que
// pour placer le commerce (même parti pris que l'inscription gérant).
const ChoisirPosition = lazy(() => import('../components/ChoisirPosition.jsx'));

/** Position envoyée toutes les 5 minutes pendant le service (exigence produit). */
const INTERVALLE_POINTAGE_MS = 5 * 60 * 1000;

/** Longueur minimale du mot de passe (alignée sur le serveur). */
const LONGUEUR_MIN_MOT_DE_PASSE = 8;

/**
 * Position GPS réelle de l'appareil, sans jamais en inventer une.
 * `enableHighAccuracy` : en tournée, un point réseau à 500 m placerait le
 * commerce dans la mauvaise rue. On préfère attendre l'accroche GPS.
 */
function positionActuelle({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error("La géolocalisation n'est pas disponible sur cet appareil."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: Math.round(pos.coords.accuracy || 0),
        }),
      (err) => {
        if (err?.code === 1) {
          reject(
            new Error(
              'Localisation refusée. Autorisez la position pour ce site dans les réglages du navigateur, puis réessayez.'
            )
          );
          return;
        }
        reject(new Error('Position GPS introuvable. Sortez à l’air libre ou placez le repère sur la carte.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

/** Champ de formulaire avec libellé, utilisé partout dans l'écran. */
function Champ({ libelle, aide = '', children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-muted">{libelle}</span>
      {children}
      {aide ? <span className="mt-1 block text-[11px] leading-snug text-ink-muted">{aide}</span> : null}
    </label>
  );
}

const CLASSE_ENTREE =
  'w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-primary';

export default function AgentApp() {
  const [agent, setAgent] = useState(() => (getAgentToken() ? getAgentProfil() : null));
  const [chargement, setChargement] = useState(Boolean(getAgentToken()));
  const [ecran, setEcran] = useState('connexion'); // connexion | inscription | activation
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  // Écran de fin : la fiche est créée, la session est déjà fermée.
  const [succes, setSucces] = useState(null);
  const [enCours, setEnCours] = useState(false);

  const [formulaire, setFormulaire] = useState({
    nom: '',
    telephone: '',
    motDePasse: '',
    motDePasse2: '',
    codeActivation: '',
  });

  const memoriser = useCallback((agentRecu, token) => {
    if (token) setAgentToken(token);
    setAgentProfil(agentRecu);
    setAgent(agentRecu);
  }, []);

  // ── Session existante : on la revérifie auprès du serveur ────────────────
  // Un agent suspendu pendant la nuit ne doit pas retrouver un tableau de bord
  // qui a l'air actif : le serveur répond 403 et la session locale est vidée.
  useEffect(() => {
    if (!getAgentToken()) {
      setChargement(false);
      return undefined;
    }
    let vivant = true;
    agentsApi
      .moi()
      .then((reponse) => {
        if (!vivant) return;
        memoriser(reponse.agent);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant) return;
        if (err?.status === 401 || err?.code === 'AGENT_SUSPENDU') {
          deconnexionAgent();
          setAgent(null);
        }
        setErreur(err?.message || 'Session agent indisponible.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [memoriser]);

  function maj(champ, valeur) {
    setFormulaire((prec) => ({ ...prec, [champ]: valeur }));
  }

  function seDeconnecter(texte = '') {
    deconnexionAgent();
    setAgent(null);
    setSucces(null);
    setEcran('connexion');
    setFormulaire({ nom: '', telephone: '', motDePasse: '', motDePasse2: '', codeActivation: '' });
    setMessage(texte);
    setErreur('');
  }

  // ── Connexion ────────────────────────────────────────────────────────────
  async function connecter(evt) {
    evt.preventDefault();
    setErreur('');
    setMessage('');
    setEnCours(true);
    try {
      const reponse = await agentsApi.login(formulaire.telephone, formulaire.motDePasse);
      memoriser(reponse.agent, reponse.token);
      setFormulaire((prec) => ({ ...prec, motDePasse: '', motDePasse2: '', codeActivation: '' }));
    } catch (err) {
      // Compte en attente : on garde le numéro et le mot de passe saisis et on
      // ouvre le champ « code d'activation » — l'agent n'a rien à retaper.
      if (err?.code === 'AGENT_EN_ATTENTE') {
        setEcran('activation');
        setMessage(err.message);
      } else {
        setErreur(err?.message || 'Connexion impossible.');
      }
    } finally {
      setEnCours(false);
    }
  }

  // ── Inscription (compte en attente, aucun jeton) ─────────────────────────
  async function inscrire(evt) {
    evt.preventDefault();
    setErreur('');
    setMessage('');
    if (formulaire.motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      setErreur(`Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`);
      return;
    }
    if (formulaire.motDePasse !== formulaire.motDePasse2) {
      setErreur('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setEnCours(true);
    try {
      const reponse = await agentsApi.register({
        nom: formulaire.nom,
        telephone: formulaire.telephone,
        motDePasse: formulaire.motDePasse,
      });
      setMessage(reponse?.message || 'Compte créé. Il reste à l’activer avec le code de l’administrateur.');
      setEcran('activation');
    } catch (err) {
      setErreur(err?.message || 'Inscription impossible.');
    } finally {
      setEnCours(false);
    }
  }

  // ── Activation par code ─────────────────────────────────────────────────
  async function activer(evt) {
    evt.preventDefault();
    setErreur('');
    setEnCours(true);
    try {
      const reponse = await agentsApi.activer({
        telephone: formulaire.telephone,
        motDePasse: formulaire.motDePasse,
        codeActivation: formulaire.codeActivation,
      });
      memoriser(reponse.agent, reponse.token);
      setMessage(reponse?.message || 'Compte activé.');
      setFormulaire((prec) => ({ ...prec, motDePasse: '', motDePasse2: '', codeActivation: '' }));
    } catch (err) {
      setErreur(err?.message || 'Activation impossible.');
    } finally {
      setEnCours(false);
    }
  }

  /** Fin de parcours : la fiche est créée, on vide la session agent. */
  function ficheCreee(reponse) {
    deconnexionAgent();
    setAgent(null);
    setSucces(reponse);
    setEcran('connexion');
    setFormulaire({ nom: '', telephone: '', motDePasse: '', motDePasse2: '', codeActivation: '' });
    setMessage('');
    setErreur('');
  }

  if (chargement) {
    return (
      <div className="ecran flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
        <Icon name="loader" size={18} />
        Vérification de votre session…
      </div>
    );
  }

  // ── Écran de fin : succès, session fermée ────────────────────────────────
  if (succes) {
    return (
      <div className="ecran py-8">
        <div className="rounded-md border border-line bg-white p-5 text-center shadow-card">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="check" size={30} />
          </span>
          <h1 className="text-lg font-bold text-ink">Fiche créée avec succès.</h1>
          <p className="mt-1 text-sm text-ink-muted">Le gérant peut se connecter.</p>
          {succes.fiche?.nom ? (
            <p className="mt-3 rounded-md bg-soft px-3 py-2 text-sm font-semibold text-ink">
              {succes.fiche.nom}
              {succes.gerant?.telephone ? (
                <span className="block text-xs font-normal text-ink-muted">
                  Compte gérant : {formatTelephone(succes.gerant.telephone)}
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="mt-3 text-[11px] leading-snug text-ink-muted">
            Votre session a été fermée automatiquement : le téléphone est propre pour le prochain commerce.
          </p>
          <button
            type="button"
            className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-white"
            onClick={() => seDeconnecter('Vous pouvez vous reconnecter pour une nouvelle fiche.')}
          >
            Revenir à la connexion
          </button>
        </div>
      </div>
    );
  }

  // ── Tableau de bord de l'agent connecté ─────────────────────────────────
  if (agent) {
    return (
      <TableauDeBord
        agent={agent}
        onAgent={(agentMisAJour) => memoriser(agentMisAJour)}
        onDeconnexion={seDeconnecter}
        onFicheCreee={ficheCreee}
      />
    );
  }

  // ── Connexion / inscription / activation ────────────────────────────────
  return (
    <div className="ecran py-5">
      <h1 className="text-xl font-bold text-ink">Espace agent de terrain</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Réservé aux agents de Rejoins’Moi. L’accès est validé par un code d’activation remis par
        l’administrateur.
      </p>

      {message ? (
        <InfoBanner variante="info" titre="À savoir" className="mb-3">
          {message}
        </InfoBanner>
      ) : null}
      {erreur ? (
        <InfoBanner variante="erreur" titre="Action impossible" className="mb-3">
          {erreur}
        </InfoBanner>
      ) : null}

      {ecran !== 'activation' ? (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-soft p-1">
          {[
            { cle: 'connexion', libelle: 'Se connecter' },
            { cle: 'inscription', libelle: 'Devenir agent' },
          ].map((onglet) => (
            <button
              key={onglet.cle}
              type="button"
              onClick={() => {
                setEcran(onglet.cle);
                setErreur('');
                setMessage('');
              }}
              className={`rounded-sm px-3 py-2 text-sm font-bold transition ${
                ecran === onglet.cle ? 'bg-white text-primary shadow-card' : 'text-ink-muted'
              }`}
            >
              {onglet.libelle}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="space-y-3 rounded-md border border-line bg-white p-4 shadow-card"
        onSubmit={ecran === 'connexion' ? connecter : ecran === 'inscription' ? inscrire : activer}
      >
        {ecran === 'inscription' ? (
          <Champ libelle="Nom complet">
            <input
              className={CLASSE_ENTREE}
              type="text"
              value={formulaire.nom}
              onChange={(e) => maj('nom', e.target.value)}
              maxLength={80}
              autoComplete="name"
              required
            />
          </Champ>
        ) : null}

        <Champ libelle="Numéro de téléphone" aide="Ex. 07 07 12 34 56">
          <input
            className={CLASSE_ENTREE}
            type="tel"
            inputMode="tel"
            value={formulaire.telephone}
            onChange={(e) => maj('telephone', e.target.value)}
            autoComplete="tel"
            required
          />
        </Champ>

        <Champ
          libelle="Mot de passe"
          aide={
            ecran === 'activation'
              ? 'Celui choisi à l’inscription, ou celui que vous définissez maintenant.'
              : ''
          }
        >
          <input
            className={CLASSE_ENTREE}
            type="password"
            value={formulaire.motDePasse}
            onChange={(e) => maj('motDePasse', e.target.value)}
            autoComplete={ecran === 'inscription' ? 'new-password' : 'current-password'}
            required
          />
        </Champ>

        {ecran === 'inscription' ? (
          <Champ libelle="Confirmer le mot de passe">
            <input
              className={CLASSE_ENTREE}
              type="password"
              value={formulaire.motDePasse2}
              onChange={(e) => maj('motDePasse2', e.target.value)}
              autoComplete="new-password"
              required
            />
          </Champ>
        ) : null}

        {ecran === 'activation' ? (
          <Champ
            libelle="Code d’activation"
            aide="Code de 8 caractères fourni par l’administrateur (ex. AG7K2M9P)."
          >
            <input
              className={`${CLASSE_ENTREE} uppercase tracking-[0.3em]`}
              type="text"
              value={formulaire.codeActivation}
              onChange={(e) => maj('codeActivation', e.target.value.toUpperCase())}
              maxLength={8}
              autoCapitalize="characters"
              required
            />
          </Champ>
        ) : null}

        <button
          type="submit"
          disabled={enCours}
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {enCours
            ? 'Veuillez patienter…'
            : ecran === 'connexion'
              ? 'Se connecter'
              : ecran === 'inscription'
                ? 'Créer mon compte agent'
                : 'Activer mon compte'}
        </button>

        {ecran === 'activation' ? (
          <button
            type="button"
            className="w-full text-xs font-semibold text-ink-muted underline"
            onClick={() => {
              setEcran('connexion');
              setMessage('');
              setErreur('');
            }}
          >
            Revenir à la connexion
          </button>
        ) : null}
      </form>

      <p className="mt-4 text-[11px] leading-snug text-ink-muted">
        Un agent ne peut pas s’activer seul : le code d’activation est généré par l’équipe
        Rejoins’Moi. Les fiches créées sont rattachées à votre code agent, qui sert de base au
        paiement de vos tournées.
      </p>
    </div>
  );
}

/** « 14:32 » — heure courte d'Abidjan, pour le dernier pointage. */
function heureCourte(valeur) {
  if (!valeur) return '—';
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d);
}

/**
 * Tableau de bord de l'agent connecté.
 *
 * Le minuteur de pointage vit ICI (et non dans AgentApp) : il ne doit tourner que
 * lorsque l'agent est en service, et s'arrêter net au départ ou à la fermeture de
 * l'onglet. Aucune position n'est envoyée hors service.
 */
function TableauDeBord({ agent, onAgent, onDeconnexion, onFicheCreee }) {
  const [enService, setEnService] = useState(Boolean(agent.enService));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [dernierPointage, setDernierPointage] = useState(agent.dernierePosition?.updatedAt || null);
  const [pointagesEnvoyes, setPointagesEnvoyes] = useState(0);
  const [fiches, setFiches] = useState(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  /** Envoie la position courante. Lève si le GPS refuse : l'appelant explique. */
  const envoyerPointage = useCallback(async (enServiceDemande) => {
    const coords = await positionActuelle();
    const reponse = await agentsApi.pointage({
      lat: coords.lat,
      lng: coords.lng,
      enService: enServiceDemande,
    });
    setEnService(Boolean(reponse.enService));
    if (reponse.dernierePosition?.updatedAt) setDernierPointage(reponse.dernierePosition.updatedAt);
    setPointagesEnvoyes((n) => n + 1);
    return reponse;
  }, []);

  // Mes fiches : chargées une fois à l'ouverture (la session se ferme après
  // chaque création, la liste ne peut donc pas changer pendant qu'on la regarde).
  useEffect(() => {
    let vivant = true;
    agentsApi
      .mesFiches()
      .then((reponse) => {
        if (vivant) setFiches(reponse);
      })
      .catch(() => {
        /* la liste est une commodité : un échec ne bloque pas la tournée */
      });
    return () => {
      vivant = false;
    };
  }, []);

  // Pointage automatique toutes les 5 minutes, UNIQUEMENT en service.
  useEffect(() => {
    if (!enService) return undefined;
    let vivant = true;
    const minuterie = setInterval(async () => {
      try {
        const coords = await positionActuelle();
        if (!vivant) return;
        const reponse = await agentsApi.pointage({ lat: coords.lat, lng: coords.lng, enService: true });
        if (!vivant) return;
        if (reponse.dernierePosition?.updatedAt) setDernierPointage(reponse.dernierePosition.updatedAt);
        setPointagesEnvoyes((n) => n + 1);
        setErreur('');
      } catch (err) {
        // On n'interrompt PAS le service : le téléphone peut être rentré dans une
        // boutique sans réseau GPS. L'agent voit l'erreur et continue sa fiche.
        if (vivant) setErreur(`Pointage impossible : ${err.message}`);
      }
    }, INTERVALLE_POINTAGE_MS);
    return () => {
      vivant = false;
      clearInterval(minuterie);
    };
  }, [enService]);

  // Retour au premier plan : un téléphone verrouillé suspend les minuteurs. On
  // renvoie donc une position dès que l'écran redevient visible.
  useEffect(() => {
    if (!enService) return undefined;
    function surVisibilite() {
      if (document.visibilityState !== 'visible') return;
      envoyerPointage(true).catch((err) => setErreur(`Pointage impossible : ${err.message}`));
    }
    document.addEventListener('visibilitychange', surVisibilite);
    return () => document.removeEventListener('visibilitychange', surVisibilite);
  }, [enService, envoyerPointage]);

  async function prendreService() {
    setEnCours(true);
    setErreur('');
    setMessage('');
    try {
      await envoyerPointage(true);
      setMessage('Service commencé. Votre position est envoyée toutes les 5 minutes.');
      // Profil rafraîchi : `enService` survit ainsi à un rechargement de page.
      const profil = await agentsApi.moi().catch(() => null);
      if (profil?.agent) onAgent(profil.agent);
    } catch (err) {
      setErreur(err?.message || 'Impossible de démarrer le service.');
    } finally {
      setEnCours(false);
    }
  }

  async function terminerService() {
    setEnCours(true);
    setErreur('');
    setMessage('');
    try {
      // Dernière position si elle est disponible ; le départ est accepté sans GPS
      // (on ne retient personne sur la carte parce que le réseau a lâché).
      let coords = null;
      try {
        coords = await positionActuelle({ timeout: 8000 });
      } catch {
        coords = null;
      }
      const reponse = await agentsApi.pointage({
        lat: coords?.lat,
        lng: coords?.lng,
        enService: false,
      });
      setEnService(false);
      setMessage(reponse?.message || 'Service terminé. Vous n’êtes plus suivi sur la carte.');
      const profil = await agentsApi.moi().catch(() => null);
      if (profil?.agent) onAgent(profil.agent);
    } catch (err) {
      setErreur(err?.message || 'Impossible de terminer le service.');
    } finally {
      setEnCours(false);
    }
  }

  // ── Écran de création de fiche (plein écran dans l'espace agent) ──────────
  if (formulaireOuvert) {
    return (
      <FormulaireFiche
        agent={agent}
        onRetour={() => setFormulaireOuvert(false)}
        onFicheCreee={onFicheCreee}
      />
    );
  }

  const totalFiches = fiches?.total;
  const dernieresFiches = (fiches?.items || []).slice(0, 4);
  const position = agent.dernierePosition || null;

  return (
    <div className="ecran py-4">
      {/* En-tête : le code agent reste sous les yeux en permanence. C'est lui qui
          est recopié sur chaque fiche, donc la clé du paiement de la tournée. */}
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            Espace agent de terrain
          </p>
          <h1 className="truncate text-xl font-bold text-ink">{agent.nom}</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Code agent <strong className="tracking-[0.2em] text-ink">{agent.code}</strong>
            {agent.telephone ? ` · ${formatTelephone(agent.telephone)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDeconnexion()}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-bold text-ink-muted"
        >
          <Icon name="logOut" size={14} />
          Quitter
        </button>
      </header>

      {message ? (
        <InfoBanner variante="succes" titre="C’est noté" className="mb-3">
          {message}
        </InfoBanner>
      ) : null}
      {erreur ? (
        <InfoBanner variante="erreur" titre="À corriger" className="mb-3">
          {erreur}
        </InfoBanner>
      ) : null}

      {/* Service : un seul geste, et il est explicite. Aucune position n'est
          envoyée hors service (voir le minuteur plus haut). */}
      <section className="rounded-md border border-line bg-white p-4 shadow-card">
        <div className="flex items-start gap-2">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              enService ? 'bg-health/10 text-health-dark' : 'bg-soft text-ink-muted'
            }`}
          >
            <Icon name={enService ? 'mapPin' : 'clock'} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">
              {enService ? 'Service en cours' : 'Vous n’êtes pas en service'}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
              {enService
                ? `Position envoyée toutes les 5 minutes · dernier pointage ${heureCourte(dernierPointage)}`
                : 'Prenez votre service pour apparaître sur la carte de l’équipe et compter vos fiches du jour.'}
            </p>
            {enService && position ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                Dernière position : {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          disabled={enCours}
          onClick={enService ? terminerService : prendreService}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-bold text-white disabled:opacity-60 ${
            enService ? 'bg-ink' : 'bg-primary'
          }`}
        >
          <Icon name={enCours ? 'loader' : enService ? 'check' : 'mapPin'} size={16} />
          {enCours
            ? 'Veuillez patienter…'
            : enService
              ? 'Terminer mon service'
              : 'Prendre mon service'}
        </button>
        {enService ? (
          <p className="mt-2 text-[11px] text-ink-muted">
            {pointagesEnvoyes} pointage(s) envoyé(s) depuis la prise de service.
          </p>
        ) : null}
      </section>

      {/* Le geste qui rapporte : inscrire le commerce du client. */}
      <button
        type="button"
        onClick={() => setFormulaireOuvert(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-left"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <Icon name="store" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">Inscrire un commerce</span>
          <span className="block text-[11px] leading-snug text-ink-muted">
            Fiche + compte du gérant, en une seule visite. La session se ferme après.
          </span>
        </span>
        <Icon name="chevronRight" size={18} />
      </button>


      {/* Mes fiches : ce que le code a déjà produit (base de la paie). */}
      <section className="mt-3 rounded-md border border-line bg-white p-4 shadow-card">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-ink">Mes fiches</p>
          <span className="text-xs font-bold text-ink-muted">
            {totalFiches == null ? '—' : `${totalFiches} au total`}
          </span>
        </div>
        {fiches == null ? (
          <p className="text-[11px] text-ink-muted">Chargement de vos fiches…</p>
        ) : dernieresFiches.length === 0 ? (
          <p className="text-[11px] leading-snug text-ink-muted">
            Aucune fiche pour l’instant. Votre première inscription apparaîtra ici.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {dernieresFiches.map((fiche) => (
              <li key={fiche.id} className="flex items-center gap-2 py-2">
                <Icon name="store" size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {fiche.nom}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {[fiche.sousCategorie, fiche.quartier, fiche.commune]
                      .filter(Boolean)
                      .join(' · ') || 'quartier non précisé'}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-muted">
                  {dateCourte(fiche.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {totalFiches != null && totalFiches > dernieresFiches.length ? (
          <p className="mt-2 text-[11px] text-ink-muted">
            Les {dernieresFiches.length} plus récentes sont affichées.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** « 12 nov. » — date courte d'une fiche, dans la liste de l'agent. */
function dateCourte(valeur) {
  if (!valeur) return '—';
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(d);
}


/**
 * Suggestions de produits/services par famille.
 *
 * `data/demoData.js` ne déclare des listes que pour les familles historiques
 * (alimentation, beaute, services, artisanat…). Les trois familles locales qui
 * portent l'essentiel des fiches n'en avaient pas : sur le terrain, l'agent
 * n'aurait eu AUCUNE pastille à toucher. On complète donc ici, sans toucher au
 * jeu de données partagé ; la saisie libre reste possible dans tous les cas.
 */
const SUGGESTIONS_LOCALES = {
  restauration: [
    'Attiéké',
    'Poisson braisé',
    'Poulet braisé',
    'Garba',
    'Alloco',
    'Spaghetti',
    'Riz sauce',
    'Baguette',
    'Café',
    'Jus naturel',
    'Eau minérale',
    'Sucrerie',
  ],
  commerces: [
    'Vêtements',
    'Chaussures',
    'Sacs',
    'Bijoux',
    'Tissu pagne',
    'Cosmétiques',
    'Produits ménagers',
    'Accessoires téléphone',
    'Papeterie',
    'Quincaillerie',
  ],
  proximite: [
    'Clé minute',
    'Photocopie',
    'Impression',
    'Recharge crédit',
    'Transfert d’argent',
    'Pressing',
    'Lavage auto',
    'Réparation téléphone',
    'Couture',
    'Livraison',
  ],
};

/** Pastilles proposées pour une famille : locales d'abord, héritées ensuite. */
function suggestionsPour(famille) {
  return SUGGESTIONS_LOCALES[famille] || TAGS_PAR_CATEGORIE[famille] || [];
}

/**
 * Formulaire d'inscription d'un commerce, tenu par l'agent.
 *
 * Deux documents naissent d'un seul appel serveur (POST /api/agents/creer-fiche) :
 *   • la fiche de l'établissement, marquée du code agent (paie) ;
 *   • le compte du gérant, avec le mot de passe TAPÉ PAR LE COMMERÇANT.
 * C'est pour cela que le bloc « compte du gérant » est visuellement séparé : le
 * téléphone change de mains à ce moment-là, l'agent ne doit pas connaître le mot
 * de passe (sinon il pourrait se connecter au compte du commerce).
 */
function FormulaireFiche({ agent, onRetour, onFicheCreee }) {
  const [nom, setNom] = useState('');
  const [categorie, setCategorie] = useState('');
  const [sousCategorie, setSousCategorie] = useState('');
  const [sousCategorieLibre, setSousCategorieLibre] = useState('');
  const [description, setDescription] = useState('');
  const [telephone, setTelephone] = useState('');
  const [photoDevanture, setPhotoDevanture] = useState('');
  const [photoVendeur, setPhotoVendeur] = useState('');
  const [tags, setTags] = useState([]);
  const [tagLibre, setTagLibre] = useState('');
  const [coords, setCoords] = useState(null);
  const [precision, setPrecision] = useState(null);
  const [gpsEnCours, setGpsEnCours] = useState(false);
  const [carteOuverte, setCarteOuverte] = useState(false);
  const [quartier, setQuartier] = useState('');
  const [commune, setCommune] = useState('');
  const [adresse, setAdresse] = useState('');
  const [gerantNom, setGerantNom] = useState('');
  const [gerantTelephone, setGerantTelephone] = useState('');
  const [gerantMotDePasse, setGerantMotDePasse] = useState('');
  const [gerantMotDePasse2, setGerantMotDePasse2] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  const familles = FAMILLES_VISIBLES.filter((famille) => famille.slug !== 'tous');
  const precisions = sousCategoriesDe(categorie).filter((s) => !s.libre);
  const suggestions = suggestionsPour(categorie);

  function choisirFamille(slug) {
    setCategorie(slug);
    // Les précisions dépendent de la famille : on repart de zéro, sinon on
    // enregistrerait « Maquis » sur une boutique de vêtements.
    setSousCategorie('');
    setSousCategorieLibre('');
    setTags([]);
    setTagLibre('');
  }

  function basculerTag(valeur) {
    setTags((prec) => (prec.includes(valeur) ? prec.filter((t) => t !== valeur) : [...prec, valeur]));
  }

  function ajouterTagLibre() {
    const valeur = tagLibre.trim().slice(0, 40);
    if (!valeur) return;
    setTags((prec) => (prec.includes(valeur) ? prec : [...prec, valeur]));
    setTagLibre('');
  }

  async function utiliserGps() {
    setGpsEnCours(true);
    setErreur('');
    try {
      const point = await positionActuelle();
      setCoords({ lat: point.lat, lng: point.lng });
      setPrecision(point.precision);
    } catch (err) {
      setErreur(err?.message || 'Position GPS introuvable.');
    } finally {
      setGpsEnCours(false);
    }
  }



  async function valider(evt) {
    evt.preventDefault();
    setErreur('');

    if (nom.trim().length < 2) {
      setErreur('Indiquez le nom du commerce.');
      return;
    }
    if (!categorie) {
      setErreur('Choisissez la catégorie du commerce.');
      return;
    }
    if (!telephone.trim()) {
      setErreur('Indiquez le numéro de téléphone du commerce.');
      return;
    }
    if (tags.length < 3) {
      setErreur('Sélectionnez au moins 3 produits ou services : ce sont eux que les clients cherchent.');
      return;
    }
    if (!coords) {
      setErreur('Placez la position du commerce : GPS, ou repère sur la carte.');
      return;
    }
    if (gerantNom.trim().length < 2) {
      setErreur('Indiquez le nom du gérant.');
      return;
    }
    if (!gerantTelephone.trim()) {
      setErreur('Indiquez le numéro de téléphone du gérant : c’est son identifiant de connexion.');
      return;
    }
    if (gerantMotDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) {
      setErreur(
        `Le gérant doit choisir un mot de passe de ${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum.`
      );
      return;
    }
    if (gerantMotDePasse !== gerantMotDePasse2) {
      setErreur('Les deux mots de passe du gérant ne sont pas identiques.');
      return;
    }

    setEnCours(true);
    try {
      const reponse = await agentsApi.creerFiche({
        nom: nom.trim(),
        categorie,
        sousCategorie: (sousCategorieLibre.trim() || sousCategorie).trim(),
        description: description.trim(),
        telephone: telephone.trim(),
        photoDevanture,
        photoVendeur,
        tags,
        localisation: coords,
        commune: commune.trim(),
        quartier: quartier.trim(),
        adresse: adresse.trim(),
        // Le gérant tape lui-même ces trois champs : l'agent ne doit pas
        // connaître son mot de passe (il ne pourrait plus nier y avoir accès).
        gerant: {
          nom: gerantNom.trim(),
          telephone: gerantTelephone.trim(),
          motDePasse: gerantMotDePasse,
        },
      });

      // Succès : le parent vide la session et affiche « Fiche créée avec succès.
      // Le gérant peut se connecter. ». Inutile de remettre `enCours` à false :
      // le composant est démonté à cet instant.
      onFicheCreee(reponse);
    } catch (err) {
      // Rien n'est enregistré quand le serveur refuse : la compensation (compte
      // gérant supprimé si la fiche échoue) est faite côté serveur, la fiche
      // n'existe pas. L'agent peut corriger le champ et réappuyer.
      setErreur(err?.message || 'Création de la fiche impossible. Aucune fiche n’a été enregistrée.');
      setEnCours(false);
    }
  }

  return (
    <div className="ecran py-4">
      <button
        type="button"
        onClick={onRetour}
        className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-ink-muted"
      >
        <Icon name="chevronLeft" size={15} />
        Retour à mon service
      </button>

      <h1 className="text-xl font-bold text-ink">Inscrire un commerce</h1>
      <p className="mb-3 text-sm text-ink-muted">
        Fiche du commerce et compte du gérant, en une seule visite. À la fin, votre session se ferme
        automatiquement.
      </p>

      <form className="space-y-3" onSubmit={valider}>
        {/* ── 1. Le commerce ─────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-line bg-white p-4 shadow-card">
          <p className="text-sm font-bold text-ink">1. Le commerce</p>

          <Champ libelle="Nom du commerce">
            <input
              className={CLASSE_ENTREE}
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              maxLength={120}
              placeholder="Ex. Chez Fatou"
              required
            />
          </Champ>

          <div>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-muted">
              Catégorie
            </span>
            <div className="flex flex-wrap gap-1.5">
              {familles.map((famille) => {
                const actif = famille.slug === categorie;
                return (
                  <button
                    key={famille.slug}
                    type="button"
                    onClick={() => choisirFamille(famille.slug)}
                    aria-pressed={actif}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold transition ${
                      actif
                        ? 'border-primary bg-primary text-white'
                        : 'border-line bg-white text-ink-muted'
                    }`}
                  >
                    <Icon name={famille.icone} size={14} />
                    {famille.label}
                  </button>
                );
              })}
            </div>
          </div>

          {categorie && precisions.length > 0 ? (
            <div>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-muted">
                Précisez l’activité <span className="font-normal normal-case">(facultatif)</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {precisions.map((item) => {
                  const actif = !sousCategorieLibre && item.slug === sousCategorie;
                  return (
                    <button
                      key={item.slug}
                      type="button"
                      onClick={() => {
                        setSousCategorieLibre('');
                        setSousCategorie(actif ? '' : item.slug);
                      }}
                      aria-pressed={actif}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        actif
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-line bg-white text-ink-muted'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <Champ libelle="Autre précision (facultatif)">
            <input
              className={CLASSE_ENTREE}
              type="text"
              value={sousCategorieLibre}
              onChange={(e) => {
                setSousCategorieLibre(e.target.value.slice(0, 60));
                if (e.target.value) setSousCategorie('');
              }}
              maxLength={60}
              placeholder="Ex. Poissonnerie, Cordonnerie…"
            />
          </Champ>

          <Champ libelle="Description courte (facultatif)">
            <textarea
              className={CLASSE_ENTREE}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ce que propose le commerce, en une phrase."
            />
          </Champ>

          <Champ libelle="Téléphone du commerce" aide="Le numéro que le client appellera.">
            <input
              className={CLASSE_ENTREE}
              type="tel"
              inputMode="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="07 07 12 34 56"
              required
            />
          </Champ>
        </section>

        {/* ── 2. Photos et produits ──────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-line bg-white p-4 shadow-card">
          <p className="text-sm font-bold text-ink">2. Photos et produits</p>
          <p className="-mt-1 text-[11px] leading-snug text-ink-muted">
            Les photos ne sont pas obligatoires : mieux vaut une fiche sans photo qu’une visite
            perdue. Elles sont compressées sur place avant l’envoi.
          </p>

          <PhotoUploadField
            label="Photo de la devanture"
            indication="Cadrez l’enseigne ou la boutique, à la lumière du jour."
            value={photoDevanture}
            onChange={setPhotoDevanture}
            requis={false}
          />
          <PhotoUploadField
            label="Photo du gérant ou de l’étal"
            indication="Une photo de la personne ou des produits rassure les clients."
            value={photoVendeur}
            onChange={setPhotoVendeur}
            requis={false}
          />

          <div>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-muted">
              Produits et services <span className="normal-case">(3 minimum)</span>
            </span>
            {categorie ? (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((suggestion) => {
                  const actif = tags.includes(suggestion);
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => basculerTag(suggestion)}
                      aria-pressed={actif}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        actif
                          ? 'border-primary bg-primary text-white'
                          : 'border-line bg-white text-ink-muted'
                      }`}
                    >
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-ink-muted">
                Choisissez d’abord la catégorie : les produits proposés en dépendent.
              </p>
            )}

            <div className="mt-2 flex gap-2">
              <input
                className={CLASSE_ENTREE}
                type="text"
                value={tagLibre}
                onChange={(e) => setTagLibre(e.target.value.slice(0, 40))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    ajouterTagLibre();
                  }
                }}
                maxLength={40}
                placeholder="Autre produit ou service…"
              />
              <button
                type="button"
                onClick={ajouterTagLibre}
                className="shrink-0 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink"
              >
                Ajouter
              </button>
            </div>

            {tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => basculerTag(tag)}
                    className="inline-flex items-center gap-1 rounded-full bg-soft px-2.5 py-1 text-[11px] font-semibold text-ink"
                  >
                    {tag}
                    <Icon name="close" size={12} />
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-[11px] text-ink-muted">
              {tags.length === 0
                ? 'Aucun produit sélectionné pour l’instant.'
                : `${tags.length} produit(s) ou service(s) retenu(s).`}
            </p>
          </div>
        </section>


        {/* ── 3. Position ─────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-line bg-white p-4 shadow-card">
          <p className="text-sm font-bold text-ink">3. Position du commerce</p>
          <p className="-mt-1 text-[11px] leading-snug text-ink-muted">
            Le point sert à calculer la distance affichée aux clients. Sur place, le GPS est le plus
            juste ; sinon, placez le repère à la main.
          </p>

          <div className="rounded-md border border-line bg-soft/60 p-3">
            {coords ? (
              <p className="text-xs font-semibold text-ink">
                Point retenu : {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                {precision ? ` · précision ${Math.round(precision)} m` : ' · repère placé à la main'}
              </p>
            ) : (
              <p className="text-xs font-semibold text-ink-muted">
                Aucun point pour l’instant.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={gpsEnCours}
                onClick={utiliserGps}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                <Icon name="mapPin" size={14} />
                {gpsEnCours ? 'Recherche du GPS…' : 'Ma position actuelle'}
              </button>
              <button
                type="button"
                onClick={() => setCarteOuverte(true)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-xs font-bold text-ink"
              >
                <Icon name="mapPin" size={14} />
                Placer sur la carte
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Champ libelle="Quartier">
              <input
                className={CLASSE_ENTREE}
                type="text"
                value={quartier}
                onChange={(e) => setQuartier(e.target.value)}
                maxLength={80}
                placeholder="Ex. Yopougon Selmer"
              />
            </Champ>
            <Champ libelle="Commune">
              <input
                className={CLASSE_ENTREE}
                type="text"
                value={commune}
                onChange={(e) => setCommune(e.target.value)}
                maxLength={80}
                placeholder="Ex. Yopougon"
              />
            </Champ>
          </div>

          <Champ libelle="Repère ou adresse (facultatif)">
            <input
              className={CLASSE_ENTREE}
              type="text"
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              maxLength={160}
              placeholder="Ex. en face de la station Total"
            />
          </Champ>
        </section>

        {carteOuverte ? (
          <Suspense fallback={null}>
            <ChoisirPosition
              ouvert={carteOuverte}
              onFermer={() => setCarteOuverte(false)}
              onValider={(lat, lng) => {
                setCoords({ lat, lng });
                setPrecision(null);
                setCarteOuverte(false);
              }}
              centre={coords || agent.dernierePosition || null}
              reference={coords}
              titre="Position du commerce"
              aide="Faites glisser le repère orange sur la boutique (ou touchez la carte). Le point validé sera celui de la fiche, donc celui des distances affichées."
            />
          </Suspense>
        ) : null}


        {/* ── 4. Compte du gérant ────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-line bg-white p-4 shadow-card">
          <p className="text-sm font-bold text-ink">4. Compte du gérant</p>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-[11px] font-semibold leading-snug text-ink">
              Passez le téléphone au gérant à cette étape : c’est lui qui choisit son mot de passe.
              Vous, vous ne le voyez pas — et vous n’en avez pas besoin. Son identifiant de
              connexion sera son numéro de téléphone.
            </p>
          </div>

          <Champ libelle="Nom du gérant">
            <input
              className={CLASSE_ENTREE}
              type="text"
              value={gerantNom}
              onChange={(e) => setGerantNom(e.target.value)}
              maxLength={80}
              placeholder="Ex. Fatou Koné"
              required
            />
          </Champ>

          <Champ libelle="Téléphone du gérant" aide="Identifiant de connexion du compte.">
            <input
              className={CLASSE_ENTREE}
              type="tel"
              inputMode="tel"
              value={gerantTelephone}
              onChange={(e) => setGerantTelephone(e.target.value)}
              placeholder="07 07 12 34 56"
              required
            />
          </Champ>

          <Champ
            libelle="Mot de passe du gérant"
            aide={`${LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum. À taper par le gérant.`}
          >
            <input
              className={CLASSE_ENTREE}
              type="password"
              autoComplete="new-password"
              value={gerantMotDePasse}
              onChange={(e) => setGerantMotDePasse(e.target.value)}
              minLength={LONGUEUR_MIN_MOT_DE_PASSE}
              placeholder="••••••••"
              required
            />
          </Champ>

          <Champ libelle="Confirmer le mot de passe">
            <input
              className={CLASSE_ENTREE}
              type="password"
              autoComplete="new-password"
              value={gerantMotDePasse2}
              onChange={(e) => setGerantMotDePasse2(e.target.value)}
              minLength={LONGUEUR_MIN_MOT_DE_PASSE}
              placeholder="••••••••"
              required
            />
          </Champ>
        </section>

        {/* L'erreur est répétée juste au-dessus du bouton : c'est là que le regard
            se trouve quand on appuie, et le formulaire est long. */}
        {erreur ? (
          <div aria-live="polite">
            <InfoBanner variante="erreur" titre="Fiche non enregistrée">
              {erreur}
            </InfoBanner>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={enCours}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          <Icon name={enCours ? 'loader' : 'check'} size={16} />
          {enCours ? 'Enregistrement…' : 'Créer la fiche et fermer ma session'}
        </button>
        <p className="pb-2 text-center text-[11px] leading-snug text-ink-muted">
          Après l’enregistrement, votre session se ferme : le gérant reste seul avec son compte, et
          la fiche de votre tournée reste marquée de votre code.
        </p>
      </form>
    </div>
  );
}

