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
//   5. MON PROFIL : identité administrateur, changement de mot de passe, déconnexion.
//
// Aucun déblocage « automatique » : valider un dépôt écrit `viaDepot: true` dans
// Job.contactDebloquePar côté serveur. Le front déclenche, il ne décide pas.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '../components/Icons.jsx';
import { adminApi, getAdminToken, setAdminToken } from '../utils/api/admin.js';
import { formatDateRelative, formatFcfa, formatTelephone, initiales } from '../utils/format.js';

/* ─────────────────────────── Repères de navigation ─────────────────────────── */

const SECTIONS = [
  {
    cle: 'tableau',
    libelle: 'Tableau de bord',
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
    cle: 'activite',
    libelle: 'Activité',
    icone: 'activity',
    sous: 'Inscriptions, connexions et paiements, dans un seul journal',
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
function NavLaterale({ admin, section, stats, onSection, onDeconnecter }) {
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
      const donnees = await adminApi.statistiques();
      setStats(donnees);
      setStatsErreur('');
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
        onSection={setSection}
        onDeconnecter={() => deconnecter()}
      />

      <div className="bo-main">
        <header className="bo-entete">
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

          {section === 'activite' ? (
            <VueActivite
              cle={cle}
              onGererErreur={gererErreur}
              onVoirUtilisateur={ouvrirUtilisateur}
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
    // Le serveur ne renvoie pas « actifs » : c'est tout sauf les suspendus.
    return Math.max(0, (compteurs.utilisateurs || 0) - (compteurs.suspendus || 0));
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
          note={`+${stats.inscrits7j || 0} ces 7 derniers jours`}
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
          note={`${stats.depots?.valides || 0} dépôt(s) validé(s) · contact à ${formatFcfa(stats.fraisDeblocage)}`}
          icone="chart"
        />
        <Tuile
          libelle="Comptes suspendus"
          valeur={stats.suspendus || 0}
          note="Connexion coupée immédiatement, même avec un jeton déjà émis"
          icone="ban"
          couleur={stats.suspendus > 0 ? 'rouge' : ''}
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

const TYPE_ANNONCE = { offre: 'Offre d’emploi', demande: 'Demande d’emploi' };

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
          <p className="bo-petit bo-doux">
            {nomComplet(action.depot.utilisateur)} · {libelleOperateur(action.depot.operateur)} ·{' '}
            {formatFcfa(action.depot.montant)}
            {action.depot.reference ? ` · réf. ${action.depot.reference}` : ''}
            {action.type === 'valider'
              ? ' — le contact de l’annonce deviendra visible pour cet utilisateur.'
              : ' — le contact RESTERA masqué et le motif ci-dessous lui sera affiché.'}
          </p>
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
        sous={`${total} compte(s) dans ce filtre${compteurs ? ` · ${compteurs.connectes24h} connecté(s) ces 24 h · ${compteurs.suspendus} suspendu(s)` : ''}`}
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
                    }`}
                    onClick={() => onUtilisateurOuvert(String(compte.id))}
                  >
                    <td>
                      <div className="bo-cellule-principale">
                        <span className="bo-avatar">{initiales(nomComplet(compte)) || '?'}</span>
                        <span>
                          <span className="bo-nom">{nomComplet(compte)}</span>
                          <span className="bo-sous-ligne bo-petit bo-doux">
                            {formatTelephone(compte.telephone) || 'numéro inconnu'}
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
                {formatTelephone(utilisateur?.telephone) || 'numéro inconnu'}
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
                <dd className="bo-mono">{formatTelephone(utilisateur.telephone) || '—'}</dd>
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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
          {utilisateur && !reinit ? (
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
          {utilisateur && suspendu ? (
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





