// og-etablissement.js — Socle de la fonction Cloudflare Pages `/etablissement/:id`.
//
// LE PROBLÈME (relevé le 17/11)
//   L'application est une SPA React : toutes les adresses servent le MÊME
//   index.html. Quand on colle le lien d'une fiche dans WhatsApp, son robot lit
//   donc l'index.html générique — d'où une vignette et un titre identiques pour
//   les 6 700 fiches (« Rejoins'Moi »), au lieu du nom et de la photo de
//   l'établissement. Google, lui, ne peut pas indexer les fiches
//   individuellement : il ne voit qu'une page, répétée.
//
// LA RÉPONSE
//   Une fonction Pages intercepte `/etablissement/:id` AVANT de servir les
//   fichiers statiques. Elle interroge l'API, puis réécrit dans le HTML les
//   quelques balises que lisent WhatsApp, Facebook et Google (<title>, og:*,
//   twitter:*), et y ajoute un bloc JSON-LD `LocalBusiness` (nom, adresse,
//   téléphone, GPS). Le corps de la page ne change pas : c'est toujours le même
//   index.html, donc la même application React qui démarre.
//
// CE FICHIER NE CONTIENT QUE DE LA LOGIQUE PURE : aucune API propre à Cloudflare
//   (ni `env.ASSETS` obligatoire, ni `waitUntil`). Il est donc testable hors
//   Workers, avec un simple `context` simulé, et il est partagé par les deux
//   points d'entrée (functions/etablissement/[id].js et
//   frontend/functions/etablissement/[id].js). Seuls `Request`/`Response`/`URL`
//   sont utilisés : ce sont des standards, présents dans Workers comme dans Node.
//
// RÈGLE DE SÉCURITÉ : tout ce qui vient de l'API est ÉCHAPPÉ avant d'entrer
//   dans le HTML (`echapperHtml`, et `\u003c` dans le JSON-LD). Un nom
//   d'établissement est saisi par un utilisateur : sans échappement, il pourrait
//   fermer une balise et injecter du script dans une page publique.

/** API publique du backend (Render). Peut être changée par `env.API_BASE_URL`. */
export const API_ETABLISSEMENTS = 'https://rejoins-moi-api.onrender.com';

/** Domaine publié sur Cloudflare Pages (vignette de repli, JSON-LD). */
export const SITE_PUBLIC = 'https://rejoins-moi.pages.dev';

/** Vignette de repli : l'icône de l'application, en URL absolue (WhatsApp l'exige). */
export const IMAGE_DEFAUT = `${SITE_PUBLIC}/icons/icon-512.png`;

/** Nom affiché de l'application (og:site_name, titres). */
export const NOM_APPLICATION = "Rejoins'Moi";

/**
 * Délai maximal accordé à l'API avant de renoncer. Court, volontairement : le
 * robot de WhatsApp abandonne vite, et une page servie en 25 s (démarrage à
 * froid de Render) ne produit AUCUN aperçu. Mieux vaut une page rapide au titre
 * générique qu'un lien mort. La réponse est ensuite mise en cache au bord
 * (s-maxage), donc les partages suivants n'attendent plus.
 */
export const DELAI_API_MS = 4000;

/** Libellés lisibles des catégories (le backend renvoie des clés techniques). */
const LIBELLES_CATEGORIES = {
  alimentation: 'Alimentation',
  beaute: 'Beauté',
  services: 'Services',
  artisanat: 'Artisanat',
  commerce: 'Commerce',
  sante: 'Santé',
  spiritualite: 'Spiritualité',
  autre: 'Artisan de quartier',
};

/** Un identifiant MongoDB valide : 24 caractères hexadécimaux. */
export function estIdentifiantValide(id) {
  return /^[a-f0-9]{24}$/i.test(String(id || ''));
}

/**
 * Échappe une valeur pour insertion dans du HTML (texte ou attribut).
 * `&` d'abord, sinon on ré-échapperait les entités produites.
 */
