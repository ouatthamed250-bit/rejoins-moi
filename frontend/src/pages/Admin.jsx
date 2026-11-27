// Admin.jsx — Back-office administrateur (espace PLEIN ÉCRAN, route /admin).
//
// ⚠️ VOLONTAIREMENT SÉPARÉ de l'app mobile (App.jsx + pages/*.jsx) : autre feuille de style
// (styles/admin.css, préfixe `bo-`), autre structure (barre latérale + tableaux), autre
// parcours. Un administrateur ne doit jamais confondre son outil de travail avec l'écran
// qu'il est en train de tester. Le jeton admin est stocké à part de la session utilisateur
// (utils/api/admin.js) : /admin s'ouvre donc sans déconnecter le compte « normal ».
//
// Ce que le back-office fait, et rien d'autre :
//   1. TABLEAU DE BORD : combien d'inscrits, qui s'est vraiment connecté (24 h / 7 j),
//      combien de comptes suspendus, combien d'argent est entré par les dépôts.
//   2. DÉPÔTS : la passerelle CinetPay n'étant pas branchée, le déblocage d'un contact se
//      paie par dépôt Wave / Orange Money / MTN MoMo. L'utilisateur déclare « j'ai payé »
//      (components/BlocDepot.jsx) ; c'est ICI, et nulle part ailleurs, qu'on vérifie la
//      réception du montant. Valider un dépôt est le seul geste qui révèle le contact.
//   3. UTILISATEURS : rechercher un compte, lire sa fiche (activité, paiements, contacts
//      débloqués), puis VALIDER ou SUSPENDRE. La suspension coupe la connexion ET les
//      jetons déjà émis (middleware/auth.js côté serveur) : elle reste réversible.
//   4. ACTIVITÉ : le journal fusionné des inscriptions, des connexions et des paiements.
//   5. CATÉGORIES PROPOSÉES : les métiers locaux que les gérants ont saisis faute de
//      les trouver dans la liste (« Poissonnerie », « Cordonnerie »). Valider l'ajoute
//      aux choix des prochains inscrits, refuser le laisse sur la fiche sans le proposer.
//   6. MON PROFIL : identité administrateur, changement de mot de passe, déconnexion.
//
// Aucun déblocage « automatique » : valider un dépôt écrit `viaDepot: true` dans
// Job.contactDebloquePar côté serveur. Le front déclenche, il ne décide pas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { adminApi, getAdminToken, setAdminToken } from '../utils/api/admin.js';
import { libelleFamille } from '../config/categories.js';
import { CENTRE_DEFAUT } from '../utils/position.js';
import { formatDateRelative, formatFcfa, formatNote, formatTelephone, initiales } from '../utils/format.js';

/* ─────────────────────────── Repères de navigation ─────────────────────────── */

const SECTIONS = [
  {
    cle: 'tableau',
    libelle: 'Vue d’ensemble',
    icone: 'chart',
    sous: 'Suivi des comptes, de la présence réelle et des paiements',
    groupe: 'Suivi',
  },
  {
    cle: 'depots',
    libelle: 'Dépôts',
    icone: 'wallet',
    sous: 'Vérification manuelle des dépôts mobile money',
    groupe: 'Suivi',
  },
  {
    cle: 'utilisateurs',
    libelle: 'Utilisateurs',
    icone: 'users',
    sous: 'Comptes inscrits : recherche, fiche, validation et suspension',
    groupe: 'Suivi',
  },
  {
    cle: 'etablissements',
    libelle: 'Établissements',
    icone: 'store',
    sous: 'Catalogue des fiches : gérants, contacts et état de publication',
    groupe: 'Suivi',
  },
  {
    // Import massif de la base OpenStreetMap (27/11). Rangé juste après le
    // catalogue : c'est une opération SUR les fiches, pas un écran de suivi.
    cle: 'import',
    libelle: 'Import de données',
    icone: 'download',
    sous: 'Base OpenStreetMap de Côte d’Ivoire : simulation et import des fiches',
    groupe: 'Suivi',
  },
  {
    // Prompt 9 : les agents qui inscrivent des commerces sur le terrain. Leur code
    // à 6 caractères est la seule clé de la paie — d'où un écran dédié, et non un
    // filtre de plus dans le catalogue.
    cle: 'agents',
    libelle: 'Agents de terrain',
    icone: 'mapPin',
    sous: 'Codes agents, fiches créées, export CSV de paie et fiches à vérifier',
    groupe: 'Suivi',
  },
  {
    // Prompt 9 : la carte répond à une question que le tableau ne sait pas dire —
    // QUI travaille en ce moment, et où. Elle n'affiche que les agents en service
    // et activés, jamais tous les téléphones de l'équipe.
    cle: 'carteAgents',
    libelle: 'Carte des agents',
    icone: 'mapPin',
    sous: 'Agents en service et leur dernière position GPS',
    groupe: 'Suivi',
  },
  {
    cle: 'activite',
    libelle: 'Activité',
    icone: 'activity',
    sous: 'Inscriptions, connexions et paiements, dans un seul journal',
    groupe: 'Suivi',
  },
  {
    cle: 'reclamations',
    libelle: 'Réclamations',
    icone: 'mapPin',
    sous: 'Fiches importées : valider ou refuser « c’est mon établissement »',
    groupe: 'Suivi',
  },
  {
    cle: 'categories',
    libelle: 'Catégories proposées',
    icone: 'grid',
    sous: 'Métiers saisis par les gérants (« Autre (précisez) ») à valider ou refuser',
    groupe: 'Suivi',
  },
  {
    cle: 'annonces',
    libelle: 'Annonces signalées',
    icone: 'flag',
    sous: 'Offres et demandes signalées par les utilisateurs : examiner, puis retirer',
    groupe: 'Suivi',
  },
  {
    cle: 'messages',
    libelle: 'Modération des messages',
    icone: 'message',
    sous: 'Retrouver les conversations d’un compte et les exporter (réquisition légale)',
    groupe: 'Suivi',
  },
  {
    cle: 'misesEnAvant',
    libelle: 'Mises en avant',
    icone: 'star',
    sous: 'Demandes « Je veux être mis en avant » à rappeler pour les options de visibilité',
    groupe: 'Suivi',
  },
  {
    cle: 'profil',
    libelle: 'Mon profil',
    icone: 'shieldCheck',
    sous: 'Votre compte administrateur : sécurité, session et déconnexion',
    groupe: 'Compte',
  },
];

const GROUPES = ['Suivi', 'Compte'];

/**
 * Onglets principaux, affichés en haut de CHAQUE écran du back-office.
 *
 * Pourquoi une seconde navigation alors que la barre latérale existe déjà ?
 * Parce que le travail quotidien tient en cinq écrans (regarder l'ensemble,
 * ouvrir un compte, vérifier une fiche, modérer une annonce, rappeler une mise
 * en avant). La barre latérale garde la navigation EXHAUSTIVE (dépôts, journal,
 * réclamations, catégories, profil) ; cette barre-ci met les cinq gestes
 * courants à un clic, toujours au même endroit, avec leur compteur.
 */
const ONGLETS_PRINCIPAUX = [
  { cle: 'tableau', libelle: 'Vue d’ensemble', icone: 'chart' },
  { cle: 'utilisateurs', libelle: 'Utilisateurs', icone: 'users' },
  { cle: 'etablissements', libelle: 'Établissements', icone: 'store' },
  { cle: 'annonces', libelle: 'Annonces signalées', icone: 'flag' },
  { cle: 'misesEnAvant', libelle: 'Mises en avant', icone: 'star' },
];

const LIBELLE_OPERATEUR = { WAVE: 'Wave', ORANGE_MONEY: 'Orange Money', MTN_MOMO: 'MTN MoMo' };
const LIBELLE_DEPOT = { en_attente: 'À vérifier', valide: 'Validé', rejete: 'Rejeté' };
const CLASSE_DEPOT = { en_attente: 'attente', valide: 'ok', rejete: 'ko' };

const ONGLETS_FILTRE = [
  { cle: '', libelle: 'Tous les comptes', compteur: 'utilisateurs', icone: 'users' },
  { cle: 'actifs', libelle: 'Actifs', compteur: 'actifs', icone: 'userCheck' },
  { cle: 'suspendus', libelle: 'Suspendus', compteur: 'suspendus', icone: 'ban' },
  { cle: 'artisans', libelle: 'Artisans', compteur: 'artisans', icone: 'tools' },
  { cle: 'chercheurs', libelle: 'Chercheurs', compteur: 'chercheurs', icone: 'briefcase' },
  { cle: 'admins', libelle: 'Administrateurs', compteur: 'admins', icone: 'shield' },
  // Comptes effacés (droit à l'oubli, 20/11) : ils n'ont plus de nom ni de numéro.
  // L'onglet existe pour l'AUDIT (« ce compte a-t-il bien été anonymisé ? »), jamais
  // pour du démarchage : plus aucune donnée personnelle n'y figure.
  { cle: 'effaces', libelle: 'Effacés', compteur: 'effaces', icone: 'close' },
];

const TRIS = [
  { cle: 'recents', libelle: 'Inscription récente' },
  { cle: 'activite', libelle: 'Dernière connexion' },
  { cle: 'anciens', libelle: 'Comptes dormants' },
  { cle: 'nom', libelle: 'Nom (A → Z)' },
];

const ONGLETS_ACTIVITE = [
  { cle: 'tout', libelle: 'Tout', icone: 'activity' },
  { cle: 'inscriptions', libelle: 'Inscriptions', icone: 'userCheck' },
  { cle: 'connexions', libelle: 'Connexions', icone: 'eye' },
  { cle: 'paiements', libelle: 'Paiements', icone: 'wallet' },
];

/* ─────────────────────────── Formatage local ─────────────────────────── */

const FR_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const FR_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const FR_JOUR = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

/** « 01/10/2026 » — tiret si la date manque (on n'écrit jamais « Invalid Date »). */
function formatDate(valeur) {
  if (!valeur) return '—';
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? '—' : FR_DATE.format(d);
}

/** « 01/10/26 14:20 » — pour les colonnes denses (listes, journaux). */
function formatDateHeure(valeur) {
  if (!valeur) return '—';
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? '—' : FR_DATE_HEURE.format(d);
}

/** « lun » à partir de « 2026-10-01 » (série des 7 derniers jours). */
function formatJourCourt(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : FR_JOUR.format(d).replace('.', '');
}

function nomComplet(u) {
  if (!u) return 'Sans nom';
  return [u.prenom, u.nom].filter(Boolean).join(' ') || 'Sans nom';
}

function libelleOperateur(cle) {
  return LIBELLE_OPERATEUR[cle] || 'Mobile money';
}

/* ─────────────────────────── Petits blocs partagés ─────────────────────────── */

function Alerte({ variante = 'info', icone = 'info', children, onFermer }) {
  return (
    <div className={`bo-alerte bo-alerte--${variante}`} role="status">
      <Icon name={icone} size={16} />
      <span>{children}</span>
      {onFermer ? (
        <button type="button" className="bo-btn bo-btn--lien bo-alerte-fermer" onClick={onFermer}>
          Fermer
        </button>
      ) : null}
    </div>
  );
}

function EtatVide({ texte, icone = 'search', action }) {
  return (
    <div className="bo-vide">
      <Icon name={icone} size={26} />
      <span className="bo-vide-titre">{texte}</span>
      {action}
    </div>
  );
}

function EtatChargement({ texte = 'Chargement…' }) {
  return (
    <div className="bo-chargement" aria-live="polite">
      <Icon name="loader" size={20} className="bo-tourne" />
      <p className="bo-petit">{texte}</p>
    </div>
  );
}

function Badge({ variante = 'info', icone, children }) {
  return (
    <span className={`bo-badge bo-badge--${variante}`}>
      {icone ? <Icon name={icone} size={12} /> : null}
      {children}
    </span>
  );
}

