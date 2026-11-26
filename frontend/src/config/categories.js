// categories.js — Taxonomie LOCALE de Rejoins'Moi (source de vérité côté frontend).
//
// POURQUOI CE FICHIER : jusqu'ici la liste vivait dans data/demoData.js, c'est-à-dire
// dans le jeu de données de secours — un comble pour une info qui pilote le feed,
// l'inscription et le back-office. Elle vit désormais ici, et demoData.js la RÉ-EXPORTE
// (`CATEGORIES`) pour ne pas casser les écrans existants.
//
// DEUX NIVEAUX, comme dans la rue :
//   • la FAMILLE  = l'onglet du feed (slug stocké dans Establishment.categorie) ;
//   • la SOUS-CATÉGORIE = ce que le gérant précise (« Garbadrom », « Clé minute »),
//     stockée dans Establishment.sousCategorie / sousCategorieSlug.
//
// Les 8 familles historiques sont CONSERVÉES telles quelles (slugs inchangés) : les
// 6 719 fiches importées et les liens partagés ont `categorie=alimentation`, etc.
// Quatre familles locales s'y ajoutent, et la migration (backend/scripts/
// migrer-categories.js) y bascule les sous-catégories concernées.
//
// Le miroir serveur est backend/src/config/categories.js : toute famille ou
// sous-catégorie ajoutée ici doit y être ajoutée aussi (l'API valide l'enum).

/**
 * Familles affichées dans les filtres. `icone` = clé de components/Icons.jsx.
 * `historique: true` = famille présente AVANT le passage aux catégories locales.
 */
export const FAMILLES = [
  { slug: 'tous', label: 'Tous', icone: 'grid' },
  { slug: 'alimentation', label: 'Alimentation', icone: 'utensils', historique: true },
  { slug: 'beaute', label: 'Beauté', icone: 'scissors', historique: true },
  { slug: 'services', label: 'Services', icone: 'tools', historique: true },
  { slug: 'artisanat', label: 'Artisanat', icone: 'hammer', historique: true },
  { slug: 'commerce', label: 'Commerce', icone: 'store', historique: true },
  { slug: 'sante', label: 'Santé', icone: 'heart', historique: true },
  { slug: 'spiritualite', label: 'Spiritualité', icone: 'church', historique: true },
  // ── Familles locales (adaptation ivoirienne) ──
  { slug: 'restauration', label: 'Restauration et boissons', icone: 'utensils' },
  { slug: 'commerces', label: 'Commerces', icone: 'store' },
  { slug: 'proximite', label: 'Services de proximité', icone: 'tools' },
  { slug: 'cultes', label: 'Lieux de culte et communautaires', icone: 'church' },
  { slug: 'autre', label: 'Autre', icone: 'dot', historique: true },
];

/** Alias historique : les écrans importaient `CATEGORIES` depuis demoData.js. */
export const CATEGORIES = FAMILLES;

/**
 * Sous-catégories proposées par famille, dans l'ordre d'affichage.
 * `libre: true` = la sous-catégorie n'est pas un libellé figé : l'utilisateur écrit
 * le sien (« Autre (précisez) ») et sa proposition part en modération.
 */
export const SOUS_CATEGORIES = {
  restauration: [
    { slug: 'maquis', label: 'Maquis' },
    { slug: 'koutoukoudrom', label: 'Koutoukoudrom' },
    { slug: 'placalidrom', label: 'Placalidrom' },
    { slug: 'garbadrom', label: 'Garbadrom' },
    { slug: 'boulangerie', label: 'Boulangerie' },
    { slug: 'patisserie', label: 'Pâtisserie' },
    { slug: 'boutique-alimentaire', label: 'Boutique alimentaire' },
    { slug: 'market', label: 'Market' },
  ],
  commerces: [
    { slug: 'vetements', label: 'Vêtements' },
    { slug: 'chaussures', label: 'Chaussures' },
    { slug: 'bijouterie', label: 'Bijouterie' },
    { slug: 'quincaillerie', label: 'Quincaillerie' },
    { slug: 'papeterie', label: 'Papeterie' },
    { slug: 'accessoires-telephone', label: 'Accessoires téléphone' },
  ],
  proximite: [
    { slug: 'cle-minute', label: 'Clé minute' },
    { slug: 'imprimerie', label: 'Imprimerie' },
    { slug: 'cybercafe', label: 'Cybercafé' },
    { slug: 'pressing', label: 'Pressing' },
    { slug: 'lavage-auto', label: 'Lavage auto' },
    { slug: 'garage', label: 'Garage' },
    { slug: 'transfert-argent', label: "Transfert d'argent" },
    { slug: 'wc-publique', label: 'WC publique' },
  ],
  cultes: [
    { slug: 'mosquee', label: 'Mosquée' },
    { slug: 'eglise', label: 'Église' },
    { slug: 'association', label: 'Association' },
  ],
  autre: [{ slug: 'a-precision', label: 'Autre (précisez)', libre: true }],
};