export function echapperHtml(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Réduit un texte à `max` caractères, sur une frontière de mot, sans jamais
 * couper au milieu d'un mot (une description tronquée net fait « bâclée » dans
 * un aperçu WhatsApp).
 */
export function resumer(texte, max = 160) {
  const plat = String(texte ?? '').replace(/\s+/g, ' ').trim();
  if (plat.length <= max) return plat;
  const coupe = plat.slice(0, max - 1);
  const sansMotCoupe = coupe.includes(' ') ? coupe.replace(/\s+\S*$/, '') : coupe;
  return `${sansMotCoupe.replace(/[\s,;:·—-]+$/, '')}…`;
}

/** « alimentation » -> « Alimentation ». Une catégorie inconnue reste lisible. */
export function libelleCategorie(fiche) {
  const cle = String(fiche?.categorie || '').toLowerCase();
  return (
    LIBELLES_CATEGORIES[cle] ||
    (fiche?.sousCategorie ? String(fiche.sousCategorie) : 'Artisan de quartier')
  );
}

/**
 * Recadre une image Cloudinary au format d'aperçu (1200 × 630, celui de
 * Facebook/WhatsApp/LinkedIn) et la compresse.
 *
 * POURQUOI : une photo de devanture envoyée depuis un téléphone pèse souvent
 * 2 à 5 Mo et plusieurs milliers de pixels de large. Le robot de WhatsApp
 * abandonne au-delà de quelques centaines de kilo-octets : la vignette resterait
 * vide. On demande donc à Cloudinary une version déjà calibrée.
 *
 * `c_pad` + `b_gen_fill` : l'image entière est conservée (aucun cadrage qui
 * couperait la devanture), les bandes manquantes reçoivent un fond flou tiré de
 * la photo. On ne touche QUE les URL Cloudinary non transformées
 * (`/upload/v1234/...`) : toute autre adresse est renvoyée telle quelle.
 */
