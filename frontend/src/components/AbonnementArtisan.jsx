// AbonnementArtisan.jsx — Bloc « Abonnement » affiché sur le profil de l'utilisateur.
//
// Cahier des charges (ajout du 29/09) : « un artisan doit voir sur son profil une
// option d'abonnement qui débloque ces trois éléments en une fois : offres de
// boulot + demandes de main-d'œuvre + mise en avant du profil ».
//
// ⚠️ PRIX PROVISOIRES : ils viennent de l'API
// (GET /api/subscriptions/formules → backend/src/config/abonnement.js). Quand le
// serveur répond, la mention « tarif provisoire » s'affiche (aConfirmer: true) :
// on ne fait jamais croire à un prix définitif.
//
// DEUX FORMULES EN PARALLÈLE (semaine 7 j / mois 30 j) : l'artisan choisit sa période
// ici, et la préférée du terrain sera figée plus tard. Le serveur peut en désactiver
// une (SUBSCRIPTION_PERIODICITY) : l'interface suit automatiquement la liste reçue.
//
// ⚠️ AUCUN FAUX PAIEMENT : le bloc demande au serveur d'initialiser la transaction
// CinetPay, ouvre la page de paiement, puis attend que le SERVEUR confirme. Si la
// passerelle n'est pas configurée (HTTP 501), le bouton reste utilisable mais
// explique clairement que rien n'est encaissable et l'abonnement n'est pas activé.

import { useCallback, useEffect, useState } from 'react';

import EmptyState from './EmptyState.jsx';
import InfoBanner from './InfoBanner.jsx';
import { Icon } from './Icons.jsx';
import {
  ABONNEMENT as MIROIR,
  CATALOGUE,
  FORMULES as FORMULES_MIROIR,
  libellePrix,
  libellePrixListe,
} from '../config/abonnement.js';
import { ouvrirPaiement } from '../utils/payment.js';
import {
  chargerFormules,
  confirmerSouscription,
  monAbonnement,
  resilierAbonnement,
  souscrire,
} from '../utils/abonnement.js';
import { formatDateRelative, formatFcfa } from '../utils/format.js';
import { useAuth } from '../hooks/useAuth.js';

/**
 * @param {{ onChangement?: (abonnement: object|null) => void, compact?: boolean }} props
 */
