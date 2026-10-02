// useDeblocageContact.js — Logique partagée de déblocage d'un contact main-d'œuvre.
//
// Pourquoi un hook ? La page Jobs (sous-onglet « demandes de main-d'œuvre ») et le
// JobBoard historique débloquent le même type de contact. La règle est délicate
// (paiement mobile money jamais simulé, abonnement qui couvre les frais, contact
// mémorisé localement) : elle ne doit exister QU'UNE FOIS, sinon les deux écrans
// finiront par diverger — exactement le genre d'écart qui coûte de l'argent réel.
//
// Ce que le hook ne fait PAS : décider qu'un paiement a réussi. Il demande au
// backend d'initialiser (étape 1), ouvre la page CinetPay, puis demande au backend
// de vérifier (étape 2). Aucun succès n'est inventé côté navigateur.
//
// Si un ABONNEMENT est actif, le backend renvoie directement le numéro
// (`gratuit: true`, `viaAbonnement: true`) : le hook se contente de l'afficher.

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { confirmPayment, declarerDepot, initiatePayment, ouvrirPaiement, verifierDepot } from '../utils/payment.js';
import { ecrireContactsLocaux, lireContactsLocaux } from '../utils/contactsLocaux.js';
import { formatFcfa } from '../utils/format.js';
import { useAuth } from './useAuth.js';

// Demandes de dépôt mobile money déclarées par l'utilisateur, mémorisées sur
// l'appareil : elles permettent d'afficher « en attente de validation » (et le
// numéro de référence à donner au support) même après fermeture de l'app.
// ⚠️ Ce cache n'autorise RIEN : seul le serveur dit si le contact est débloqué.
const CLE_DEMANDES = 'rejoinsmoi.demandesDepot';

function lireDemandesLocales() {
  try {
    const brut = localStorage.getItem(CLE_DEMANDES);
    const objet = brut ? JSON.parse(brut) : {};
    return objet && typeof objet === 'object' ? objet : {};
  } catch {
    return {};
  }
}