export function optimiserImage(url) {
  const valeur = String(url || '');
  if (!/^https?:\/\//i.test(valeur)) return '';
  if (!/res\.cloudinary\.com/i.test(valeur)) return valeur;
  const [avant, apres] = valeur.split('/upload/');
  if (!apres) return valeur;
  // On ne touche qu'une URL NON transformée : juste après `/upload/` vient
  // directement `v<horodatage>/`. Toute autre forme est renvoyée telle quelle,
  // pour ne jamais empiler deux jeux de transformations.
  if (!/^v\d+\//.test(apres)) return valeur;
  return `${avant}/upload/c_pad,w_1200,h_630,b_gen_fill,q_auto:good,f_jpg/${apres}`;
}

/**
 * Choisit l'image de partage, par ordre de fiabilité décroissante :
 *   1. la devanture, si le gérant a saisi une URL https (fiches importées) ;
 *   2. la première photo de la galerie (Cloudinary : CDN toujours chaud, donc
 *      rapide pour le robot) ;
 *   3. `photoDevantureUrl`, la route d'image de l'API — utile quand la photo est
 *      stockée en base, mais elle traverse Render (instance qui peut dormir) ;
 *   4. l'icône de l'application, pour ne jamais produire d'aperçu sans vignette.
 *
 * NB : l'API renvoie `''` (et non une URL cassée) quand la fiche n'a aucune
 * image — inutile d'appeler une route qui répondrait 404.
 */
export function imageDePartage(fiche) {
  const candidates = [
    fiche?.photoDevanture,
    Array.isArray(fiche?.photos) ? fiche.photos[0] : '',
    fiche?.photoDevantureUrl,
  ];
  for (const candidate of candidates) {
    const url = optimiserImage(candidate);
    if (url) return url;
  }
  return IMAGE_DEFAUT;
}

/**
 * Téléphone au format international (E.164) pour le JSON-LD.
 * Les numéros ivoiriens sont saisis à 10 chiffres (« 07 68 42 73 05 ») : on
 * retire les séparateurs et on préfixe l'indicatif +225. Un numéro qui commence
 * déjà par « + » est conservé tel quel.
 */
export function telephoneInternational(telephone) {
  const brut = String(telephone || '').trim();
  if (!brut) return '';
  if (brut.startsWith('+')) return `+${brut.slice(1).replace(/\D/g, '')}`;
  const chiffres = brut.replace(/\D/g, '');
  if (!chiffres) return '';
  if (chiffres.startsWith('225')) return `+${chiffres}`;
  return `+225${chiffres}`;
}

/** Titre de la page : ce que WhatsApp affiche en gras au-dessus de la phrase. */
export function titreDe(fiche) {
  const lieu = fiche?.commune || fiche?.quartier || 'Abidjan';
  return resumer(`${fiche?.nom} — ${libelleCategorie(fiche)} à ${lieu} · ${NOM_APPLICATION}`, 110);
}

/**
 * Phrase d'aperçu : la description du gérant quand elle existe (c'est sa
 * vitrine), sinon une phrase de service qui dit ce qu'on trouve sur la page, et
 * toujours le quartier.
 */
export function descriptionDe(fiche) {
  const lieu = [fiche?.quartier, fiche?.commune].filter(Boolean).join(' · ');
  const description = String(fiche?.description || '').trim();
  const morceaux = [
    description ||
      `${libelleCategorie(fiche)} à Abidjan : adresse, téléphone, horaires et photos sur ${NOM_APPLICATION}.`,
  ];
  if (lieu) morceaux.push(lieu);
  return resumer(morceaux.join(' · '), 200);
}

/**
 * Bloc JSON-LD `LocalBusiness` (schema.org), celui que Google lit pour
 * comprendre qu'il s'agit d'un commerce local à Abidjan : nom, adresse,
 * téléphone, coordonnées GPS.
 *
 * `image` n'est déclarée que si c'est une vraie photo de la fiche : annoncer
 * l'icône générique de l'app comme photo d'établissement serait un faux signal
 * (et Google sanctionne les données structurées trompeuses).
 */
export function donneesStructurees(fiche, { url, image }) {
  const donnees = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${url}#etablissement`,
    name: String(fiche?.nom || ''),
    url,
  };

  const description = String(fiche?.description || '').trim();
  if (description) donnees.description = description;

  if (image && image !== IMAGE_DEFAUT) donnees.image = image;

  const telephone = telephoneInternational(fiche?.telephone);
  if (telephone) donnees.telephone = telephone;

  // Adresse postale : la rue reste facultative dans les fiches importées, le
  // quartier est le repère qui compte à Abidjan.
  const rue = [fiche?.quartier, fiche?.adresse].filter(Boolean).join(', ');
  const adresse = { '@type': 'PostalAddress', addressCountry: 'CI' };
  if (rue) adresse.streetAddress = rue;
  if (fiche?.commune) adresse.addressLocality = String(fiche.commune);
  adresse.addressRegion = 'Abidjan';
  donnees.address = adresse;

  const latitude = Number(fiche?.localisation?.lat);
  const longitude = Number(fiche?.localisation?.lng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    donnees.geo = { '@type': 'GeoCoordinates', latitude, longitude };
  }

  return donnees;
}

// ── Réécriture du <head> ─────────────────────────────────────────────────────
// On travaille sur le HTML déjà compilé par Vite (balises présentes, commentaires
// retirés) plutôt que sur un gabarit à nous : l'index.html reste la seule source
// de vérité pour les scripts, le manifeste et les icônes.

/** Insère un extrait juste avant `</head>` (cas d'une balise absente). */
function insererDansEntete(html, extrait) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `  ${extrait}\n  </head>`);
  return `${html}\n${extrait}`;
}

