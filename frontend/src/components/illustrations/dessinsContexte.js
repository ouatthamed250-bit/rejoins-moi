// dessinsContexte.js — « Quel dessin crayon pour ce contexte ? »
//
// Pourquoi un module SÉPARÉ de PhotoSecours.jsx : la même question se pose à trois
// endroits qui n'affichent pas une photo —
//   • PhotoSecours.jsx (fiche sans photo du feed)          → dessinDeContexte()
//   • Jobs.jsx / JobBoard.jsx (pastille d'une annonce)     → dessinDeContexte({ metier })
//   • les états vides et bandeaux hors ligne (EmptyState, InfoBanner), qui reçoivent
//     directement la clé du dessin.
// Une seule table, donc, plutôt que trois listes qui divergeraient.
//
// RÈGLE DE CHOIX (dans cet ordre) :
//   1. le MÉTIER (« Plombier », « électricien »…) — le plus précis ;
//   2. la SOUS-CATÉGORIE (fiches importées : « Coiffeurs(ses) », « Transfert d'argent ») ;
//   3. les TAGS choisis par le gérant (« Pharmacie », « Kiosque »…) ;
//   4. la CATÉGORIE (repli historique de PhotoSecours).
// Le NOM de l'établissement n'est JAMAIS lu : « Salon de thé » n'est pas un salon de
// beauté, et une heuristique sur le nom se tromperait sans qu'on puisse le prouver.
//
// Repli de catégorie, celui du kit (voir la planche) :
//   alimentation → « marmite »    beaute   → « motifWax »    services/artisanat → « boiteOutils »
//   commerce     → « etalMarche » sante    → « croixSante »  spiritualite       → « paillote »
//   autre/inconnue → « maison » (la maison du quartier, celle de l'accueil)
//
// Aucune couleur n'est décidée ici : `Illustration` garde `currentColor`, ce qui permet
// de passer le dessin en teinte santé sur l'écran Pharmacies & Cliniques sans le dupliquer.

/** Dessin de repli par catégorie (clés = tracesEsquisse.jsx). */
export const DESSIN_PAR_CATEGORIE = {
  alimentation: 'marmite',
  beaute: 'motifWax',
  services: 'boiteOutils',
  artisanat: 'boiteOutils',
  commerce: 'etalMarche',
  sante: 'croixSante',
  spiritualite: 'paillote',
  autre: 'maison',
  // ── Familles locales (prompt 6) : chaque famille ajoutée doit avoir SON repli,
  // sinon ses fiches tombent sur la maison du quartier, hors sujet.
  restauration: 'marmite',
  commerces: 'etalMarche',
  proximite: 'boiteOutils',
  cultes: 'paillote',
};

/** Repli universel : la maison du quartier (trace prévue pour l'accueil). */
export const DESSIN_PAR_DEFAUT = 'maison';

/**
 * Règles par mot-clé, de la PLUS SPÉCIFIQUE à la plus générale (le premier motif qui
 * correspond gagne). Les motifs portent sur un texte SANS ACCENT ni casse (voir
 * `normaliser`) et ne sont volontairement PAS globaux : une regex `g` garderait un
 * `lastIndex` entre deux appels et raterait la moitié des fiches suivantes.
 */
