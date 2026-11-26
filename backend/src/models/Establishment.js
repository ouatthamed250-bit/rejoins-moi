// Establishment.js — Schéma Mongoose
// Champs attendus (voir cahier-des-charges §5) :
//   nom, categorie, photoDevanture, photoVendeur, tags[], localisation {lat, lng},
//   texteBoutonAction (ex: "Aller chez Chez Fatou"), telephone,
//   horaires (texte libre, historique) + horairesStructures (grille 7 jours, 16/11)
//   + fermetureTemporaire,
//   noteMoyenne, avis[], compteurVisites, compteurUtilisateurs,
//   createdAt, updatedAt
//
// RÈGLE CRITIQUE (§3, §5) : `compteurVisites` et `compteurUtilisateurs` sont deux
// compteurs INDÉPENDANTS. Ils ne doivent jamais être additionnés côté API ni
// côté UI. Ils sont incrémentés par deux endpoints distincts :
//   POST /api/establishments/:id/visit   -> +1 visites
//   POST /api/establishments/:id/action  -> +1 utilisateurs (clic bouton d'action)

import mongoose from 'mongoose';
import { photoLegere } from '../utils/photos.js';

const avisSchema = new mongoose.Schema(
  {
    auteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    auteurNom: { type: String, trim: true, default: 'Client' },
    auteurPhoto: { type: String, default: '' },
    note: { type: Number, min: 1, max: 5, required: true },
    commentaire: { type: String, trim: true, maxlength: 600, default: '' },
    tags: [{ type: String, trim: true }],
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const establishmentSchema = new mongoose.Schema(
  {
    nom: { type: String, required: [true, 'Le nom est obligatoire'], trim: true, maxlength: 120 },

    categorie: {
      type: String,
      required: [true, 'La catégorie est obligatoire'],
      enum: {
        values: [
          'alimentation',
          'beaute',
          'services',
          'artisanat',
          'commerce',
          'sante',
          'spiritualite',
          // ── Familles locales (20/11) : maquis, garbadrom, clé minute… ──
          // Les 8 slugs ci-dessus sont CONSERVÉS tels quels : les fiches importées et
          // les liens partagés (`?categorie=beaute`) continuent de fonctionner. Les
          // nouvelles familles viennent de backend/src/config/categories.js et sont
          // alimentées par scripts/migrer-categories.js, jamais à la main.
          'restauration',
          'commerces',
          'proximite',
          'cultes',
          'autre',
        ],
        message: 'Catégorie inconnue : {VALUE}',
      },
      index: true,
    },

    // Sous-catégorie issue de la source publique (ex. « Restaurant », « Coiffeurs(ses) »)
    // OU précisée par le gérant à l'inscription (« Garbadrom », « Clé minute »).
    // Sert au filtrage fin.
    sousCategorie: { type: String, trim: true, maxlength: 60, default: '' },

    // Clé STABLE de filtrage, dérivée du libellé ci-dessus (« Clé minute » → « cle-minute »).
    // Pourquoi un doublon : le libellé est ce qu'on AFFICHE (accents, apostrophes, casse
    // libres), le slug est ce qu'on COMPARE. Filtrer sur le texte ferait rater
    // « Clé minute » saisi « cle minute » ; filtrer sur le slug ne rate rien.
    // Vide pour les fiches importées d'avant le 20/11 tant que la migration n'est pas
    // appliquée — la route GET / retombe alors sur le libellé (voir establishments.js).
    sousCategorieSlug: { type: String, trim: true, maxlength: 80, default: '', index: true },

    description: { type: String, trim: true, maxlength: 500, default: '' },

    // §5 — DEUX photos distinctes (devanture + vendeur/gérant), RECOMMANDÉES mais
    // facultatives depuis le 30/09 : une fiche publiée sans photo reste valide et
    // se complète plus tard. La route POST/PATCH ne refuse qu'une image invalide
    // ou deux photos identiques (validateEstablishmentPhotos).
    photoDevanture: { type: String, trim: true, default: '' },
    photoVendeur: { type: String, trim: true, default: '' },

    // Galerie multi-photos (ajout du 16/11) : HUIT photos maximum, EN PLUS de la
    // devanture et du vendeur/gérant ci-dessus. Ce sont des URL https hébergées
    // chez Cloudinary (`rejoinsmoi/photos`) : le serveur ne stocke jamais l'image,
    // donc la fiche reste légère même avec 8 photos.
    //
    // L'ORDRE DU TABLEAU EST L'ORDRE D'AFFICHAGE (on ajoute à la fin, on ne trie
    // jamais). La règle des 8 est tenue ici ET dans les routes POST/PATCH
    // (validerPhotos) : le modèle refuse un tableau trop long même si un appel
    // interne contournait la validation HTTP.
    photos: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => Array.isArray(v) && v.length <= 8,
        message: 'Maximum 8 photos par établissement.',
      },
    },

    // CE QUE L'ON TESTE EN AMBIENTE D'ÉVALUATION (bloc d'audit préventif).
    // Un compte ou une fiche marquée `test: true` est automatiquement exclue
    // des réponses aux requêtes publiques (routes GET des routes ci-dessous) :
    // elle ne sera visible QUE dans l'espace d'administration (back-office).
    // Valeur par défaut false : aucun changement pour les documents existants.
    test: { type: Boolean, default: false, index: true },

    // Tags produits/services choisis en bulles cliquables, minimum 3 (§5).
    //
    // EXCEPTION (30/09) — fiches importées de la base publique (data.gouv.ci/OSM) :
    // la source ne fournit qu'UNE sous-catégorie comme tag. Exiger 3 tags
    // rejetterait les 6 719 fiches et empêcherait le gérant de réenregistrer la
    // fiche qu'il vient de réclamer. Dès qu'il prend la fiche en main, il complète
    // ses 3 tags depuis /profil (la route POST/PATCH exige bien 3 tags côté API).
    tags: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      validate: {
        // `function` (et non flèche) : seul un function voit `this.estImporte`.
        validator: function tagsSelonOrigine(v) {
          const minimum = this.estImporte ? 1 : 3;
          return Array.isArray(v) && v.length >= minimum;
        },
        message: 'Sélectionnez au moins 3 produits/services.',
      },
      default: undefined,
    },

    localisation: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },

    // Miroir GeoJSON de `localisation` — voir utils/geo.js et le hook de
    // synchronisation plus bas.
    //
    // POURQUOI DEUX CHAMPS plutôt qu'un seul : `localisation {lat, lng}` reste le
    // format stocké, renvoyé par l'API et attendu par le frontend (aucun changement
    // pour les autres routes : offres d'emploi, santé, inscription). Mais MongoDB
    // n'utilise un index géographique qu'avec un point GeoJSON : c'est `position`
    // qui porte l'index 2dsphere et permet le `$geoNear` de GET /api/establishments.
    // Résultat : le tri par proximité est calculé par la base sur les 6 719 fiches,
    // au lieu d'être trié en mémoire sur 400 candidats seulement.
    //
    // Volontairement SANS valeur par défaut : un document dont la position n'a pas
    // été renseignée ne doit pas contenir un point vide (index géographique
    // inexploitable). Ne jamais écrire ce champ à la main : il est dérivé.
    position: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] }, // [lng, lat] — ordre imposé par GeoJSON
    },

    commune: { type: String, trim: true, default: '' }, // ex. Cocody, Yopougon...
    quartier: { type: String, trim: true, default: '' }, // ex. Angré 8e tranche
    adresse: { type: String, trim: true, default: '' },

    // §5 — texte du bouton d'action dynamique ("Aller chez Chez Fatou")
    texteBoutonAction: { type: String, trim: true, maxlength: 80, default: '' },

    telephone: {
      type: String,
      // Obligatoire pour une fiche créée dans l'application. Une fiche IMPORTÉE
      // (données publiques) n'a presque jamais de numéro : exiger le téléphone
      // ferait échouer tout l'import. C'est `telephoneAVerifier` qui porte alors le
      // numéro à contrôler sur le terrain avant de le publier.
      required: [
        function telephoneObligatoireHorsImport() {
          return !this.estImporte;
        },
        'Le numéro de téléphone / WhatsApp est obligatoire',
      ],
      trim: true,
    },
    whatsapp: { type: String, trim: true, default: '' },

    horaires: { type: String, trim: true, default: '' }, // texte libre : "Lun-Sam 7h-21h"

    // ── HORAIRES STRUCTURÉS (16/11) ────────────────────────────────────────────
    // Le texte libre ci-dessus est CONSERVÉ : les 6 700 fiches importées de la base
    // publique n'ont que lui, et l'application doit continuer à l'afficher tel quel.
    // On AJOUTE une grille de sept jours que seul un gérant renseigne (éditeur
    // d'horaires de l'inscription), pour pouvoir répondre à « c'est ouvert, là ? ».
    //
    // `ouvert: false` = jour de fermeture (dimanche par défaut) ; `debut` et `fin`
    // restent renseignés pour ne pas perdre la saisie si le gérant rouvre le jour.
    // Une fermeture APRÈS MINUIT (20:00 → 02:00) est légale : c'est le calcul du
    // badge (frontend/src/utils/statutHoraire.js) qui lit la plage à cheval.
    //
    // ORDRE D'AFFICHAGE = ordre des clés : lundi → dimanche.
    horairesStructures: {
      lundi: { ouvert: { type: Boolean, default: true }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
      mardi: { ouvert: { type: Boolean, default: true }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
      mercredi: { ouvert: { type: Boolean, default: true }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
      jeudi: { ouvert: { type: Boolean, default: true }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
      vendredi: { ouvert: { type: Boolean, default: true }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
      samedi: { ouvert: { type: Boolean, default: true }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
      dimanche: { ouvert: { type: Boolean, default: false }, debut: { type: String, default: '08:00' }, fin: { type: String, default: '18:00' } },
    },

    // DATE DE LA DERNIÈRE SAISIE RÉELLE des horaires structurés — et NON un champ
    // décoratif. Mongoose applique les valeurs par défaut d'une grille à TOUT
    // document hydraté depuis la base : sans ce témoin, les 6 700 fiches importées
    // arriveraient avec « lundi-samedi 08:00-18:00 » alors que personne ne l'a
    // jamais saisi, et l'application annoncerait « Ouvert jusqu'à 18:00 » sur des
    // commerces dont les horaires sont inconnus. `toCardJSON` ne publie donc la
    // grille que si ce témoin existe (voir plus bas).
    horairesStructuresMisAJourLe: { type: Date, default: null },

    // FERMETURE TEMPORAIRE (rupture de stock, décès, travaux, panne…) : elle PRIME
    // sur la grille le temps qu'elle dure. Le gérant l'active/désactive depuis la
    // fiche (PATCH /api/establishments/:id) ; le badge affiche alors la raison au
    // lieu de « Ouvert ».
    fermetureTemporaire: {
      actif: { type: Boolean, default: false },
      raison: { type: String, default: '' },
    },

    noteMoyenne: { type: Number, default: 0, min: 0, max: 5, index: true },
    nombreAvis: { type: Number, default: 0, min: 0 },
    avis: [avisSchema],

    compteurVisites: { type: Number, default: 0, min: 0 },
    compteurUtilisateurs: { type: Number, default: 0, min: 0 },

    verifie: { type: Boolean, default: false },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // ── Traçabilité des fiches pré-remplies (base publique nettoyée) ──────────
    // Distinguer ce qui vient de la base publique (OSM / data.gouv.ci) de ce qui a
    // été créé par un vrai gérant, et permettre à celui-ci de « réclamer » sa
    // fiche pour la compléter (photos, tags, horaires, numéro vérifié).
    estImporte: { type: Boolean, default: false, index: true },
    reclame: { type: Boolean, default: false, index: true },
    // RÉCLAMATION (bloc D) : un gérant reconnaît une fiche importée comme la sienne.
    // `statut: ''` = aucune demande. « en_attente » = une personne de l'équipe doit
    // trancher (`/api/admin/reclamations`) ; « acceptee » / « refusee » = décision prise.
    // L'acceptation ne CRÉE jamais de copie : elle rattache la fiche EXISTANTE au compte
    // (`reclame` passe à true, `createdByUserId` devient le demandeur).
    reclamation: {
      statut: { type: String, enum: ['', 'en_attente', 'acceptee', 'refusee'], default: '' },
      demandeurUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      nomDeclare: { type: String, trim: true, maxlength: 120, default: '' },
      distanceMetres: { type: Number, default: null },
      demandeeLe: { type: Date, default: null },
      traiteeLe: { type: Date, default: null },
      traiteeParUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    // Numéro relevé dans la source, à confirmer avant publication (usage interne :
    // volontairement ABSENT de toCardJSON, on n'affiche pas un contact non vérifié).
    telephoneAVerifier: { type: String, trim: true, default: '' },
    // Clé de recherche normalisée (« abiba-coiffure ») : retrouve une fiche sans se
    // soucier des accents, de la casse ou de la ponctuation.
    slugRecherche: { type: String, trim: true, maxlength: 90, default: '', index: true },
    // Provenance exacte : attribution OSM (ODbL) + jeu de données d'origine.
    sourceImport: { type: String, trim: true, maxlength: 160, default: '' },
  },
  { timestamps: true }
);

// Recherche mot-clé (nom, tags, description, quartier) — §4
establishmentSchema.index({
  nom: 'text',
  description: 'text',
  tags: 'text',
  quartier: 'text',
  commune: 'text',
});

// Index GÉOGRAPHIQUE (2dsphere) sur le miroir `position`.
// C'est LUI qui rend `$geoNear` possible dans GET /api/establishments : sans cet
// index, MongoDB refuse l'étape `$geoNear` (« unable to find index for
// $geoNear »). Créé automatiquement par Mongoose au démarrage du serveur.
establishmentSchema.index({ position: '2dsphere' });

// Listing par CATÉGORIE, du plus récent au plus ancien.
// Utile au mélange équilibré demandé sans position (GET /api/establishments avec
// diversite=1 et sans lat/lng) : il faut les fiches les plus récentes DE CHAQUE
// catégorie, or les 240 fiches les plus récentes de l'annuaire appartiennent toutes à
// la même catégorie (l'import OSM est groupé par catégorie). Sans cet index, chacune
// de ces 8 requêtes triait tout l'annuaire — mesuré à 8 s pour un appel.
establishmentSchema.index({ categorie: 1, createdAt: -1 });

/**
 * Copie `localisation` vers le point GeoJSON `position` (voir le champ `position`).
 * Tolérant : une localisation absente ou hors bornes laisse `position` vide
 * (le schéma impose déjà lat/lng, c'est une ceinture de sécurité pour les mises à jour).
 */
function synchroniserPosition(doc) {
  const lat = Number(doc?.localisation?.lat);
  const lng = Number(doc?.localisation?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
  doc.position = { type: 'Point', coordinates: [lng, lat] };
}

// Texte du bouton d'action : généré à la création si non fourni (§5).
// Le même hook maintient `position` (lat/lng déplacés en cours de correction de fiche).
establishmentSchema.pre('validate', function preValidate(next) {
  if (!this.texteBoutonAction && this.nom) {
    this.texteBoutonAction = `Aller chez ${this.nom}`;
  }
  synchroniserPosition(this);
  next();
});

/** Recalcule noteMoyenne / nombreAvis. */
establishmentSchema.methods.recalculerNote = function recalculerNote() {
  const avis = this.avis || [];
  this.nombreAvis = avis.length;
  this.noteMoyenne = avis.length
    ? Math.round((avis.reduce((s, a) => s + a.note, 0) / avis.length) * 10) / 10
    : 0;
};

/**
 * Sérialisation pour l'API : expose toujours les DEUX compteurs séparément.
 * (On n'ajoute volontairement aucun champ "total" qui les fusionnerait.)
 *
 * PHOTOS (bloc A, correction de lancement) : le JSON ne transporte JAMAIS l'image
 * en base64. `photoDevanture` / `photoVendeur` restent des URL https quand c'en est
 * une (cas des fiches seedées), valent '' quand l'image est stockée en base64, et
 * sont alors remplacées par `photoDevantureUrl` / `photoVendeurUrl` — l'URL de la
 * route qui sert l'image binairement (voir utils/photos.js et
 * GET /api/establishments/:id/photo/:role). Le frontend prend
 * `photoDevantureUrl || photoDevanture` : le comportement ne change pas, mais une
 * liste ne peut plus peser plusieurs mégaoctets.
 *
 * @param {{distanceKm?: number, base?: string}} options `base` = origine publique
 *   de l'API (« https://hote »), nécessaire pour construire une URL absolue.
 */
establishmentSchema.methods.toCardJSON = function toCardJSON({ distanceKm, base = '' } = {}) {
  const devanture = photoLegere(this.photoDevanture, base, this._id, 'devanture');
  const vendeur = photoLegere(this.photoVendeur, base, this._id, 'vendeur');
  return {
    id: this._id,
    nom: this.nom,
    categorie: this.categorie,
    sousCategorie: this.sousCategorie || '',
    // Slug de filtre (« cle-minute »). Vide sur une fiche importée jamais migrée :
    // le frontend et la recherche retombent alors sur le libellé.
    sousCategorieSlug: this.sousCategorieSlug || '',
    description: this.description,
    photoDevanture: devanture.valeur,
    photoVendeur: vendeur.valeur,
    photoDevantureUrl: devanture.url,
    photoVendeurUrl: vendeur.url,
    // Galerie : uniquement des URL https Cloudinary (jamais de base64), dans
    // l'ordre d'ajout choisi par le gérant.
    photos: this.photos || [],

    tags: this.tags || [],
    localisation: this.localisation,
    commune: this.commune,
    quartier: this.quartier,
    adresse: this.adresse,
    horaires: this.horaires,
    // Horaires structurés : publiés SEULEMENT si un gérant les a réellement
    // enregistrés (`horairesStructuresMisAJourLe`). Voir le commentaire du champ :
    // Mongoose remplit la grille par défaut sur TOUTE fiche hydratée, donc publier
    // `this.horairesStructures` sans ce garde-fou ferait dire à l'application
    // « Ouvert jusqu'à 18:00 » sur les 6 700 fiches importées, dont les horaires
    // sont inconnus. Une fiche non renseignée renvoie `null` → aucun badge.
    horairesStructures: this.horairesStructuresMisAJourLe ? this.horairesStructures : null,
    // Fermeture temporaire : toujours publiée sous sa forme complète (deux champs
    // seulement), pour que l'application n'ait jamais à deviner un `undefined`.
    fermetureTemporaire: {
      actif: Boolean(this.fermetureTemporaire?.actif),
      raison: this.fermetureTemporaire?.raison || '',
    },
    telephone: this.telephone,
    whatsapp: this.whatsapp,
    texteBoutonAction: this.texteBoutonAction || `Aller chez ${this.nom}`,
    noteMoyenne: this.noteMoyenne,
    nombreAvis: this.nombreAvis,
    compteurVisites: this.compteurVisites,
    compteurUtilisateurs: this.compteurUtilisateurs,
    verifie: this.verifie,
    // Traçabilité (fiches pré-remplies) : l'app pourra afficher « fiche non
    // réclamée » et proposer au gérant de la reprendre. `telephoneAVerifier` est
    // volontairement absent : un numéro non vérifié ne doit pas être publié.
    estImporte: Boolean(this.estImporte),
    reclame: Boolean(this.reclame),
    slugRecherche: this.slugRecherche || '',
    sourceImport: this.sourceImport || '',
    distanceKm: distanceKm == null ? null : Math.round(distanceKm * 100) / 100,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Establishment', establishmentSchema);