function ecrireDemandesLocales(demandes) {
  try {
    localStorage.setItem(CLE_DEMANDES, JSON.stringify(demandes));
  } catch {
    /* mode privé : on continue sans persistance */
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.horsLigne=false] serveur injoignable (données de démo)
 * @param {string} [options.cheminConnexion='/main-doeuvre'] où revenir après connexion
 * @param {(besoin: object, details: {telephone: string, montant: number}) => void} [options.onDebloque]
 *        appelé après un déblocage réussi : la page met à jour la ligne affichée.
 */
export function useDeblocageContact({
  horsLigne = false,
  cheminConnexion = '/main-doeuvre',
  onDebloque,
} = {}) {
  const navigate = useNavigate();
  const { connecte, estDemo, ajouterInteraction } = useAuth();

  const [contacts, setContacts] = useState(() => lireContactsLocaux());
  const [demandes, setDemandes] = useState(() => lireDemandesLocales());
  const [enCours, setEnCours] = useState('');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  /** La demande de dépôt mémorisée pour un besoin (null si aucune). */
  const maDemande = useCallback((id) => demandes[String(id)] || null, [demandes]);

  /** Le contact de cette annonce est-il déjà débloqué sur cet appareil ? */
  const telephoneDebloque = useCallback(
    (id) => contacts[String(id)]?.telephone || null,
    [contacts]
  );

  /** Mémorise un contact débloqué (miroir local + historique + page appelante). */
  const memoriserContact = useCallback(
    (besoin, telephone, montant) => {
      const libelle = [besoin.titre || besoin.metier, besoin.quartier].filter(Boolean).join(' · ');
      setContacts((prec) => {
        const suivant = {
          ...prec,
          [String(besoin.id)]: { telephone, montant, libelle, at: new Date().toISOString() },
        };
        ecrireContactsLocaux(suivant);
        return suivant;
      });
      ajouterInteraction({ type: 'contact', terme: `job:${besoin.id}`, telephone, libelle });
      onDebloque?.(besoin, { telephone, montant: Number(montant) || 0 });
    },
    [ajouterInteraction, onDebloque]
  );

  /**
   * Étape 1/2 — Débloquer le contact : initialise le paiement (500 FCFA) ou récupère
   * directement le numéro si l'abonnement est actif ou si la mission est journalière.
   */
  const debloquer = useCallback(
    async (besoin) => {
      if (!connecte) {
        navigate('/connexion', { state: { depuis: cheminConnexion } });
        return;
      }
      if (estDemo) {
        setErreur(
          'Profil de démonstration : aucun paiement n’est possible, donc le contact reste masqué. Créez un compte réel pour débloquer un numéro.'
        );
        return;
      }
      if (horsLigne) {
        setErreur('Serveur injoignable : impossible de débloquer ce contact pour le moment.');
        return;
      }

      setErreur('');
      setMessage('');
      setEnCours(String(besoin.id));
      try {
        const reponse = await initiatePayment(besoin.id);
        if (reponse.debloque && reponse.telephoneContact) {
          memoriserContact(besoin, reponse.telephoneContact, reponse.montantPaye ?? reponse.montant);
          setMessage(
            reponse.message ||
              (reponse.gratuit
                ? 'Premier contact offert pour cette mission journalière : appelez directement.'
                : 'Contact débloqué. Votre historique le conserve.')
          );
        } else if (reponse.paiementRequis) {
          setContacts((prec) => {
            const suivant = {
              ...prec,
              [String(besoin.id)]: { transactionId: reponse.transactionId, at: new Date().toISOString() },
            };
            ecrireContactsLocaux(suivant);
            return suivant;
          });
          ouvrirPaiement(reponse.paymentUrl);
          setMessage(
            `Paiement de ${formatFcfa(reponse.montant)} à finaliser sur ${reponse.operateurs.join(
              ' / '
            )}. L’onglet de paiement vient de s’ouvrir : revenez ici puis appuyez sur « J’ai payé ».`
          );
        } else {
          setErreur(reponse.message || 'Le paiement n’a pas abouti. Le contact reste masqué.');
        }
      } catch (err) {
        setErreur(
          err?.message || 'Déblocage impossible pour le moment. Réessayez dans quelques instants.'
        );
      } finally {
        setEnCours('');
      }
    },
    [connecte, estDemo, horsLigne, navigate, cheminConnexion, memoriserContact]
  );

  /** Étape 2/2 — Vérification : le backend interroge CinetPay et révèle le numéro. */
  const verifierPaiement = useCallback(
    async (besoin) => {
      const transactionId = contacts[String(besoin.id)]?.transactionId;
      setErreur('');
      setEnCours(String(besoin.id));
      try {
        const reponse = await confirmPayment(besoin.id, transactionId);
        memoriserContact(besoin, reponse.telephoneContact, reponse.montantPaye);
        setMessage(reponse.message || 'Paiement confirmé : contact débloqué.');
      } catch (err) {
        setErreur(err?.message || 'Paiement non confirmé. Le contact reste masqué.');
      } finally {
        setEnCours('');
      }
    },
    [contacts, memoriserContact]
  );

  /**
   * PAIEMENT MANUEL — « J'ai payé » : enregistre une demande de dépôt mobile money.
   * Ne débloque rien par elle-même : un administrateur doit la valider (voir
   * routes/admin.js). On mémorise la référence localement pour l'afficher.
   */
  const demanderDepot = useCallback(
    async (besoin, { operateur, telephonePayeur = '', reference = '' } = {}) => {
      if (!connecte) {
        navigate('/connexion', { state: { depuis: cheminConnexion } });
        return null;
      }
      if (estDemo || horsLigne) {
        setErreur('Aucune déclaration de paiement possible hors ligne ou en démonstration.');
        return null;
      }

      setErreur('');
      setMessage('');
      setEnCours(String(besoin.id));
      try {
        const reponse = await declarerDepot(besoin.id, { operateur, telephonePayeur, reference });

        // Cas particulier : le besoin était déjà débloqué (abonnement, 1re mission
        // offerte…). Le serveur le dit, on affiche directement le contact.
        if (reponse.debloque && reponse.telephoneContact) {
          memoriserContact(besoin, reponse.telephoneContact, reponse.montant);
          setMessage(reponse.message || 'Contact déjà débloqué.');
          return reponse;
        }

        setDemandes((prec) => {
          const suivant = {
            ...prec,
            [String(besoin.id)]: {
              statut: reponse.statut,
              operateur: reponse.operateur,
              montant: reponse.montant,
              devise: reponse.devise,
              reference: reponse.depot?.reference || reference,
              depotId: reponse.depot?.id || null,
              at: new Date().toISOString(),
            },
          };
          ecrireDemandesLocales(suivant);
          return suivant;
        });
        setMessage(
          `Dépôt déclaré (${formatFcfa(reponse.montant)} via ${
            reponse.depots.find((d) => d.canal === reponse.operateur)?.libelle || reponse.operateur
          }). Nous vérifions votre paiement, puis le numéro s'affichera ici.`
        );
        return reponse;
      } catch (err) {
        setErreur(err?.message || 'Déclaration impossible pour le moment. Réessayez.');
        return null;
      } finally {
        setEnCours('');
      }
    },
    [connecte, estDemo, horsLigne, navigate, cheminConnexion, memoriserContact]
  );

  /**
   * PAIEMENT MANUEL — interroge le serveur : ma demande a-t-elle été validée ?
   * Si oui, le contact est révélé et mémorisé (même chemin que l'abonnement).
   */
  const verifierMaDemande = useCallback(
    async (besoin) => {
      setErreur('');
      setEnCours(String(besoin.id));
      try {
        const reponse = await verifierDepot(besoin.id);
        if (reponse.debloque && reponse.telephoneContact) {
          memoriserContact(besoin, reponse.telephoneContact, reponse.montant);
          setDemandes((prec) => {
            const suivant = { ...prec };
            delete suivant[String(besoin.id)];
            ecrireDemandesLocales(suivant);
            return suivant;
          });
          setMessage('Paiement validé : le numéro de contact est affiché.');
          return true;
        }
        setMessage(
          'Votre dépôt est enregistré mais pas encore validé. Réessayez dans quelques minutes ou écrivez au support WhatsApp.'
        );
        return false;
      } catch (err) {
        setErreur(err?.message || 'Vérification impossible pour le moment.');
        return false;
      } finally {
        setEnCours('');
      }
    },
    [memoriserContact]
  );

  return {
    contacts,
    demandes,
    enCours,
    erreur,
    message,
    setErreur,
    setMessage,
    telephoneDebloque,
    maDemande,
    memoriserContact,
    debloquer,
    verifierPaiement,
    demanderDepot,
    verifierMaDemande,
  };
}

export default useDeblocageContact;
