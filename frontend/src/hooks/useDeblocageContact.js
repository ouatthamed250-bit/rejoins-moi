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

import { confirmPayment, initiatePayment, ouvrirPaiement } from '../utils/payment.js';
import { ecrireContactsLocaux, lireContactsLocaux } from '../utils/contactsLocaux.js';
import { formatFcfa } from '../utils/format.js';
import { useAuth } from './useAuth.js';

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
  const [enCours, setEnCours] = useState('');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

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

  return {
    contacts,
    enCours,
    erreur,
    message,
    setErreur,
    setMessage,
    telephoneDebloque,
    memoriserContact,
    debloquer,
    verifierPaiement,
  };
}

export default useDeblocageContact;
