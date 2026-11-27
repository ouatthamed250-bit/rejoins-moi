// Messages.jsx — MESSAGERIE INTERNE (chat privé), onglet « Messages ».
//
// Remplace l'ancien écran qui renvoyait vers WhatsApp (prompt B). Deux états, une
// seule page — comme WhatsApp Web :
//   • état 0 : barre de recherche en haut + liste des conversations existantes.
//     Taper un nom (artisan, client, commerce) affiche les résultats de
//     `GET /api/messages/search` et permet de DÉMARRER une discussion ;
//   • état 1 : conversation ouverte, bulles à gauche pour l'autre, orange à
//     droite pour soi, champ d'envoi en bas.
//
// L'URL fait foi : `/messages?to=<id>` ouvre (ou crée) la discussion avec cette
// personne ou ce commerce — c'est ce que produisent les boutons « Message » des
// fiches. Le serveur accepte un identifiant de COMPTE comme d'ÉTABLISSEMENT
// (il retrouve le gérant), l'écran n'a donc rien à deviner.
//
// Confidentialité : aucun numéro de téléphone n'est affiché ni demandé ici. Le
// contenu des messages ne sort que par les routes protégées de l'API ; la
// modération et l'extraction (réquisition) vivent dans le back-office.
//
// Pas de WebSocket : le projet n'a aucune dépendance temps réel. L'écran
// s'actualise par interrogation périodique (10 s) UNIQUEMENT quand il est
// visible, ce qui suffit pour une conversation et évite une connexion
// permanente sur un téléphone d'entrée de gamme en 3G.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import { Icon, IconLoader } from '../components/Icons.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../utils/api/client.js';
import { formatDateRelative, formaterNomPublic, initiales } from '../utils/format.js';
import { getSupportWhatsapp } from '../config/paiement.js';

/** Numéro du support (WhatsApp) — canal d'aide, pas canal de mise en relation. */
const SUPPORT = getSupportWhatsapp();

/** Doit rester aligné sur LONGUEUR_MAX_MESSAGE côté serveur (models/Message.js). */
const LONGUEUR_MAX = 1000;
const INTERVALLE_RAFRAICHISSEMENT_MS = 5000;

/** Nom affichable d'un interlocuteur — jamais un numéro de téléphone. */
function nomAffiche(interlocuteur) {
  if (!interlocuteur) return 'Discussion';
  if (interlocuteur.supprime) return 'Compte supprimé';
  return formaterNomPublic(interlocuteur.nom) || 'Utilisateur';
}

/** Sous-titre d'un interlocuteur : métier pour un artisan, rien pour un client. */
function sousTitreAffiche(interlocuteur) {
  if (!interlocuteur || interlocuteur.supprime) return '';
  return interlocuteur.metier || '';
}

/** Libellé d'un résultat de recherche selon sa nature. */
function libelleType(resultat) {
  if (!resultat) return '';
  if (resultat.type === 'etablissement') {
    return resultat.joignable ? 'Commerce' : 'Commerce — pas encore de compte';
  }
  if (resultat.type === 'artisan') return 'Artisan';
  return 'Utilisateur';
}