function Tuile({ libelle, valeur, note, noteVariante = '', couleur = '', icone, onClick }) {
  const classe = `bo-tuile${couleur ? ` bo-tuile--${couleur}` : ''}${onClick ? ' bo-tuile--cliquable' : ''}`;
  const contenu = (
    <>
      <span className="bo-tuile-libelle">
        {icone ? <Icon name={icone} size={13} /> : null}
        {libelle}
      </span>
      <span className="bo-tuile-valeur">{valeur}</span>
      {note ? (
        <span className={`bo-tuile-note${noteVariante ? ` bo-tuile-note--${noteVariante}` : ''}`}>{note}</span>
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={classe} onClick={onClick}>
        {contenu}
      </button>
    );
  }
  return <div className={classe}>{contenu}</div>;
}

function Panneau({ titre, sous, actions, children, serre = false }) {
  return (
    <section className="bo-panneau">
      {titre || actions ? (
        <header className="bo-panneau-tete">
          <div className="bo-entete-texte">
            {titre ? <h2 className="bo-panneau-titre">{titre}</h2> : null}
            {sous ? <p className="bo-panneau-sous">{sous}</p> : null}
          </div>
          {actions ? <div className="bo-ligne-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`bo-panneau-corps${serre ? ' bo-panneau-corps--serre' : ''}`}>{children}</div>
    </section>
  );
}

/** Puces d'état d'un compte — l'état le plus important d'abord (la suspension). */
function EtatCompte({ utilisateur }) {
  if (!utilisateur) return null;
  // Compte effacé (droit à l'oubli) : ni actif ni suspendu — il n'existe plus
  // qu'à l'état de trace technique pour la comptabilité.
  if (utilisateur.supprime || utilisateur.supprimeAt) {
    return (
      <Badge variante="susp" icone="close">
        Effacé
      </Badge>
    );
  }
  if (utilisateur.suspendu || utilisateur.statutCompte === 'suspendu') {
    return (
      <Badge variante="ko" icone="ban">
        Suspendu
      </Badge>
    );
  }
  return (
    <Badge variante="ok">
      <span className="bo-point" />
      Actif
    </Badge>
  );
}

/** Rôle d'un compte : admin d'abord (il peut tout), puis artisan / chercheur. */
function RolesCompte({ utilisateur }) {
  return (
    <div className="bo-ligne-actions">
      {utilisateur?.estAdmin ? (
        <Badge variante="admin" icone="shield">
          Administrateur
        </Badge>
      ) : null}
      {utilisateur?.estArtisan ? <Badge variante="info">Artisan</Badge> : null}
      {utilisateur?.chercheTravail ? <Badge variante="susp">Cherche un emploi</Badge> : null}
      {!utilisateur?.estAdmin && !utilisateur?.estArtisan && !utilisateur?.chercheTravail ? (
        <span className="bo-petit bo-doux">Compte simple</span>
      ) : null}
    </div>
  );
}

/** Une ligne de la présentation de gauche (écran de connexion). */
function PucePresentation({ icone, children }) {
  return (
    <li className="bo-connexion-item">
      <span className="bo-connexion-item-icone">
        <Icon name={icone} size={15} />
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Écran de connexion du back-office : DEUX PANNEAUX, pas un formulaire au milieu du vide.
 * Il doit être évident, en une seconde, qu'on n'est PAS dans l'application mobile.
 */
function PanneauConnexion({ erreurInitiale = '', onConnexion }) {
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [voir, setVoir] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(erreurInitiale);

  const soumettre = async (e) => {
    e.preventDefault();
    if (!identifiant.trim() || !motDePasse) {
      setErreur('Numéro et mot de passe sont obligatoires.');
      return;
    }
    setEnCours(true);
    setErreur('');
    try {
      const reponse = await adminApi.login(identifiant.trim(), motDePasse);
      onConnexion(reponse);
    } catch (err) {
      setErreur(err?.message || 'Connexion impossible. Vérifiez le numéro et le mot de passe.');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="bo bo-connexion">
      <aside className="bo-connexion-presentation">
        <div className="bo-connexion-marque">
          <span className="bo-nav-logo">
            <Icon name="shield" size={18} />
          </span>
          <span className="bo-nav-marque-texte">
            <span className="bo-nav-marque-nom">Rejoins’Moi</span>
            <span className="bo-nav-marque-role">Back-office</span>
          </span>
        </div>

        <h1 className="bo-connexion-titre">Le suivi de la plateforme, séparé de l’application.</h1>
        <p className="bo-connexion-texte">
          Cet espace sert à suivre les utilisateurs et l’argent, pas à chercher un emploi. Il est
          volontairement différent de l’application mobile : tableaux, filtres, compteurs.
        </p>

        <ul className="bo-connexion-liste">
          <PucePresentation icone="wallet">
            Vérifier les dépôts Wave / Orange Money / MTN MoMo et débloquer les contacts payés.
          </PucePresentation>
          <PucePresentation icone="users">
            Voir qui s’inscrit, qui se connecte vraiment, et suspendre un compte abusif.
          </PucePresentation>
          <PucePresentation icone="activity">
            Relire le journal des inscriptions, des connexions et des paiements.
          </PucePresentation>
        </ul>
      </aside>

      <div className="bo-connexion-formulaire">
        <form className="bo-connexion-boite" onSubmit={soumettre}>
          <div>
            <h2 className="bo-connexion-boite-titre">Connexion administrateur</h2>
            <p className="bo-connexion-boite-sous">
              Accès réservé. Identifiez-vous avec le numéro et le mot de passe du compte
              administrateur (l’authentification se fait par téléphone, sans e-mail).
            </p>
          </div>

          <label className="bo-champ">
            <span className="bo-etiquette">Numéro de téléphone</span>
            <input
              className="bo-entree"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              placeholder="+225 07 07 12 34 56"
              value={identifiant}
              onChange={(e) => setIdentifiant(e.target.value)}
            />
          </label>

          <label className="bo-champ">
            <span className="bo-etiquette">Mot de passe</span>
            <input
              className="bo-entree"
              type={voir ? 'text' : 'password'}
              autoComplete="current-password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
          </label>

          <button type="button" className="bo-btn bo-btn--lien" onClick={() => setVoir((v) => !v)}>
            <Icon name="eye" size={14} />
            {voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          </button>

          {erreur ? (
            <Alerte variante="erreur" icone="alert">
              {erreur}
            </Alerte>
          ) : null}

          <button type="submit" className="bo-btn bo-btn--principal bo-btn--bloc" disabled={enCours}>
            <Icon name="lock" size={15} />
            {enCours ? 'Connexion…' : 'Ouvrir le back-office'}
          </button>

          <p className="bo-connexion-note">
            Le jeton de cette session est conservé séparément de celui de l’application : vous
            pouvez rester connecté sur /admin et sur votre compte utilisateur en même temps.
          </p>
        </form>
      </div>
    </div>
  );
}

/**
 * Barre latérale : navigation du back-office + identité de l'administrateur en bas.
 * Les pastilles (dépôts à vérifier, comptes, connectés) viennent des statistiques déjà
 * chargées par l'écran : elles ne déclenchent aucune requête supplémentaire.
 */
function NavLaterale({ admin, section, stats, annoncesSignalees, onSection, onDeconnecter }) {
  const pastille = (s) => {
    if (!stats) return null;
    if (s.cle === 'depots') {
      const n = stats.depots?.enAttente || 0;
      return (
        <span className={`bo-nav-pastille bo-nav-pastille--${n > 0 ? 'alerte' : 'calme'}`}>{n}</span>
      );
    }
    if (s.cle === 'utilisateurs') {
      return <span className="bo-nav-pastille bo-nav-pastille--calme">{stats.utilisateurs || 0}</span>;
    }
    if (s.cle === 'etablissements') {
      return <span className="bo-nav-pastille bo-nav-pastille--calme">{stats.etablissements || 0}</span>;
    }
    if (s.cle === 'annonces') {
      // File de modération : une pastille rouge dès qu'une annonce est signalée,
      // rien du tout quand la file est vide (on ne montre jamais « 0 » en rouge).
      if (!annoncesSignalees) return null;
      return <span className="bo-nav-pastille bo-nav-pastille--alerte">{annoncesSignalees}</span>;
    }
    if (s.cle === 'misesEnAvant') {
      const n = stats.listeAttente?.enAttente || 0;
      return n > 0 ? <span className="bo-nav-pastille bo-nav-pastille--alerte">{n}</span> : null;
    }
    if (s.cle === 'activite') {
      const n = stats.connectes?.dernier24h || 0;
      return <span className="bo-nav-pastille bo-nav-pastille--calme">{n}</span>;
    }
    return null;
  };

  return (
    <nav className="bo-nav">
      <div className="bo-nav-marque">
        <span className="bo-nav-logo">
          <Icon name="shield" size={18} />
        </span>
        <span className="bo-nav-marque-texte">
          <span className="bo-nav-marque-nom">Rejoins’Moi</span>
          <span className="bo-nav-marque-role">Back-office</span>
        </span>
      </div>

      <div className="bo-nav-sections">
        {GROUPES.map((groupe) => (
          <div key={groupe} className="bo-nav-groupe">
            <p className="bo-nav-titre">{groupe}</p>
            {SECTIONS.filter((s) => s.groupe === groupe).map((s) => (
              <button
                key={s.cle}
                type="button"
                className={`bo-nav-lien${section === s.cle ? ' bo-nav-lien--actif' : ''}`}
                onClick={() => onSection(s.cle)}
              >
                <Icon name={s.icone} size={16} />
                <span className="bo-nav-lien-texte">{s.libelle}</span>
                {pastille(s)}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="bo-nav-pied">
        <div className="bo-nav-identite">
          <span className="bo-nav-avatar">{initiales(nomComplet(admin)) || 'AD'}</span>
          <span className="bo-nav-identite-texte">
            <span className="bo-nav-identite-nom">{nomComplet(admin)}</span>
            <span className="bo-nav-identite-numero">{formatTelephone(admin?.telephone)}</span>
          </span>
        </div>
        <button type="button" className="bo-nav-lien" onClick={onDeconnecter}>
          <Icon name="logOut" size={16} />
          <span className="bo-nav-lien-texte">Se déconnecter</span>
        </button>
      </div>
    </nav>
  );
}

/** Pastille d'un dépôt selon son statut (journal d'activité et file des dépôts). */
function StatutDepot({ statut }) {
  return (
    <Badge variante={CLASSE_DEPOT[statut] || 'susp'} icone={statut === 'valide' ? 'check' : undefined}>
      {LIBELLE_DEPOT[statut] || statut}
    </Badge>
  );
}

/* ─────────────────────────── Écran principal du back-office ─────────────────────────── */

export default function Admin() {
  const [jeton, setJeton] = useState(() => getAdminToken());
  const [admin, setAdmin] = useState(null);
  const [verification, setVerification] = useState(Boolean(getAdminToken()));
  const [section, setSection] = useState('tableau');
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState(null);
  const [statsErreur, setStatsErreur] = useState('');
  // Nombre d'annonces dans la file de modération : il alimente la pastille de
  // l'onglet « Annonces signalées ». `null` = pas encore connu (aucune pastille).
  const [annoncesSignalees, setAnnoncesSignalees] = useState(null);
  const [chargementStats, setChargementStats] = useState(false);
  // `cle` force le rechargement des vues : « Actualiser » réincrémente ce compteur au lieu
  // de dupliquer un state de rechargement dans chaque section.
  const [cle, setCle] = useState(0);
  const [utilisateurOuvert, setUtilisateurOuvert] = useState(null);
  const [filtreUtilisateurs, setFiltreUtilisateurs] = useState('');

  const deconnecter = useCallback((raison = '') => {
    setAdminToken(null);
    setJeton(null);
    setAdmin(null);
    setStats(null);
    setStatsErreur('');
    setSection('tableau');
    setMessage('');
    setErreur(raison);
  }, []);

  /** Vérifie le jeton conservé : il peut avoir expiré ou le rôle admin avoir été retiré. */
  const verifierSession = useCallback(async () => {
    if (!getAdminToken()) {
      setVerification(false);
      setAdmin(null);
      return;
    }
    setVerification(true);
    try {
      const reponse = await adminApi.moi();
      setAdmin(reponse?.user || null);
      setErreur('');
    } catch (err) {
      deconnecter(err?.status === 403 ? 'Ce compte n’a plus les droits administrateur.' : '');
    } finally {
      setVerification(false);
    }
  }, [deconnecter]);

  useEffect(() => {
    verifierSession();
  }, [verifierSession]);

  const connecte = Boolean(jeton && admin);

  /** Statistiques d'ensemble : elles alimentent le tableau de bord ET les pastilles du menu. */
  const chargerStats = useCallback(async () => {
    if (!getAdminToken()) return;
    setChargementStats(true);
    try {
      // Les deux appels partent EN PARALLÈLE : la file de modération ne doit pas
      // retarder l'affichage du tableau de bord. Un échec sur la file (route plus
      // ancienne, réseau…) reste silencieux — il ne masque aucune statistique.
      const [donnees, file] = await Promise.all([
        adminApi.statistiques(),
        adminApi.annoncesSignalees().catch(() => null),
      ]);
      setStats(donnees);
      setStatsErreur('');
      setAnnoncesSignalees(Array.isArray(file?.items) ? file.items.length : null);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        deconnecter('Votre session administrateur n’est plus valide. Reconnectez-vous.');
      } else {
        setStatsErreur(err?.message || 'Statistiques indisponibles pour le moment.');
      }
    } finally {
      setChargementStats(false);
    }
  }, [deconnecter]);

  useEffect(() => {
    if (connecte) chargerStats();
  }, [connecte, chargerStats, cle]);

  /**
   * Renvoie `true` si l'erreur a été traitée ici (session coupée) : les vues n'affichent
   * alors rien de plus, l'écran de connexion reprend la main.
   */
  const gererErreur = useCallback(
    (err) => {
      if (err?.status === 401 || err?.status === 403) {
        deconnecter('Votre session administrateur n’est plus valide (jeton expiré ou droits retirés).');
        return true;
      }
      return false;
    },
    [deconnecter]
  );

  const rafraichir = () => {
    setCle((n) => n + 1);
    setMessage('');
  };

  /** Ouvre la fiche d'un compte depuis n'importe quelle section (dépôts, journal…). */
  const ouvrirUtilisateur = (id, filtre) => {
    setUtilisateurOuvert(id || null);
    if (filtre !== undefined) setFiltreUtilisateurs(filtre);
    setSection('utilisateurs');
  };

  if (verification) {
    return (
      <div className="bo">
        <div className="bo-chargement">
          <Icon name="loader" size={22} className="bo-tourne" />
          <p className="bo-petit">Vérification de la session administrateur…</p>
        </div>
      </div>
    );
  }

  if (!connecte) {
    return (
      <PanneauConnexion
        erreurInitiale={erreur}
        onConnexion={(reponse) => {
          setAdminToken(reponse.token);
          setJeton(reponse.token);
          setAdmin(reponse.user);
          setErreur('');
          setSection('tableau');
        }}
      />
    );
  }

  const sectionActive = SECTIONS.find((s) => s.cle === section) || SECTIONS[0];
  const enAttente = stats?.depots?.enAttente || 0;

  return (
    <div className="bo">
      <NavLaterale
        admin={admin}
        section={section}
        stats={stats}
        annoncesSignalees={annoncesSignalees}
        onSection={setSection}
        onDeconnecter={() => deconnecter()}
      />

      <div className="bo-main">
        <header className="bo-entete">
          <div className="bo-entete-ligne">
            <div className="bo-entete-texte">
              <h1 className="bo-entete-titre">{sectionActive.libelle}</h1>
              <p className="bo-entete-sous">{sectionActive.sous}</p>
            </div>
            <div className="bo-entete-actions">
              {enAttente > 0 ? (
                <Badge variante="attente" icone="wallet">
                  {enAttente} dépôt{enAttente > 1 ? 's' : ''} à vérifier
                </Badge>
              ) : null}
              <button
                type="button"
                className="bo-btn bo-btn--petit"
                onClick={rafraichir}
                disabled={chargementStats}
              >
                <Icon name="refresh" size={14} className={chargementStats ? 'bo-tourne' : ''} />
                Actualiser
              </button>
              <button
                type="button"
                className="bo-btn bo-btn--petit"
                onClick={() => window.location.assign('/')}
              >
                <Icon name="home" size={14} />
                Ouvrir l’application
              </button>
            </div>
          </div>

          {/* Cinq onglets toujours visibles : ce sont les gestes du quotidien.
              Le compteur n'apparaît que s'il y a quelque chose à traiter. */}
          <div className="bo-onglets-principaux" role="tablist" aria-label="Écrans principaux">
            {ONGLETS_PRINCIPAUX.map((onglet) => {
              const actif = section === onglet.cle;
              const compte =
                onglet.cle === 'utilisateurs'
                  ? stats?.utilisateurs
                  : onglet.cle === 'etablissements'
                    ? stats?.etablissements
                    : onglet.cle === 'annonces'
                      ? annoncesSignalees
                      : onglet.cle === 'misesEnAvant'
                        ? stats?.listeAttente?.enAttente
                        : null;
              return (
                <button
                  key={onglet.cle}
                  type="button"
                  role="tab"
                  aria-selected={actif}
                  className={`bo-onglet-principal${actif ? ' bo-onglet-principal--actif' : ''}`}
                  onClick={() => setSection(onglet.cle)}
                >
                  <Icon name={onglet.icone} size={15} />
                  {onglet.libelle}
                  {compte ? <span className="bo-onglet-principal-compte">{compte}</span> : null}
                </button>
              );
            })}
          </div>
        </header>

        <main className="bo-contenu">
          {erreur ? (
            <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
              {erreur}
            </Alerte>
          ) : null}
          {message ? (
            <Alerte variante="succes" icone="check" onFermer={() => setMessage('')}>
              {message}
            </Alerte>
          ) : null}

          {section === 'tableau' ? (
            <VueTableauDeBord
              stats={stats}
              erreur={statsErreur}
              chargement={chargementStats}
              cle={cle}
              annoncesSignalees={annoncesSignalees}
              onGererErreur={gererErreur}
              onNaviguer={setSection}
              onOuvrirUtilisateur={ouvrirUtilisateur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'depots' ? (
            <VueDepots
              cle={cle}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onVoirUtilisateur={ouvrirUtilisateur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'utilisateurs' ? (
            <VueUtilisateurs
              cle={cle}
              filtreInitial={filtreUtilisateurs}
              utilisateurOuvert={utilisateurOuvert}
              onUtilisateurOuvert={setUtilisateurOuvert}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'etablissements' ? (
            <VueEtablissements
              cle={cle}
              stats={stats}
              onNaviguer={setSection}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'import' ? (
            <VueImportDonnees
              cle={cle}
              stats={stats}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'agents' ? (
            <VueAgentsDeTerrain
              cle={cle}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'carteAgents' ? (
            <VueCarteAgents
              cle={cle}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'activite' ? (
            <VueActivite
              cle={cle}
              onGererErreur={gererErreur}
              onVoirUtilisateur={ouvrirUtilisateur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'reclamations' ? (
            <VueReclamations
              cle={cle}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'categories' ? (
            <VueDemandesCategories
              cle={cle}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'annonces' ? (
            <VueAnnoncesSignalees
              cle={cle}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'messages' ? (
            <VueModerationMessages
              cle={cle}
              onMessage={setMessage}
              onGererErreur={gererErreur}
            />
          ) : null}

          {section === 'misesEnAvant' ? (
            <VueMisesEnAvant
              stats={stats}
              onNaviguer={setSection}
              onOuvrirUtilisateur={ouvrirUtilisateur}
              onRafraichir={rafraichir}
            />
          ) : null}

          {section === 'profil' ? (
            <VueProfil
              admin={admin}
              onAdmin={setAdmin}
              onMessage={setMessage}
              onGererErreur={gererErreur}
              onDeconnecter={() => deconnecter()}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
/* ─────────────────────────── 1. Tableau de bord ─────────────────────────── */

const ICONE_EVENEMENT = { inscription: 'userCheck', connexion: 'eye', paiement: 'wallet' };

/** Une ligne du journal fusionné (inscription, connexion ou paiement). */
function LigneEvenement({ evenement, onVoirUtilisateur }) {
  const type = evenement.type;
  const details = [];
  if (evenement.numero) details.push(formatTelephone(evenement.numero));
  if (type === 'paiement') {
    if (evenement.operateur) details.push(libelleOperateur(evenement.operateur));
    if (evenement.montant) details.push(formatFcfa(evenement.montant));
    if (evenement.reference) details.push(`réf. ${evenement.reference}`);
  }

  return (
    <div className="bo-journal-item">
      <span className={`bo-journal-icone bo-journal-icone--${type}`}>
        <Icon name={ICONE_EVENEMENT[type] || 'activity'} size={15} />
      </span>
      <div className="bo-journal-texte">
        <p className="bo-journal-titre">
          {evenement.titre}
          {type === 'inscription' && evenement.admin ? (
            <Badge variante="admin" icone="shield">
              Administrateur
            </Badge>
          ) : null}
          {type === 'connexion' && evenement.suspendu ? (
            <Badge variante="ko" icone="ban">
              Compte suspendu
            </Badge>
          ) : null}
          {type === 'paiement' && evenement.statut ? <StatutDepot statut={evenement.statut} /> : null}
        </p>
        <p className="bo-journal-detail">
          {evenement.qui}
          {details.length ? ` · ${details.join(' · ')}` : ''}
        </p>
      </div>
      <span className="bo-journal-date" title={formatDateHeure(evenement.at)}>
        {formatDateRelative(evenement.at) || '—'}
      </span>
      {onVoirUtilisateur && evenement.utilisateurId ? (
        <button
          type="button"
          className="bo-btn bo-btn--lien bo-btn--petit"
          onClick={() => onVoirUtilisateur(String(evenement.utilisateurId))}
        >
          Fiche
        </button>
      ) : null}
    </div>
  );
}

/** Valeur d'un onglet de filtre des utilisateurs (les compteurs viennent du serveur). */
function compteurOnglet(onglet, compteurs) {
  if (!compteurs) return 0;
  if (onglet.compteur === 'actifs') {
    // Le serveur ne renvoie pas « actifs » : c'est tout sauf les suspendus et les
    // comptes effacés (anonymisés, ils ne sont actifs pour personne).
    return Math.max(
      0,
      (compteurs.utilisateurs || 0) - (compteurs.suspendus || 0) - (compteurs.effaces || 0)
    );
  }
  return compteurs[onglet.compteur] || 0;
}


/**
 * Tableau de bord : l'état du parc, la présence réelle et l'argent reçu.
 * Les 8 derniers mouvements sont chargés à part (GET /activite) : un compteur dit combien,
 * jamais quoi — or c'est « quoi » que l'équipe veut voir en arrivant le matin.
 */
function VueTableauDeBord({
  stats,
  erreur,
  chargement,
  cle,
  annoncesSignalees,
  onGererErreur,
  onNaviguer,
  onOuvrirUtilisateur,
  onRafraichir,
}) {
  const [derniers, setDerniers] = useState(null);
  const [chargementJournal, setChargementJournal] = useState(false);
  const [erreurJournal, setErreurJournal] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargementJournal(true);
    adminApi
      .activite({ type: 'tout', limit: 8 })
      .then((reponse) => {
        if (!vivant) return;
        setDerniers(reponse?.evenements || []);
        setErreurJournal('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreurJournal(err?.message || 'Journal indisponible pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargementJournal(false);
      });
    return () => {
      vivant = false;
    };
  }, [cle, onGererErreur]);

  if (!stats && chargement) return <EtatChargement texte="Chargement des statistiques…" />;

  if (!stats) {
    return (
      <Panneau titre="Tableau de bord" sous="Les statistiques d’ensemble n’ont pas pu être chargées.">
        <Alerte variante="erreur" icone="alert">
          {erreur || 'Statistiques indisponibles. Rechargez l’écran.'}
        </Alerte>
        <div className="bo-ligne-actions bo-actions-sous-alerte">
          <button type="button" className="bo-btn" onClick={onRafraichir}>
            <Icon name="refresh" size={14} />
            Réessayer
          </button>
        </div>
      </Panneau>
    );
  }

  const serie = stats.depots?.serie7j || [];
  const plus = Math.max(1, ...serie.map((e) => e.total || 0));
  const connectes24h = stats.connectes?.dernier24h || 0;
  const connectes7j = stats.connectes?.dernier7j || 0;
  const enAttente = stats.depots?.enAttente || 0;

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="attention" icone="alert">
          {erreur}
        </Alerte>
      ) : null}

      <div className="bo-tuiles">
        <Tuile
          libelle="Comptes inscrits"
          valeur={stats.utilisateurs || 0}
          note={
            stats.effaces
              ? `+${stats.inscrits7j || 0} ces 7 derniers jours · ${stats.effaces} effacé(s)`
              : `+${stats.inscrits7j || 0} ces 7 derniers jours`
          }
          icone="users"
          couleur="accent"
          onClick={() => onNaviguer('utilisateurs')}
        />
        <Tuile
          libelle="Connectés (24 h)"
          valeur={connectes24h}
          note={`${connectes7j} sur 7 jours`}
          icone="eye"
          couleur="vert"
          noteVariante={connectes7j > 0 ? 'bien' : ''}
          onClick={() => onNaviguer('activite')}
        />
        <Tuile
          libelle="Dépôts à vérifier"
          valeur={enAttente}
          note={`${stats.depots?.aujourdhui || 0} reçus aujourd’hui`}
          icone="wallet"
          couleur={enAttente > 0 ? 'rouge' : ''}
          noteVariante={enAttente > 0 ? 'mal' : ''}
          onClick={() => onNaviguer('depots')}
        />
        <Tuile
          libelle="Encaissé (validé)"
          valeur={formatFcfa(stats.depots?.montantEncaisseFcfa || 0)}
          note={`${stats.depots?.valides || 0} dépôt(s) validé(s) · contact gratuit (100 % gratuit)`}
          icone="chart"
        />
        <Tuile
          libelle="Comptes suspendus"
          valeur={stats.suspendus || 0}
          note="Connexion coupée immédiatement, même avec un jeton déjà émis"
          icone="ban"
          couleur={stats.suspendus > 0 ? 'rouge' : ''}
        />
        <Tuile
          libelle="Mises en avant demandées"
          valeur={stats.listeAttente?.enAttente || 0}
          note="Demandes « Je veux être mis en avant »"
          icone="star"
          couleur={(stats.listeAttente?.enAttente || 0) > 0 ? 'accent' : ''}
          onClick={() => onNaviguer('misesEnAvant')}
        />
        <Tuile
          libelle="Annonces signalées"
          valeur={annoncesSignalees || 0}
          note={
            annoncesSignalees
              ? 'À examiner puis, si besoin, retirer'
              : 'Aucune annonce à modérer'
          }
          icone="flag"
          couleur={annoncesSignalees ? 'rouge' : ''}
          noteVariante={annoncesSignalees ? 'mal' : ''}
          onClick={() => onNaviguer('annonces')}
        />
        <Tuile
          libelle="Catégories proposées"
          valeur={stats.demandesCategorie?.enAttente || 0}
          note="Métiers locaux saisis par les gérants, à valider"
          icone="grid"
          couleur={(stats.demandesCategorie?.enAttente || 0) > 0 ? 'accent' : ''}
          onClick={() => onNaviguer('categories')}
        />
      </div>



      <div className="bo-colonnes">
        <Panneau
          titre="Dépôts des 7 derniers jours"
          sous="Nombre de dépôts reçus par jour ; l’infobulle donne les montants validés"
          actions={
            <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir} disabled={chargement}>
              <Icon name="refresh" size={13} className={chargement ? 'bo-tourne' : ''} />
              Actualiser
            </button>
          }
        >
          {serie.length === 0 ? (
            <EtatVide texte="Aucun dépôt enregistré sur la période." icone="wallet" />
          ) : (
            <div className="bo-barres">
              {serie.map((jour) => (
                <div
                  key={jour.jour}
                  className="bo-barre-colonne"
                  title={`${formatDate(jour.jour)} · ${jour.total || 0} dépôt(s) · ${formatFcfa(jour.montantValide || 0)} validés · ${jour.rejetes || 0} rejeté(s)`}
                >
                  <span className="bo-barre-valeur">{jour.total || 0}</span>
                  <div
                    className={`bo-barre${jour.total ? '' : ' bo-barre--vide'}`}
                    style={{ height: `${Math.round(((jour.total || 0) / plus) * 100)}%` }}
                  />
                  <span className="bo-barre-nom">{formatJourCourt(jour.jour)}</span>
                </div>
              ))}
            </div>
          )}
        </Panneau>

        <Panneau
          titre="Derniers mouvements"
          sous="Inscriptions, connexions et paiements, du plus récent au plus ancien"
          serre
          actions={
            <button type="button" className="bo-btn bo-btn--petit" onClick={() => onNaviguer('activite')}>
              <Icon name="activity" size={13} />
              Journal complet
            </button>
          }
        >
          {chargementJournal && !derniers ? <EtatChargement texte="Chargement du journal…" /> : null}
          {derniers && derniers.length === 0 ? (
            <EtatVide texte="Rien à signaler pour l’instant." icone="activity" />
          ) : null}
          {erreurJournal ? (
            <div className="bo-panneau-corps">
              <Alerte variante="attention" icone="alert">
                {erreurJournal}
              </Alerte>
            </div>
          ) : null}
          <div className="bo-journal">
            {(derniers || []).map((evenement, i) => (
              <LigneEvenement
                key={`${evenement.type}-${evenement.depotId || evenement.utilisateurId || i}-${i}`}
                evenement={evenement}
                onVoirUtilisateur={onOuvrirUtilisateur}
              />
            ))}
          </div>
        </Panneau>
      </div>

      <Panneau
        titre="Demandes de mise en avant"
        sous="« Je veux être mis en avant » — personnes à rappeler pour les options de visibilité"
      >
        {(stats.listeAttente?.recentes || []).length === 0 ? (
          <EtatVide texte="Aucune demande pour l’instant." icone="star" />
        ) : (
          <div className="bo-journal">
            {(stats.listeAttente?.recentes || []).map((demande) => (
              <div key={String(demande.id)} className="bo-journal-item">
                <span className="bo-journal-icone">
                  <Icon name="star" size={15} />
                </span>
                <div className="bo-journal-texte">
                  <p className="bo-journal-titre">
                    {demande.utilisateur?.nom || 'Compte utilisateur'}
                  </p>
                  <p className="bo-journal-detail">
                    {demande.etablissement?.nom
                      ? `Fiche : ${demande.etablissement.nom}`
                      : 'Profil artisan'}
                    {demande.utilisateur?.telephone
                      ? ` · ${formatTelephone(demande.utilisateur.telephone)}`
                      : ''}
                  </p>
                </div>
                <span className="bo-journal-date" title={formatDateHeure(demande.date)}>
                  {formatDateRelative(demande.date) || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panneau>

      <Panneau titre="Le reste du parc" sous="Ce que les tuiles du haut ne montrent pas">
        <div className="bo-mini-tuiles">
          {[
            { libelle: 'Artisans', valeur: stats.artisans || 0 },
            { libelle: 'Chercheurs d’emploi', valeur: stats.chercheurs || 0 },
            { libelle: 'Administrateurs', valeur: stats.administrateurs || 0 },
            { libelle: 'Inscrits (30 j)', valeur: stats.inscrits30j || 0 },
            { libelle: 'Établissements', valeur: stats.etablissements || 0 },
            { libelle: 'Annonces publiées', valeur: stats.jobs?.total || 0 },
            { libelle: 'Offres d’emploi', valeur: stats.jobs?.offres || 0 },
            { libelle: 'Demandes d’emploi', valeur: stats.jobs?.demandes || 0 },
            { libelle: 'Demandes de mise en avant', valeur: stats.listeAttente?.enAttente || 0 },
            { libelle: 'Abonnements actifs', valeur: stats.abonnementsActifs || 0 },
            { libelle: 'Dépôts validés', valeur: stats.depots?.valides || 0 },
            { libelle: 'Dépôts rejetés', valeur: stats.depots?.rejetes || 0 },
          ].map((mini) => (
            <div key={mini.libelle} className="bo-mini-tuile">
              <span className="bo-tuile-libelle">{mini.libelle}</span>
              <p className="bo-mini-tuile-valeur">{mini.valeur}</p>
            </div>
          ))}
        </div>
      </Panneau>
    </div>
  );
}

/* ─────────────────────────── 2. Dépôts mobile money ─────────────────────────── */

const ONGLETS_DEPOTS = [
  { cle: 'en_attente', libelle: 'À vérifier', icone: 'clock', compteur: 'enAttente' },
  { cle: 'valide', libelle: 'Validés', icone: 'check', compteur: 'valides' },
  { cle: 'rejete', libelle: 'Rejetés', icone: 'ban', compteur: 'rejetes' },
  { cle: 'tous', libelle: 'Tous', icone: 'wallet', compteur: null },
];

const TYPE_ANNONCE = { offre: 'Offre d’emploi', demande: 'Demande d’emploi', stage: 'Offre de stage' };

/**
 * File des dépôts mobile money. La passerelle CinetPay n'étant pas branchée, c'est ICI
 * que l'argent est vérifié à la main : valider un dépôt est le SEUL geste qui révèle le
 * contact payé (côté serveur, Job.contactDebloquePar avec viaDepot: true).
 * Rejeter laisse le contact masqué ; l'utilisateur peut redéclarer un dépôt.
 */
function VueDepots({ cle, onMessage, onGererErreur, onVoirUtilisateur, onRafraichir }) {
  const [statut, setStatut] = useState('en_attente');
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState('');
  // Action en attente de confirmation : { type: 'valider' | 'rejeter', depot }.
  const [action, setAction] = useState(null);
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .depots(statut)
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Dépôts indisponibles pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [statut, cle, onGererErreur]);

  const items = donnees?.items || [];
  const compteurs = donnees?.compteurs || { enAttente: 0, valides: 0, rejetes: 0 };

  // Filtre local : la route renvoie au plus 200 dépôts d'un statut donné ; retrouver UNE
  // référence précise ne doit pas coûter un aller-retour réseau de plus.
  const lignes = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return items;
    const chiffres = terme.replace(/\D/g, '');
    return items.filter((depot) => {
      const champs = [
        depot.reference,
        depot.telephonePayeur,
        depot.noteAdmin,
        depot.utilisateur?.nom,
        depot.utilisateur?.telephone,
        depot.job?.titre,
      ];
      if (champs.some((champ) => String(champ || '').toLowerCase().includes(terme))) return true;
      return chiffres.length >= 4 && String(depot.reference || '').includes(chiffres);
    });
  }, [items, recherche]);

  const confirmer = async () => {
    if (!action) return;
    setEnCours(true);
    try {
      const reponse =
        action.type === 'valider'
          ? await adminApi.validerDepot(action.depot.id)
          : await adminApi.rejeterDepot(action.depot.id, motif.trim() || 'Dépôt non retrouvé.');
      setAction(null);
      setMotif('');
      // On recharge tout (file + pastilles + statistiques) PUIS on annonce le résultat :
      // l'ordre compte, la fonction de rafraîchissement efface le message précédent.
      onRafraichir();
      onMessage(reponse?.message || (action.type === 'valider' ? 'Dépôt validé.' : 'Dépôt rejeté.'));
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Action impossible sur ce dépôt.');
    } finally {
      setEnCours(false);
    }
  };

  const ongletCourant = ONGLETS_DEPOTS.find((o) => o.cle === statut) || ONGLETS_DEPOTS[0];


  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      {action ? (
        <div className="bo-bloc-action">
          <p className="bo-bloc-action-titre">
            <Icon name={action.type === 'valider' ? 'check' : 'ban'} size={15} />
            {action.type === 'valider'
              ? 'Valider ce dépôt et révéler le contact ?'
              : 'Rejeter ce dépôt de paiement ?'}
          </p>
          {/* Récapitulatif COMPLET avant une décision IRRÉVERSIBLE (bloc F) : montant,
              opérateur, numéro payeur et référence, un par ligne. L’administrateur doit
              pouvoir comparer avec son relevé mobile money sans quitter l’écran : une fois
              validé, le contact est révélé et le dépôt ne peut plus être rejeté. */}
          <div className="bo-bloc-action-recap">
            <p className="bo-petit bo-doux">
              <strong>Compte :</strong> {nomComplet(action.depot.utilisateur) || 'compte inconnu'}
              {action.depot.utilisateur?.telephone
                ? ` (${formatTelephone(action.depot.utilisateur.telephone)})`
                : ''}
            </p>
            <p className="bo-petit bo-doux">
              <strong>Montant :</strong> {formatFcfa(action.depot.montant)}
            </p>
            <p className="bo-petit bo-doux">
              <strong>Opérateur :</strong> {libelleOperateur(action.depot.operateur)}
            </p>
            <p className="bo-petit bo-doux">
              <strong>Numéro payeur :</strong>{' '}
              {formatTelephone(action.depot.telephonePayeur) || 'non précisé'}
            </p>
            <p className="bo-petit bo-doux">
              <strong>Référence :</strong> {action.depot.reference || 'aucune référence fournie'}
            </p>
            <p className="bo-petit bo-doux">
              {action.type === 'valider'
                ? 'Le contact de l’annonce deviendra visible pour cet utilisateur. Décision DÉFINITIVE : un dépôt validé ne pourra plus être rejeté.'
                : 'Le contact RESTERA masqué et le motif ci-dessous sera affiché à l’utilisateur. Décision définitive.'}
            </p>
          </div>
          {action.type === 'rejeter' ? (
            <label className="bo-champ">
              <span className="bo-etiquette">Motif du rejet (visible par l’utilisateur)</span>
              <textarea
                className="bo-zone"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                placeholder="Dépôt non retrouvé sur le compte Wave indiqué…"
              />
            </label>
          ) : null}
          <div className="bo-ligne-actions">
            <button
              type="button"
              className={`bo-btn ${action.type === 'valider' ? 'bo-btn--ok' : 'bo-btn--danger'}`}
              onClick={confirmer}
              disabled={enCours}
            >
              <Icon name={enCours ? 'loader' : 'check'} size={14} className={enCours ? 'bo-tourne' : ''} />
              {action.type === 'valider' ? 'Confirmer la validation' : 'Confirmer le rejet'}
            </button>
            <button
              type="button"
              className="bo-btn"
              onClick={() => {
                setAction(null);
                setMotif('');
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      <Panneau
        titre={`Dépôts — ${ongletCourant.libelle}`}
        sous={`${lignes.length} dépôt(s) affiché(s). Chaque validation révèle le contact de l’annonce à l’utilisateur qui a payé.`}
        serre
        actions={
          <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir} disabled={chargement}>
            <Icon name="refresh" size={13} className={chargement ? 'bo-tourne' : ''} />
            Actualiser
          </button>
        }
      >
        <div className="bo-barre-outils">
          <div className="bo-onglets">
            {ONGLETS_DEPOTS.map((onglet) => (
              <button
                key={onglet.cle || 'tous'}
                type="button"
                className={`bo-onglet${statut === onglet.cle ? ' bo-onglet--actif' : ''}`}
                onClick={() => setStatut(onglet.cle)}
              >
                <Icon name={onglet.icone} size={13} />
                {onglet.libelle}
                {onglet.compteur ? (
                  <span className="bo-onglet-compte">{compteurs[onglet.compteur] || 0}</span>
                ) : null}
              </button>
            ))}
          </div>
          <label className="bo-champ bo-champ--large">
            <span className="bo-etiquette">Rechercher (compte, référence, annonce)</span>
            <input
              className="bo-entree"
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="07 07 …, RM-…, Wave, métier…"
            />
            {recherche ? (
              <button
                type="button"
                className="bo-btn bo-btn--lien bo-btn--petit"
                onClick={() => setRecherche('')}
              >
                Effacer
              </button>
            ) : null}
          </label>
        </div>

        {chargement && !donnees ? <EtatChargement texte="Chargement des dépôts…" /> : null}

        {!chargement && lignes.length === 0 ? (
          <EtatVide
            texte={
              recherche
                ? 'Aucun dépôt ne correspond à cette recherche.'
                : statut === 'en_attente'
                  ? 'Aucun dépôt à vérifier : la file est vide.'
                  : 'Aucun dépôt dans cet état pour l’instant.'
            }
            icone="wallet"
          />
        ) : null}

        {lignes.length ? (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Reçu le</th>
                  <th>Compte payeur</th>
                  <th>Annonce concernée</th>
                  <th>Paiement déclaré</th>
                  <th className="bo-tableau-num">Montant</th>
                  <th>État</th>
                  <th className="bo-tableau-actions">Vérification</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((depot) => (
                  <tr
                    key={depot.id}
                    className={depot.statut === 'rejete' ? 'bo-tableau-ligne--suspendu' : undefined}
                  >
                    <td className="bo-petit bo-doux">
                      {formatDateHeure(depot.createdAt)}
                      <span className="bo-sous-ligne">{formatDateRelative(depot.createdAt)}</span>
                    </td>
                    <td>
                      <div className="bo-cellule-principale">
                        <span className="bo-avatar">{initiales(nomComplet(depot.utilisateur)) || '?'}</span>
                        <span>
                          <span className="bo-nom">{nomComplet(depot.utilisateur)}</span>
                          <span className="bo-sous-ligne bo-petit bo-doux">
                            {formatTelephone(depot.utilisateur?.telephone) || 'numéro inconnu'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="bo-nom">{depot.job?.titre || 'Annonce supprimée'}</span>
                      <span className="bo-sous-ligne bo-petit bo-doux">
                        {TYPE_ANNONCE[depot.job?.typeAnnonce] || 'Annonce supprimée'}
                        {depot.utilisateur?.metier ? ` · ${depot.utilisateur.metier}` : ''}
                      </span>
                    </td>
                    <td>
                      <Badge variante="info" icone="wallet">
                        {libelleOperateur(depot.operateur)}
                      </Badge>
                      <span className="bo-sous-ligne bo-petit bo-doux">
                        {depot.reference ? `réf. ${depot.reference}` : 'aucune référence fournie'}
                      </span>
                      <span className="bo-sous-ligne bo-petit bo-doux">
                        payé par {formatTelephone(depot.telephonePayeur) || 'numéro non précisé'}
                      </span>
                    </td>
                    <td className="bo-tableau-num">{formatFcfa(depot.montant)}</td>
                    <td>
                      <StatutDepot statut={depot.statut} />
                      {depot.statut === 'valide' && depot.job?.telephoneContact ? (
                        <span className="bo-sous-ligne bo-petit bo-doux">
                          contact révélé : {formatTelephone(depot.job.telephoneContact)}
                        </span>
                      ) : null}
                      {depot.statut === 'rejete' && depot.noteAdmin ? (
                        <span className="bo-sous-ligne bo-petit bo-doux" title={depot.noteAdmin}>
                          motif : {depot.noteAdmin}
                        </span>
                      ) : null}
                      {/* QUI a tranché (bloc F) : la décision est définitive, elle doit être
                          attribuable. `validePar` est renvoyé par GET /api/admin/depots. */}
                      {depot.statut !== 'en_attente' ? (
                        <span className="bo-sous-ligne bo-petit bo-doux">
                          {depot.statut === 'valide' ? 'validé par' : 'rejeté par'}{' '}
                          {depot.validePar?.nom || 'administrateur inconnu'}
                          {depot.valideAt ? ` · ${formatDateRelative(depot.valideAt)}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="bo-tableau-actions">
                      <div className="bo-ligne-actions bo-ligne-actions--droite">
                        {depot.statut === 'en_attente' ? (
                          <>
                            <button
                              type="button"
                              className="bo-btn bo-btn--ok bo-btn--petit"
                              onClick={() => {
                                setAction({ type: 'valider', depot });
                                setMotif('');
                              }}
                            >
                              <Icon name="check" size={13} />
                              Valider
                            </button>
                            <button
                              type="button"
                              className="bo-btn bo-btn--danger bo-btn--petit"
                              onClick={() => {
                                setAction({ type: 'rejeter', depot });
                                setMotif('');
                              }}
                            >
                              <Icon name="ban" size={13} />
                              Rejeter
                            </button>
                          </>
                        ) : null}
                        {depot.utilisateur?.id ? (
                          <button
                            type="button"
                            className="bo-btn bo-btn--lien bo-btn--petit"
                            onClick={() => onVoirUtilisateur(String(depot.utilisateur.id))}
                          >
                            Fiche du compte
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panneau>
    </div>
  );
}


/* ─────────────────────────── 3. Utilisateurs ─────────────────────────── */

/**
 * Annuaire des comptes inscrits : on cherche, on trie, on lit la fiche, puis on VALIDE
 * ou on SUSPEND. La suspension coupe la connexion ET les jetons déjà émis
 * (middleware/auth.js) : elle est re-vérifiée à CHAQUE requête, pas seulement au login.
 * Les compteurs des onglets viennent du serveur (état global du parc) et non de la page
 * affichée : « 3 suspendus » doit rester vrai quel que soit le filtre en cours.
 */
function VueUtilisateurs({
  cle,
  filtreInitial,
  utilisateurOuvert,
  onUtilisateurOuvert,
  onMessage,
  onGererErreur,
  onRafraichir,
}) {
  const [recherche, setRecherche] = useState('');
  const [terme, setTerme] = useState('');
  const [filtre, setFiltre] = useState(filtreInitial || '');
  const [tri, setTri] = useState('recents');
  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  // Recherche retardée : une requête par frappe clavier serait du gaspillage pur.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      setTerme(recherche.trim());
      setPage(1);
    }, 320);
    return () => clearTimeout(minuteur);
  }, [recherche]);

  // Filtre imposé par une autre section (« voir les comptes suspendus », par exemple)
  // ou par « Actualiser » du haut de l'écran (via `cle`).
  useEffect(() => {
    setFiltre(filtreInitial || '');
    setPage(1);
  }, [filtreInitial, cle]);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .utilisateurs({ q: terme, filtre, tri, page, limit: 30 })
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Liste des comptes indisponible pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [terme, filtre, tri, page, cle, onGererErreur]);

  const items = donnees?.items || [];
  const compteurs = donnees?.compteurs || null;
  const total = donnees?.total || 0;
  const pages = donnees?.pages || 1;
  const pageCourante = donnees?.page || 1;
  const changerFiltre = (valeur) => {
    setFiltre(valeur);
    setPage(1);
  };

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      <Panneau
        titre="Comptes inscrits"
        sous={`${total} compte(s) dans ce filtre${compteurs ? ` · ${compteurs.connectes24h} connecté(s) ces 24 h · ${compteurs.suspendus} suspendu(s)${compteurs.effaces ? ` · ${compteurs.effaces} effacé(s)` : ''}` : ''}`}
        serre
        actions={
          <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir} disabled={chargement}>
            <Icon name="refresh" size={13} className={chargement ? 'bo-tourne' : ''} />
            Actualiser
          </button>
        }
      >
        <div className="bo-barre-outils">
          <label className="bo-champ bo-champ--large">
            <span className="bo-etiquette">Rechercher un compte</span>
            <input
              className="bo-entree"
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Nom, numéro (07 07…), métier, commune"
            />
          </label>
          <label className="bo-champ">
            <span className="bo-etiquette">Trier par</span>
            <select
              className="bo-selection"
              value={tri}
              onChange={(e) => {
                setTri(e.target.value);
                setPage(1);
              }}
            >
              {TRIS.map((option) => (
                <option key={option.cle} value={option.cle}>
                  {option.libelle}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="bo-barre-outils">
          <div className="bo-onglets">
            {ONGLETS_FILTRE.map((onglet) => (
              <button
                key={onglet.cle || 'tous'}
                type="button"
                className={`bo-onglet${filtre === onglet.cle ? ' bo-onglet--actif' : ''}`}
                onClick={() => changerFiltre(onglet.cle)}
              >
                <Icon name={onglet.icone} size={13} />
                {onglet.libelle}
                <span className="bo-onglet-compte">{compteurOnglet(onglet, compteurs)}</span>
              </button>
            ))}
          </div>
          <span className="bo-petit bo-doux">Cliquez une ligne pour ouvrir la fiche complète.</span>
        </div>



        {chargement && !donnees ? <EtatChargement texte="Chargement des comptes…" /> : null}

        {!chargement && items.length === 0 ? (
          <EtatVide
            texte={
              recherche.trim()
                ? 'Aucun compte ne correspond à cette recherche.'
                : 'Aucun compte dans ce filtre.'
            }
            icone="users"
          />
        ) : null}

        {items.length ? (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Rôle</th>
                  <th>Activité</th>
                  <th>Paiements</th>
                  <th>Inscription</th>
                  <th>Dernière connexion</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {items.map((compte) => (
                  <tr
                    key={compte.id}
                    className={`bo-tableau-ligne--cliquable${
                      compte.suspendu ? ' bo-tableau-ligne--suspendu' : ''
                    }${compte.supprime ? ' bo-tableau-ligne--efface' : ''}`}
                    onClick={() => onUtilisateurOuvert(String(compte.id))}
                  >
                    <td>
                      <div className="bo-cellule-principale">
                        <span className="bo-avatar">
                          {compte.supprime ? (
                            <Icon name="close" size={13} />
                          ) : (
                            initiales(nomComplet(compte)) || '?'
                          )}
                        </span>
                        <span>
                          <span className="bo-nom">{nomComplet(compte)}</span>
                          <span className="bo-sous-ligne bo-petit bo-doux">
                            {compte.supprime
                              ? 'compte anonymisé'
                              : formatTelephone(compte.telephone) || 'numéro inconnu'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <RolesCompte utilisateur={compte} />
                    </td>
                    <td>
                      <span className="bo-sous-ligne bo-petit bo-doux">
                        {compte.metier || 'métier non renseigné'}
                      </span>
                      <span className="bo-sous-ligne bo-petit bo-doux">
                        {compte.commune || 'commune non renseignée'}
                      </span>
                    </td>
                    <td>
                      <span className="bo-sous-ligne bo-petit">{`${compte.depots?.total || 0} dépôt(s)`}</span>
                      {compte.depots?.valides ? (
                        <span className="bo-sous-ligne bo-petit bo-doux">
                          {`${compte.depots.valides} validé(s) · ${formatFcfa(compte.depots.montantValide || 0)}`}
                        </span>
                      ) : null}
                      {compte.depots?.enAttente ? (
                        <span className="bo-sous-ligne">
                          <Badge variante="attente" icone="clock">
                            {`${compte.depots.enAttente} à vérifier`}
                          </Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="bo-petit bo-doux">{formatDate(compte.createdAt)}</td>
                    <td className="bo-petit bo-doux">
                      {compte.dernierLoginAt
                        ? formatDateRelative(compte.dernierLoginAt)
                        : 'jamais connecté'}
                    </td>
                    <td>
                      <EtatCompte utilisateur={compte} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {pages > 1 ? (
          <div className="bo-barre-outils bo-barre-outils--pied">
            <span className="bo-petit bo-doux">
              Page {pageCourante} sur {pages} · {total} compte(s)
            </span>
            <div className="bo-ligne-actions">
              <button
                type="button"
                className="bo-btn bo-btn--petit"
                disabled={pageCourante <= 1 || chargement}
                onClick={() => setPage(Math.max(1, pageCourante - 1))}
              >
                <Icon name="chevronLeft" size={13} />
                Précédent
              </button>
              <button
                type="button"
                className="bo-btn bo-btn--petit"
                disabled={pageCourante >= pages || chargement}
                onClick={() => setPage(Math.min(pages, pageCourante + 1))}
              >
                Suivant
                <Icon name="chevronRight" size={13} />
              </button>
            </div>
          </div>
        ) : null}
      </Panneau>

      {utilisateurOuvert ? (
        <TiroirUtilisateur
          utilisateurId={utilisateurOuvert}
          onFermer={() => onUtilisateurOuvert(null)}
          onMessage={onMessage}
          onGererErreur={onGererErreur}
          onRafraichir={onRafraichir}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────────── 4. Fiche d'un compte (tiroir) ─────────────────────────── */

/**
 * Fiche complète d'un compte, ouverte PAR-DESSUS la section en cours (dépôts,
 * utilisateurs, journal) : l'administrateur garde la liste en arrière-plan et referme
 * d'un clic sur le fond ou avec Échap.
 * Deux gestes seulement, mais décisifs : VALIDER (réactiver) et SUSPENDRE. Le serveur
 * refuse de suspendre un administrateur ou de changer son propre statut — le front n'a
 * donc qu'à afficher le message d'erreur renvoyé.
 */
function TiroirUtilisateur({ utilisateurId, onFermer, onMessage, onGererErreur, onRafraichir }) {
  const [fiche, setFiche] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [rechargement, setRechargement] = useState(0);
  const [suspendre, setSuspendre] = useState(false);
  const [motif, setMotif] = useState('');
  const [reinit, setReinit] = useState(false);
  const [nouveauMdp, setNouveauMdp] = useState('');
  const [enCours, setEnCours] = useState('');
  // Droit à l'effacement (20/11) : le geste est IRRÉVERSIBLE, il demande donc une
  // confirmation tapée à la main (le nom affiché du compte), et non un simple clic.
  const [effacer, setEffacer] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [motifEffacement, setMotifEffacement] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .utilisateur(utilisateurId)
      .then((reponse) => {
        if (!vivant) return;
        setFiche(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Fiche indisponible pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [utilisateurId, rechargement, onGererErreur]);

  // Échap referme le tiroir : un back-office se pilote aussi au clavier.
  useEffect(() => {
    const surTouche = (e) => {
      if (e.key === 'Escape') onFermer();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onFermer]);

  const utilisateur = fiche?.user || null;
  const resume = fiche?.resume || null;
  const depots = fiche?.depots || [];

  const changerStatut = async (statut) => {
    setEnCours(statut);
    try {
      const reponse = await adminApi.changerStatut(
        utilisateurId,
        statut,
        statut === 'suspendu' ? motif.trim() : ''
      );
      setSuspendre(false);
      setMotif('');
      onRafraichir();
      onMessage(reponse?.message || (statut === 'suspendu' ? 'Compte suspendu.' : 'Compte réactivé.'));
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Changement de statut impossible.');
    } finally {
      setEnCours('');
    }
  };

  const reinitialiser = async () => {
    if (nouveauMdp.length < 6) {
      setErreur('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setEnCours('motdepasse');
    try {
      const reponse = await adminApi.reinitialiserMotDePasse(utilisateurId, nouveauMdp);
      setReinit(false);
      setNouveauMdp('');
      onMessage(reponse?.message || 'Mot de passe réinitialisé.');
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Réinitialisation impossible.');
    } finally {
      setEnCours('');
    }
  };

  const suspendu = Boolean(utilisateur?.suspendu);
  const efface = Boolean(utilisateur?.supprime || utilisateur?.supprimeAt);
  // Exactement ce que le serveur attend : le nom complet s'il existe, sinon le
  // numéro (voir DELETE /api/admin/utilisateurs/:id). On ne recompose pas la chaîne
  // à la main — c'est `nomComplet` renvoyé par l'API qui fait foi.
  const attenduConfirmation = String(utilisateur?.nomComplet || utilisateur?.telephone || '').trim();
  const confirmationValide =
    Boolean(attenduConfirmation) &&
    confirmation.trim().toLowerCase() === attenduConfirmation.toLowerCase();

  /**
   * Efface le compte (anonymisation, pas suppression : voir
   * backend/src/services/suppressionCompte.js). Le serveur revérifie `confirmation`
   * contre le nom — ou le numéro — qu'il connaît : taper « n'importe quoi » renvoie
   * 400 et ne touche à rien. On recharge ensuite la fiche pour montrer l'état réel
   * (nom « Utilisateur supprimé », badge Effacé) : l'administrateur voit ce qu'il a
   * fait, il ne le suppose pas.
   */
  const effacerCompte = async () => {
    if (!confirmation.trim()) return;
    setEnCours('effacer');
    try {
      const reponse = await adminApi.supprimerUtilisateur(
        utilisateurId,
        confirmation.trim(),
        motifEffacement.trim()
      );
      setEffacer(false);
      setConfirmation('');
      setMotifEffacement('');
      onRafraichir();
      onMessage(
        reponse?.dejaSupprime
          ? 'Ce compte était déjà effacé.'
          : reponse?.message || 'Compte effacé : les données personnelles ont été anonymisées.'
      );
      setRechargement((n) => n + 1);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Effacement impossible.');
    } finally {
      setEnCours('');
    }
  };

  return (
    <div
      className="bo-tiroir-fond"
      role="dialog"
      aria-modal="true"
      aria-label="Fiche du compte"
      onClick={(e) => {
        // Clic sur le FOND uniquement : cliquer dans le tiroir ne doit pas le refermer.
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <aside className="bo-tiroir">
        <header className="bo-tiroir-tete">
          <div className="bo-fiche-titre">
            <span className="bo-avatar">{initiales(nomComplet(utilisateur)) || '?'}</span>
            <span>
              <span className="bo-fiche-nom">{nomComplet(utilisateur)}</span>
              <span className="bo-fiche-sous">
                {efface
                  ? 'numéro effacé'
                  : formatTelephone(utilisateur?.telephone) || 'numéro inconnu'}
              </span>
            </span>
          </div>
          <button type="button" className="bo-btn bo-btn--petit" onClick={onFermer}>
            <Icon name="close" size={13} />
            Fermer
          </button>
        </header>

        <div className="bo-tiroir-corps">
          {erreur ? (
            <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
              {erreur}
            </Alerte>
          ) : null}

          {chargement && !fiche ? <EtatChargement texte="Chargement de la fiche…" /> : null}

          {!chargement && !utilisateur ? (
            <EtatVide texte="Ce compte n’existe plus ou n’est pas accessible." icone="users" />
          ) : null}

          {utilisateur ? (
            <>
              <div className="bo-ligne-actions">
                <EtatCompte utilisateur={utilisateur} />
                <RolesCompte utilisateur={utilisateur} />
              </div>

              {efface ? (
                <Alerte variante="attention" icone="close">
                  Compte effacé
                  {utilisateur.supprimeAt ? ` le ${formatDateHeure(utilisateur.supprimeAt)}` : ''} :
                  nom, numéro, photo, favoris et avis ont été anonymisés. Les dépôts et abonnements
                  payés sont conservés sans donnée personnelle (comptabilité). Aucune action n’est
                  possible sur ce compte ; la personne peut en recréer un avec le même numéro.
                </Alerte>
              ) : null}

              {suspendu ? (
                <Alerte variante="attention" icone="ban">
                  Compte suspendu
                  {utilisateur.motifSuspension ? ` : ${utilisateur.motifSuspension}` : ''}
                  {utilisateur.suspenduAt ? ` (depuis le ${formatDate(utilisateur.suspenduAt)})` : ''}
                  . La connexion est coupée immédiatement, même avec un jeton déjà émis.
                </Alerte>
              ) : null}

              <div className="bo-mini-tuiles">
                <div className="bo-mini-tuile">
                  <span className="bo-petit bo-doux">Dépôts</span>
                  <span className="bo-sous-ligne bo-mini-tuile-valeur">{resume?.depots?.total || 0}</span>
                  <span className="bo-petit bo-doux">
                    {`${resume?.depots?.enAttente || 0} en attente · ${resume?.depots?.rejetes || 0} rejeté(s)`}
                  </span>
                </div>
                <div className="bo-mini-tuile">
                  <span className="bo-petit bo-doux">Encaissé</span>
                  <span className="bo-sous-ligne bo-mini-tuile-valeur">
                    {formatFcfa(resume?.depots?.montantValideFcfa || 0)}
                  </span>
                  <span className="bo-petit bo-doux">dépôts validés</span>
                </div>
                <div className="bo-mini-tuile">
                  <span className="bo-petit bo-doux">Contacts débloqués</span>
                  <span className="bo-sous-ligne bo-mini-tuile-valeur">{resume?.contactsDebloques || 0}</span>
                  <span className="bo-petit bo-doux">annonces payées</span>
                </div>
                <div className="bo-mini-tuile">
                  <span className="bo-petit bo-doux">Réputation</span>
                  <span className="bo-sous-ligne bo-mini-tuile-valeur">
                    {`${resume?.noteMoyenne || 0}/5`}
                  </span>
                  <span className="bo-petit bo-doux">
                    {`${resume?.avis || 0} avis · ${resume?.favoris || 0} favori(s)`}
                  </span>
                </div>
              </div>

              <dl className="bo-dl">
                <dt>Capacités</dt>
                <dd>
                  {[
                    utilisateur.estArtisan ? 'Artisan / prestataire' : null,
                    utilisateur.chercheTravail ? 'Cherche du travail' : null,
                    utilisateur.estAdmin ? 'Administrateur' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Aucune capacité déclarée'}
                </dd>
                <dt>Métier / lieu</dt>
                <dd>
                  {[utilisateur.metier, utilisateur.commune, utilisateur.quartier].filter(Boolean).join(' · ') ||
                    '—'}
                </dd>
                <dt>Téléphone</dt>
                <dd className="bo-mono">
                  {efface ? '—' : formatTelephone(utilisateur.telephone) || '—'}
                </dd>
                <dt>Inscription</dt>
                <dd>{formatDateHeure(utilisateur.createdAt)}</dd>
                <dt>Dernière connexion</dt>
                <dd>
                  {utilisateur.dernierLoginAt
                    ? `${formatDateHeure(utilisateur.dernierLoginAt)} (${formatDateRelative(utilisateur.dernierLoginAt)})`
                    : 'jamais connecté'}
                </dd>
                <dt>Abonnement</dt>
                <dd>{utilisateur.abonnementActif ? 'Abonnement actif' : 'Aucun abonnement en cours'}</dd>
                <dt>Interactions</dt>
                <dd>{`${resume?.interactions || 0} signaux enregistrés (algorithme du feed)`}</dd>
                {utilisateur.bio ? (
                  <>
                    <dt>Présentation</dt>
                    <dd>{utilisateur.bio}</dd>
                  </>
                ) : null}
              </dl>

              <h3 className="bo-section-titre">
                <Icon name="wallet" size={14} />
                Dépôts du compte
              </h3>
              <p className="bo-petit bo-doux">
                {`${resume?.depots?.total || 0} dépôt(s) déclaré(s) · les 20 derniers sont listés ci-dessous.`}
              </p>

              {depots.length === 0 ? (
                <EtatVide texte="Ce compte n’a jamais déclaré de dépôt mobile money." icone="wallet" />
              ) : (
                <div className="bo-tableau-enveloppe">
                  <table className="bo-tableau">
                    <thead>
                      <tr>
                        <th>Reçu le</th>
                        <th className="bo-tableau-num">Montant</th>
                        <th>Paiement</th>
                        <th>Annonce</th>
                        <th>État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {depots.map((depot) => (
                        <tr key={depot.id}>
                          <td className="bo-petit bo-doux">
                            {formatDateHeure(depot.createdAt)}
                            <span className="bo-sous-ligne">{formatDateRelative(depot.createdAt)}</span>
                          </td>
                          <td className="bo-tableau-num">{formatFcfa(depot.montant)}</td>
                          <td className="bo-petit">
                            {libelleOperateur(depot.operateur)}
                            <span className="bo-sous-ligne bo-doux">
                              {depot.reference ? `réf. ${depot.reference}` : 'sans référence'}
                            </span>
                          </td>
                          <td className="bo-petit bo-doux">{depot.job?.titre || 'Annonce supprimée'}</td>
                          <td>
                            <StatutDepot statut={depot.statut} />
                            {depot.noteAdmin ? (
                              <span className="bo-sous-ligne bo-petit bo-doux">{depot.noteAdmin}</span>
                            ) : null}
                            {/* Qui a tranché ce dépôt (bloc F). */}
                            {depot.statut !== 'en_attente' ? (
                              <span className="bo-sous-ligne bo-petit bo-doux">
                                {depot.statut === 'valide' ? 'validé par' : 'rejeté par'}{' '}
                                {depot.validePar?.nom || 'administrateur inconnu'}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Droit à l'effacement (20/11). Le libellé demande de TAPER le nom :
                  un clic de trop ne peut pas effacer un compte (demande fréquente de
                  clients qui n'ont plus accès au numéro). */}
              {effacer ? (
                <div className="bo-bloc-action">
                  <p className="bo-bloc-action-titre">
                    <Icon name="close" size={15} />
                    Effacer ce compte ?
                  </p>
                  <p className="bo-petit bo-doux">
                    Le nom, le numéro, la photo, les favoris et les avis de cette personne seront
                    anonymisés immédiatement («&nbsp;Utilisateur supprimé&nbsp;»), et ses jetons de
                    connexion cesseront de fonctionner. Ses fiches d’établissement créées sont
                    supprimées ; celles qu’elle a seulement revendiquées restent en ligne, sans son
                    nom. Ses dépôts et abonnements payés restent, sans donnée personnelle, pour la
                    comptabilité. C’est <strong>irréversible</strong>.
                  </p>
                  <label className="bo-champ">
                    <span className="bo-etiquette">
                      {`Pour confirmer, tapez « ${attenduConfirmation || 'le nom du compte'} »`}
                    </span>
                    <input
                      className="bo-entree"
                      type="text"
                      autoComplete="off"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      placeholder={attenduConfirmation}
                    />
                  </label>
                  <label className="bo-champ">
                    <span className="bo-etiquette">Motif (facultatif, à usage interne)</span>
                    <input
                      className="bo-entree"
                      type="text"
                      autoComplete="off"
                      value={motifEffacement}
                      onChange={(e) => setMotifEffacement(e.target.value)}
                      placeholder="Demande écrite du client, compte frauduleux…"
                    />
                  </label>
                  <div className="bo-ligne-actions">
                    <button
                      type="button"
                      className="bo-btn bo-btn--danger"
                      onClick={effacerCompte}
                      disabled={enCours === 'effacer' || !confirmationValide}
                    >
                      <Icon
                        name={enCours === 'effacer' ? 'loader' : 'close'}
                        size={14}
                        className={enCours === 'effacer' ? 'bo-tourne' : ''}
                      />
                      Confirmer l’effacement
                    </button>
                    <button
                      type="button"
                      className="bo-btn"
                      onClick={() => {
                        setEffacer(false);
                        setConfirmation('');
                        setMotifEffacement('');
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}

              {suspendre ? (
                <div className="bo-bloc-action">
                  <p className="bo-bloc-action-titre">
                    <Icon name="ban" size={15} />
                    Suspendre ce compte ?
                  </p>
                  <p className="bo-petit bo-doux">
                    L’utilisateur sera déconnecté immédiatement et ne pourra plus se reconnecter tant que le
                    compte n’est pas réactivé. Le motif ci-dessous lui sera affiché à la connexion.
                  </p>
                  <label className="bo-champ">
                    <span className="bo-etiquette">Motif de la suspension (visible par l’utilisateur)</span>
                    <textarea
                      className="bo-zone"
                      value={motif}
                      onChange={(e) => setMotif(e.target.value)}
                      placeholder="Annonces frauduleuses répétées malgré les avertissements…"
                    />
                  </label>
                  <div className="bo-ligne-actions">
                    <button
                      type="button"
                      className="bo-btn bo-btn--danger"
                      onClick={() => changerStatut('suspendu')}
                      disabled={enCours === 'suspendu'}
                    >
                      <Icon
                        name={enCours === 'suspendu' ? 'loader' : 'ban'}
                        size={14}
                        className={enCours === 'suspendu' ? 'bo-tourne' : ''}
                      />
                      Confirmer la suspension
                    </button>
                    <button
                      type="button"
                      className="bo-btn"
                      onClick={() => {
                        setSuspendre(false);
                        setMotif('');
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}

              {reinit ? (
                <div className="bo-bloc-action">
                  <p className="bo-bloc-action-titre">
                    <Icon name="key" size={15} />
                    Réinitialiser le mot de passe
                  </p>
                  <p className="bo-petit bo-doux">
                    À utiliser quand l’utilisateur a perdu l’accès à son compte (il n’existe pas de récupération
                    par e-mail). Communiquez-lui le nouveau mot de passe de vive voix.
                  </p>
                  <label className="bo-champ">
                    <span className="bo-etiquette">Nouveau mot de passe (6 caractères minimum)</span>
                    <input
                      className="bo-entree"
                      type="text"
                      autoComplete="off"
                      value={nouveauMdp}
                      onChange={(e) => setNouveauMdp(e.target.value)}
                    />
                  </label>
                  <div className="bo-ligne-actions">
                    <button
                      type="button"
                      className="bo-btn bo-btn--principal"
                      onClick={reinitialiser}
                      disabled={enCours === 'motdepasse'}
                    >
                      <Icon
                        name={enCours === 'motdepasse' ? 'loader' : 'key'}
                        size={14}
                        className={enCours === 'motdepasse' ? 'bo-tourne' : ''}
                      />
                      Définir ce mot de passe
                    </button>
                    <button
                      type="button"
                      className="bo-btn"
                      onClick={() => {
                        setReinit(false);
                        setNouveauMdp('');
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="bo-tiroir-pied">
          <button
            type="button"
            className="bo-btn bo-btn--petit"
            onClick={() => setRechargement((n) => n + 1)}
          >
            <Icon name="refresh" size={13} className={chargement ? 'bo-tourne' : ''} />
            Recharger la fiche
          </button>
          {utilisateur && !reinit && !efface ? (
            <button type="button" className="bo-btn bo-btn--petit" onClick={() => setReinit(true)}>
              <Icon name="key" size={13} />
              Mot de passe
            </button>
          ) : null}
          {utilisateur && !utilisateur.estAdmin && !suspendu && !suspendre ? (
            <button
              type="button"
              className="bo-btn bo-btn--danger bo-btn--petit"
              onClick={() => setSuspendre(true)}
            >
              <Icon name="ban" size={13} />
              Suspendre
            </button>
          ) : null}
          {utilisateur && !utilisateur.estAdmin && !efface && !effacer ? (
            <button
              type="button"
              className="bo-btn bo-btn--danger bo-btn--petit"
              onClick={() => setEffacer(true)}
            >
              <Icon name="close" size={13} />
              Effacer le compte
            </button>
          ) : null}
          {utilisateur && suspendu && !efface ? (
            <button
              type="button"
              className="bo-btn bo-btn--ok bo-btn--petit"
              onClick={() => changerStatut('actif')}
              disabled={enCours === 'actif'}
            >
              <Icon
                name={enCours === 'actif' ? 'loader' : 'check'}
                size={13}
                className={enCours === 'actif' ? 'bo-tourne' : ''}
              />
              Réactiver le compte
            </button>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}

/* ─────────────────────────── 5. Journal d'activité ─────────────────────────── */

/**
 * Journal fusionné : inscriptions, connexions et paiements dans UN SEUL flux
 * chronologique. C'est le serveur qui agrège les trois sources puis retrie par date
 * (GET /api/admin/activite) — l'équipe n'a donc pas à recouper trois écrans.
 * Le filtre par type part au serveur (c'est lui qui sait trier proprement) ; la
 * recherche ci-dessous ne travaille que sur les mouvements DÉJÀ chargés, d'où le
 * rappel permanent de la fenêtre affichée (l'API plafonne à 60 mouvements).
 */
function VueActivite({ cle, onGererErreur, onVoirUtilisateur, onRafraichir }) {
  const [type, setType] = useState('tout');
  const [limite, setLimite] = useState(30);
  const [recherche, setRecherche] = useState('');
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .activite({ type, limit: limite })
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Journal indisponible pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [type, limite, cle, onGererErreur]);

  const evenements = donnees?.evenements || [];
  const ongletCourant = ONGLETS_ACTIVITE.find((o) => o.cle === type) || ONGLETS_ACTIVITE[0];
  const terme = recherche.trim().toLowerCase();
  // Recherche LOCALE sur la fenêtre chargée : nom du compte, numéro, référence du
  // dépôt, opérateur, montant. Elle ne relance aucune requête — taper au clavier ne
  // doit pas faire trois allers-retours réseau.
  const filtres = terme
    ? evenements.filter((evenement) =>
        [
          evenement.titre,
          evenement.qui,
          formatTelephone(evenement.numero),
          evenement.reference,
          evenement.operateur ? libelleOperateur(evenement.operateur) : '',
          evenement.montant ? formatFcfa(evenement.montant) : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(terme)
      )
    : evenements;
  const connectes24h = donnees?.connectes?.dernier24h || 0;
  const connectes7j = donnees?.connectes?.dernier7j || 0;
  const suspendus = donnees?.suspendus || 0;

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      <div className="bo-tuiles">
        <Tuile
          libelle="Connectés (24 h)"
          valeur={connectes24h}
          note={`${connectes7j} sur les 7 derniers jours`}
          icone="eye"
          couleur="vert"
          noteVariante={connectes7j > 0 ? 'bien' : ''}
        />
        <Tuile
          libelle="Connectés (7 j)"
          valeur={connectes7j}
          note="comptes réellement revenus"
          icone="users"
          couleur="accent"
        />
        <Tuile
          libelle="Comptes suspendus"
          valeur={suspendus}
          note={suspendus > 0 ? 'connexion coupée pour eux' : 'aucun compte coupé'}
          icone="ban"
          couleur={suspendus > 0 ? 'rouge' : ''}
        />
        <Tuile
          libelle="Mouvements affichés"
          valeur={filtres.length}
          note={`${limite} derniers chargés${terme ? ' · recherche en cours' : ''}`}
          icone="activity"
        />
      </div>

      <Panneau
        titre={`Journal — ${ongletCourant.libelle}`}
        sous="Inscriptions, connexions et paiements fusionnés, du plus récent au plus ancien"
        serre
        actions={
          <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir} disabled={chargement}>
            <Icon name="refresh" size={13} className={chargement ? 'bo-tourne' : ''} />
            Actualiser
          </button>
        }
      >
        <div className="bo-barre-outils">
          <div className="bo-onglets">
            {ONGLETS_ACTIVITE.map((onglet) => (
              <button
                key={onglet.cle}
                type="button"
                className={`bo-onglet${type === onglet.cle ? ' bo-onglet--actif' : ''}`}
                onClick={() => setType(onglet.cle)}
              >
                <Icon name={onglet.icone} size={13} />
                {onglet.libelle}
              </button>
            ))}
          </div>
          <label className="bo-champ">
            <span className="bo-etiquette">Afficher</span>
            <select
              className="bo-selection"
              value={limite}
              onChange={(e) => setLimite(Number(e.target.value))}
            >
              <option value={20}>20 derniers</option>
              <option value={30}>30 derniers</option>
              <option value={60}>60 derniers (maximum)</option>
            </select>
          </label>
        </div>

        <div className="bo-barre-outils">
          <label className="bo-champ bo-champ--large">
            <span className="bo-etiquette">Filtrer dans la liste (nom, numéro, référence)</span>
            <input
              className="bo-entree"
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="07 07…, RM-…, Wave, dépôt…"
            />
            {recherche ? (
              <button
                type="button"
                className="bo-btn bo-btn--lien bo-btn--petit"
                onClick={() => setRecherche('')}
              >
                Effacer
              </button>
            ) : null}
          </label>
        </div>

        {chargement && !donnees ? <EtatChargement texte="Chargement du journal…" /> : null}

        {!chargement && filtres.length === 0 ? (
          <EtatVide
            texte={
              terme
                ? 'Aucun mouvement ne correspond à cette recherche.'
                : 'Aucun mouvement dans ce filtre pour l’instant.'
            }
            icone="activity"
          />
        ) : null}

        {filtres.length ? (
          <div className="bo-journal">
            {filtres.map((evenement, i) => (
              <LigneEvenement
                key={`${evenement.type}-${evenement.depotId || evenement.utilisateurId || i}-${i}`}
                evenement={evenement}
                onVoirUtilisateur={onVoirUtilisateur}
              />
            ))}
          </div>
        ) : null}

        <p className="bo-petit bo-doux">
          {`Fenêtre affichée : les ${limite} derniers mouvements (60 au maximum côté serveur). « Fiche » ouvre le compte concerné sans quitter le journal.`}
        </p>
      </Panneau>
    </div>
  );
}

/* ─────────────────────────── 6. Mon profil administrateur ─────────────────────────── */

/**
 * Le compte AVEC LEQUEL l'administrateur est connecté. Deux gestes seulement, et ils
 * sont volontairement séparés :
 *   - CHANGER SON MOT DE PASSE (PATCH /moi/mot-de-passe) : l'ancien est exigé, comme
 *     partout ailleurs dans le produit — un poste laissé ouvert ne doit pas permettre
 *     de se faire remplacer le mot de passe ;
 *   - SE DÉCONNECTER : on efface le jeton ADMIN conservé à part (localStorage), la
 *     session de l'application mobile n'est pas touchée.
 * Le profil est RELU au montage (GET /moi) pour afficher l'état réel côté serveur et
 * non les valeurs gardées en mémoire depuis la connexion.
 */
/* ─── Réclamations de fiches (bloc D) ─────────────────────────────────────────
   Les fiches publiques importées ne sont pas réclamées. Quand un gérant reconnaît la
   sienne, elle est acceptée TOUT DE SUITE s'il est sur place (150 m ou moins, décidé côté
   serveur). Au-delà, il ne peut pas la reprendre seul : c'est ICI qu'une personne tranche.
   Accepter RATTACHE la fiche existante à son gérant — aucune copie n'est créée, et rien de
   public (photos, horaires, description, avis) n'est écrasé. Refuser laisse la fiche
   réclamable par quelqu'un d'autre. */
function VueReclamations({ cle, onMessage, onGererErreur, onRafraichir }) {
  const [statut, setStatut] = useState('en_attente');
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [idEnCours, setIdEnCours] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .reclamations(statut)
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Réclamations indisponibles pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [statut, cle, onGererErreur]);

  const lignes = donnees?.reclamations || [];

  async function decider(ligne, decision) {
    setIdEnCours(ligne.etablissementId);
    try {
      await adminApi.deciderReclamation(ligne.etablissementId, decision);
      // On recharge la file PUIS on annonce le résultat (l'ordre compte : le
      // rafraîchissement efface le message précédent).
      onRafraichir();
      onMessage(
        decision === 'accepter'
          ? `« ${ligne.nomFiche} » est désormais rattachée à son gérant.`
          : `Réclamation refusée pour « ${ligne.nomFiche} ».`
      );
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Action impossible sur cette réclamation.');
    } finally {
      setIdEnCours('');
    }
  }

  return (
    <Panneau
      titre="Réclamations de fiches"
      sous="Un gérant demande à reprendre une fiche publique importée. Accepter la lui rattache : aucune fiche en double n’est créée, et aucune information publique n’est écrasée."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`bo-btn${statut === 'en_attente' ? ' bo-btn--principal' : ''}`}
            onClick={() => setStatut('en_attente')}
          >
            À traiter
          </button>
          <button
            type="button"
            className={`bo-btn${statut === 'traitees' ? ' bo-btn--principal' : ''}`}
            onClick={() => setStatut('traitees')}
          >
            Traitées
          </button>
        </div>
      }
    >
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      {chargement ? (
        <EtatChargement texte="Chargement des réclamations…" />
      ) : lignes.length === 0 ? (
        <EtatVide
          texte={statut === 'en_attente' ? 'Aucune réclamation en attente.' : 'Aucune réclamation traitée pour le moment.'}
          icone="check"
        />
      ) : (
        <div className="bo-tableau-enveloppe">
          <table className="bo-tableau">
            <thead>
              <tr>
                <th>Fiche</th>
                <th>Nom déclaré</th>
                <th>Distance</th>
                <th>Demandeur</th>
                <th>Demandée</th>
                <th>{statut === 'en_attente' ? 'Décision' : 'Statut'}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => (
                <tr key={ligne.etablissementId}>
                  <td>
                    <strong>{ligne.nomFiche}</strong>
                    <div>{[ligne.quartier, ligne.commune].filter(Boolean).join(', ')}</div>
                  </td>
                  <td>{ligne.nomDeclare || '—'}</td>
                  <td>{ligne.distanceMetres == null ? 'inconnue' : `${ligne.distanceMetres} m`}</td>
                  <td>
                    {ligne.demandeur
                      ? `${ligne.demandeur.nomComplet} — ${formatTelephone(ligne.demandeur.telephone)}`
                      : 'compte supprimé'}
                  </td>
                  <td>{ligne.demandeeLe ? formatDateRelative(ligne.demandeeLe) : '—'}</td>
                  <td className="bo-tableau-actions">
                    {statut === 'en_attente' ? (
                      <>
                        <button
                          type="button"
                          className="bo-btn bo-btn--ok"
                          disabled={idEnCours === ligne.etablissementId}
                          onClick={() => decider(ligne, 'accepter')}
                        >
                          Accepter
                        </button>
                        <button
                          type="button"
                          className="bo-btn bo-btn--danger"
                          disabled={idEnCours === ligne.etablissementId}
                          onClick={() => decider(ligne, 'refuser')}
                        >
                          Refuser
                        </button>
                      </>
                    ) : (
                      <Badge
                        variante={ligne.statut === 'acceptee' ? 'ok' : 'ko'}
                        icone={ligne.statut === 'acceptee' ? 'check' : 'ban'}
                      >
                        {ligne.statut === 'acceptee' ? 'Acceptée' : 'Refusée'}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panneau>
  );
}

/* ─── Établissements (catalogue) ──────────────────────────────────────────────
   Le back-office n'a pas de liste de fiches à lui : cette vue lit le CATALOGUE
   PUBLIC (`GET /api/establishments`, celui de l'application) pour répondre aux
   questions du quotidien — « cette fiche existe-t-elle ? », « quel numéro est
   publié ? », « est-elle importée, réclamée, vérifiée ? ». La modération des
   réclamations garde sa section dédiée, joignable d'un clic depuis la barre
   d'outils : on regarde ici, on tranche là-bas. */
function VueEtablissements({ cle, stats, onNaviguer, onGererErreur, onRafraichir }) {
  const [recherche, setRecherche] = useState('');
  const [requete, setRequete] = useState('');
  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    // `sort=recent` : les fiches qui viennent d'être créées (tournée terrain,
    // inscription d'un gérant) sont celles qu'on veut voir en premier.
    const parametres = new URLSearchParams({ page: String(page), limit: '25', sort: 'recent' });
    if (requete) parametres.set('q', requete);
    api
      .get(`/establishments?${parametres.toString()}`, { auth: false })
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Catalogue indisponible pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [cle, page, requete, onGererErreur]);

  const items = donnees?.items || [];
  const total = Number(donnees?.total) || 0;

  function chercher(evt) {
    evt.preventDefault();
    setPage(1);
    setRequete(recherche.trim());
  }

  function effacer() {
    setRecherche('');
    setRequete('');
    setPage(1);
  }

  return (
    <div className="bo-empile bo-apparition">
      <div className="bo-tuiles">
        <Tuile
          libelle="Fiches au catalogue"
          valeur={stats?.etablissements || 0}
          note="Toutes catégories confondues"
          icone="store"
          couleur="accent"
        />
        <Tuile
          libelle="Résultat affiché"
          valeur={total}
          note={requete ? `Recherche « ${requete} »` : 'Fiches les plus récentes'}
          icone="search"
        />
        <Tuile
          libelle="Catégories proposées"
          valeur={stats?.demandesCategorie?.enAttente || 0}
          note="Métiers locaux saisis par les gérants, à valider"
          icone="grid"
          couleur={(stats?.demandesCategorie?.enAttente || 0) > 0 ? 'accent' : ''}
          onClick={() => onNaviguer('categories')}
        />
      </div>

      <Panneau
        titre="Catalogue"
        sous="Fiches visibles dans l’application : contact publié, réputation et état de publication"
        serre
      >
        <div className="bo-barre-outils">
          <form className="bo-recherche" onSubmit={chercher}>
            <input
              className="bo-entree"
              type="search"
              placeholder="Nom, quartier, catégorie…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              aria-label="Rechercher une fiche"
            />
            <button type="submit" className="bo-btn bo-btn--petit">
              <Icon name="search" size={14} />
              Rechercher
            </button>
            {requete ? (
              <button type="button" className="bo-btn bo-btn--petit" onClick={effacer}>
                <Icon name="close" size={13} />
                Effacer
              </button>
            ) : null}
          </form>
          <div className="bo-ligne-actions">
            <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir}>
              <Icon name="refresh" size={14} />
              Actualiser
            </button>
            <button
              type="button"
              className="bo-btn bo-btn--petit"
              onClick={() => onNaviguer('reclamations')}
            >
              <Icon name="mapPin" size={14} />
              Réclamations
            </button>
          </div>
        </div>

        {chargement ? (
          <EtatChargement texte="Chargement du catalogue…" />
        ) : erreur ? (
          <div className="bo-panneau-corps">
            <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
              {erreur}
            </Alerte>
          </div>
        ) : items.length === 0 ? (
          <EtatVide
            texte={requete ? `Aucune fiche pour « ${requete} ».` : 'Aucune fiche au catalogue.'}
            icone="store"
          />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Fiche</th>
                  <th>Catégorie</th>
                  <th>Localisation</th>
                  <th>Contact publié</th>
                  <th>Réputation</th>
                  <th>État</th>
                  <th>Créée le</th>
                </tr>
              </thead>
              <tbody>
                {items.map((fiche) => (
                  <tr key={String(fiche.id)}>
                    <td>
                      <strong>{fiche.nom || 'Fiche sans nom'}</strong>
                      {fiche.sousCategorie ? (
                        <div className="bo-petit bo-doux">{fiche.sousCategorie}</div>
                      ) : null}
                    </td>
                    <td>{libelleFamille(fiche.categorie)}</td>
                    <td>{[fiche.quartier, fiche.commune].filter(Boolean).join(', ') || '—'}</td>
                    <td>
                      {fiche.telephone ? (
                        formatTelephone(fiche.telephone)
                      ) : (
                        <span className="bo-doux">non publié</span>
                      )}
                    </td>
                    <td>
                      {Number(fiche.nombreAvis) > 0 ? (
                        <>
                          <span className="bo-note">{formatNote(fiche.noteMoyenne)}</span>
                          <div className="bo-petit bo-doux">{fiche.nombreAvis} avis</div>
                        </>
                      ) : (
                        <span className="bo-petit bo-doux">Nouveau</span>
                      )}
                    </td>
                    <td>
                      {fiche.verifie ? (
                        <Badge variante="ok" icone="check">
                          Vérifiée
                        </Badge>
                      ) : fiche.reclame ? (
                        <Badge variante="info">Réclamée</Badge>
                      ) : fiche.estImporte ? (
                        <Badge variante="susp">Importée</Badge>
                      ) : (
                        <Badge variante="attente">À compléter</Badge>
                      )}
                    </td>
                    <td className="bo-tableau-num">{formatDate(fiche.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!chargement && !erreur && items.length > 0 ? (
          <div className="bo-pagination">
            <span className="bo-pagination-info">
              Page {page} · {total} fiche{total > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="bo-btn bo-btn--petit"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Précédent
            </button>
            <button
              type="button"
              className="bo-btn bo-btn--petit"
              disabled={!donnees?.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </button>
          </div>
        ) : null}
      </Panneau>
    </div>
  );
}




/* ─── Import de données : base OpenStreetMap (27/11) ──────────────────────────
   Le fichier backend/data/base-complete-ci.geojson contient 46 745 lieux publics
   relevés par les contributeurs OSM (restaurants, pharmacies, mairies, banques,
   écoles, lieux de culte, hôtels, stations-service…).

   POURQUOI AUCUN BOUTON NE LANCE L'IMPORT : il écrit plusieurs dizaines de
   milliers de fiches en lots, sur plusieurs minutes. Lancé depuis un navigateur,
   un onglet fermé ou une 4G qui saute laisserait la base à moitié remplie sans
   que personne ne le voie. Le script (backend/scripts/importer-osm.js) est donc
   exécuté en local, en simulation d'abord. Cet écran sert à décider : il montre
   ce que contient DÉJÀ chaque famille concernée, et rappelle la commande exacte. */

const FAMILLES_IMPORT = [
  { slug: 'commerce', libelle: 'Commerces', icone: 'store' },
  { slug: 'restauration', libelle: 'Restauration', icone: 'utensils' },
  { slug: 'sante', libelle: 'Santé', icone: 'hospital' },
  { slug: 'education', libelle: 'Éducation', icone: 'briefcase' },
  { slug: 'administration', libelle: 'Administration', icone: 'shield' },
  { slug: 'culte', libelle: 'Culte', icone: 'church' },
  { slug: 'banque', libelle: 'Banque', icone: 'wallet' },
  { slug: 'hebergement', libelle: 'Hébergement', icone: 'home' },
  { slug: 'service_auto', libelle: 'Services auto', icone: 'tools' },
  { slug: 'transport', libelle: 'Transport', icone: 'route' },
];

const COMMANDE_SIMULATION = 'cd backend && npm run importer:osm';
const COMMANDE_IMPORT = 'cd backend && npm run importer:osm -- --apply';

function VueImportDonnees({ cle, stats, onGererErreur, onRafraichir }) {
  const [compteurs, setCompteurs] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [alerte, setAlerte] = useState('');
  const [copiee, setCopiee] = useState('');

  // Une requête par famille, avec `limit=1` : seule la valeur `total` nous
  // intéresse, et 10 petits appels publics restent plus simples (donc plus
  // sûrs) qu'une route d'administration dédiée à un simple comptage.
  useEffect(() => {
    let vivant = true;
    setChargement(true);
    Promise.all(
      FAMILLES_IMPORT.map((famille) =>
        api
          .get(`/establishments?categorie=${famille.slug}&limit=1`, { auth: false })
          .then((reponse) => Number(reponse?.total) || 0)
          .catch(() => 0)
      )
    ).then((totaux) => {
      if (!vivant) return;
      setCompteurs(FAMILLES_IMPORT.map((famille, index) => ({ ...famille, total: totaux[index] })));
      setChargement(false);
    });
    return () => {
      vivant = false;
    };
  }, [cle, onGererErreur]);

  const totalFamilles = (compteurs || []).reduce((somme, famille) => somme + famille.total, 0);

  async function copier(commande) {
    try {
      await navigator.clipboard.writeText(commande);
      setCopiee(commande);
      setAlerte('');
    } catch {
      // Presse-papiers refusé (http, permission) : la commande reste lisible à l'écran.
      setCopiee('');
      setAlerte('Copie impossible dans ce navigateur : sélectionnez la commande à la main.');
    }
  }

  return (
    <div className="bo-empile bo-apparition">
      <div className="bo-tuiles">
        <Tuile
          libelle="Fiches au catalogue"
          valeur={stats?.etablissements || 0}
          note="Toutes familles confondues"
          icone="store"
          couleur="accent"
        />
        <Tuile
          libelle="Familles de l’import"
          valeur={FAMILLES_IMPORT.length}
          note="Celles que remplit la base OpenStreetMap"
          icone="download"
        />
        <Tuile
          libelle="Fiches dans ces familles"
          valeur={chargement ? '…' : totalFamilles}
          note="Ce que l’import viendra compléter"
          icone="chart"
        />
      </div>

      <Panneau
        titre="Import OpenStreetMap"
        sous="46 745 lieux publics, 30 022 fiches attendues après nettoyage"
        actions={
          <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir}>
            <Icon name="refresh" size={14} />
            Actualiser
          </button>
        }
      >
        <p className="bo-petit bo-doux">
          Le script écarte les lieux sans nom et les doublons (même nom à moins de 50 m), ramène
          les numéros au format <strong>+225</strong>, classe chaque lieu dans sa famille et crée
          les fiches avec <strong>estImporte</strong> et <strong>reclame : false</strong> — chaque
          gérant pourra donc reprendre la sienne (« C’est mon établissement ? »).
        </p>

        <div className="bo-ligne-actions">
          <button
            type="button"
            className="bo-btn bo-btn--principal"
            onClick={() =>
              setAlerte(
                'Import massif : veuillez lancer le script en local (commande ci-dessous). ' +
                  'Un navigateur ne peut pas écrire 30 000 fiches sans risquer de laisser la base à moitié remplie.'
              )
            }
          >
            <Icon name="download" size={15} />
            Lancer l’import OSM
          </button>
        </div>

        {alerte ? (
          <Alerte variante="info" icone="info" onFermer={() => setAlerte('')}>
            {alerte}
          </Alerte>
        ) : null}

        <div className="bo-empile">
          <p className="bo-petit">
            <strong>1. Simuler (sans écrire)</strong> — affiche les compteurs, ne touche pas à la base.
          </p>
          <p className="bo-petit">
            <code>{COMMANDE_SIMULATION}</code>{' '}
            <button
              type="button"
              className="bo-btn bo-btn--petit"
              onClick={() => copier(COMMANDE_SIMULATION)}
            >
              {copiee === COMMANDE_SIMULATION ? 'Copié' : 'Copier'}
            </button>
          </p>
          <p className="bo-petit">
            <strong>2. Écrire réellement</strong> — demande la phrase de confirmation du garde-fou
            production, puis écrit par lots de 500 fiches.
          </p>
          <p className="bo-petit">
            <code>{COMMANDE_IMPORT}</code>{' '}
            <button
              type="button"
              className="bo-btn bo-btn--petit"
              onClick={() => copier(COMMANDE_IMPORT)}
            >
              {copiee === COMMANDE_IMPORT ? 'Copié' : 'Copier'}
            </button>
          </p>
        </div>
      </Panneau>

      <Panneau
        titre="Fiches par famille"
        sous="État actuel du catalogue, pour les familles que remplit la base OpenStreetMap"
      >
        {chargement ? (
          <EtatChargement texte="Comptage des familles…" />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Famille</th>
                  <th>Fiches en base</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {(compteurs || []).map((famille) => (
                  <tr key={famille.slug}>
                    <td>
                      <div className="bo-cellule-principale">
                        <Icon name={famille.icone} size={15} />
                        <div>
                          <strong>{famille.libelle}</strong>
                          <div className="bo-petit bo-doux">{famille.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td>{famille.total}</td>
                    <td>
                      {famille.total === 0 ? (
                        <Badge variante="attente" icone="download">
                          À alimenter
                        </Badge>
                      ) : (
                        <Badge variante="ok" icone="check">
                          Déjà alimentée
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>
    </div>
  );
}

/* ─── Annonces signalées (prompt 7) ───────────────────────────────────────────
   Le signalement est un geste de terrain : quelqu'un voit une annonce douteuse
   (fausse offre, numéro surtaxé, arnaque) et appuie sur le drapeau. Le serveur ne
   garde AUCUN nom de signaleur, seulement un compteur — cette file, triée par nombre
   de signalements, est donc le seul endroit où la décision se prend. « Retirer »
   supprime réellement l'annonce : une offre frauduleuse ne doit pas rester en pause. */


function VueAnnoncesSignalees({ cle, onMessage, onGererErreur, onRafraichir }) {
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [idEnCours, setIdEnCours] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .annoncesSignalees()
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Annonces signalées indisponibles pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [cle, onGererErreur]);

  const lignes = donnees?.items || [];

  async function retirer(ligne) {
    setIdEnCours(ligne.id);
    try {
      await adminApi.supprimerAnnonce(ligne.id);
      // On recharge la file PUIS on annonce le résultat (l'ordre compte : le
      // rafraîchissement efface le message précédent).
      onRafraichir();
      onMessage(`« ${ligne.titre} » a été retirée.`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Retrait impossible sur cette annonce.');
    } finally {
      setIdEnCours('');
    }
  }

  return (
    <Panneau
      titre="Annonces signalées"
      sous="Chaque appui sur le drapeau d’une annonce incrémente un compteur, sans conserver le nom du signaleur. Cette file est triée par nombre de signalements : à vous de trancher."
    >
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      {chargement ? (
        <EtatChargement texte="Chargement des annonces signalées…" />
      ) : lignes.length === 0 ? (
        <EtatVide texte="Aucune annonce signalée pour le moment." icone="check" />
      ) : (
        <div className="bo-tableau-enveloppe">
          <table className="bo-tableau">
            <thead>
              <tr>
                <th>Annonce</th>
                <th>Type</th>
                <th>Auteur</th>
                <th>Signalements</th>
                <th>Dernier</th>
                <th>Décision</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => (
                <tr key={ligne.id}>
                  <td>
                    <strong>{ligne.titre}</strong>
                    <div className="bo-petit bo-doux">
                      {[ligne.quartier, ligne.commune].filter(Boolean).join(', ') ||
                        'Localisation non précisée'}
                    </div>
                    <div className="bo-petit bo-doux">{ligne.description}</div>
                  </td>
                  <td>
                    <div>{TYPE_ANNONCE[ligne.typeAnnonce] || 'Annonce'}</div>
                    <div className="bo-petit bo-doux">
                      {ligne.contactPublic ? 'Numéro public' : 'Contact via demande'}
                    </div>
                  </td>
                  <td>
                    {ligne.auteur ? (
                      <>
                        {ligne.auteur.nom}
                        <div className="bo-petit bo-doux">
                          {ligne.auteur.telephone
                            ? formatTelephone(ligne.auteur.telephone)
                            : 'numéro masqué'}
                        </div>
                      </>
                    ) : (
                      'compte supprimé'
                    )}
                  </td>
                  <td>
                    <Badge variante="attente" icone="flag">
                      {ligne.signalements}
                    </Badge>
                  </td>
                  <td>{ligne.dernierSignalementAt ? formatDateRelative(ligne.dernierSignalementAt) : '—'}</td>
                  <td className="bo-tableau-actions">
                    <button
                      type="button"
                      className="bo-btn bo-btn--danger"
                      disabled={idEnCours === ligne.id}
                      onClick={() => retirer(ligne)}
                    >
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panneau>
  );
}

/* ─── Modération des messages (prompt B) ──────────────────────────────────────
   La messagerie interne est privée par conception : l'administrateur n'y écrit
   jamais et n'a pas de conversation à lui. Cette section est le SEUL accès, et
   elle est volontairement brute : on cherche un compte par nom ou par numéro, on
   lit la liste de ses discussions, puis on exporte celle qui est visée.

   Pourquoi un export de fichier : une réquisition légale demande une pièce
   transmissible (identifiant de conversation, noms, numéros, date/heure de
   chaque message, expéditeur). Le serveur construit ce document ; cet écran ne
   fait que le télécharger — il ne recompose aucune donnée, donc aucune chance
   d'altérer une pièce.
   --------------------------------------------------------------------------- */

/** Télécharge un objet JSON sous forme de fichier (aucune dépendance). */
function telechargerJson(nomFichier, donnees) {
  try {
    const contenu = JSON.stringify(donnees, null, 2);
    const blob = new Blob([contenu], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    // Le navigateur a lu l'URL de façon synchrone : on peut la libérer ensuite.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Télécharge un contenu TEXTE (CSV de paie) sous forme de fichier.
 *
 * Même logique que `telechargerJson`, mais sans sérialisation : le serveur a
 * déjà construit le fichier (BOM UTF-8, séparateur `;`, échappement RFC 4180).
 * Le recopier tel quel est la seule façon de garantir que ce qui est payé est
 * exactement ce que le serveur a compté.
 */
function telechargerTexte(nomFichier, contenu, type = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([contenu], { type });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

function VueModerationMessages({ cle, onMessage, onGererErreur }) {
  const [recherche, setRecherche] = useState('');
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  // Compteur : « Actualiser » doit relancer la requête même quand la recherche
  // n'a pas changé (un simple setRecherche(précédent) ne provoquerait aucun rendu).
  const [rafraichissement, setRafraichissement] = useState(0);

  const [idColle, setIdColle] = useState('');
  const [apercu, setApercu] = useState(null);
  const [chargementApercu, setChargementApercu] = useState(false);
  const [idEnCours, setIdEnCours] = useState('');

  // Recherche débouncée (350 ms) : la liste se met à jour sans requête par frappe.
  useEffect(() => {
    let vivant = true;
    setChargement(true);
    const minuteur = setTimeout(
      () => {
        adminApi
          .conversations(recherche.trim() ? { q: recherche.trim() } : {})
          .then((reponse) => {
            if (!vivant) return;
            setDonnees(reponse);
            setErreur('');
          })
          .catch((err) => {
            if (!vivant || onGererErreur(err)) return;
            setErreur(err?.message || 'Conversations indisponibles pour le moment.');
          })
          .finally(() => {
            if (vivant) setChargement(false);
          });
      },
      recherche.trim() ? 350 : 0
    );

    return () => {
      vivant = false;
      clearTimeout(minuteur);
    };
  }, [cle, recherche, onGererErreur, rafraichissement]);

  async function chargerApercu(id) {
    const identifiant = String(id || '').trim();
    if (!identifiant) {
      setErreur('Collez l’identifiant d’une conversation avant de charger.');
      return;
    }
    setChargementApercu(true);
    setErreur('');
    try {
      const reponse = await adminApi.exportConversation(identifiant);
      setApercu(reponse);
    } catch (err) {
      setApercu(null);
      if (!onGererErreur(err)) setErreur(err?.message || 'Conversation introuvable.');
    } finally {
      setChargementApercu(false);
    }
  }

  async function exporter(conversation) {
    const id = typeof conversation === 'string' ? conversation : conversation?.id;
    if (!id) return;
    setIdEnCours(String(id));
    setErreur('');
    try {
      const reponse = await adminApi.exportConversation(id);
      const nom = `conversation-${id}-${new Date().toISOString().slice(0, 10)}.json`;
      if (!telechargerJson(nom, reponse)) {
        throw new Error('Le téléchargement a été bloqué par le navigateur.');
      }
      onMessage(`Conversation exportée (${reponse?.meta?.nombreMessages ?? 0} message(s)) : ${nom}`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Export impossible sur cette conversation.');
    } finally {
      setIdEnCours('');
    }
  }

  const lignes = donnees?.conversations || [];

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      <Panneau
        titre="Modération des messages"
        sous="La messagerie est privée : cet écran ne permet ni de lire au fil de l’eau ni d’écrire. Cherchez un compte, puis exportez la conversation visée — le fichier contient les métadonnées, les deux participants avec leurs numéros, et chaque message daté."
        serre
        actions={
          <button
            type="button"
            className="bo-btn bo-btn--petit"
            onClick={() => setRafraichissement((precedent) => precedent + 1)}
            disabled={chargement}
          >
            <Icon name="refresh" size={13} className={chargement ? 'bo-tourne' : ''} />
            Actualiser
          </button>
        }
      >
        <div className="bo-barre-outils">
          <label className="bo-champ bo-champ--large">
            <span className="bo-etiquette">Rechercher par nom ou numéro</span>
            <input
              className="bo-entree"
              type="search"
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
              placeholder="Nom, prénom, 07 07… ou identifiant de conversation"
            />
          </label>
          <label className="bo-champ bo-champ--large">
            <span className="bo-etiquette">…ou coller un identifiant de conversation</span>
            <div className="bo-ligne-actions">
              <input
                className="bo-entree"
                type="text"
                value={idColle}
                onChange={(evenement) => setIdColle(evenement.target.value)}
                placeholder="ex. 6730f2c9a1b2c3d4e5f60718"
              />
              <button
                type="button"
                className="bo-btn"
                onClick={() => chargerApercu(idColle)}
                disabled={chargementApercu}
              >
                {chargementApercu ? 'Chargement…' : 'Aperçu'}
              </button>
            </div>
          </label>
        </div>

        {chargement && !donnees ? (
          <EtatChargement texte="Chargement des conversations…" />
        ) : lignes.length === 0 ? (
          <EtatVide
            texte={
              recherche.trim()
                ? 'Aucune conversation pour cette recherche.'
                : 'Aucune conversation sur la plateforme pour le moment.'
            }
            icone="message"
          />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Participants</th>
                  <th>Dernier message</th>
                  <th>Messages</th>
                  <th>Activité</th>
                  <th>Extraction</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((ligne) => (
                  <tr key={ligne.id}>
                    <td>
                      {(ligne.participants || []).map((participant) => (
                        <div key={participant.id}>
                          <strong>{participant.nom}</strong>
                          <div className="bo-petit bo-doux">
                            {participant.telephone
                              ? formatTelephone(participant.telephone)
                              : 'numéro absent'}
                            {participant.metier ? ` · ${participant.metier}` : ''}
                          </div>
                        </div>
                      ))}
                      <div className="bo-petit bo-mono">{ligne.id}</div>
                    </td>
                    <td>
                      <div className="bo-petit">
                        {ligne.dernierMessage || <span className="bo-doux">aucun message</span>}
                      </div>
                      <div className="bo-petit bo-doux">début {formatDate(ligne.debut)}</div>
                    </td>
                    <td>
                      <Badge variante={ligne.nombreMessages ? 'info' : 'attente'} icone="message">
                        {ligne.nombreMessages}
                      </Badge>
                    </td>
                    <td>{ligne.derniereActivite ? formatDateRelative(ligne.derniereActivite) : '—'}</td>
                    <td className="bo-tableau-actions">
                      <button
                        type="button"
                        className="bo-btn bo-btn--petit"
                        onClick={() => chargerApercu(ligne.id)}
                      >
                        Lire
                      </button>
                      <button
                        type="button"
                        className="bo-btn bo-btn--petit bo-btn--principal"
                        disabled={idEnCours === ligne.id}
                        onClick={() => exporter(ligne)}
                      >
                        <Icon name="download" size={13} />
                        Exporter
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>


      {apercu ? (
        <Panneau
          titre={`Conversation ${apercu.meta?.conversationId || ''}`}
          sous={[
            `${apercu.meta?.nombreMessages || 0} message(s)`,
            `début ${apercu.meta?.debutLisible || '—'}`,
            (apercu.participants || [])
              .map(
                (participant) =>
                  `${participant.nom} (${
                    participant.telephone ? formatTelephone(participant.telephone) : 'n° absent'
                  })`
              )
              .join(' ↔ '),
          ]
            .filter(Boolean)
            .join(' · ')}
          serre
          actions={
            <>
              <button
                type="button"
                className="bo-btn bo-btn--petit bo-btn--principal"
                disabled={idEnCours === apercu.meta?.conversationId}
                onClick={() => exporter(apercu.meta?.conversationId)}
              >
                <Icon name="download" size={13} />
                Exporter le JSON
              </button>
              <button
                type="button"
                className="bo-btn bo-btn--petit"
                onClick={() => setApercu(null)}
              >
                Fermer
              </button>
            </>
          }
        >
          <div className="bo-empile" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {(apercu.messages || []).length === 0 ? (
              <EtatVide texte="Aucun message dans cette conversation." icone="message" />
            ) : (
              (apercu.messages || []).map((message) => (
                <div key={message.id} className="bo-sous-ligne">
                  <div className="bo-petit bo-doux">
                    #{message.numero} · {message.dateLisible} {message.heure} · {message.expediteur}
                  </div>
                  <div className="bo-petit" style={{ whiteSpace: 'pre-line' }}>
                    {message.contenu}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panneau>
      ) : null}
    </div>
  );
}

/* ─── Agents de terrain (prompt 9) ────────────────────────────────────────────
   Quatre gestes, dans l'ordre où ils servent :
     1. recruter : nom + téléphone, le serveur tire au sort le code agent ET le
        code d'activation (personne ne choisit le code d'un collègue) ;
     2. remettre le code d'activation — affiché UNE seule fois — à un agent qui
        s'est inscrit lui-même depuis /agent (compte « en attente ») ;
     3. suivre ce que chaque code a produit, puis télécharger le CSV de paie ;
     4. suspendre (accès et pointage coupés au prochain appel), réactiver, ou
        supprimer une erreur de recrutement — la carte des agents est dans sa
        propre section (« Carte des agents »).

   Aucun écran ne calcule un montant : la paie se fait sur le nombre de fiches
   par jour et sur le fichier produit par le serveur, jamais sur un total
   reconstitué ici. Une erreur d'arrondi dans un écran de paie se paie deux fois.
   --------------------------------------------------------------------------- */
function VueAgentsDeTerrain({ cle, onMessage, onGererErreur, onRafraichir }) {
  const [donnees, setDonnees] = useState(null);
  const [fiches, setFiches] = useState(null);
  const [rapport, setRapport] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [nom, setNom] = useState('');
  const [telephoneAgent, setTelephoneAgent] = useState('');
  const [creation, setCreation] = useState(false);
  // Dernier code d'ACTIVATION remis : affiché en grand une seule fois, parce que
  // le serveur ne le renverra plus jamais (champ `select: false`). On y joint le
  // code agent (6 caractères), qui est la clé de la paie : les deux se dictent
  // dans la même conversation, il serait absurde de les séparer.
  const [codeRemis, setCodeRemis] = useState(null);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [idEnCours, setIdEnCours] = useState('');
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    Promise.all([adminApi.agents(), adminApi.fichesAVerifier(100), adminApi.rapportAgents(30)])
      .then(([agentsReponse, fichesReponse, rapportReponse]) => {
        if (!vivant) return;
        setDonnees(agentsReponse);
        setFiches(fichesReponse);
        setRapport(rapportReponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Les agents de terrain sont indisponibles pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [cle, rechargement, onGererErreur]);

  function rechargerTout() {
    setRechargement((n) => n + 1);
    onRafraichir?.();
  }

  /**
   * Recrutement direct : on saisit le nom et le téléphone, le serveur tire au sort
   * le code agent (6 caractères, la paie) ET le code d'activation (8 caractères,
   * l'accès). Le second n'est renvoyé qu'ici, une seule fois.
   */
  async function genererCode(evt) {
    evt.preventDefault();
    const valeur = nom.trim();
    if (valeur.length < 2) {
      setErreur('Indiquez le nom de l’agent (2 caractères minimum).');
      return;
    }
    if (telephoneAgent.trim().length < 8) {
      setErreur('Indiquez le téléphone de l’agent : c’est son identifiant de connexion sur /agent.');
      return;
    }
    setCreation(true);
    setErreur('');
    try {
      const reponse = await adminApi.genererCodeAgent({
        nom: valeur,
        telephone: telephoneAgent.trim(),
      });
      setNom('');
      setTelephoneAgent('');
      setCodeRemis({
        nom: reponse?.agent?.nom || valeur,
        code: reponse?.agent?.code || '',
        codeActivation: reponse?.codeActivation || '',
      });
      rechargerTout();
      onMessage(`Code d’activation généré pour ${reponse?.agent?.nom || valeur}.`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Génération du code impossible.');
    } finally {
      setCreation(false);
    }
  }

  /** L'agent s'est inscrit lui-même : on génère un code pour SON compte existant. */
  async function remettreCode(agent) {
    setIdEnCours(agent.id);
    setErreur('');
    try {
      const reponse = await adminApi.genererCodeAgent({ agentId: agent.id });
      setCodeRemis({
        nom: reponse?.agent?.nom || agent.nom,
        code: reponse?.agent?.code || agent.code,
        codeActivation: reponse?.codeActivation || '',
      });
      rechargerTout();
      onMessage(`Nouveau code d’activation pour ${agent.nom}.`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Génération du code impossible.');
    } finally {
      setIdEnCours('');
    }
  }

  /**
   * Suspendre / réactiver. La suspension coupe la connexion ET le pointage au
   * prochain appel : le serveur relit le statut en base, aucun jeton n'est exilé
   * « à la main » ici.
   */
  async function changerStatut(agent) {
    const cible = agent.statut === 'actif' ? 'suspendu' : 'actif';
    setIdEnCours(agent.id);
    setErreur('');
    try {
      const reponse = await adminApi.changerStatutAgent(agent.id, cible);
      rechargerTout();
      onMessage(
        reponse?.message ||
          (cible === 'actif' ? `${agent.nom} peut de nouveau se connecter.` : `${agent.nom} est suspendu.`)
      );
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Modification du statut impossible.');
    } finally {
      setIdEnCours('');
    }
  }

  /**
   * Suppression définitive : réservée aux erreurs de recrutement. Les fiches déjà
   * créées gardent le code (la paie passée reste vérifiable), d'où la confirmation
   * qui rappelle combien de fiches resteront rattachées au code.
   */
  async function retirerAgent(agent) {
    const fichesRattachees = agent.totalFiches || 0;
    const question =
      fichesRattachees > 0
        ? `Supprimer ${agent.nom} (code ${agent.code}) ?\n\nSes ${fichesRattachees} fiche(s) restent dans la paie sous ce code, mais plus aucune nouvelle fiche ne pourra lui être attribuée.`
        : `Supprimer ${agent.nom} (code ${agent.code}) ?\n\nAucune fiche n'est rattachée à ce code. Cette action est définitive.`;
    if (!window.confirm(question)) return;

    setIdEnCours(agent.id);
    setErreur('');
    try {
      const reponse = await adminApi.supprimerAgent(agent.id);
      rechargerTout();
      onMessage(reponse?.message || `${agent.nom} est supprimé.`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Suppression de l’agent impossible.');
    } finally {
      setIdEnCours('');
    }
  }

  async function validerFiche(fiche) {
    setIdEnCours(fiche.id);
    setErreur('');
    try {
      await adminApi.validerFiche(fiche.id);
      rechargerTout();
      onMessage(`« ${fiche.nom} » est vérifiée : elle sort de la file de contrôle.`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Validation impossible sur cette fiche.');
    } finally {
      setIdEnCours('');
    }
  }

  async function exporterCsv() {
    setExportEnCours(true);
    setErreur('');
    try {
      const csv = await adminApi.exportAgentsCsv();
      const nomFichier = `agents-terrain-${new Date().toISOString().slice(0, 10)}.csv`;
      if (!telechargerTexte(nomFichier, csv, 'text/csv;charset=utf-8')) {
        throw new Error('Le téléchargement a été bloqué par le navigateur.');
      }
      onMessage(`Export de paie téléchargé : ${nomFichier}`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Export CSV impossible pour le moment.');
    } finally {
      setExportEnCours(false);
    }
  }

  const liste = donnees?.agents || [];
  const codesInconnus = donnees?.codesInconnus || [];
  const totaux = donnees?.totaux || {};
  const aVerifier = fiches?.items || [];
  const lignesRapport = rapport?.lignes || [];

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      {codeRemis ? (
        <Alerte variante="succes" icone="check" onFermer={() => setCodeRemis(null)}>
          <div style={{ display: 'grid', gap: 4 }}>
            <span>
              <strong>{codeRemis.nom}</strong> — dictez ces deux codes à l’agent, ils ne seront
              plus affichés ensuite :
            </span>
            <span>
              Code d’activation (accès à /agent, une seule fois) :{' '}
              <strong style={{ letterSpacing: 3, fontSize: 18 }}>{codeRemis.codeActivation}</strong>
            </span>
            <span>
              Code agent (à recopier sur chaque fiche, clé de la paie) :{' '}
              <strong style={{ letterSpacing: 2 }}>{codeRemis.code}</strong>
            </span>
          </div>
        </Alerte>
      ) : null}

      <div className="bo-tuiles">
        <Tuile
          libelle="Agents actifs"
          valeur={totaux.agentsActifs || 0}
          note={`${totaux.agents || 0} code(s) au total`}
          icone="users"
        />
        <Tuile
          libelle="En attente d’activation"
          valeur={totaux.agentsEnAttente || 0}
          note="Code d’activation à remettre"
          icone="key"
          couleur={(totaux.agentsEnAttente || 0) > 0 ? 'accent' : ''}
        />
        <Tuile
          libelle="En service maintenant"
          valeur={totaux.agentsEnService || 0}
          note="Position suivie sur la carte"
          icone="mapPin"
          couleur={(totaux.agentsEnService || 0) > 0 ? 'vert' : ''}
        />
        <Tuile
          libelle="Fiches attribuées"
          valeur={totaux.fiches || 0}
          note="Fiches créées avec un code agent"
          icone="store"
        />
        <Tuile
          libelle="Fiches à vérifier"
          valeur={fiches?.total || 0}
          note="Numéro en double, GPS < 20 m, appareil…"
          icone="flag"
          couleur={(fiches?.total || 0) > 0 ? 'accent' : ''}
        />
        <Tuile
          libelle="Fiches (30 jours)"
          valeur={rapport?.totaux?.fiches || 0}
          note={`${rapport?.totaux?.joursCouverts || 0} jour(s) d’activité`}
          icone="activity"
        />
      </div>

      <Panneau
        titre="Agents de terrain"
        sous="Chaque agent reçoit un code à 6 caractères, recopié sur les fiches qu’il fait inscrire. Ce code est la clé de la paie : sans lui, la fiche n’est attribuée à personne."
        actions={
          <button
            type="button"
            className="bo-btn bo-btn--petit bo-btn--principal"
            disabled={exportEnCours || liste.length === 0}
            onClick={exporterCsv}
          >
            <Icon name="download" size={13} />
            {exportEnCours ? 'Préparation…' : 'Télécharger le CSV'}
          </button>
        }
      >
        <form className="bo-barre-outils" onSubmit={genererCode}>
          <div className="bo-recherche">
            <input
              className="bo-entree"
              type="text"
              placeholder="Nom de l’agent (ex. « Awa Traoré »)"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              maxLength={80}
              aria-label="Nom du nouvel agent"
            />
          </div>
          <div className="bo-recherche">
            <input
              className="bo-entree"
              type="tel"
              placeholder="Téléphone (ex. 07 07 12 34 56)"
              value={telephoneAgent}
              onChange={(e) => setTelephoneAgent(e.target.value)}
              maxLength={20}
              aria-label="Téléphone du nouvel agent"
            />
          </div>
          <button type="submit" className="bo-btn bo-btn--principal" disabled={creation}>
            <Icon name="key" size={14} />
            {creation ? 'Génération…' : 'Générer le code d’activation'}
          </button>
        </form>
        <p className="bo-doux" style={{ margin: '0 0 10px' }}>
          Le téléphone est obligatoire : c’est l’identifiant de connexion de l’agent sur{' '}
          <strong>/agent</strong>. Le code d’activation (8 caractères) n’est affiché qu’une seule
          fois, juste après la génération — notez-le avant de fermer le bandeau. Un agent déjà
          inscrit depuis son téléphone apparaît ci-dessous en « En attente » : utilisez le bouton
          « Code d’activation » de sa ligne.
        </p>

        {codesInconnus.length > 0 ? (
          <Alerte variante="alerte" icone="alert">
            {codesInconnus.length} code(s) figurent sur des fiches sans agent correspondant (
            {codesInconnus.map((ligne) => ligne.code).join(', ')}) : ces fiches ne peuvent pas être payées.
          </Alerte>
        ) : null}

        {chargement && !donnees ? (
          <EtatChargement texte="Chargement des agents…" />
        ) : liste.length === 0 ? (
          <EtatVide
            texte="Aucun agent pour le moment : créez le premier code ci-dessus, puis recopiez-le sur les fiches."
            icone="users"
          />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Code</th>
                  <th>Téléphone</th>
                  <th>Statut</th>
                  <th>Fiches</th>
                  <th>À vérifier</th>
                  <th>Dernière fiche</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <strong>{agent.nom}</strong>
                      <div className="bo-doux">
                        {agent.enService ? 'En service — position suivie' : 'Hors service'}
                      </div>
                    </td>
                    <td>
                      <strong style={{ letterSpacing: 1.5 }}>{agent.code}</strong>
                    </td>
                    <td>
                      {agent.telephone ? (
                        formatTelephone(agent.telephone)
                      ) : (
                        <span className="bo-doux">Aucun numéro</span>
                      )}
                    </td>
                    <td>
                      <Badge
                        variante={
                          agent.statut === 'actif' ? 'ok' : agent.statut === 'en_attente' ? 'attente' : 'ko'
                        }
                        icone={agent.statut === 'actif' ? 'check' : agent.statut === 'en_attente' ? 'clock' : 'ban'}
                      >
                        {agent.statut === 'actif'
                          ? 'Actif'
                          : agent.statut === 'en_attente'
                            ? 'En attente'
                            : 'Suspendu'}
                      </Badge>
                      {!agent.aCompte ? (
                        <div className="bo-doux">Aucun mot de passe : connexion impossible</div>
                      ) : null}
                    </td>
                    <td>{agent.totalFiches}</td>
                    <td>
                      {agent.fichesAVerifier > 0 ? (
                        <Badge variante="attente" icone="flag">
                          {agent.fichesAVerifier}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{agent.derniereActivite ? formatDateHeure(agent.derniereActivite) : '—'}</td>
                    <td className="bo-tableau-actions">
                      <button
                        type="button"
                        className="bo-btn bo-btn--petit"
                        disabled={idEnCours === agent.id || agent.statut === 'actif' || !agent.telephone}
                        title={
                          agent.statut === 'actif'
                            ? 'Ce compte est déjà actif : aucun code d’activation n’est nécessaire.'
                            : 'Générer un code d’activation à dicter à l’agent'
                        }
                        onClick={() => remettreCode(agent)}
                      >
                        <Icon name="key" size={13} />
                        Code d’activation
                      </button>
                      <button
                        type="button"
                        className={`bo-btn bo-btn--petit ${agent.statut === 'actif' ? 'bo-btn--danger' : 'bo-btn--ok'}`}
                        disabled={idEnCours === agent.id}
                        onClick={() => changerStatut(agent)}
                      >
                        <Icon name={agent.statut === 'actif' ? 'ban' : 'check'} size={13} />
                        {agent.statut === 'actif' ? 'Suspendre' : 'Activer'}
                      </button>
                      <button
                        type="button"
                        className="bo-btn bo-btn--petit bo-btn--danger"
                        disabled={idEnCours === agent.id}
                        title="Supprimer définitivement (erreur de recrutement)"
                        onClick={() => retirerAgent(agent)}
                      >
                        <Icon name="close" size={13} />
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>

      <Panneau
        titre="Fiches à vérifier"
        sous="Marquées automatiquement à l’inscription : numéro déjà utilisé, position à moins de 20 m, plus de 5 fiches en 24 h sur le même appareil, code agent inconnu. Aucune inscription n’a été bloquée — c’est ici qu’on tranche."
        serre
      >
        {chargement && !fiches ? (
          <EtatChargement texte="Chargement des fiches à vérifier…" />
        ) : aVerifier.length === 0 ? (
          <EtatVide texte="Aucune fiche suspecte : la file de contrôle est vide." icone="check" />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Fiche</th>
                  <th>Téléphone</th>
                  <th>Motifs</th>
                  <th>Code agent</th>
                  <th>Créée</th>
                  <th>Décision</th>
                </tr>
              </thead>
              <tbody>
                {aVerifier.map((fiche) => (
                  <tr key={fiche.id}>
                    <td>
                      <strong>{fiche.nom}</strong>
                      <div>{[fiche.quartier, fiche.commune].filter(Boolean).join(', ') || 'quartier non précisé'}</div>
                    </td>
                    <td>{fiche.telephone ? formatTelephone(fiche.telephone) : '—'}</td>
                    <td>
                      {(fiche.motifsVerification || []).length === 0 ? (
                        <span className="bo-doux">Aucun motif enregistré</span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {fiche.motifsVerification.map((motif) => (
                            <li key={motif}>{motif}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{fiche.codeAgent || '—'}</td>
                    <td>{formatDateHeure(fiche.createdAt)}</td>
                    <td className="bo-tableau-actions">
                      <button
                        type="button"
                        className="bo-btn bo-btn--ok"
                        disabled={idEnCours === fiche.id}
                        onClick={() => validerFiche(fiche)}
                      >
                        Valider la fiche
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>

      <Panneau
        titre="Fiches créées par jour"
        sous={`Nombre de fiches par agent et par jour sur les ${rapport?.jours || 30} derniers jours : c’est la base de la paie, et le seul chiffre qu’un agent ne peut pas gonfler depuis son téléphone.`}
        serre
      >
        {chargement && !rapport ? (
          <EtatChargement texte="Chargement du rapport…" />
        ) : lignesRapport.length === 0 ? (
          <EtatVide texte="Aucune fiche créée par un agent sur la période." icone="activity" />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Jour</th>
                  <th>Agent</th>
                  <th>Code</th>
                  <th>Fiches</th>
                  <th>À vérifier</th>
                </tr>
              </thead>
              <tbody>
                {lignesRapport.slice(0, 60).map((ligne) => (
                  <tr key={`${ligne.jour}-${ligne.code}`}>
                    <td>{formatDate(`${ligne.jour}T12:00:00Z`)}</td>
                    <td>{ligne.agentConnu ? ligne.nom : <Badge variante="ko" icone="alert">Code inconnu</Badge>}</td>
                    <td>
                      <strong style={{ letterSpacing: 1.5 }}>{ligne.code}</strong>
                    </td>
                    <td>{ligne.total}</td>
                    <td>{ligne.fichesAVerifier > 0 ? ligne.fichesAVerifier : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>
    </div>
  );
}

/* ─── Carte des agents (suivi GPS du service) ──────────────────────────────────
   La question posée ici n'est pas « qui existe ? » (c'est le tableau) mais « qui
   travaille en ce moment, et où ? ». Le serveur ne renvoie donc que les agents
   `enService` ET `actif` : un agent au repos n'est pas surveillé, sa dernière
   position ne quitte pas la base. Rafraîchissement toutes les 30 s, sans bouton à
   toucher : une position de terrain vieillit vite. */

/** Fond de carte : mêmes tuiles que la carte de choix de position (aucune clé). */
const TUILES_CARTE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Repère d'un agent : le `mapPin` de l'application, en vert « en service ». */
const ICONE_AGENT = `<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style="display:block">
  <path d="M12 22s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" fill="#16a34a" stroke="#14532d" stroke-width="1.6" stroke-linejoin="round" />
  <circle cx="12" cy="10" r="2.6" fill="#ffffff" />
</svg>`;

function VueCarteAgents({ cle, onGererErreur, onRafraichir }) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    let vivant = true;
    // Pas de `setChargement(true)` à chaque tour : le rafraîchissement automatique
    // ferait clignoter la carte toutes les 30 s. L'indicateur ne sert qu'au premier
    // chargement (état initial à `true`).
    adminApi
      .carteAgents()
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'La carte des agents est indisponible pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [cle, rechargement, onGererErreur]);

  useEffect(() => {
    const minuteur = setInterval(() => setRechargement((n) => n + 1), 30000);
    return () => clearInterval(minuteur);
  }, []);

  const agents = donnees?.agents || [];

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      <div className="bo-tuiles">
        <Tuile
          libelle="Agents en service"
          valeur={agents.length}
          note="Position suivie toutes les 5 min"
          icone="mapPin"
          couleur={agents.length > 0 ? 'vert' : ''}
        />
        <Tuile
          libelle="Dernière remontée"
          valeur={
            donnees?.horodatage
              ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(
                  new Date(donnees.horodatage)
                )
              : '—'
          }
          note="Heure du dernier appel au serveur"
          icone="clock"
        />
      </div>

      <Panneau
        titre="Qui travaille en ce moment"
        sous="Seuls les agents qui ont pris leur service et dont le compte est actif apparaissent. Rien n’est enregistré ici : la carte lit la dernière position envoyée par le téléphone de l’agent."
        serre
        actions={
          <button
            type="button"
            className="bo-btn bo-btn--petit"
            onClick={() => {
              setRechargement((n) => n + 1);
              onRafraichir?.();
            }}
          >
            <Icon name="refresh" size={13} />
            Actualiser
          </button>
        }
      >
        {chargement && !donnees ? (
          <EtatChargement texte="Recherche des agents en service…" />
        ) : (
          <>
            <CarteAgentsLeaflet agents={agents} />
            {agents.length === 0 ? (
              <p className="bo-doux" style={{ marginTop: 10 }}>
                Aucun agent en service pour l’instant : personne n’a appuyé sur « Prendre mon
                service » depuis son téléphone.
              </p>
            ) : (
              <div className="bo-tableau-enveloppe" style={{ marginTop: 12 }}>
                <table className="bo-tableau">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Code</th>
                      <th>Téléphone</th>
                      <th>Dernier pointage</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.id}>
                        <td>{agent.nom}</td>
                        <td>
                          <strong style={{ letterSpacing: 1.5 }}>{agent.code}</strong>
                        </td>
                        <td>{agent.telephone ? formatTelephone(agent.telephone) : '—'}</td>
                        <td>
                          {agent.dernierePosition?.updatedAt
                            ? formatDateRelative(agent.dernierePosition.updatedAt)
                            : '—'}
                        </td>
                        <td className="bo-doux">
                          {agent.dernierePosition
                            ? `${agent.dernierePosition.lat.toFixed(4)}, ${agent.dernierePosition.lng.toFixed(4)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Panneau>
    </div>
  );
}
/**
 * La carte elle-même. Leaflet est chargé à la demande : l'administration ne pèse
 * pas 40 ko de plus pour tout le monde, et la carte des agents n'existe que dans
 * cette section. Le nettoyage retire la carte du DOM, sinon un changement d'onglet
 * laisse des écouteurs et des tuiles en mémoire.
 */
function CarteAgentsLeaflet({ agents }) {
  const conteneur = useRef(null);
  const carte = useRef(null);
  const couche = useRef(null);
  const leaflet = useRef(null);
  const [etat, setEtat] = useState('chargement');

  useEffect(() => {
    let abandonne = false;
    (async () => {
      let module;
      try {
        const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        module = mod.default || mod;
      } catch {
        if (!abandonne) setEtat('echec');
        return;
      }
      if (abandonne || !conteneur.current) return;

      leaflet.current = module;
      const instance = module.map(conteneur.current, {
        center: [CENTRE_DEFAUT.lat, CENTRE_DEFAUT.lng],
        zoom: 11,
        zoomControl: true,
        scrollWheelZoom: false,
      });
      module
        .tileLayer(TUILES_CARTE, {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        })
        .addTo(instance);
      couche.current = module.layerGroup().addTo(instance);
      carte.current = instance;
      setEtat('prete');
      // Le panneau vient d'apparaître : sans ce recalcul, Leaflet garde la taille
      // qu'il avait avant la mise en page et n'affiche que des tuiles grises.
      window.setTimeout(() => instance.invalidateSize(), 120);
    })();

    return () => {
      abandonne = true;
      if (carte.current) {
        carte.current.remove();
        carte.current = null;
      }
      couche.current = null;
      leaflet.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    if (etat !== 'prete' || !L || !carte.current || !couche.current) return;

    couche.current.clearLayers();
    const points = [];

    agents.forEach((agent) => {
      const lat = agent.dernierePosition?.lat;
      const lng = agent.dernierePosition?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      points.push([lat, lng]);

      const repere = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'bo-repere-agent',
          html: ICONE_AGENT,
          iconSize: [30, 30],
          iconAnchor: [15, 29],
          popupAnchor: [0, -26],
        }),
        title: agent.nom,
        keyboard: false,
      });

      // Popup construit avec l'API DOM : le nom et le numéro viennent d'une saisie
      // libre et ne doivent jamais être interprétés comme du HTML par Leaflet.
      const bulle = document.createElement('div');
      bulle.style.minWidth = '150px';
      const titre = document.createElement('strong');
      titre.textContent = agent.nom;
      const code = document.createElement('div');
      code.textContent = `Code ${agent.code}${
        agent.telephone ? ` · ${formatTelephone(agent.telephone)}` : ''
      }`;
      const vue = document.createElement('div');
      vue.style.color = '#6b6b5e';
      vue.textContent = agent.dernierePosition?.updatedAt
        ? `Position ${formatDateRelative(agent.dernierePosition.updatedAt)}`
        : 'Position non datée';
      bulle.append(titre, code, vue);

      repere.bindPopup(bulle, { closeButton: false });
      repere.addTo(couche.current);
    });

    if (points.length === 1) {
      carte.current.setView(points[0], 15);
    } else if (points.length > 1) {
      carte.current.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    }
  }, [agents, etat]);

  if (etat === 'echec') {
    return (
      <Alerte variante="erreur" icone="alert">
        La carte n’a pas pu être chargée (bibliothèque indisponible). Vérifiez la connexion, puis
        actualisez.
      </Alerte>
    );
  }

  return (
    <div
      ref={conteneur}
      className="bo-carte-agents"
      style={{
        height: 420,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #e6e1d5',
        background: '#efeee8',
      }}
      role="img"
      aria-label="Carte des agents en service"
    />
  );
}




/* ─── Mises en avant (file d'attente) ─────────────────────────────────────────
   Pendant la période gratuite, la mise en avant est OFFERTE : le bouton du profil
   n'achète rien, il enregistre l'INTÉRÊT d'un artisan ou d'un gérant pour les
   futures options de visibilité (models/ListeAttente.js). Cette section est donc
   un carnet d'appels : qui rappeler, pour quel profil, depuis quand. Aucune
   action n'est nécessaire ici — la demande se traite au téléphone, avec la
   personne. Le compteur de la tuile vient du serveur (`listeAttente.enAttente`),
   la liste montre les demandes les plus récentes. */
function VueMisesEnAvant({ stats, onNaviguer, onOuvrirUtilisateur, onRafraichir }) {
  const file = stats?.listeAttente?.recentes || [];
  const total = stats?.listeAttente?.enAttente || 0;
  const avecFiche = file.filter((demande) => Boolean(demande.etablissement?.nom)).length;
  const sansFiche = file.length - avecFiche;

  return (
    <div className="bo-empile bo-apparition">
      <div className="bo-tuiles">
        <Tuile
          libelle="Demandes en attente"
          valeur={total}
          note="« Je veux être mis en avant »"
          icone="star"
          couleur={total > 0 ? 'accent' : ''}
        />
        <Tuile
          libelle="Avec une fiche"
          valeur={avecFiche}
          note={`Sur les ${file.length} demande(s) les plus récentes`}
          icone="store"
        />
        <Tuile
          libelle="Profil artisan seul"
          valeur={sansFiche}
          note={`Sur les ${file.length} demande(s) les plus récentes`}
          icone="tools"
        />
      </div>

      <Panneau
        titre="File d’attente"
        sous="Demandes les plus récentes, à rappeler pour les options de visibilité"
        actions={
          <button type="button" className="bo-btn bo-btn--petit" onClick={onRafraichir}>
            <Icon name="refresh" size={14} />
            Actualiser
          </button>
        }
      >
        {file.length === 0 ? (
          <EtatVide texte="Aucune demande de mise en avant pour l’instant." icone="star" />
        ) : (
          <div className="bo-tableau-enveloppe">
            <table className="bo-tableau">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>À mettre en avant</th>
                  <th>Demandée le</th>
                  <th>Ancienneté</th>
                  <th>Compte</th>
                </tr>
              </thead>
              <tbody>
                {file.map((demande) => (
                  <tr key={String(demande.id)}>
                    <td>
                      <div className="bo-cellule-principale">
                        <span className="bo-avatar">{initiales(demande.utilisateur?.nom) || '?'}</span>
                        <div>
                          <strong>{demande.utilisateur?.nom || 'Compte sans nom'}</strong>
                          <div className="bo-petit bo-doux">
                            {demande.utilisateur?.telephone
                              ? formatTelephone(demande.utilisateur.telephone)
                              : 'numéro indisponible'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {demande.etablissement?.nom || 'Profil artisan (sans fiche)'}
                      {demande.utilisateur?.metier ? (
                        <div className="bo-petit bo-doux">{demande.utilisateur.metier}</div>
                      ) : null}
                    </td>
                    <td>{formatDateHeure(demande.date)}</td>
                    <td>{formatDateRelative(demande.date) || '—'}</td>
                    <td className="bo-tableau-actions">
                      {demande.utilisateur?.id ? (
                        <button
                          type="button"
                          className="bo-btn bo-btn--petit"
                          onClick={() => onOuvrirUtilisateur(demande.utilisateur.id)}
                        >
                          Ouvrir
                        </button>
                      ) : (
                        <span className="bo-petit bo-doux">compte supprimé</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>

      <div className="bo-aide">
        <p className="bo-aide-titre">Comment traiter une demande</p>
        <ul className="bo-aide-liste">
          <li>Appelez la personne au numéro affiché : le numéro n’est pas public dans l’application.</li>
          <li>
            Confirmez ce qui doit être mis en avant — une fiche d’établissement ou un profil
            d’artisan — et le métier concerné.
          </li>
          <li>
            La mise en avant est offerte pendant la période gratuite : la demande sert à savoir qui
            rappeler le jour où des options de visibilité seront proposées.
          </li>
          <li>
            Besoin de la fiche complète du compte (activité, dépôts, contacts débloqués) ?
            « Ouvrir » mène directement à sa fiche dans la section Utilisateurs.
          </li>
        </ul>
        <div className="bo-ligne-actions">
          <button type="button" className="bo-btn bo-btn--petit" onClick={() => onNaviguer('utilisateurs')}>
            <Icon name="users" size={14} />
            Ouvrir les utilisateurs
          </button>
        </div>
      </div>
    </div>
  );
}



/* ─── Catégories proposées (prompt 6) ─────────────────────────────────────────
   La taxonomie locale (maquis, garbadrom, clé minute…) ne se devine pas depuis un
   bureau : quand un gérant ne trouve pas son métier, il l'écrit (« Poissonnerie »,
   « Cordonnerie »). Sa fiche l'affiche tout de suite ; c'est ICI qu'on décide si ce
   libellé doit être PROPOSÉ aux gérants suivants.
   Valider = la sous-catégorie rejoint la famille d'origine dans le formulaire
   d'inscription. Refuser = elle reste sur la fiche (on n'efface pas le travail du
   gérant) mais n'est plus proposée. Un libellé demandé plusieurs fois remonte en
   premier : `demandes` compte les fiches qui l'ont saisi. */
const ONGLETS_CATEGORIES = [
  { cle: 'en_attente', libelle: 'À trancher' },
  { cle: 'validee', libelle: 'Validées' },
  { cle: 'refusee', libelle: 'Refusées' },
  { cle: 'toutes', libelle: 'Toutes' },
];

function VueDemandesCategories({ cle, onMessage, onGererErreur, onRafraichir }) {
  const [statut, setStatut] = useState('en_attente');
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [idEnCours, setIdEnCours] = useState('');
  // Refus : le motif est facultatif, mais il explique pourquoi le métier n'est pas
  // proposé aux autres. Un seul formulaire ouvert à la fois.
  const [refusOuvert, setRefusOuvert] = useState('');
  const [motif, setMotif] = useState('');

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    adminApi
      .demandesCategories(statut)
      .then((reponse) => {
        if (!vivant) return;
        setDonnees(reponse);
        setErreur('');
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Catégories proposées indisponibles pour le moment.');
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [statut, cle, onGererErreur]);

  const lignes = donnees?.demandes || [];
  const compteurs = donnees?.compteurs || {};

  async function valider(ligne) {
    setIdEnCours(ligne.id);
    try {
      await adminApi.validerDemandeCategorie(ligne.id);
      onRafraichir();
      onMessage(`« ${ligne.nom} » est désormais proposée dans « ${libelleFamille(ligne.famille)} ».`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Validation impossible sur cette proposition.');
    } finally {
      setIdEnCours('');
    }
  }

  async function refuser(ligne) {
    setIdEnCours(ligne.id);
    try {
      await adminApi.refuserDemandeCategorie(ligne.id, motif.trim());
      setRefusOuvert('');
      setMotif('');
      onRafraichir();
      onMessage(`« ${ligne.nom} » ne sera plus proposée (elle reste affichée sur les fiches concernées).`);
    } catch (err) {
      if (!onGererErreur(err)) setErreur(err?.message || 'Refus impossible sur cette proposition.');
    } finally {
      setIdEnCours('');
    }
  }

  return (
    <Panneau
      titre="Catégories proposées"
      sous="Quand un gérant ne trouve pas son métier, il écrit le sien. Valider l’ajoute aux choix des prochains inscrits, dans sa famille ; refuser le laisse sur sa fiche sans le proposer."
      actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ONGLETS_CATEGORIES.map((onglet) => (
            <button
              key={onglet.cle}
              type="button"
              className={`bo-btn${statut === onglet.cle ? ' bo-btn--principal' : ''}`}
              onClick={() => setStatut(onglet.cle)}
            >
              {onglet.libelle}
              {onglet.cle === 'en_attente' && compteurs.enAttente ? (
                <span className="bo-onglet-compte">{compteurs.enAttente}</span>
              ) : null}
            </button>
          ))}
        </div>
      }
    >
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      {chargement ? (
        <EtatChargement texte="Chargement des catégories proposées…" />
      ) : lignes.length === 0 ? (
        <EtatVide
          texte={
            statut === 'en_attente'
              ? 'Aucune proposition en attente : tous les métiers saisis sont déjà connus.'
              : 'Aucune proposition dans cette liste.'
          }
          icone="check"
        />
      ) : (
        <div className="bo-tableau-enveloppe">
          <table className="bo-tableau">
            <thead>
              <tr>
                <th>Activité proposée</th>
                <th>Famille</th>
                <th>Demandes</th>
                <th>Proposée par</th>
                <th>Date</th>
                <th>{statut === 'en_attente' ? 'Décision' : 'Statut'}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => (
                <tr key={ligne.id}>
                  <td>
                    <strong>{ligne.nom}</strong>
                    <div className="bo-petit bo-doux">/{ligne.slug}</div>
                  </td>
                  <td>{libelleFamille(ligne.famille)}</td>
                  <td>{ligne.demandes || 1}</td>
                  <td>
                    {ligne.utilisateur ? (
                      <>
                        {ligne.utilisateur.nom || 'Compte sans nom'}
                        {ligne.utilisateur.telephone ? (
                          <div className="bo-petit bo-doux">{formatTelephone(ligne.utilisateur.telephone)}</div>
                        ) : null}
                      </>
                    ) : (
                      'compte supprimé'
                    )}
                    {ligne.etablissement ? (
                      <div className="bo-petit bo-doux">fiche : {ligne.etablissement.nom}</div>
                    ) : null}
                  </td>
                  <td>{ligne.date ? formatDateRelative(ligne.date) : '—'}</td>
                  <td className="bo-tableau-actions">
                    {statut !== 'en_attente' ? (
                      <>
                        <Badge
                          variante={ligne.statut === 'validee' ? 'ok' : 'ko'}
                          icone={ligne.statut === 'validee' ? 'check' : 'ban'}
                        >
                          {ligne.statut === 'validee' ? 'Proposée' : 'Refusée'}
                        </Badge>
                        {ligne.noteAdmin ? (
                          <span className="bo-sous-ligne bo-petit bo-doux" title={ligne.noteAdmin}>
                            motif : {ligne.noteAdmin}
                          </span>
                        ) : null}
                      </>
                    ) : refusOuvert === ligne.id ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input
                          className="bo-entree"
                          style={{ minWidth: 140 }}
                          value={motif}
                          onChange={(e) => setMotif(e.target.value.slice(0, 300))}
                          placeholder="Motif (facultatif)"
                          aria-label={`Motif du refus pour ${ligne.nom}`}
                        />
                        <button
                          type="button"
                          className="bo-btn bo-btn--danger"
                          disabled={idEnCours === ligne.id}
                          onClick={() => refuser(ligne)}
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          className="bo-btn"
                          onClick={() => {
                            setRefusOuvert('');
                            setMotif('');
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="bo-btn bo-btn--ok"
                          disabled={idEnCours === ligne.id}
                          onClick={() => valider(ligne)}
                        >
                          Valider
                        </button>
                        <button
                          type="button"
                          className="bo-btn bo-btn--danger"
                          disabled={idEnCours === ligne.id}
                          onClick={() => {
                            setRefusOuvert(ligne.id);
                            setMotif('');
                          }}
                        >
                          Refuser
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panneau>
  );
}

function VueProfil({ admin, onAdmin, onMessage, onGererErreur, onDeconnecter }) {
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [relecture, setRelecture] = useState(0);

  useEffect(() => {
    let vivant = true;
    adminApi
      .moi()
      .then((reponse) => {
        if (vivant && reponse?.user) onAdmin(reponse.user);
      })
      .catch((err) => {
        if (!vivant || onGererErreur(err)) return;
        setErreur(err?.message || 'Profil indisponible pour le moment.');
      });
    return () => {
      vivant = false;
    };
  }, [relecture, onAdmin, onGererErreur]);

  const soumettre = async (e) => {
    e.preventDefault();
    if (!ancien || !nouveau) {
      setErreur('Le mot de passe actuel et le nouveau sont obligatoires.');
      return;
    }
    if (nouveau.length < 6) {
      setErreur('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (nouveau !== confirmation) {
      setErreur('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setEnCours(true);
    setErreur('');
    try {
      const reponse = await adminApi.changerMonMotDePasse(ancien, nouveau);
      setAncien('');
      setNouveau('');
      setConfirmation('');
      onMessage(reponse?.message || 'Mot de passe administrateur modifié.');
    } catch (err) {
      if (!onGererErreur(err)) {
        setErreur(err?.message || 'Changement de mot de passe impossible.');
      }
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="bo-empile bo-apparition">
      {erreur ? (
        <Alerte variante="erreur" icone="alert" onFermer={() => setErreur('')}>
          {erreur}
        </Alerte>
      ) : null}

      <div className="bo-colonnes">
        <Panneau titre="Votre compte administrateur" sous="Identité et état du compte connecté">
          <div className="bo-fiche-titre">
            <span className="bo-avatar">{initiales(nomComplet(admin)) || '?'}</span>
            <span>
              <span className="bo-fiche-nom">{nomComplet(admin) || 'Administrateur'}</span>
              <span className="bo-fiche-sous">
                {`${formatTelephone(admin?.telephone) || 'numéro inconnu'} · accès back-office`}
              </span>
            </span>
          </div>

          <div className="bo-ligne-actions">
            <Badge variante="admin" icone="shield">
              Administrateur
            </Badge>
            <Badge variante="ok">
              <span className="bo-point" />
              Session active
            </Badge>
          </div>

          <dl className="bo-dl">
            <dt>Téléphone (identifiant de connexion)</dt>
            <dd className="bo-mono">{formatTelephone(admin?.telephone) || '—'}</dd>
            <dt>Identifiant technique</dt>
            <dd className="bo-mono bo-petit">{admin?.id || '—'}</dd>
            <dt>Compte créé le</dt>
            <dd>{formatDateHeure(admin?.createdAt)}</dd>
            <dt>Dernière connexion</dt>
            <dd>
              {admin?.dernierLoginAt
                ? `${formatDateHeure(admin.dernierLoginAt)} (${formatDateRelative(admin.dernierLoginAt)})`
                : '—'}
            </dd>
            <dt>Jeton conservé</dt>
            <dd>
              {getAdminToken()
                ? 'Jeton admin actif, rangé à part de la session de l’application.'
                : 'Aucun jeton admin dans ce navigateur.'}
            </dd>
          </dl>

          <div className="bo-ligne-actions">
            <button
              type="button"
              className="bo-btn bo-btn--petit"
              onClick={() => setRelecture((n) => n + 1)}
            >
              <Icon name="refresh" size={13} />
              Relire depuis le serveur
            </button>
            <button type="button" className="bo-btn bo-btn--danger bo-btn--petit" onClick={onDeconnecter}>
              <Icon name="logOut" size={13} />
              Se déconnecter
            </button>
          </div>
        </Panneau>

        <Panneau
          titre="Mot de passe"
          sous="L’ancien mot de passe est exigé : un poste laissé ouvert ne suffit pas"
          serre
        >
          <form className="bo-empile" onSubmit={soumettre}>
            <label className="bo-champ">
              <span className="bo-etiquette">Mot de passe actuel</span>
              <input
                className="bo-entree"
                type="password"
                autoComplete="current-password"
                value={ancien}
                onChange={(e) => setAncien(e.target.value)}
                placeholder="••••••"
              />
            </label>

            <label className="bo-champ">
              <span className="bo-etiquette">Nouveau mot de passe (6 caractères minimum)</span>
              <input
                className="bo-entree"
                type="password"
                autoComplete="new-password"
                value={nouveau}
                onChange={(e) => setNouveau(e.target.value)}
                placeholder="••••••"
              />
            </label>

            <label className="bo-champ">
              <span className="bo-etiquette">Confirmer le nouveau mot de passe</span>
              <input
                className="bo-entree"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="••••••"
              />
            </label>

            <div className="bo-ligne-actions">
              <button type="submit" className="bo-btn bo-btn--principal" disabled={enCours}>
                <Icon
                  name={enCours ? 'loader' : 'key'}
                  size={14}
                  className={enCours ? 'bo-tourne' : ''}
                />
                {enCours ? 'Modification…' : 'Modifier le mot de passe'}
              </button>
            </div>
          </form>

          <p className="bo-petit bo-doux">
            Le serveur relit le compte à chaque requête : la suspension prend effet
            immédiatement, mais un jeton ADMIN déjà émis reste valide jusqu’à son expiration.
            Conservez donc ce mot de passe dans un endroit sûr — il n’y a pas de
            « mot de passe oublié » côté back-office, un autre administrateur doit réinitialiser.
          </p>
        </Panneau>
      </div>
    </div>
  );
}





