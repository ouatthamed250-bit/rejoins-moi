// categories.js — Taxonomie LOCALE côté serveur (miroir de frontend/src/config/categories.js).
//
// Pourquoi un miroir et non un import du frontend : le backend valide l'enum Mongoose
// `Establishment.categorie` et filtre les recherches ; il ne doit jamais dépendre d'un
// fichier de l'application cliente (builds séparés). La règle est simple et vérifiée par
// les tests : toute famille ajoutée ici existe aussi côté frontend.
//
// DEUX NIVEAUX :
//   • FAMILLE       = onglet du feed, stockée dans `Establishment.categorie` (enum) ;
//   • SOUS-CATÉGORIE = précision locale (« Garbadrom », « Clé minute »), stockée dans
//     `Establishment.sousCategorie` (libellé) + `sousCategorieSlug` (clé stable de filtre).
//
// Les 8 familles historiques gardent leur slug : les 6 719 fiches importées et les liens
// partagés (`?categorie=alimentation`) continuent de fonctionner sans réécriture.

export const FAMILLES = [
  { slug: 'tous', label: 'Tous', icone: 'grid' },
  { slug: 'alimentation', label: 'Alimentation', icone: 'utensils', historique: true },
  { slug: 'beaute', label: 'Beauté', icone: 'scissors', historique: true },
  { slug: 'services', label: 'Services', icone: 'tools', historique: true },
  { slug: 'artisanat', label: 'Artisanat', icone: 'hammer', historique: true },
  { slug: 'commerce', label: 'Commerce', icone: 'store', historique: true },
  { slug: 'sante', label: 'Santé', icone: 'heart', historique: true },
  { slug: 'spiritualite', label: 'Spiritualité', icone: 'church', historique: true },
  { slug: 'restauration', label: 'Restauration et boissons', icone: 'utensils' },
  { slug: 'commerces', label: 'Commerces', icone: 'store' },
  { slug: 'proximite', label: 'Services de proximité', icone: 'tools' },
  { slug: 'cultes', label: 'Lieux de culte et communautaires', icone: 'church' },
  // ── Familles de l'import OpenStreetMap (27/11) ──────────────────────────────
  // Miroir EXACT de frontend/src/config/categories.js : l'API valide l'enum avec
  // cette liste. Alimentées par scripts/importer-osm.js (mairies, banques, gares,
  // écoles, lieux de culte, hôtels, garages).
  { slug: 'administration', label: 'Administration', icone: 'shield' },
  { slug: 'banque', label: 'Banque', icone: 'wallet' },
  { slug: 'transport', label: 'Transport', icone: 'route' },
  { slug: 'education', label: 'Éducation', icone: 'briefcase' },
  { slug: 'culte', label: 'Culte', icone: 'church' },
  { slug: 'hebergement', label: 'Hébergement', icone: 'home' },
  { slug: 'service_auto', label: 'Services auto', icone: 'tools' },
  { slug: 'autre', label: 'Autre', icone: 'dot', historique: true },
];


/**
 * Familles stockables dans `Establishment.categorie` : l'onglet « Tous » n'en est pas une.
 * C'est CETTE liste qui alimente l'enum du modèle et la validation des inscriptions.
 */
export const CATEGORIES = FAMILLES.filter((f) => f.slug !== 'tous');
export const CATEGORIES_FILTRABLES = CATEGORIES.map((f) => f.slug);

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

/** Liste plate des sous-catégories, pour valider un slug en une passe. */
export const SOUS_CATEGORIES_PLATES = Object.entries(SOUS_CATEGORIES).flatMap(([famille, liste]) =>
  liste.map((s) => ({ ...s, famille }))
);

/**
 * Catégories JAMAIS proposées aux options payantes (règle métier).
 * Un WC public, une mosquée, une église ou une association ne font pas de publicité —
 * aujourd'hui comme demain, gratuité ou pas. Cette liste est la source unique de la
 * règle : routes/users.js (mise en avant) et le frontend la lisent, personne ne
 * réécrit la condition à la main.
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

/** « Clé minute » → « cle-minute » : clé stable de filtre, insensible aux accents. */
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

/**
 * Résout une sous-catégorie à partir d'un libellé libre ou d'un slug.
 * Renvoie `{ slug, label, famille }` si elle est connue, sinon `null` — l'appelant
 * décide alors de conserver le libellé tel quel (sous-catégorie libre).
 *
 * @param {string} valeur
 * @param {string} [famille] restreint la recherche à une famille
 */
export function resoudreSousCategorie(valeur, famille) {
  const cle = slugifier(valeur);
  if (!cle) return null;
  const candidates = famille ? sousCategoriesDe(famille) : SOUS_CATEGORIES_PLATES;
  // Correspondance par SLUG ou par LIBELLÉ : le slug déclaré n'est pas toujours
  // `slugifier(label)` (« Transfert d'argent » → « transfert-argent », et non
  // « transfert-d-argent »). Sans la comparaison de libellé, ce cas serait pris
  // pour une sous-catégorie libre et dupliqué en demande de catégorie.
  const libelle = normaliserTexte(valeur);
  const trouvee = candidates.find(
    (s) => s.slug === cle || normaliserTexte(s.label) === libelle
  );
  if (!trouvee) return null;
  return { slug: trouvee.slug, label: trouvee.label, famille: famille || trouvee.famille };
}