/** Remplace le contenu d'une balise `<meta>`, ou l'ajoute si elle n'existe pas. */
function poserMeta(html, attribut, cle, contenu) {
  const valeur = echapperHtml(contenu);
  const motif = new RegExp(`<meta\\b[^>]*\\b${attribut}="${cle}"[^>]*>`, 'i');
  if (motif.test(html)) {
    return html.replace(motif, (balise) => {
      if (/\bcontent="/i.test(balise)) {
        return balise.replace(/\bcontent="[^"]*"/i, `content="${valeur}"`);
      }
      return balise.replace(/\s*\/?>\s*$/, ` content="${valeur}" />`);
    });
  }
  return insererDansEntete(html, `<meta ${attribut}="${cle}" content="${valeur}" />`);
}

/** Remplace le contenu du `<title>`. */
function poserTitre(html, titre) {
  const balise = `<title>${echapperHtml(titre)}</title>`;
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, () => balise);
  }
  return insererDansEntete(html, balise);
}

/** Pose `rel="canonical"` : c'est lui qui évite à Google de dupliquer les fiches. */
function poserCanonique(html, url) {
  const valeur = echapperHtml(url);
  const motif = /<link\b[^>]*\brel="canonical"[^>]*>/i;
  if (motif.test(html)) {
    return html.replace(motif, (balise) => balise.replace(/\bhref="[^"]*"/i, `href="${valeur}"`));
  }
  return insererDansEntete(html, `<link rel="canonical" href="${valeur}" />`);
}

/**
 * Ajoute le bloc JSON-LD. `<` devient `\u003c` : sans cela, un texte contenant
 * `</script>` refermerait la balise et casserait la page (le JSON reste
 * strictement équivalent).
 */
function poserDonneesStructurees(html, donnees) {
  const json = JSON.stringify(donnees).replace(/</g, '\\u003c');
  return insererDansEntete(html, `<script type="application/ld+json">${json}</script>`);
}

/**
 * Applique toutes les substitutions à l'index.html.
 *
 * @param {string} html index.html tel que servi par l'hébergeur
 * @param {{titre: string, description: string, image: string, url: string,
 *          donneesStructurees: object}} valeurs
 * @returns {string} le même document, avec les balises d'aperçu remplacées
 */
export function construireHtml(html, { titre, description, image, url, donneesStructurees: structurees }) {
  let sortie = String(html);
  sortie = poserTitre(sortie, titre);
  sortie = poserMeta(sortie, 'property', 'og:title', titre);
  sortie = poserMeta(sortie, 'property', 'og:description', description);
  sortie = poserMeta(sortie, 'property', 'og:image', image);
  sortie = poserMeta(sortie, 'property', 'og:url', url);
  // Moteurs qui ne lisent pas Open Graph (et balise déjà présente dans
  // l'index.html) : on garde les deux jeux de balises cohérents.
  sortie = poserMeta(sortie, 'name', 'description', description);
  sortie = poserMeta(sortie, 'name', 'twitter:title', titre);
  sortie = poserMeta(sortie, 'name', 'twitter:description', description);
  sortie = poserMeta(sortie, 'name', 'twitter:image', image);
  sortie = poserCanonique(sortie, url);
  sortie = poserDonneesStructurees(sortie, structurees);
  return sortie;
}

/** Adresse publique de la page, sans paramètres de suivi (`?utm=…`). */
export function urlPubliqueDe(request) {
  try {
    const url = new URL(request.url);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return `${SITE_PUBLIC}/`;
  }
}

/**
 * Interroge l'API pour UNE fiche.
 *
 * Ne lève jamais : tout échec (API endormie, délai dépassé, identifiant inconnu,
 * réponse inattendue) renvoie `null`, et l'appelant sert alors l'index.html
 * d'origine. Un lien partagé sur WhatsApp ne doit jamais tomber sur une erreur.
 *
 * @param {string} id identifiant MongoDB de la fiche
 * @param {{base?: string, fetchImpl?: Function, delaiMs?: number}} options
 * @returns {Promise<object|null>}
 */
export async function chargerFiche(
  id,
  { base = API_ETABLISSEMENTS, fetchImpl = fetch, delaiMs = DELAI_API_MS } = {}
) {
  const racine = String(base || API_ETABLISSEMENTS).replace(/\/+$/, '');
  const adresse = `${racine}/api/establishments/${encodeURIComponent(id)}`;
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(delaiMs)
      : undefined;
  try {
    const reponse = await fetchImpl(adresse, { headers: { accept: 'application/json' }, signal });
    if (!reponse || !reponse.ok) return null;
    const donnees = await reponse.json();
    const fiche = donnees?.etablissement;
    if (!fiche || !fiche.nom) return null;
    return fiche;
  } catch {
    return null;
  }
}

// ── Requête HTTP : le code exécuté par la fonction Pages ─────────────────────

/**
 * Lit l'index.html statique du site.
 *
 * On passe par la liaison `ASSETS` (le dossier publié) plutôt que par
 * `fetch(request)` : cela évite de rappeler la fonction elle-même (boucle) et de
 * dépendre de la règle de réécriture SPA de `_redirects`. `context.next()` reste
 * le repli si la liaison n'est pas exposée.
 *
 * @param {{request: Request, env?: object, next?: Function}} context
 * @returns {Promise<string|null>} le HTML, ou null si introuvable
 */
export async function lireIndexHtml(context) {
  const { request, env } = context || {};
  try {
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const url = new URL('/index.html', request.url).toString();
      const reponse = await env.ASSETS.fetch(new Request(url, { headers: { accept: 'text/html' } }));
      if (reponse && reponse.ok) return await reponse.text();
    }
  } catch {
    /* on tente le repli ci-dessous */
  }
  try {
    if (typeof context.next === 'function') {
      const reponse = await context.next();
      if (reponse && reponse.ok) return await reponse.text();
    }
  } catch {
    /* rien de mieux à proposer */
  }
  return null;
}

