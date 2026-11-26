// ArtisanProfile.jsx — Page publique d'un artisan / prestataire (/artisan/:id)
//
// POURQUOI CETTE PAGE : depuis le 29/09, les cartes « Artisans mis en avant »
// affichaient un nom, un métier et une note — mais ne menaient nulle part. Un
// habitant qui voyait « Jean Kouassi, électricien, Angré » n'avait aucun moyen
// de lire la présentation de la personne ni de savoir s'il pouvait l'appeler :
// il fallait passer par la page Jobs et espérer la retrouver.
//
// DÉCISIONS
//  - La page n'est PAS en plein écran (voir App.jsx) : elle garde la barre du
//    haut et la navigation basse, comme la recherche ou les annonces. C'est une
//    fiche qu'on consulte au fil d'une liste ; un simple bouton « Retour » en
//    tête ramène à l'écran précédent.
//  - Une seule source de vérité : GET /api/users/:id (route PUBLIQUE déjà en
//    place). Aucun numéro n'est deviné ici : le serveur renvoie
//    `telephone: null` dès que `contactPublic` est faux, et la page se contente
//    de lire ce que l'API a bien voulu servir.
//  - `contactPublic === true` -> « Appeler » + « WhatsApp », en vert, comme les
//    cartes d'annonces et la fiche établissement : la personne a explicitement
//    accepté d'être contactée, on ne cache pas ce qu'elle a publié. Un bouton
//    « Envoyer un message » est ajouté en dessous : le chat interne (prompt B)
//    est disponible pour TOUT LE MONDE, y compris ceux qui publient leur numéro.
//  - `contactPublic === false` -> un seul bouton « Envoyer un message », qui
//    ouvre la messagerie interne (/messages?to=<id>). Le serveur ne renvoie
//    jamais le numéro dans ce cas ; la discussion se fait donc dans l'app.
//  - Identifiants « demo-… » : les cartes d'exemple (data/demoData.js), montrées
//    quand le serveur est injoignable, pointent vers /artisan/demo-artisan-jean.
//    Ces identifiants n'existent pas côté serveur : on les sert directement
//    depuis demoData (en le disant) au lieu d'afficher « introuvable » après un
//    aller-retour réseau voué à échouer.
//  - Trois échecs distincts, jamais un écran blanc : « introuvable » (404, ou
//    compte anonymisé), « serveur injoignable » et « échec » (autre erreur).
//    Chacun propose l'action utile — réessayer, ou revenir à la recherche.
//  - Les avis ne sont pas listés : la page demande la NOTE et le NOMBRE d'avis.
//    Le détail commenté viendra plus tard, pas avant.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import StarRating from '../components/StarRating.jsx';
import Illustration from '../components/illustrations/Illustration.jsx';
import { dessinDeContexte } from '../components/illustrations/dessinsContexte.js';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { ARTISANS_DEMO } from '../data/demoData.js';
import { formaterNomPublic, initiales } from '../utils/format.js';

/** Ouvre la messagerie interne sur la discussion avec cet artisan. */
function ouvrirMessagerie(navigate, artisanId) {
  navigate(`/messages?to=${artisanId}`);
}

/**
 * Les trois échecs possibles, avec l'action qui a du sens pour chacun.
 * `hors-ligne` propose de réessayer (le réseau revient), `introuvable` renvoie
 * vers l'annuaire : insister sur une adresse morte ne mènerait à rien.
 */
const ERREURS = {
  introuvable: {
    icone: 'user',
    illustration: 'boiteOutils',
    titre: 'Artisan introuvable',
    description:
      "Ce profil n'existe pas ou plus : le compte a peut-être été supprimé. Le reste de l'annuaire reste consultable.",
    action: 'recherche',
  },
  'hors-ligne': {
    icone: 'wifiOff',
    illustration: 'horsLigne',
    titre: 'Serveur injoignable',
    description:
      'Le profil n’a pas pu être chargé. Vérifiez votre connexion internet, puis réessayez : rien n’a été perdu.',
    action: 'reessayer',
  },
  echec: {
    icone: 'alert',
    illustration: 'boiteOutils',
    titre: 'Profil indisponible',
    description: 'Une erreur est survenue pendant le chargement. Réessayez dans un instant.',
    action: 'reessayer',
  },
};

/**
 * Grande photo de l'artisan, avec deux replis successifs — la MÊME règle que la
 * pastille des cartes (components/ArtisansMisEnAvant.jsx), pour qu'une personne
 * n'ait pas un dessin ici et des initiales là-bas :
 *   photo qui se charge -> dessin « crayon » du métier -> initiales.
 * L'état `cassee` est LOCAL : une URL de photo morte ne laisse jamais un trou.
 */
