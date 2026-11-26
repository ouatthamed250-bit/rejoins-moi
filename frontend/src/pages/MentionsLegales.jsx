// MentionsLegales.jsx — Page « Mentions légales » (bloc G du 12/10).
//
// Objectif : dire la VÉRITÉ sur ce que fait l'application — quelles données sont
// collectées, pourquoi, ce qui est public, et COMMENT les faire supprimer ou corriger
// (WhatsApp, où une personne répond). Il n'y a volontairement aucune promesse
// d'auto-suppression : ce bouton n'existe pas dans l'application.
//
// On n'y parle PAS de déclaration ARTCI : elle n'est pas déposée à ce jour. Voir
// config/legal.js (commentaire en tête) avant d'ajouter la moindre mention de conformité.
//
// Contenu accessible depuis le profil, l'écran de connexion et le menu principal.

import { Icon } from '../components/Icons.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import { TEXTE_DONNEES, LIEN_DONNEES, NUMERO_SUPPORT } from '../config/legal.js';

/** Un bloc titré, style sobre (pas de couleur vive : on n'est pas dans un parcours). */
function Bloc({ titre, icone, children }) {
  return (
    <section className="mb-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink">
        <Icon name={icone} size={15} className="text-primary" />
        {titre}
      </h2>
      <div className="flex flex-col gap-1 text-xs leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

export default function MentionsLegales() {
  return (
    <div className="ecran py-3">
      <h1 className="text-xl font-bold text-ink">Mentions légales</h1>
      <p className="mb-3 text-sm text-ink-muted">
        Ce que Rejoins’Moi enregistre, pourquoi, et comment faire supprimer ou corriger vos données.
      </p>

      {/* La phrase unique (config/legal.js) : identique sur le profil et à la connexion. */}
      <InfoBanner variante="info" titre="Supprimer ou corriger vos données" className="mb-4">
        {TEXTE_DONNEES}.{' '}
        <a
          className="font-semibold text-primary underline"
          href={LIEN_DONNEES}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ouvrir WhatsApp
        </a>{' '}
        — le message est déjà rédigé, vous n’avez qu’à l’envoyer.
      </InfoBanner>

      <Bloc titre="Qui édite l’application" icone="store">
        <p>
          Rejoins’Moi, application de mise en relation avec les commerces, artisans et main-d’œuvre
          de proximité à Abidjan (Côte d’Ivoire).
        </p>
        <p>
          Contact unique, WhatsApp : <span className="font-semibold text-ink">{NUMERO_SUPPORT}</span>
        </p>
      </Bloc>

      <Bloc titre="Données enregistrées" icone="user">
        <p>
          <span className="font-semibold text-ink">Compte :</span> numéro de téléphone, mot de passe
          (conservé haché, jamais lisible), nom et prénom si vous les renseignez, métier déclaré,
          quartier/commune, photo de profil si vous en ajoutez une.
        </p>
        <p>
          <span className="font-semibold text-ink">Fiche d’établissement :</span> nom, catégorie,
          description, adresse/quartier, horaires, téléphone et jusqu’à deux photos, plus le texte du
          bouton d’action.
        </p>
        <p>
          <span className="font-semibold text-ink">Position :</span> uniquement si vous l’autorisez,
          pour trier par distance. Refuser la position n’empêche pas d’utiliser l’application (vous
          pouvez choisir votre quartier à la main).
        </p>
        <p>
          <span className="font-semibold text-ink">Annonces et mises en relation :</span> annonces de
          main-d’œuvre publiées, contacts débloqués, avis laissés.
        </p>
      </Bloc>

      <Bloc titre="À quoi servent ces données" icone="message">
        <p>
          Uniquement à la mise en relation : vous rendre trouvable, afficher les établissements
          autour de vous, et permettre à un artisan et un client de se joindre.
        </p>
        <p>
          Aucune revente, aucun partage avec des annonceurs, aucun profilage publicitaire. Aucun
          outil de mesure d’audience tiers n’est installé dans l’application.
        </p>
      </Bloc>

      <Bloc titre="Ce qui est public, ce qui ne l’est pas" icone="lock">
        <p>
          Les fiches d’établissement (nom, catégorie, adresse, horaires, photos) sont publiques :
          c’est le principe de l’annuaire.
        </p>
        <p>
          Le numéro de téléphone d’un artisan ou d’un chercheur de boulot n’est{' '}
          <span className="font-semibold text-ink">jamais</span> affiché dans les listes : il n’est
          révélé qu’après votre demande de contact, et cette révélation est enregistrée côté
          serveur.
        </p>
      </Bloc>

      <Bloc titre="Contact et utilisation" icone="wallet">
        <p>
          L’application est ouverte à tous : consulter les fiches et demander un contact se fait
          directement dans l’application, sans information bancaire à saisir.
        </p>
        <p>
          Toute évolution des conditions d’utilisation sera annoncée ici avant sa mise en service.
        </p>
      </Bloc>

      <Bloc titre="Pharmacies et cliniques" icone="pharmacy">
        <p>
          Aucune note, aucun avis, aucun commentaire n’est affiché pour les pharmacies et les
          cliniques (déontologie médicale), et aucun classement par popularité n’est calculé. Le
          statut « de garde » est déclaré par l’établissement lui-même : il doit être confirmé par
          téléphone en cas d’urgence.
        </p>
      </Bloc>

      <Bloc titre="Combien de temps" icone="clock">
        <p>
          Les données de votre compte sont conservées tant que le compte existe. Il n’y a pas encore
          de purge automatique : c’est justement pour cela que la suppression se demande par
          WhatsApp, où elle est traitée à la main.
        </p>
      </Bloc>

      <Bloc titre="Vos droits" icone="check">
        <p>
          Vous pouvez demander à consulter, corriger ou supprimer les données liées à votre compte.
          Écrivez-nous sur WhatsApp au{' '}
          <span className="font-semibold text-ink">{NUMERO_SUPPORT}</span> :{' '}
          <a
            className="font-semibold text-primary underline"
            href={LIEN_DONNEES}
            target="_blank"
            rel="noopener noreferrer"
          >
            ouvrir WhatsApp
          </a>
          .
        </p>
        <p>Nous répondons pendant les heures ouvrables (8h - 18h, Abidjan).</p>
      </Bloc>
    </div>
  );
}