export const REGLES_DESSIN = [
  // Paiement / mobile money : AVANT « téléphonie », car une agence de téléphonie est
  // d'abord un point de recharge. « Accessoires téléphones » ne matche pas ici et
  // retombe sur sa catégorie : ce n'est pas un paiement.
  {
    motif: /transfert d'argent|mobile money|money|wave|orange money|mtn|moov|paiement|credit telephonique|agence[s]? de telephonie/,
    dessin: 'mobileMoney',
  },

  { motif: /pharmaci/, dessin: 'pharmacie' },
  { motif: /clinique|dispensaire|hopital|medical|cabinet de soin|sante/, dessin: 'croixSante' },

  // ── Adaptation ivoirienne (prompt 6) : la rue se mange et se boit debout.
  // Maquis, garbadrom, koutoukoudrom, placalidrom = braises et grillades, pas une
  // salle de restaurant : le barbecue dit mieux le lieu que la marmite.
  { motif: /maquis|garba|koutoukou|placali|braise|grillade|barbecue|street food/, dessin: 'barbecue' },

  // WC public : ce n'est pas une devanture qu'on montre, c'est un endroit qu'on
  // cherche. L'épingle de carte est plus juste que la maison (et jamais payante).
  { motif: /\bwc\b|toilette|latrine/, dessin: 'repere' },

  { motif: /paroisse|eglise|cathedral|chapelle|culte chretien|catech|chorale|messe/, dessin: 'eglise' },
  { motif: /mosqu|islam|minaret|coran|ablution|ramadan|imam/, dessin: 'mosquee' },

  {
    motif: /coiffeur|coiffure|coiffeuse|salon|tresses|beaute|cosmetique|onglerie|barbier|manucure|capillaire/,
    dessin: 'salonBeaute',
  },
  // Boutiques de la famille « Commerces » : un étal, pas un atelier de couture
  // (« Vêtements » est un lieu de vente ; « Couturier », lui, reste à la machine).
  {
    motif: /^(vetements?|chaussures?|bijouterie|papeterie|accessoires? telephone)$/,
    dessin: 'etalMarche',
  },

  { motif: /coutur|couture|tailleur|retouche|vetement|pagne|tissu|wax/, dessin: 'atelierCouture' },

  { motif: /plomb|sanitaire|robinet|fuite/, dessin: 'plomberie' },
  { motif: /electric/, dessin: 'electricite' },
  { motif: /macon|chantier|construction|btp|carrelage|peinture|platrerie|ferraille/, dessin: 'chantier' },

  { motif: /taxi|transport|chauffeur|livraison|deplacement/, dessin: 'taxiMoto' },

  // Le marché et ses étals : « Marché », « Market », « Supermarché » de quartier.
  { motif: /marche|market|etal|panier/, dessin: 'etalMarche' },

  // Le kiosque de rue : boutique, et le « clé minute » (le plus petit commerce de
  // la rue ivoirienne — ni atelier, ni boutique : un comptoir sous un auvent).
  {
    motif: /kiosque|boutique|epicerie|alimentation generale|commodite|petit commerce|cle minute|serrur/,
    dessin: 'kiosque',
  },

  // Métiers de l'atelier et du dépannage : la boîte à outils, pas un lieu de vente.
  {
    motif: /quincaillerie|menuiser|mobilier|reparation|depannage|nettoyage|pressing|pneumatique|garage|soudure|mecanique|lavage/,
    dessin: 'boiteOutils',
  },

  { motif: /hotel|auberge|residence|hebergement/, dessin: 'maison' },

  // États de connexion : jamais déduits d'une fiche, mais acceptés ici pour qu'un
  // appelant puisse passer le texte d'un message s'il le souhaite.
  { motif: /hors ligne|hors-ligne|injoignable|sans connexion/, dessin: 'horsLigne' },
];

/** Minuscules sans accents : « Électricien » et « électricien » doivent matcher pareil. */
export function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Dessin correspondant à un texte libre (métier, sous-catégorie, tag).
 * @param {string} texte
 * @returns {string|null} clé de tracesEsquisse.jsx, ou null si rien ne correspond
 */
export function dessinPourTexte(texte) {
  const t = normaliser(texte);
  if (!t) return null;
  for (const regle of REGLES_DESSIN) {
    if (regle.motif.test(t)) return regle.dessin;
  }
  return null;
}

/**
 * Dessin d'une fiche ou d'une annonce.
 * @param {{ categorie?: string|null, tags?: string[], sousCategorie?: string,
 *   metier?: string }} [contexte]
 * @returns {string|null} null quand l'appelant n'a demandé aucune catégorie : le
 *   composant garde alors son rendu d'avant, sans dessin.
 */
export function dessinDeContexte({ categorie = null, tags = [], sousCategorie = '', metier = '' } = {}) {
  const candidats = [metier, sousCategorie, ...(Array.isArray(tags) ? tags : [])];
  for (const candidat of candidats) {
    const dessin = dessinPourTexte(candidat);
    if (dessin) return dessin;
  }
  if (categorie) return DESSIN_PAR_CATEGORIE[normaliser(categorie)] || DESSIN_PAR_DEFAUT;
  return null;
}

export default {
  DESSIN_PAR_CATEGORIE,
  DESSIN_PAR_DEFAUT,
  REGLES_DESSIN,
  normaliser,
  dessinPourTexte,
  dessinDeContexte,
};