function AvatarArtisan({ artisan, nom }) {
  const [cassee, setCassee] = useState(false);
  const dessin = dessinDeContexte({ metier: artisan.metier });
  const url = artisan.photoProfil;

  useEffect(() => {
    setCassee(false);
  }, [url]);

  return (
    <span className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xl font-bold text-primary ring-1 ring-inset ring-primary/15">
      {url && !cassee ? (
        <img
          src={url}
          alt={nom}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setCassee(true)}
        />
      ) : dessin ? (
        <Illustration nom={dessin} taille={56} className="opacity-80" />
      ) : (
        initiales(nom) || '?'
      )}
    </span>
  );
}

/**
 * Squelette : MÊME silhouette que la fiche (médaillon, nom, métier, quartier,
 * deux lignes de bio, deux boutons). Un cadre beige vide se lit comme « l'app
 * est cassée » ; une silhouette qui a la forme du contenu se lit comme « ça
 * arrive ». `role="status"` + texte réservé aux lecteurs d'écran : le
 * chargement est annoncé, il n'est pas seulement mimé visuellement.
 */
function SqueletteProfil() {
  return (
    <div
      className="carte animate-pulse p-3"
      role="status"
      aria-live="polite"
      data-profil-chargement=""
    >
      <span className="sr-only">Chargement du profil de l’artisan…</span>
      <div className="flex items-center gap-3">
        <span className="h-20 w-20 shrink-0 rounded-full bg-soft" />
        <div className="min-w-0 flex-1">
          <span className="block h-4 w-32 rounded-full bg-soft" />
          <span className="mt-2 block h-3 w-24 rounded-full bg-soft" />
          <span className="mt-2 block h-3 w-20 rounded-full bg-soft" />
        </div>
      </div>
      <span className="mt-3 block h-3 w-28 rounded-full bg-soft" />
      <span className="mt-4 block h-3 w-full rounded-full bg-soft" />
      <span className="mt-1.5 block h-3 w-11/12 rounded-full bg-soft" />
      <span className="mt-1.5 block h-3 w-2/3 rounded-full bg-soft" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <span className="block h-10 rounded-md bg-soft" />
        <span className="block h-10 rounded-md bg-soft" />
      </div>
    </div>
  );
}