export default function AbonnementArtisan({ onChangement, compact = false }) {
  const { connecte, estDemo } = useAuth();

  // DEUX formules proposées en parallèle (semaine / mois) : le serveur fait foi pour
  // les prix, le miroir config/abonnement.js ne sert que si l'API est injoignable.
  const [formules, setFormules] = useState(FORMULES_MIROIR);
  const [cleChoisie, setCleChoisie] = useState(MIROIR.cle);
  const [formuleParDefaut, setFormuleParDefaut] = useState(MIROIR.cle);
  const [etat, setEtat] = useState({
    abonnement: null,
    abonnementActif: false,
    paiementConfigure: false,
    operateurs: [],
    horsLigne: false,
    chargement: true,
  });
  const [transactionId, setTransactionId] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');

  /** Recharge le catalogue (prix) puis l'état d'abonnement de l'utilisateur. */
  const charger = useCallback(async () => {
    setEtat((prec) => ({ ...prec, chargement: true }));
    const [catalogue, mien] = await Promise.all([
      chargerFormules(),
      connecte && !estDemo
        ? monAbonnement()
        : Promise.resolve({ abonnement: null, abonnementActif: false, paiementConfigure: false, operateurs: [], horsLigne: false }),
    ]);
    // Le serveur fait foi (formules, prix, périodicité) ; le miroir complète les
    // champs d'affichage absents (avantages, sous-titre) et sert hors ligne.
    const serveur = catalogue.formules?.length
      ? catalogue.formules.map((f) => ({
          ...MIROIR,
          ...f,
          avantages: f.avantages?.length ? f.avantages : MIROIR.avantages,
          sousTitre: f.sousTitre || MIROIR.sousTitre,
        }))
      : FORMULES_MIROIR;
    const defaut = catalogue.formuleParDefaut || serveur[0]?.cle || MIROIR.cle;
    setFormules(serveur);
    setFormuleParDefaut(defaut);
    // Le choix de l'artisan est conservé s'il est toujours proposé : une formule
    // retirée de la vente (SUBSCRIPTION_PERIODICITY) bascule sur celle par défaut.
    setCleChoisie((precedente) => (serveur.some((f) => f.cle === precedente) ? precedente : defaut));
    setEtat({
      abonnement: mien.abonnement,
      abonnementActif: Boolean(mien.abonnementActif),
      paiementConfigure: Boolean(catalogue.paiementConfigure && mien.paiementConfigure !== false),
      operateurs: catalogue.operateurs?.length ? catalogue.operateurs : mien.operateurs || [],
      horsLigne: Boolean(catalogue.horsLigne || mien.horsLigne),
      chargement: false,
    });
    onChangement?.(mien.abonnement);
  }, [connecte, estDemo, onChangement]);

  useEffect(() => {
    charger();
  }, [charger]);

  /** Étape 1 : initialise le paiement et ouvre la page CinetPay. */
  async function souscrireAbonnement() {
    if (!connecte) return;
    if (estDemo) {
      setErreur(
        'Profil de démonstration : aucun paiement n’est possible. Créez un compte réel pour souscrire.'
      );
      return;
    }
    setErreur('');
    setMessage('');
    setEnCours(true);
    try {
      const reponse = await souscrire({ formule: formuleChoisie.cle });
      if (reponse.abonnementActif) {
        setMessage(reponse.message || 'Votre abonnement est déjà actif.');
        await charger();
        return;
      }
      if (reponse.paiementRequis) {
        setTransactionId(reponse.transactionId || '');
        ouvrirPaiement(reponse.paymentUrl);
        setMessage(
          `Paiement de ${formatFcfa(reponse.montant)} à finaliser sur ${
            reponse.operateurs.join(' / ') || 'Wave / Orange Money'
          }. L’onglet de paiement vient de s’ouvrir : revenez ici puis appuyez sur « J’ai payé ».`
        );
      }
    } catch (err) {
      setErreur(err?.message || 'Souscription impossible pour le moment.');
    } finally {
      setEnCours(false);
    }
  }

  /** Étape 2 : le SERVEUR vérifie la transaction auprès de CinetPay avant d'activer. */
  async function verifierSouscription() {
    setErreur('');
    setEnCours(true);
    try {
      const reponse = await confirmerSouscription({ formule: formuleChoisie.cle, transactionId });
      setMessage(reponse.message || 'Abonnement activé.');
      setTransactionId('');
      await charger();
    } catch (err) {
      setErreur(err?.message || 'Paiement non confirmé. L’abonnement reste inactif.');
    } finally {
      setEnCours(false);
    }
  }

  /** Arrête le renouvellement : l'accès courant court jusqu'à l'échéance payée. */
  async function resilier() {
    setErreur('');
    setEnCours(true);
    try {
      const reponse = await resilierAbonnement();
      setMessage(reponse.message || 'Renouvellement arrêté.');
      await charger();
    } catch (err) {
      setErreur(err?.message || 'Résiliation impossible pour le moment.');
    } finally {
      setEnCours(false);
    }
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────

  if (!connecte) {
    return (
      <section id="abonnement" className={`carte ${compact ? 'p-3' : 'p-4'}`}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
          <Icon name="wallet" size={17} className="text-primary" />
          {CATALOGUE.titre}
        </h2>
        <p className="mt-1 text-xs leading-snug text-ink-muted">
          Connectez-vous pour souscrire : l’abonnement débloque les contacts de la page Jobs sans
          frais à l’unité et met en avant votre profil d’artisan.
        </p>
        <p className="mt-2 text-xs font-bold text-ink">
          {libellePrixListe(FORMULES_MIROIR)}
          <span className="ml-1 font-semibold text-ink-muted">({CATALOGUE.mentionProvisoire})</span>
        </p>
      </section>
    );
  }

  const abonnement = etat.abonnement;
  const actif = etat.abonnementActif;
  // Formule retenue par l'artisan. Les prix affichés sont ceux du SERVEUR dès qu'ils
  // sont chargés ; le miroir ne sert qu'en mode hors ligne.
  const formuleChoisie = formules.find((f) => f.cle === cleChoisie) || formules[0] || MIROIR;

  return (
    <section id="abonnement" className={`carte ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name="wallet" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-ink">{CATALOGUE.titre}</h2>
          <p className="text-[11px] leading-snug text-ink-muted">{CATALOGUE.sousTitre}</p>
        </div>
        {actif && (
          <span className="shrink-0 rounded-full bg-health-light px-2 py-0.5 text-[10px] font-bold text-health-dark">
            Actif
          </span>
        )}
      </div>

      {/* Choix de la période : les DEUX formules restent proposées tant que le tarif
          n'est pas tranché (test terrain), avec la mention « tarif provisoire ». */}
      <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Période de l’abonnement">
        {formules.map((f) => {
          const choisie = f.cle === formuleChoisie.cle;
          return (
            <button
              key={f.cle}
              type="button"
              role="radio"
              aria-checked={choisie}
              onClick={() => setCleChoisie(f.cle)}
              disabled={enCours}
              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${
                choisie ? 'border-primary bg-primary/10' : 'border-line bg-white'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-bold text-ink">{f.libelle}</span>
                <span className="block text-[10px] leading-snug text-ink-muted">
                  {f.dureeJours} jours d’accès
                  {f.cle === formuleParDefaut ? ' · notre conseil pour essayer' : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs font-bold text-ink">{formatFcfa(f.prixFcfa)}</span>
                {f.aConfirmer ? (
                  <span className="block text-[10px] font-semibold text-ink-muted">
                    {CATALOGUE.mentionProvisoire}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-ink-muted">
        Vous paierez <span className="font-bold text-ink">{libellePrix(formuleChoisie)}</span>. Les
        deux formules restent ouvertes le temps de la tournée terrain : la préférée des artisans
        sera figée ensuite.
      </p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {(formuleChoisie.avantages || []).map((avantage) => (
          <li key={avantage.cle} className="flex items-start gap-2 text-[11px] leading-snug text-ink">
            <Icon name={avantage.icone || 'check'} size={14} className="mt-0.5 shrink-0 text-primary" />
            {avantage.libelle}
          </li>
        ))}
      </ul>

      {actif && abonnement && (
        <p className="mt-2 rounded-md border border-health/40 bg-health-light px-2 py-1.5 text-[11px] font-semibold text-health-dark">
          {abonnement.joursRestants > 0
            ? `Accès illimité jusqu’au ${new Date(abonnement.finAt).toLocaleDateString('fr-FR')} (${abonnement.joursRestants} j).`
            : 'Abonnement en cours.'}{' '}
          {abonnement.statut === 'annule' ? 'Renouvellement arrêté. ' : ''}
          {abonnement.debutAt ? `Souscrit ${formatDateRelative(abonnement.debutAt)}.` : ''}
        </p>
      )}

      {erreur && (
        <InfoBanner
          variante="erreur"
          titre="Abonnement"
          className="mt-2"
          action={{ libelle: 'OK', onClick: () => setErreur('') }}
        >
          {erreur}
        </InfoBanner>
      )}
      {message && (
        <InfoBanner
          variante="succes"
          titre="Abonnement"
          className="mt-2"
          action={{ libelle: 'OK', onClick: () => setMessage('') }}
        >
          {message}
        </InfoBanner>
      )}

      {etat.chargement ? (
        <EmptyState chargement titre="Vérification de votre abonnement…" />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {transactionId ? (
            <button
              type="button"
              className="bouton-principal w-full text-sm"
              onClick={verifierSouscription}
              disabled={enCours}
            >
              <Icon name="unlock" size={17} />
              {enCours ? 'Vérification du paiement…' : 'J’ai payé — vérifier mon paiement'}
            </button>
          ) : (
            <button
              type="button"
              className="bouton-principal w-full text-sm"
              onClick={souscrireAbonnement}
              disabled={enCours || estDemo || etat.horsLigne}
            >
              <Icon name="unlock" size={17} />
              {enCours
                ? 'Ouverture du paiement…'
                : actif
                  ? `Renouveler — ${libellePrix(formuleChoisie)}`
                  : `Souscrire — ${libellePrix(formuleChoisie)}`}
            </button>
          )}

          {actif && abonnement?.statut === 'actif' && (
            <button
              type="button"
              className="btn-ghost w-full py-2 text-xs"
              onClick={resilier}
              disabled={enCours}
            >
              Arrêter le renouvellement
            </button>
          )}

          {estDemo && (
            <p className="text-[10px] leading-snug text-ink-muted">
              Mode démonstration : la souscription est désactivée (aucun paiement possible).
            </p>
          )}
          {!estDemo && etat.horsLigne && (
            <p className="text-[10px] leading-snug text-ink-muted">
              Serveur injoignable : impossible de souscrire pour le moment. Le prix affiché est celui
              enregistré dans l’application.
            </p>
          )}
          {!estDemo && !etat.horsLigne && !etat.paiementConfigure && (
            <p className="text-[10px] leading-snug text-ink-muted">
              Paiement Wave / Orange Money non activé sur cet environnement : la souscription sera
              refusée (aucun abonnement activé, rien n’est simulé).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
