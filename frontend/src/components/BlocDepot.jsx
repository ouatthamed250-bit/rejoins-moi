// BlocDepot.jsx — Paiement MANUEL par dépôt mobile money (Wave / Orange Money / MTN MoMo).
//
// Pourquoi ce composant : la passerelle CinetPay n'est pas encore branchée, mais on ne
// peut pas laisser un utilisateur bloqué devant « paiement indisponible ». On affiche
// donc le parcours réel du lancement :
//   1. l'utilisateur envoie les 500 FCFA au numéro de son opérateur (copié depuis ici) ;
//   2. il appuie sur « J'ai payé » -> la demande part au serveur (`onDeclarer`) ;
//   3. un administrateur valide dans le back-office, puis il appuie sur « Vérifier »
//      (`onVerifier`) et le numéro de contact s'affiche.
//
// ⚠️ Ce composant ne débloque JAMAIS un contact : il ne fait que collecter une
// déclaration et interroger le serveur. La vérité vient de Job.contactDebloquePar.

import { useState } from 'react';

import { Icon } from './Icons.jsx';
import { formatFcfa, formatTelephone } from '../utils/format.js';

export default function BlocDepot({
  montant,
  devise = 'XOF',
  depots = [],
  support = null,
  demande = null,
  enCours = false,
  onDeclarer,
  onVerifier,
}) {
  const [ouvert, setOuvert] = useState(false);
  const [operateur, setOperateur] = useState(depots[0]?.canal || '');
  const [reference, setReference] = useState('');
  const [telephonePayeur, setTelephonePayeur] = useState('');

  const choisi = depots.find((d) => d.canal === operateur) || depots[0] || null;

  // ── 2e étape : une demande est enregistrée, on attend la validation de l'équipe.
  if (demande && demande.statut === 'en_attente') {
    return (
      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
        <p className="flex items-center gap-1 text-[11px] font-bold text-amber-800">
          <Icon name="clock" size={14} />
          Dépôt enregistré — en attente de validation
        </p>
        <p className="mt-1 text-[11px] leading-snug text-amber-800">
          {formatFcfa(demande.montant)} déclarés
          {demande.reference ? ` · référence ${demande.reference}` : ''}. Notre équipe vérifie le
          dépôt, puis le numéro s’affichera ici. Vous pouvez revenir plus tard : rien n’est perdu.
        </p>
        <button
          type="button"
          className="bouton-principal mt-2 w-full text-sm"
          onClick={() => onVerifier?.()}
          disabled={enCours}
        >
          <Icon name="unlock" size={17} />
          {enCours ? 'Vérification…' : 'Le numéro s’affiche-t-il ? Vérifier'}
        </button>
        {support?.whatsapp && (
          <a
            className="btn-ghost mt-2 w-full text-xs"
            href={`https://wa.me/${support.whatsapp}?text=${encodeURIComponent(
              `Bonjour Rejoins'Moi, j'ai payé ${formatFcfa(demande.montant)} par ${
                demande.operateur || 'dépôt'
              }${demande.reference ? ` (réf. ${demande.reference})` : ''}. Pouvez-vous valider mon déblocage ?`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="whatsapp" size={16} />
            Relancer le support sur WhatsApp
          </a>
        )}
      </div>
    );
  }

  // ── 1re étape : le paiement se fait par dépôt mobile money.
  return (
    <div className="mt-2">
      <button
        type="button"
        className={`bouton-principal w-full text-sm ${ouvert ? 'opacity-70' : ''}`}
        onClick={() => setOuvert((v) => !v)}
        disabled={enCours}
      >
        <Icon name="wallet" size={17} />
        {ouvert ? 'Masquer les instructions' : `Payer par dépôt — ${formatFcfa(montant)}`}
      </button>

      {ouvert && (
        <div className="mt-2 rounded-md border border-line bg-soft p-2">
          <p className="text-[11px] font-bold text-ink">
            1. Envoyez {formatFcfa(montant)} au numéro ci-dessous
          </p>

          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {depots.map((d) => (
              <button
                key={d.canal}
                type="button"
                onClick={() => setOperateur(d.canal)}
                className={`rounded-md border px-1 py-1.5 text-[10px] font-bold ${
                  operateur === d.canal
                    ? 'border-primary bg-primary text-white'
                    : 'border-line bg-white text-ink-muted'
                }`}
              >
                {d.libelle}
              </button>
            ))}
          </div>

          {choisi && (
            <div className="mt-1.5 rounded-md border border-primary/30 bg-white p-2 text-center">
              <p className="text-[10px] font-semibold uppercase text-ink-muted">
                Numéro {choisi.libelle} (Rejoins’Moi)
              </p>
              <p className="text-lg font-bold text-primary">{formatTelephone(choisi.numero)}</p>
              <p className="text-[10px] text-ink-muted">Montant exact : {formatFcfa(montant)}</p>
            </div>
          )}

          <p className="mt-2 text-[11px] font-bold text-ink">
            2. Déclarez votre paiement (numéro utilisé et référence, si vous les avez)
          </p>
          <input
            className="input mt-1 w-full text-sm"
            type="tel"
            inputMode="tel"
            placeholder="Votre numéro de dépôt (ex. 07 07 12 34 56)"
            value={telephonePayeur}
            onChange={(e) => setTelephonePayeur(e.target.value)}
          />
          <input
            className="input mt-1 w-full text-sm"
            type="text"
            placeholder="Référence / ID de transaction reçu de l’opérateur"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />

          <button
            type="button"
            className="bouton-principal mt-2 w-full text-sm"
            disabled={enCours || !operateur}
            onClick={() => onDeclarer?.({ operateur, telephonePayeur, reference })}
          >
            <Icon name="check" size={17} />
            {enCours ? 'Envoi…' : 'J’ai payé — déclarer mon dépôt'}
          </button>

          <p className="mt-1 text-[10px] leading-snug text-ink-muted">
            Le numéro de contact ne s’affiche qu’après vérification du dépôt par l’équipe
            Rejoins’Moi. Conservez la référence de la transaction : elle accélère la validation.
          </p>
        </div>
      )}
    </div>
  );
}
