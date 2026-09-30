// Messages.jsx — Onglet « Messages » de la navigation basse.
//
// ⚠️ ÉTAT HONNÊTE DU PRODUIT : il n'y a PAS encore de messagerie interne
// (pas de socket, pas de WebSocket, pas de collection de conversations côté
// backend). Plutôt que d'afficher une fausse liste de discussions, cet écran
// explique le canal réellement utilisé aujourd'hui — WhatsApp / appel direct —
// et centralise les conversations en cours détectées localement à partir des
// interactions de l'utilisateur (besoins dont il a débloqué le contact).
//
// Feuille de route (à valider) : ajouter un modèle `Conversation` + Socket.IO
// quand le volume d'échanges WhatsApp le justifiera. C'est volontaire de ne pas
// ouvrir ce chantier maintenant : le terrain passe déjà par WhatsApp (voir §10).

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import { Icon } from '../components/Icons.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { formatDateRelative, formatTelephone } from '../utils/format.js';
import { listerMisesEnRelation } from '../utils/contactsLocaux.js';

const NUMERO_SUPPORT = '+2250700000000';

export default function Messages() {
  const navigate = useNavigate();
  const { connecte, profil, historique, setMessagesNonLus } = useAuth();

  // Mises en relation = besoins de main-d'œuvre dont le contact a été débloqué :
  // miroir local (survit au rechargement) + historique de la session.
  const misesEnRelation = useMemo(() => listerMisesEnRelation(historique).slice(0, 20), [historique]);

  return (
    <div className="ecran py-3">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Messages</h1>
        <button
          type="button"
          className="text-xs font-bold text-primary underline"
          onClick={() => setMessagesNonLus(0)}
        >
          Tout marquer comme lu
        </button>
      </div>

      <InfoBanner variante="info" titre="Le contact passe par WhatsApp" className="mb-3">
        Rejoins’Moi met en relation, mais la conversation se poursuit sur WhatsApp ou par appel direct : c’est plus
        simple, moins cher et déjà installé sur tous les téléphones.
      </InfoBanner>

      {!connecte ? (
        <EmptyState
          icone="user"
          titre="Connectez-vous pour retrouver vos contacts"
          description="Vos mises en relation débloquées apparaîtront ici, sur tous vos appareils."
          action={{ libelle: 'Se connecter', onClick: () => navigate('/connexion', { state: { depuis: '/messages' } }) }}
        />
      ) : misesEnRelation.length === 0 ? (
        <EmptyState
          icone="briefcase"
          titre="Aucune mise en relation pour le moment"
          description="Débloquez le contact d’un besoin de main-d’œuvre : il apparaîtra ici pour être recontacté facilement."
          action={{ libelle: 'Voir les besoins', onClick: () => navigate('/main-doeuvre') }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {misesEnRelation.map((m) => (
            <li key={m.id} className="carte flex items-center gap-3 p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon name="briefcase" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">
                  {m.libelle || 'Besoin de main-d’œuvre'}
                </p>
                <p className="text-[11px] text-ink-muted">
                  Contact débloqué {formatDateRelative(m.at)}
                  {m.telephone ? ` · ${formatTelephone(m.telephone)}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost px-3 py-2 text-xs"
                onClick={() => navigate('/main-doeuvre')}
              >
                Ouvrir
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-md border border-line p-3">
        <p className="text-sm font-bold text-ink">Besoin d’aide ?</p>
        <p className="mb-2 text-xs text-ink-muted">
          Écrivez-nous sur WhatsApp : nous répondons pendant les heures ouvrables (8h - 18h, Abidjan).
        </p>
        <a
          className="btn-ghost w-full text-sm"
          href={`https://wa.me/${NUMERO_SUPPORT.replace('+', '')}?text=${encodeURIComponent(
            `Bonjour Rejoins'Moi, je suis ${profil?.nomComplet || 'un utilisateur'}.`
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