/**
 * Vrai si la fiche ne doit JAMAIS être proposée à une option payante
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

/**
 * Correspondance des 26 sous-catégories RÉELLEMENT présentes en base (relevé du
 * 20/11 sur les 6 719 fiches importées) vers les familles locales.
 *
 * Deux cas, assumés et rapportés par le script de migration :
 *   • `new`  : le libellé cible existe dans SOUS_CATEGORIES (ex. Toilettes → WC publique) ;
 *   • `propre` : aucune sous-catégorie nouvelle ne décrit exactement le métier
 *     (un restaurant n'est pas un maquis, un hôtel n'est pas un garage). On garde alors
 *     le libellé d'origine DANS la nouvelle famille : rien n'est perdu, et le gérant
 *     pourra préciser depuis son profil. Ces lignes sont signalées dans le rapport.
 *
 * Le script n'écrit QUE `categorie`, `sousCategorie` et `sousCategorieSlug` : ni la
 * position GPS, ni les tags, ni les photos ne sont touchés (voir migrer-categories.js).
 */
export const MIGRATION_SOUS_CATEGORIES = [
  // ── Restauration et boissons ──
  { ancienne: 'Restaurant', famille: 'restauration', sousCategorie: 'Restaurant', propre: true },
  { ancienne: 'Café', famille: 'restauration', sousCategorie: 'Café', propre: true },
  { ancienne: 'Bar', famille: 'restauration', sousCategorie: 'Bar', propre: true },
  { ancienne: 'Fast-Food', famille: 'restauration', sousCategorie: 'Fast-food', propre: true },
  { ancienne: 'Restauration', famille: 'restauration', sousCategorie: 'Restauration', propre: true },
  { ancienne: 'Ice-Cream', famille: 'restauration', sousCategorie: 'Glacier', propre: true },
  // Cible de la ligne ci-dessus : sans elle, une re-exécution du script prendrait
  // « Glacier » pour un libellé inconnu et le signalerait à tort comme non migré.
  { ancienne: 'Glacier', famille: 'restauration', sousCategorie: 'Glacier', propre: true },
  { ancienne: 'Produits de la mer', famille: 'restauration', sousCategorie: 'Boutique alimentaire' },
  { ancienne: 'Commodites', famille: 'restauration', sousCategorie: 'Boutique alimentaire' },
  // ── Commerces ──
  { ancienne: 'Accessoires vetements', famille: 'commerces', sousCategorie: 'Vêtements' },
  { ancienne: 'Accessoires telephones', famille: 'commerces', sousCategorie: 'Accessoires téléphone' },
  { ancienne: 'Bijouteries', famille: 'commerces', sousCategorie: 'Bijouterie' },
  { ancienne: 'Quincaillerie', famille: 'commerces', sousCategorie: 'Quincaillerie' },
  // ── Services de proximité ──
  { ancienne: 'Cybercafes', famille: 'proximite', sousCategorie: 'Cybercafé' },
  { ancienne: 'Nettoyage a sec', famille: 'proximite', sousCategorie: 'Pressing' },
  { ancienne: 'Lavage de voitures', famille: 'proximite', sousCategorie: 'Lavage auto' },
  { ancienne: 'Reparation de voitures', famille: 'proximite', sousCategorie: 'Garage' },
  { ancienne: 'Pneumatique', famille: 'proximite', sousCategorie: 'Garage' },
  { ancienne: "Transfert d'argent", famille: 'proximite', sousCategorie: "Transfert d'argent" },
  { ancienne: 'Agences de telephonie', famille: 'proximite', sousCategorie: "Transfert d'argent" },
  { ancienne: 'Toilettes', famille: 'proximite', sousCategorie: 'WC publique' },
  // ── Lieux de culte et communautaires ── (aucune sous-catégorie en base aujourd'hui)
  // ── Familles historiques conservées ──
  { ancienne: 'Coiffeurs(ses)', famille: 'beaute', sousCategorie: 'Coiffeurs(ses)', propre: true },
  { ancienne: 'Accessoires de beaute', famille: 'beaute', sousCategorie: 'Accessoires de beauté' },
  { ancienne: 'Cosmetiques', famille: 'beaute', sousCategorie: 'Cosmétiques' },
  { ancienne: 'Mobiliers', famille: 'artisanat', sousCategorie: 'Mobilier', propre: true },
  // Cible de la ligne ci-dessus (idempotence d'une re-exécution), comme « Glacier ».
  { ancienne: 'Mobilier', famille: 'artisanat', sousCategorie: 'Mobilier', propre: true },
  { ancienne: 'Artisanat', famille: 'artisanat', sousCategorie: 'Artisanat', propre: true },
  { ancienne: 'Hôtel', famille: 'services', sousCategorie: 'Hôtel', propre: true },
];

/** Index par libellé d'origine (comparaison insensible aux accents). */
export const MIGRATION_PAR_ANCIENNE = new Map(
  MIGRATION_SOUS_CATEGORIES.map((ligne) => [normaliserTexte(ligne.ancienne), ligne])
);

export default {
  FAMILLES,
  CATEGORIES,
  CATEGORIES_FILTRABLES,
  SOUS_CATEGORIES,
  SOUS_CATEGORIES_PLATES,
  CATEGORIES_SANS_PUBLICITE,
  FAMILLES_SANS_PUBLICITE,
  MIGRATION_SOUS_CATEGORIES,
  MIGRATION_PAR_ANCIENNE,
  normaliserTexte,
  slugifier,
  sousCategoriesDe,
  libelleFamille,
  resoudreSousCategorie,
  estSansPublicite,
};