/**
 * Réponse HTML. `s-maxage` : un lien partagé plusieurs fois ne doit pas réveiller
 * Render à chaque lecture. La version « sans fiche » est mise en cache beaucoup
 * moins longtemps : elle peut correspondre à une API simplement endormie,
 * corrigée dès la requête suivante.
 */
function reponseHtml(corps, { injecte }) {
  return new Response(corps, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': injecte ? 'public, max-age=0, s-maxage=1800' : 'public, max-age=0, s-maxage=60',
      // En-tête de diagnostic, visible avec `curl -I` : sans effet pour le visiteur.
      'x-etablissement-og': injecte ? 'fiche' : 'defaut',
    },
  });
}

/**
 * Traite GET /etablissement/:id.
 *
 * Ne renvoie JAMAIS d'erreur 500 : si l'API ne répond pas, si l'identifiant est
 * inconnu ou mal formé, on sert l'index.html d'origine (statut 200). Un lien
 * partagé doit toujours s'ouvrir — un aperçu générique vaut mieux qu'une page
 * d'erreur.
 *
 * @param {object} context contexte Cloudflare Pages (`request`, `env`, `params`, `next`)
 * @returns {Promise<Response>}
 */
export async function gererRequeteEtablissement(context) {
  const html = await lireIndexHtml(context);
  if (!html) {
    // Même l'index.html est inaccessible : on laisse l'hébergeur répondre.
    if (typeof context.next === 'function') return context.next();
    return new Response('Page indisponible.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const id = String(context.params?.id || '');
  const url = urlPubliqueDe(context.request);
  const fiche = estIdentifiantValide(id)
    ? await chargerFiche(id, { base: context.env?.API_BASE_URL })
    : null;

  // Fiche absente ou API muette : page d'origine, intacte.
  if (!fiche) return reponseHtml(html, { injecte: false });

  const image = imageDePartage(fiche);
  const corps = construireHtml(html, {
    titre: titreDe(fiche),
    description: descriptionDe(fiche),
    image,
    url,
    donneesStructurees: donneesStructurees(fiche, { url, image }),
  });
  return reponseHtml(corps, { injecte: true });
}