export default function Messages() {
  const navigate = useNavigate();
  const { connecte, estDemo, profil, setMessagesNonLus } = useAuth();
  const [parametres, setParametres] = useSearchParams();

  // ── Liste des conversations ────────────────────────────────────────────────
  const [conversations, setConversations] = useState([]);
  const [chargementListe, setChargementListe] = useState(true);
  const [erreurListe, setErreurListe] = useState('');

  // ── Recherche d'un destinataire ────────────────────────────────────────────
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState([]);
  const [rechercheEnCours, setRechercheEnCours] = useState(false);
  const [erreurRecherche, setErreurRecherche] = useState('');

  // ── Conversation ouverte ───────────────────────────────────────────────────
  const [conversation, setConversation] = useState(null); // { conversation, messages }
  const [chargementConversation, setChargementConversation] = useState(false);
  const [erreurConversation, setErreurConversation] = useState('');
  const [ouvertureEnCours, setOuvertureEnCours] = useState(false);
  const [erreurDemarrage, setErreurDemarrage] = useState(null); // { message, details }
  const [texte, setTexte] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState('');

  const filMessages = useRef(null);
  // Empêche de rejouer `POST /messages/start` en boucle sur la même cible (l'effet
  // dépend de l'URL, qui ne change pas pendant l'ouverture).
  const cibleDejaTraitee = useRef('');

  const cible = parametres.get('to') || '';
  const idActif = conversation?.conversation?.id || '';
  const interlocuteur = conversation?.conversation?.interlocuteur || null;
  const messages = conversation?.messages || [];

  /** Recharge la boîte de réception (et met à jour la pastille de la barre basse). */
  const chargerConversations = useCallback(
    async ({ silencieux = false } = {}) => {
      if (!silencieux) setChargementListe(true);
      try {
        const donnees = await api.get('/messages/conversations');
        setConversations(donnees?.conversations || []);
        setMessagesNonLus(Number(donnees?.totalNonLus) || 0);
        setErreurListe('');
      } catch (err) {
        // En silencieux (rafraîchissement automatique) on ne remplace pas un
        // écran lisible par un bandeau d'erreur : le prochain essai suffira.
        if (!silencieux) setErreurListe(err?.message || 'Messagerie indisponible pour le moment.');
      } finally {
        if (!silencieux) setChargementListe(false);
      }
    },
    [setMessagesNonLus]
  );

  /** Ouvre une conversation existante et marque ses messages comme lus. */
  const ouvrirConversation = useCallback(async (id, { silencieux = false } = {}) => {
    if (!id) return;
    if (!silencieux) {
      setChargementConversation(true);
      setErreurConversation('');
    }
    try {
      const donnees = await api.get(`/messages/conversations/${id}`);
      setConversation(donnees);
      setErreurConversation('');
      setErreurEnvoi('');
    } catch (err) {
      if (!silencieux) {
        setConversation(null);
        setErreurConversation(err?.message || 'Conversation indisponible pour le moment.');
      }
    } finally {
      if (!silencieux) setChargementConversation(false);
    }
  }, []);

  /**
   * Démarre (ou retrouve) la discussion avec un compte ou un commerce.
   * En cas de refus métier (commerce sans compte, conversation avec soi-même),
   * l'API renvoie un `details.code` : l'écran l'explique au lieu d'un « erreur ».
   */
  const demarrerAvec = useCallback(
    async (destinataireId) => {
      setOuvertureEnCours(true);
      setErreurDemarrage(null);
      try {
        const donnees = await api.post('/messages/start', { destinataireId });
        setRecherche('');
        setResultats([]);
        // Mémorisé AVANT de toucher l'URL : sinon l'effet `?to=` relancerait un
        // second `start` pour la même cible (inutile, et cela viderait la saisie).
        cibleDejaTraitee.current = String(destinataireId);
        await ouvrirConversation(donnees?.conversation?.id);
        setParametres({ to: String(destinataireId) }, { replace: true });
        chargerConversations({ silencieux: true });
      } catch (err) {
        setErreurDemarrage({
          message: err?.message || 'Impossible de démarrer cette discussion.',
          details: err?.details || null,
          destinataireId: String(destinataireId),
        });
        cibleDejaTraitee.current = '';
      } finally {
        setOuvertureEnCours(false);
      }
    },
    [chargerConversations, ouvrirConversation, setParametres]
  );

  // Boîte de réception, au premier affichage d'un compte connecté.
  useEffect(() => {
    if (!connecte || estDemo) {
      setChargementListe(false);
      return;
    }
    chargerConversations();
  }, [connecte, estDemo, chargerConversations]);

  // `/messages?to=…` : le bouton « Message » d'une fiche arrive ici.
  useEffect(() => {
    if (!connecte || estDemo || !cible) return;
    if (cibleDejaTraitee.current === cible) return;
    cibleDejaTraitee.current = cible;
    demarrerAvec(cible);
  }, [cible, connecte, estDemo, demarrerAvec]);

  // Recherche débouncée (300 ms) : on ne lance pas une requête par frappe.
  useEffect(() => {
    const terme = recherche.trim();
    if (terme.length < 2) {
      setResultats([]);
      setErreurRecherche('');
      setRechercheEnCours(false);
      return undefined;
    }

    let vivant = true;
    const controleur = new AbortController();
    setRechercheEnCours(true);

    const minuteur = setTimeout(async () => {
      try {
        const donnees = await api.get(`/messages/search?q=${encodeURIComponent(terme)}`, {
          signal: controleur.signal,
        });
        if (!vivant) return;
        setResultats(donnees?.resultats || []);
        setErreurRecherche('');
      } catch (err) {
        if (!vivant || controleur.signal.aborted) return;
        setResultats([]);
        setErreurRecherche(err?.message || 'Recherche indisponible pour le moment.');
      } finally {
        if (vivant) setRechercheEnCours(false);
      }
    }, 300);

    return () => {
      vivant = false;
      clearTimeout(minuteur);
      controleur.abort();
      setRechercheEnCours(false);
    };
  }, [recherche]);

  // Rafraîchissement périodique, uniquement quand l'écran est visible.
  useEffect(() => {
    if (!connecte || estDemo) return undefined;
    const minuteur = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (idActif) ouvrirConversation(idActif, { silencieux: true });
      chargerConversations({ silencieux: true });
    }, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(minuteur);
  }, [connecte, estDemo, idActif, ouvrirConversation, chargerConversations]);

  // Le fil reste collé au dernier message (comme toute messagerie).
  useEffect(() => {
    const element = filMessages.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, idActif]);

  /** Envoi du message en cours de saisie. */
  async function envoyer(evenement) {
    evenement.preventDefault();
    const contenu = texte.trim();
    if (!contenu || !idActif || envoiEnCours) return;

    setEnvoiEnCours(true);
    setErreurEnvoi('');
    try {
      const donnees = await api.post(`/messages/conversations/${idActif}`, { contenu });
      setConversation((precedent) =>
        precedent
          ? {
              ...precedent,
              messages: [...precedent.messages, donnees.message],
              conversation: {
                ...precedent.conversation,
                dernierMessage: donnees?.conversation?.dernierMessage || contenu,
                derniereActivite: donnees?.conversation?.derniereActivite || new Date().toISOString(),
              },
            }
          : precedent
      );
      setTexte('');
      chargerConversations({ silencieux: true });
    } catch (err) {
      // On NE vide pas le champ : le message est toujours là, prêt à repartir.
      setErreurEnvoi(err?.message || 'Envoi impossible. Vérifiez votre connexion.');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  /** Ferme la discussion ouverte et revient à la liste (l'URL redevient /messages). */
  function fermerConversation() {
    setConversation(null);
    setErreurConversation('');
    setErreurDemarrage(null);
    setErreurEnvoi('');
    setTexte('');
    cibleDejaTraitee.current = '';
    setParametres({}, { replace: true });
    chargerConversations({ silencieux: true });
  }

  const termeRecherche = recherche.trim();
  const rechercheActive = termeRecherche.length >= 2;


  // ── La messagerie exige un compte réellement enregistré sur le serveur ─────
  if (!connecte) {
    return (
      <div className="ecran py-3">
        <h1 className="mb-2 text-xl font-bold text-ink">Messages</h1>
        <EmptyState
          icone="message"
          titre="Connectez-vous pour discuter"
          description="La messagerie interne permet de joindre un artisan ou un commerce sans échanger de numéro de téléphone."
          action={{
            libelle: 'Se connecter',
            onClick: () => navigate('/connexion', { state: { depuis: '/messages' } }),
          }}
          illustration="enveloppe"
        />
      </div>
    );
  }

  if (estDemo) {
    return (
      <div className="ecran py-3">
        <h1 className="mb-2 text-xl font-bold text-ink">Messages</h1>
        <InfoBanner variante="demo" titre="Mode démonstration" className="mb-3">
          Vous êtes connecté en mode démonstration ({profil?.nomComplet || 'compte local'}) : ce compte
          n’existe pas sur le serveur, une conversation ne pourrait donc pas être enregistrée ni
          livrée à votre interlocuteur.
        </InfoBanner>
        <EmptyState
          icone="wifiOff"
          titre="La messagerie a besoin du serveur"
          description="Reconnectez-vous dès que le réseau revient : vos discussions repartiront de là où vous les avez laissées."
          action={{ libelle: 'Se reconnecter', onClick: () => navigate('/connexion') }}
        />
      </div>
    );
  }

  // ── État 1 : une conversation est ouverte ──────────────────────────────────
  if (idActif) {
    const nom = nomAffiche(interlocuteur);
    const sousTitre = sousTitreAffiche(interlocuteur);

    return (
      <div className="ecran py-3">
        <header className="mb-2 flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost h-9 w-9 shrink-0 !px-0"
            onClick={fermerConversation}
            aria-label="Revenir à la liste des conversations"
          >
            <Icon name="chevronLeft" size={18} />
          </button>
          <AvatarInterlocuteur personne={interlocuteur} taille={38} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold leading-tight text-ink">{nom}</h1>
            <p className="truncate text-[11px] text-ink-muted">
              {sousTitre || 'Conversation privée'}
            </p>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-bold text-ink-muted">
            <Icon name="lock" size={12} />
            Privé
          </span>
        </header>

        {erreurConversation ? (
          <InfoBanner
            variante="erreur"
            titre="Conversation indisponible"
            className="mb-2"
            actions={[
              { libelle: 'Réessayer', onClick: () => ouvrirConversation(idActif) },
              { libelle: 'Retour', onClick: fermerConversation },
            ]}
          >
            {erreurConversation}
          </InfoBanner>
        ) : null}

        <div
          ref={filMessages}
          className="mb-2 flex max-h-[52vh] min-h-[240px] flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-white p-3"
          aria-live="polite"
        >
          {chargementConversation ? (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-ink-muted">
              <IconLoader size={18} className="text-primary" />
              Ouverture de la discussion…
            </p>
          ) : messages.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-bold text-ink">Aucun message pour le moment</p>
              <p className="mx-auto mt-1 max-w-[280px] text-xs text-ink-muted">
                Écrivez le premier message : {nom} le recevra dans l’application, sans que votre
                numéro soit communiqué.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[82%] rounded-lg px-3 py-2 text-sm ${
                  message.moi
                    ? 'self-end rounded-br-sm bg-primary text-white'
                    : 'self-start rounded-bl-sm bg-soft text-ink'
                }`}
              >
                <p className="whitespace-pre-line break-words leading-snug">{message.contenu}</p>
                <p
                  className={`mt-1 text-right text-[10px] ${
                    message.moi ? 'text-white/80' : 'text-ink-muted'
                  }`}
                >
                  {formatDateRelative(message.createdAt) || 'à l’instant'}
                  {message.moi ? (
                    <>
                      {message.lu ? ' · Lu' : ' · Envoyé'}
                      {message.lu ? (
                        <Icon name="check" size={10} className="shrink-0 ml-0.5 text-white" />
                      ) : (
                        <Icon name="check" size={10} className="shrink-0 ml-0.5 text-white/60" />
                      )}
                    </>
                  ) : ''}
                </p>
              </div>
            ))
          )}
        </div>


        {erreurEnvoi ? (
          <InfoBanner variante="erreur" titre="Message non envoyé" className="mb-2">
            {erreurEnvoi}
          </InfoBanner>
        ) : null}

        {interlocuteur?.supprime ? (
          <InfoBanner variante="alerte" titre="Ce compte n’existe plus">
            La discussion reste consultable, mais vous ne pouvez plus y répondre.
          </InfoBanner>
        ) : (
          <form onSubmit={envoyer} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Votre message</span>
              <textarea
                rows={1}
                maxLength={LONGUEUR_MAX}
                value={texte}
                onChange={(evenement) => setTexte(evenement.target.value)}
                placeholder="Écrivez votre message…"
                className="max-h-28 w-full resize-none rounded-md border border-line px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              type="submit"
              className="bouton-principal shrink-0 !px-4 !py-2.5 text-sm"
              disabled={!texte.trim() || envoiEnCours}
            >
              {envoiEnCours ? <IconLoader size={16} /> : <Icon name="message" size={16} />}
              Envoyer
            </button>
          </form>
        )}

        <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-ink-muted">
          <Icon name="lock" size={12} className="mt-0.5 shrink-0" />
          <span>
            Conversation privée entre vous et {nom}. Aucun numéro n’est affiché ; les messages sont
            conservés et peuvent être consultés par la modération en cas de signalement.
          </span>
        </p>
      </div>
    );
  }

  // ── État 0 : recherche + liste des conversations ───────────────────────────
  return (
    <div className="ecran py-3">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Messages</h1>
        <button
          type="button"
          className="text-xs font-bold text-primary underline"
          onClick={() => chargerConversations()}
          disabled={chargementListe}
        >
          {chargementListe ? 'Actualisation…' : 'Actualiser'}
        </button>
      </div>

      <div className="relative mb-2">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
          <Icon name="search" size={16} />
        </span>
        <input
          type="search"
          value={recherche}
          onChange={(evenement) => setRecherche(evenement.target.value)}
          placeholder="Chercher un artisan, un commerce, un nom…"
          aria-label="Chercher un destinataire"
          className="w-full rounded-md border border-line py-2.5 pl-9 pr-9 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {recherche ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted hover:bg-soft"
            onClick={() => {
              setRecherche('');
              setResultats([]);
            }}
            aria-label="Effacer la recherche"
          >
            <Icon name="close" size={15} />
          </button>
        ) : null}
      </div>


      {rechercheActive ? (
        <section className="carte mb-3 p-2" aria-label="Résultats de la recherche">
          <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            Démarrer une discussion
          </p>

          {rechercheEnCours ? (
            <p className="flex items-center gap-2 px-1 py-3 text-xs text-ink-muted">
              <IconLoader size={16} className="text-primary" />
              Recherche…
            </p>
          ) : erreurRecherche ? (
            <p className="px-1 py-3 text-xs text-danger">{erreurRecherche}</p>
          ) : resultats.length === 0 ? (
            <p className="px-1 py-3 text-xs text-ink-muted">
              Aucun résultat pour « {termeRecherche} ». Essayez le nom du commerce ou le métier
              (plombier, coiffeuse…).
            </p>
          ) : (
            <ul className="flex flex-col">
              {resultats.map((resultat) => (
                <li key={`${resultat.type}-${resultat.id}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md p-2 text-left transition hover:bg-soft disabled:opacity-60"
                    disabled={!resultat.joignable || ouvertureEnCours}
                    onClick={() => demarrerAvec(resultat.id)}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon
                        name={
                          resultat.type === 'etablissement'
                            ? 'store'
                            : resultat.type === 'artisan'
                              ? 'tools'
                              : 'user'
                        }
                        size={16}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">
                        {formaterNomPublic(resultat.nom) || 'Sans nom'}
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {resultat.sousTitre || libelleType(resultat)}
                      </span>
                    </span>
                    {resultat.joignable ? (
                      <Icon name="chevronRight" size={16} className="shrink-0 text-ink-muted" />
                    ) : (
                      <span className="shrink-0 text-[10px] font-bold text-ink-muted">
                        {resultat.raison === 'PROPRIETAIRE_SOI_MEME' ? 'Votre fiche' : 'Pas de compte'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {erreurDemarrage ? (
        <InfoBanner
          variante="erreur"
          titre="Discussion impossible"
          className="mb-3"
          actions={[
            ...(erreurDemarrage.details?.etablissement?.id
              ? [
                  {
                    libelle: 'Voir la fiche',
                    onClick: () =>
                      navigate(`/etablissement/${erreurDemarrage.details.etablissement.id}`),
                  },
                ]
              : []),
            { libelle: 'Réessayer', onClick: () => demarrerAvec(erreurDemarrage.destinataireId || cible) },
          ]}
        >
          {erreurDemarrage.message}
        </InfoBanner>
      ) : null}

      {ouvertureEnCours ? (
        <p className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
          <IconLoader size={16} className="text-primary" />
          Ouverture de la discussion…
        </p>
      ) : null}


      <h2 className="mb-1.5 mt-3 text-sm font-bold text-ink">
        Discussions
        {conversations.length > 0 ? (
          <span className="font-normal text-ink-muted"> ({conversations.length})</span>
        ) : null}
      </h2>

      {chargementListe && conversations.length === 0 ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          {[0, 1, 2].map((rang) => (
            <div key={rang} className="carte flex items-center gap-3 p-3">
              <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-soft" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="h-3 w-1/2 animate-pulse rounded bg-soft" />
                <span className="h-2.5 w-3/4 animate-pulse rounded bg-soft" />
              </span>
            </div>
          ))}
        </div>
      ) : erreurListe ? (
        <InfoBanner
          variante="erreur"
          titre="Messagerie indisponible"
          actions={[{ libelle: 'Réessayer', onClick: () => chargerConversations() }]}
        >
          {erreurListe}
        </InfoBanner>
      ) : conversations.length === 0 ? (
        <EmptyState
          icone="message"
          titre="Aucune discussion pour le moment"
          description="Cherchez un artisan ou un commerce dans la barre de recherche, puis écrivez-lui : la discussion apparaîtra ici, sur tous vos appareils."
          illustration="enveloppe"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="carte flex w-full items-center gap-3 p-3 text-left"
                onClick={() => ouvrirConversation(item.id)}
              >
                <AvatarInterlocuteur personne={item.interlocuteur} taille={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-ink">
                      {nomAffiche(item.interlocuteur)}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-muted">
                      {formatDateRelative(item.derniereActivite) || ''}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-ink-muted">
                      {item.dernierMessage || 'Aucun message — écrivez le premier.'}
                    </span>
                    {item.nonLus > 0 ? (
                      <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                        {item.nonLus}
                      </span>
                    ) : item.dernierMessageLu ? (
                      <span
                        className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/5 px-1.5 text-[10px] font-bold text-primary"
                        title="Lu"
                      >
                        <Icon name="check" size={9} className="shrink-0" />
                        <Icon name="check" size={9} className="shrink-0" />
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-md border border-line p-3">
        <p className="text-sm font-bold text-ink">Un problème avec la messagerie ?</p>
        <p className="mb-2 text-xs text-ink-muted">
          Écrivez au support : nous répondons pendant les heures ouvrables (8h - 18h, Abidjan).
        </p>
        <a
          className="btn-ghost w-full text-sm"
          href={`https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(
            `Bonjour Rejoins'Moi, je suis ${profil?.nomComplet || 'un utilisateur'} et j’ai besoin d’aide sur la messagerie.`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="whatsapp" size={18} />
          Contacter le support
        </a>
      </div>
    </div>
  );
}

/**
 * Pastille d'un interlocuteur : photo si elle existe, initiales sinon.
 * Une photo cassée (URL morte) retombe sur les initiales plutôt qu'une image
 * brisée au milieu de la conversation.
 */
function AvatarInterlocuteur({ personne, taille = 44 }) {
  const [cassee, setCassee] = useState(false);
  const nom = nomAffiche(personne);
  const dimensions = { width: taille, height: taille };

  if (personne?.photoProfil && !cassee) {
    return (
      <img
        src={personne.photoProfil}
        alt={nom}
        style={dimensions}
        className="shrink-0 rounded-full object-cover"
        onError={() => setCassee(true)}
      />
    );
  }

  return (
    <span
      style={dimensions}
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-soft text-xs font-bold text-primary"
    >
      {initiales(nom) || '?'}
    </span>
  );
}