export default function ArtisanProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [artisan, setArtisan] = useState(null);
  const [chargement, setChargement] = useState(true);
  // null | 'introuvable' | 'hors-ligne' | 'echec' — voir ERREURS.
  const [erreur, setErreur] = useState(null);
  // Profil d'exemple (identifiant « demo-… ») : on le dit, on ne le fait pas
  // passer pour un vrai compte.
  const [exemple, setExemple] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);

    // 1. Carte d'exemple : son identifiant n'existe pas côté serveur. Répondre
    //    « introuvable » après une requête perdue serait un aveu d'échec alors
    //    que la donnée est déjà dans le bundle.
    const demo = ARTISANS_DEMO.find((a) => String(a.id) === String(id));
    if (demo) {
      setArtisan(demo);
      setExemple(true);
      setChargement(false);
      return;
    }

    // 2. Profil réel. `auth: false` : la route est publique, envoyer le jeton
    //    n'apporterait rien (et ferait voyager une identité pour rien).
    try {
      const reponse = await api.get(`/users/${id}`, { auth: false });
      setArtisan(reponse?.user || null);
      setExemple(false);
      if (!reponse?.user) setErreur('introuvable');
    } catch (err) {
      setArtisan(null);
      setExemple(false);
      // 404 = compte supprimé ou identifiant jamais attribué ; `offline` =
      // serveur injoignable (le client HTTP le marque ainsi) ; le reste = panne.
      if (err?.status === 404) setErreur('introuvable');
      else if (err?.offline) setErreur('hors-ligne');
      else setErreur('echec');
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    charger();
  }, [charger]);

  /**
   * Retour : l'écran précédent s'il existe (on arrive normalement de la rangée
   * « Artisans » ou de la recherche), sinon la recherche. `history.length` ne
   * dit pas d'où l'on vient, mais à 1 il n'y a rien derrière : on ne renvoie
   * jamais l'utilisateur vers un écran vide ni hors du site.
   */
  function revenir() {
    if (window.history.length > 1) navigate(-1);
    else navigate('/recherche');
  }

  const entete = (
    <button
      type="button"
      onClick={revenir}
      className="mb-2 flex items-center gap-0.5 text-xs font-semibold text-primary"
    >
      <Icon name="chevronLeft" size={16} />
      Retour
    </button>
  );

  if (chargement) {
    return (
      <div className="ecran py-3">
        {entete}
        <SqueletteProfil />
      </div>
    );
  }

  if (erreur || !artisan) {
    const infos = ERREURS[erreur] || ERREURS.introuvable;
    return (
      <div className="ecran py-3">
        {entete}
        <div className="carte">
          <EmptyState
            icone={infos.icone}
            illustration={infos.illustration}
            titre={infos.titre}
            description={infos.description}
            action={
              infos.action === 'reessayer'
                ? { libelle: 'Réessayer', onClick: charger }
                : { libelle: 'Retour à la recherche', onClick: () => navigate('/recherche') }
            }
          />
        </div>
      </div>
    );
  }

  // ── Données affichables ───────────────────────────────────────────────────
  // Le nom passe par formaterNomPublic() : beaucoup de comptes ont leur NUMÉRO
  // dans le champ « nom » (voir utils/format.js). L'annuaire ne l'affiche pas,
  // cette page non plus — sinon la fiche rendrait public ce que la mise en
  // relation est justement censée protéger.
  const nom =
    formaterNomPublic(artisan.nomComplet) ||
    formaterNomPublic([artisan.prenom, artisan.nom].filter(Boolean).join(' ')) ||
    'Artisan';
  const metier = artisan.metier || 'Métier à préciser';
  const lieu = [artisan.quartier, artisan.commune].filter(Boolean).join(', ') || 'Abidjan';
  const bio = String(artisan.bio || '').trim();
  const nombreAvis = Number(artisan.nombreAvis) || 0;
  const noteMoyenne = Number(artisan.noteMoyenne) || 0;
  const aDesAvis = nombreAvis > 0 || noteMoyenne > 0;

  // Contact direct seulement si le drapeau ET le numéro sont là : le serveur
  // met `telephone: null` quand `contactPublic` est faux, on ne se fie donc pas
  // à un seul des deux champs.
  const contactDirect = Boolean(artisan.contactPublic && artisan.telephone);
  const lienWhatsApp = contactDirect
    ? `https://wa.me/${String(artisan.telephone).replace('+', '')}?text=${encodeURIComponent(
        `Bonjour, je vous contacte via Rejoins'Moi pour vos services de ${artisan.metier || 'votre métier'}.`
      )}`
    : '';

  return (
    <div className="ecran py-3">
      {entete}

      {exemple && (
        <InfoBanner variante="demo" titre="Profil d’exemple" className="mb-2">
          Le serveur est injoignable : ce profil vient des données d’exemple de l’application. Aucun
          numéro n’est communiqué.
        </InfoBanner>
      )}

      <article className="carte p-3">
        <div className="flex items-center gap-3">
          <AvatarArtisan artisan={artisan} nom={nom} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight text-ink">{nom}</h1>
            <p className="truncate text-sm font-semibold text-primary">{metier}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted">
              <Icon name="mapPin" size={12} className="shrink-0" />
              <span className="truncate">{lieu}</span>
            </p>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {aDesAvis ? (
            <StarRating note={noteMoyenne} nombreAvis={nombreAvis} taille={16} />
          ) : (
            <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-bold text-ink-muted">
              Pas encore noté
            </span>
          )}
          {artisan.misEnAvant && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
              Mis en avant
            </span>
          )}
        </div>

        {bio && (
          <section className="mt-3 border-t border-line pt-2">
            <h2 className="text-sm font-bold text-ink">À propos</h2>
            <p className="mt-1 whitespace-pre-line text-sm leading-snug text-ink">{bio}</p>
          </section>
        )}
      </article>

      {/* ── Actions ────────────────────────────────────────────────────────
          Deux chemins, jamais les deux à la fois : soit la personne a publié
          son numéro (contactPublic), soit non. Pas de troisième bouton
          « Partager » : une fiche artisan répond à une recherche, ce n'est pas
          une devanture qu'on envoie à un client. */}
      <section className="mt-3">
        <h2 className="mb-1.5 text-sm font-bold text-ink">Actions</h2>

        {contactDirect ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <a className="btn-health text-sm" href={`tel:${artisan.telephone}`}>
                <Icon name="phone" size={17} />
                Appeler
              </a>
              <a
                className="btn-health-ghost text-sm"
                href={lienWhatsApp}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="whatsapp" size={17} />
                WhatsApp
              </a>
            </div>
            {/* Le chat interne reste disponible même quand le numéro est publié :
                certaines personnes préfèrent ne pas recevoir d'appel. */}
            <button
              type="button"
              className="btn-ghost mt-2 w-full text-sm"
              onClick={() => ouvrirMessagerie(navigate, artisan.id)}
            >
              <Icon name="message" size={17} />
              Envoyer un message
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="bouton-principal w-full text-sm"
              onClick={() => ouvrirMessagerie(navigate, artisan.id)}
            >
              <Icon name="message" size={17} />
              Envoyer un message
            </button>
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-ink-muted">
              <Icon name="lock" size={13} className="mt-0.5 shrink-0" />
              <span>
                {nom} n’a pas publié son numéro : la discussion se déroule dans l’application, sans
                que vos coordonnées soient échangées.
              </span>
            </p>
          </>
        )}
      </section>

      <p className="mt-2 text-[10px] leading-snug text-ink-muted">
        Les coordonnées ne s’affichent que si l’artisan a accepté d’être contacté publiquement. Un
        profil « mis en avant » apparaît en tête de l’annuaire, jamais à la place des autres.
      </p>
    </div>
  );
}