/**
 * Raccourcis « Utile près de moi » (accueil + recherche).
 *
 * `famille` + `sousCategorie` = filtres envoyés à l'API
 * (`GET /establishments?categorie=…&sousCategorie=…`).
 * `route` = raccourci qui ne vit PAS dans l'annuaire : la pharmacie de garde est
 * servie par l'écran santé (modèle HealthFacility), pas par Establishment.
 * Chaque clic relance la géolocalisation : sans position, « près de moi » ne veut rien dire.
 */
export const RACCOURCIS_UTILES = [
  { slug: 'wc-publique', famille: 'proximite', label: 'WC public', icone: 'mapPin' },
  { slug: 'cle-minute', famille: 'proximite', label: 'Clé minute', icone: 'key' },
  {
    slug: 'pharmacie-de-garde',
    label: 'Pharmacie de garde',
    icone: 'pharmacy',
    route: '/pharmacies-cliniques',
  },
  { slug: 'market', famille: 'restauration', label: 'Marché', icone: 'store' },
];

/**
 * Catégories JAMAIS proposées aux options payantes (règle métier du prompt 6) :
 * un WC public, une mosquée, une église ou une association ne font pas de publicité.
 * La règle est codée MAINTENANT, même si tout est gratuit : le jour où la mise en
 * avant redevient payante, il n'y aura rien à rattraper côté serveur.
 */
export const CATEGORIES_SANS_PUBLICITE = ['wc-publique', 'mosquee', 'eglise', 'association'];

/** Familles dont TOUTES les sous-catégories sont non publicitaires. */
export const FAMILLES_SANS_PUBLICITE = ['cultes'];

/** Minuscules sans accents, espaces normalisés : « Église » === « eglise ». */
export function normaliserTexte(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** « Clé minute » → « cle-minute » (même règle que le backend). */
export function slugifier(texte) {
  return normaliserTexte(texte).replace(/\s+/g, '-');
}

/** Sous-catégories d'une famille (tableau vide si la famille n'en déclare pas). */
export function sousCategoriesDe(famille) {
  return SOUS_CATEGORIES[famille] || [];
}

/** Libellé lisible d'une famille ; renvoie le slug tel quel si inconnue. */
export function libelleFamille(slug) {
  const cle = slugifier(slug);
  return FAMILLES.find((f) => f.slug === cle)?.label || String(slug || 'Autre');
}

/** Libellé lisible d'une sous-catégorie (par slug), sur toutes les familles. */
export function libelleSousCategorie(slug) {
  const cle = slugifier(slug);
  for (const liste of Object.values(SOUS_CATEGORIES)) {
    const trouvee = liste.find((s) => s.slug === cle);
    if (trouvee) return trouvee.label;
  }
  return String(slug || '');
}

/**
 * Vrai si cette fiche ne doit JAMAIS être proposée à une option payante
 * (mise en avant, abonnement, publicité).
 *
 * @param {{categorie?: string, sousCategorie?: string, sousCategorieSlug?: string}} fiche
 */
export function estSansPublicite({ categorie, sousCategorie, sousCategorieSlug } = {}) {
  const famille = slugifier(categorie);
  if (FAMILLES_SANS_PUBLICITE.includes(famille)) return true;

  const slugs = [sousCategorieSlug, sousCategorie]
    .filter(Boolean)
    .map((valeur) => slugifier(valeur));
  if (slugs.some((s) => CATEGORIES_SANS_PUBLICITE.includes(s))) return true;

  // Filet de sécurité pour les fiches importées jamais migrées : le libellé fait foi.
  const texte = `${normaliserTexte(sousCategorie)} ${normaliserTexte(categorie)}`;
  return /\b(wc|toilettes?) public|\bmosquee|\beglise|\bassociation\b/.test(texte);
}

export default {
  FAMILLES,
  CATEGORIES,
  SOUS_CATEGORIES,
  RACCOURCIS_UTILES,
  CATEGORIES_SANS_PUBLICITE,
  FAMILLES_SANS_PUBLICITE,
  normaliserTexte,
  slugifier,
  sousCategoriesDe,
  libelleFamille,
  libelleSousCategorie,
  estSansPublicite,
};



