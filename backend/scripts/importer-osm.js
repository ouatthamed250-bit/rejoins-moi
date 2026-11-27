// importer-osm.js — Import de l'extrait OpenStreetMap de Côte d'Ivoire.
//
// SOURCE : backend/data/base-complete-ci.geojson — un export OSM (FeatureCollection
// de 46 745 points : restaurants, pharmacies, mairies, banques, écoles, églises,
// hôtels, stations-service, boutiques…). Licence ODbL : l'attribution aux
// contributeurs OSM est écrite dans `sourceImport` de CHAQUE fiche.
//
// ─── CE QUE LE SCRIPT GARANTIT ────────────────────────────────────────────────
//   • un lieu SANS NOM est ignoré : il ne sert à rien dans un annuaire ;
//   • deux lieux de MÊME NOM à moins de 50 m sont UN SEUL commerce : OSM contient
//     des doublons (un nœud et son bâtiment, deux relevés successifs). On garde le
//     premier rencontré, qui est aussi le plus complet dans cet export ;
//   • le téléphone est ramené au format `+225XXXXXXXX` (10 chiffres) ; un numéro
//     illisible n'est PAS inventé : la fiche part sans contact et `aCompleter`;
//   • `estImporte: true` + `reclame: false` : le vrai gérant peut reprendre la
//     fiche depuis l'application (« C'est mon établissement ? ») — c'est tout
//     l'intérêt de l'import, et la raison pour laquelle rien n'est verrouillé ;
//   • `source: 'osm'` : on saura toujours d'où vient la fiche, et on pourra
//     relancer un import sans dupliquer (les fiches déjà en base sont reconnues
//     par nom + 50 m).
//
// ─── COORDONNÉES ──────────────────────────────────────────────────────────────
// GeoJSON impose `[longitude, latitude]`. Le modèle, l'API et l'application
// raisonnent en `{ lat, lng }` : l'inversion se fait ICI, une seule fois, et
// `position` (le miroir GeoJSON qui porte l'index 2dsphere) est réécrit à
// l'endroit — `insertMany` ne déclenche aucun hook Mongoose, donc sans cette
// ligne les fiches importées seraient absentes du tri par proximité.
//
// ─── USAGE (depuis /backend) ──────────────────────────────────────────────────
//   npm run importer:osm                 → DRY-RUN (défaut) : aucun accès à la base
//   npm run importer:osm -- --apply      → écrit réellement dans MongoDB
//   npm run importer:osm -- --limite=500 → n'examine que 500 lieux (essai rapide)
//   npm run importer:osm -- --apply --lot=250 --pause=600
//
// Le drapeau explicite `--dry-run` est aussi accepté (c'est le défaut). Aucune
// écriture ne peut partir d'une commande sans `--apply` : c'est volontaire, un
// import de 30 000 fiches ne doit pas être un accident.
//
// `--apply` demande la phrase de confirmation du garde-fou production
// (utils/gardeFouProduction.js), comme les autres scripts qui écrivent en base.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import Establishment from '../src/models/Establishment.js';
import { sanitizeTags } from '../src/utils/validators.js';
import { exigerConfirmationProduction } from '../src/utils/gardeFouProduction.js';
import { connectDB, disconnectDB, getMongoDbName, getMongoUri, masquerUri } from '../src/config/db.js';

// `.env` du dossier backend, quel que soit le dossier d'où la commande est
// lancée : une URI de production ne doit pas être cherchée au petit bonheur.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

/* ── Options de ligne de commande ─────────────────────────────────────────── */

const ARGS = process.argv.slice(2);
const valeurOption = (nom) => {
  const prefixe = `--${nom}=`;
  const trouve = ARGS.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : null;
};
const drapeau = (nom) => ARGS.includes(`--${nom}`);

const FICHIER =
  valeurOption('fichier') || fileURLToPath(new URL('../data/base-complete-ci.geojson', import.meta.url));
// DRY-RUN PAR DÉFAUT : il faut taper `--apply` pour écrire. `--dry-run` reste
// accepté pour que la commande documentée fonctionne telle quelle.
const ECRITURE = drapeau('apply') && !drapeau('dry-run');
const LIMITE = Math.max(0, Number(valeurOption('limite')) || 0);
const TAILLE_LOT = Math.max(50, Number(valeurOption('lot')) || 500);
// `Number(null)` vaut 0 et passerait un simple test de validité : on distingue
// l'option absente de l'option « 0 ms », sinon la pause par défaut serait nulle.
const pauseDemandee = valeurOption('pause');
const PAUSE_MS = pauseDemandee === null || pauseDemandee === '' ? 250 : Math.max(0, Number(pauseDemandee) || 0);

const DISTANCE_DOUBLON_M = 50;
const ESSAIS_MAX = 4;
const SOURCE = 'osm';
const ATTRIBUTION = "OpenStreetMap — extrait Côte d'Ivoire (© contributeurs OSM, ODbL)";

const FR_NOMBRE = new Intl.NumberFormat('fr-FR');

/* ── Petits utilitaires ──────────────────────────────────────────────────── */

const texte = (v) => (v == null ? '' : String(v).trim());
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sansAccents = (txt) =>
  String(txt)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** « Chez Fatou Services » → « chez-fatou-services » (clé de recherche). */
function slugifier(txt) {
  return sansAccents(txt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Clé de comparaison des noms : accents, casse et ponctuation ignorés. */
function cleNom(nom) {
  return sansAccents(nom).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Distance en mètres entre deux points (formule de haversine, précision suffisante). */
function distanceMetres(a, b) {
  const R = 6371000;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── Catégorisation : tag OSM → famille du modèle + libellé lisible ───────── */
//
// Chaque entrée vaut `[famille, libellé]`. Le libellé devient la SOUS-CATÉGORIE
// de la fiche (« Coiffure », « Quincaillerie », « Mairie ») : c'est lui qui
// conserve la précision OSM, y compris quand la famille est large. Une fiche
// importée n'a besoin que d'UN tag (règle du modèle, voir Establishment.js).
//
// Ordre de lecture : `amenity` d'abord (c'est le type le plus fiable), puis
// `office`, `healthcare`, `tourism`, et `shop` en dernier. Un lieu qui porte
// `amenity=restaurant` ET `shop=yes` reste donc un restaurant.
const CLASSEMENT = {
  amenity: {
    restaurant: ['restauration', 'Restaurant'],
    cafe: ['restauration', 'Café'],
    fast_food: ['restauration', 'Fast-food'],
    bar: ['restauration', 'Bar'],
    pharmacy: ['sante', 'Pharmacie'],
    hospital: ['sante', 'Hôpital'],
    clinic: ['sante', 'Clinique'],
    doctors: ['sante', 'Cabinet médical'],
    townhall: ['administration', 'Mairie'],
    police: ['administration', 'Poste de police'],
    fire_station: ['administration', 'Caserne de pompiers'],
    post_office: ['administration', 'Bureau de poste'],
    courthouse: ['administration', 'Tribunal'],
    government: ['administration', 'Service public'],
    bank: ['banque', 'Banque'],
    atm: ['banque', 'Distributeur automatique'],
    bureau_de_change: ['banque', 'Bureau de change'],
    bus_stop: ['transport', 'Arrêt de bus'],
    bus_station: ['transport', 'Gare routière'],
    school: ['education', 'École'],
    college: ['education', 'Collège'],
    university: ['education', 'Université'],
    place_of_worship: ['culte', 'Lieu de culte'],
    fuel: ['service_auto', 'Station-service'],
    car_repair: ['service_auto', 'Garage automobile'],
    marketplace: ['commerce', 'Marché'],
    // ── Arbitrage des tags « autre » (27/11, avant --apply) ──
    // 2 582 « pub » tombaient dans « autre » : ce sont les bars/maquis de
    // quartier, la famille la plus nombreuse de l'extrait OSM. Les autres lignes
    // concernent des lieux réels (lavage auto, cybercafé, restaurants de galerie)
    // qui n'avaient simplement pas de règle.
    pub: ['restauration', 'Bar'],
    food_court: ['restauration', 'Restauration rapide'],
    car_wash: ['service_auto', 'Lavage auto'],
    internet_cafe: ['commerce', 'Cybercafé'],
  },
  office: {
    // `office=government` = le tag « government » de votre mapping, côté clé `office`.
    government: ['administration', 'Service public'],
  },
  healthcare: {
    hospital: ['sante', 'Hôpital'],
    clinic: ['sante', 'Clinique'],
    doctors: ['sante', 'Cabinet médical'],
  },
  tourism: {
    hotel: ['hebergement', 'Hôtel'],
    guest_house: ['hebergement', "Maison d'hôtes"],
    // `hostel` est un tag `tourism` (et non `amenity`) : le placer dans
    // CLASSEMENT.amenity l'aurait rendu inopérant.
    hostel: ['hebergement', 'Auberge'],
  },
  // TOUT `shop` est un commerce (règle explicite du mapping) ; la valeur OSM sert
  // seulement à écrire une sous-catégorie lisible dans la fiche.
  shop: {
    supermarket: ['commerce', 'Supermarché'],
    bakery: ['commerce', 'Boulangerie'],
    clothes: ['commerce', 'Vêtements'],
    shoes: ['commerce', 'Chaussures'],
    electronics: ['commerce', 'Électronique'],
    mobile_phone: ['commerce', 'Téléphonie'],
    convenience: ['commerce', 'Boutique de quartier'],
    beauty: ['commerce', 'Institut de beauté'],
    hairdresser: ['commerce', 'Coiffure'],
    cosmetics: ['commerce', 'Cosmétiques'],
    jewelry: ['commerce', 'Bijouterie'],
    hardware: ['commerce', 'Quincaillerie'],
    furniture: ['commerce', 'Mobilier'],
    butcher: ['commerce', 'Boucherie'],
    greengrocer: ['commerce', 'Primeur'],
    beverages: ['commerce', 'Boissons'],
    alcohol: ['commerce', 'Boissons alcoolisées'],
    kiosk: ['commerce', 'Kiosque'],
    money_transfer: ['commerce', "Transfert d'argent"],
    copyshop: ['commerce', 'Photocopie'],
    optician: ['commerce', 'Opticien'],
    chemist: ['commerce', 'Pharmacie'],
    motorcycle_repair: ['commerce', 'Réparation moto'],
    department_store: ['commerce', 'Grand magasin'],
    religion: ['commerce', 'Objets religieux'],
    hairdresser_supply: ['commerce', 'Fournitures de coiffure'],
  },
};

/** Clés OSM qui font d'un nœud un LIEU (sinon c'est un bâtiment ou une barrière). */
const CLES_DE_LIEU = ['amenity', 'shop', 'tourism', 'office', 'healthcare', 'leisure'];

/** « car_wash » → « Car wash » (libellé de repli quand le tag n'est pas traduit). */
function libelleDepuisTag(valeur) {
  const brut = texte(valeur).replace(/_/g, ' ');
  if (!brut || /^(yes|no)$/i.test(brut)) return 'Autre';
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}

/**
 * Trouve famille + libellé d'un lieu OSM.
 * @returns {{categorie: string, libelle: string, tag: string}|null}
 *   `null` = le lieu n'a aucun type exploitable (bâtiment, barrière…) : on l'ignore.
 */
function classer(proprietes) {
  // Tag CONNU : c'est le cas normal, et le seul qui mérite une sous-catégorie précise.
  for (const cle of ['amenity', 'office', 'healthcare', 'tourism', 'shop']) {
    const valeur = texte(proprietes?.[cle]).toLowerCase();
    if (!valeur) continue;
    const regle = CLASSEMENT[cle]?.[valeur];
    if (regle) return { categorie: regle[0], libelle: regle[1], tag: `${cle}=${valeur}` };
  }

  // `shop` INCONNU (valeur libre : « Kiosque café », « yes »…) : reste un commerce.
  const boutique = texte(proprietes?.shop).toLowerCase();
  if (boutique) return { categorie: 'commerce', libelle: libelleDepuisTag(boutique), tag: `shop=${boutique}` };

  // « Tout le reste → autre », à condition que ce soit un LIEU. Un nœud qui ne
  // porte qu'un `building=yes` ou un `barrier=gate` n'a rien à faire dans un
  // annuaire : il est écarté et compté à part.
  const cleDeLieu = CLES_DE_LIEU.find((cle) => texte(proprietes?.[cle]));
  if (!cleDeLieu) return null;
  const valeur = texte(proprietes[cleDeLieu]).toLowerCase();
  return { categorie: 'autre', libelle: libelleDepuisTag(valeur), tag: `${cleDeLieu}=${valeur}` };
}

/* ── Téléphone ───────────────────────────────────────────────────────────── */

/** Champs OSM qui peuvent porter un numéro, du plus fiable au moins fiable. */
const CHAMPS_TELEPHONE = ['phone', 'contact:phone', 'contact:mobile', 'phone:mobile', 'mobile'];

/**
 * Ramène un numéro ivoirien au format `+225XXXXXXXX`.
 *
 * Règles (et leurs raisons) :
 *   • on ne garde que les CHIFFRES : « +225 07 09 04 31 25 », « 07-09-04-31-25 »
 *     et « 00225 07 09 04 31 25 » désignent le même numéro ;
 *   • un préfixe international (00225 / 225) est retiré puis réécrit une fois ;
 *   • 10 chiffres = format actuel (07/05/01 mobile, 27 fixe) ; 8 chiffres = ancien
 *     format encore présent dans OSM, conservé tel quel après l'indicatif ;
 *   • toute autre longueur est ILLISIBLE : on renvoie '' plutôt qu'un faux numéro.
 *     Un numéro inventé est pire que pas de numéro — il envoie le client chez
 *     quelqu'un d'autre. La fiche part alors en « à compléter » ;
 *   • plusieurs numéros (« 07… ; 27… ») : on garde le premier.
 */
function normaliserTelephone(brut) {
  const premier = texte(brut).split(/[;,/]/)[0].trim();
  if (!premier) return '';
  let chiffres = premier.replace(/\D/g, '');
  if (!chiffres) return '';
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (chiffres.length > 10 && chiffres.startsWith('225')) chiffres = chiffres.slice(3);
  if (chiffres.length === 10 || chiffres.length === 8) return `+225${chiffres}`;
  return '';
}

/** Premier numéro exploitable trouvé dans les tags OSM ('' si aucun). */
function telephoneDe(proprietes) {
  for (const champ of CHAMPS_TELEPHONE) {
    const valeur = normaliserTelephone(proprietes?.[champ]);
    if (valeur) return valeur;
  }
  return '';
}

/** Tous les numéros BRUTS, pour `telephoneAVerifier` (usage interne, jamais publié). */
function telephoneBrutDe(proprietes) {
  return CHAMPS_TELEPHONE.
    map((champ) => texte(proprietes?.[champ])).
    filter(Boolean).
    join(' / ').
    slice(0, 60);
}

/* ── Horaires ────────────────────────────────────────────────────────────── */

const JOURS_OSM = { Mo: 'lun', Tu: 'mar', We: 'mer', Th: 'jeu', Fr: 'ven', Sa: 'sam', Su: 'dim' };

/**
 * « Mo-Sa 08:00-20:00 » → « lun-sam 08:00-20:00 ».
 *
 * OSM écrit ses horaires en anglais ; `horaires` est un texte libre AFFICHÉ tel
 * quel sur la fiche. On traduit la langue des jours, sans toucher à la structure
 * (plages, coupures) : aucune information n'est perdue, et le client ivoirien ne
 * lit pas « Mo-Fr 07:30-18:00 ».
 */
function traduireHoraires(brut) {
  const valeur = texte(brut);
  if (!valeur) return '';
  if (valeur === '24/7') return '24h/24, 7j/7';
  const traduit = valeur.
    replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?/g, (tout, debut, fin) =>
      fin ? `${JOURS_OSM[debut]}-${JOURS_OSM[fin]}` : JOURS_OSM[debut]).
    replace(/\bPH\b/g, 'jours fériés').
    replace(/\boff\b/gi, 'fermé');
  return traduit.slice(0, 120);
}

/* ── Adresse ─────────────────────────────────────────────────────────────── */

/** Adresse postale reconstituée depuis les tags `addr:*` ('' si OSM n'en a pas). */
function adresseDe(proprietes) {
  const numero = texte(proprietes?.['addr:housenumber']);
  const rue = texte(proprietes?.['addr:street']);
  const lieu = texte(proprietes?.['addr:place']);
  return [numero, rue].filter(Boolean).join(' ') || lieu;
}

/* ── Lecture du GeoJSON ──────────────────────────────────────────────────── */

// Emprise de la Côte d'Ivoire, volontairement large. Elle sert de garde-fou :
// un `[lat, lng]` non inversé (ou un point hors sujet glissé dans l'export) est
// rejeté au lieu de créer une fiche au milieu de l'océan.
const EMPRISE = { latMin: 4.2, latMax: 10.8, lngMin: -8.7, lngMax: -2.4 };

/** Premier couple de coordonnées d'une géométrie (récursif : Point, Polygon, LineString…). */
function premierCouple(coordonnees) {
  if (!Array.isArray(coordonnees)) return null;
  if (typeof coordonnees[0] === 'number') return coordonnees;
  for (const sous of coordonnees) {
    const trouve = premierCouple(sous);
    if (trouve) return trouve;
  }
  return null;
}

/**
 * Convertit une géométrie GeoJSON en `{ lat, lng }`.
 *
 * C'EST LE CŒUR DE LA TÂCHE 1 : GeoJSON stocke `[longitude, latitude]`, alors que
 * le modèle, l'API et le frontend raisonnent en `{ lat, lng }`. L'inversion a lieu
 * ici et NULLE PART ailleurs ; les bornes de l'emprise ivoirienne rattrapent une
 * éventuelle erreur d'ordre.
 *
 * @returns {{lat: number, lng: number}|null} null = coordonnées inexploitables.
 */
function pointDe(element) {
  const geometrie = element?.geometry;
  if (!geometrie) return null;
  const couple = premierCouple(geometrie.coordinates);
  if (!couple || couple.length < 2) return null;
  const lng = Number(couple[0]);
  const lat = Number(couple[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < EMPRISE.latMin || lat > EMPRISE.latMax) return null;
  if (lng < EMPRISE.lngMin || lng > EMPRISE.lngMax) return null;
  return { lat, lng };
}

/* ── Construction d'une fiche du modèle ──────────────────────────────────── */

/**
 * Transforme un élément GeoJSON en document `Establishment`.
 *
 * Le document est VOLONTAIREMENT explicite : chaque valeur vient de la source ou
 * d'un défaut assumé, aucune n'est devinée. Les compteurs, notes et avis d'une
 * source publique ne sont jamais repris — un avis inventé fausserait le classement
 * et la confiance des clients.
 *
 * @returns {{doc?: object, rejet?: string}}
 */
function construireDoc(element, classement, point) {
  const p = element?.properties || {};

  const nom = texte(p.name).replace(/\s+/g, ' ').slice(0, 100);
  if (!nom) return { rejet: 'sans nom' };

  if (!point) return { rejet: 'coordonnées inexploitables' };

  const telephone = telephoneDe(p);
  const libelle = (texte(classement.libelle).replace(/\s+/g, ' ') || 'Lieu').slice(0, 60);

  // Un tag au minimum : c'est la règle du modèle pour une fiche importée. Si le
  // libellé dépasse la longueur autorisée (40 car.), on le tronque plutôt que de
  // perdre la fiche pour un tag trop bavard.
  const tags = sanitizeTags([libelle]);
  if (!tags.length) tags.push(libelle.slice(0, 40) || 'Lieu');

  return {
    doc: {
      nom,
      categorie: classement.categorie,
      sousCategorie: libelle,
      // Le slug est la clé de FILTRAGE ; le libellé reste ce qu'on affiche.
      sousCategorieSlug: slugifier(libelle).slice(0, 80),
      description: texte(p.description).slice(0, 500),
      photoDevanture: '',
      photoVendeur: '',
      tags,
      localisation: { lat: point.lat, lng: point.lng },
      // Miroir GeoJSON attendu par l'index 2dsphere : `insertMany` ne déclenche
      // aucun hook `pre('validate')`, donc le point doit être écrit à la main. Sans
      // lui, les fiches importées seraient absentes du tri par proximité ET du
      // rapprochement « c'est mon établissement » (GET /rapprochement, $geoNear).
      position: { type: 'Point', coordinates: [point.lng, point.lat] },
      commune: texte(p['addr:city'] || p['addr:state']).slice(0, 80),
      quartier: texte(p['addr:suburb']).slice(0, 80),
      adresse: adresseDe(p).slice(0, 160),
      texteBoutonAction: `Aller chez ${nom}`.slice(0, 80),
      telephone,
      // Pas de WhatsApp inventé : un numéro qui n'est pas sur WhatsApp ferait perdre
      // le client au moment où il écrit. Le gérant le renseigne en réclamant sa fiche.
      whatsapp: '',
      horaires: traduireHoraires(p.opening_hours),
      noteMoyenne: 0,
      nombreAvis: 0,
      avis: [],
      compteurVisites: 0,
      compteurUtilisateurs: 0,
      verifie: false,
      // ── Marquage demandé (tâche 1, point 6) ──────────────────────────────
      estImporte: true,
      reclame: false, // le vrai propriétaire peut reprendre la fiche
      source: SOURCE, // 'osm' : traçabilité de l'import
      aCompleter: !telephone,
      // Numéro BRUT conservé pour le terrain (jamais publié sur la fiche) : il
      // permet à un agent de rappeler et de corriger, au lieu de repartir de zéro.
      telephoneAVerifier: telephone ? '' : telephoneBrutDe(p),
      slugRecherche: slugifier(nom).slice(0, 90),
      sourceImport: `${ATTRIBUTION}${texte(p['@id']) ? ` — ${texte(p['@id'])}` : ''}`.slice(0, 160),
    },
  };
}

/* ── Détection de doublons (même nom à moins de 50 m) ────────────────────── */

// 0,001° ≈ 111 m : deux points séparés de 50 m tombent forcément dans la même
// cellule de la grille ou dans une des huit voisines. On ne compare donc jamais
// 30 000 fiches entre elles (450 millions de couples), seulement les voisines.
const TAILLE_CELLULE = 0.001;

const cleCellule = (point) =>
  `${Math.floor(point.lat / TAILLE_CELLULE)}:${Math.floor(point.lng / TAILLE_CELLULE)}`;

/**
 * Index spatial minimaliste : « cet emplacement est-il déjà pris par un homonyme ? ».
 *
 * Il contient les fiches DÉJÀ RETENUES du fichier en cours ET, en mode --apply,
 * les fiches DÉJÀ EN BASE (importées ou non) : un commerce déjà présent ne doit
 * pas être créé une deuxième fois.
 */
class IndexDoublons {
  constructor() {
    this.cellules = new Map();
  }

  /** true si une fiche de MÊME NOM existe à DISTANCE_DOUBLON_M ou moins. */
  tropProche(nom, point) {
    const cle = cleNom(nom);
    if (!cle) return false;
    const i = Math.floor(point.lat / TAILLE_CELLULE);
    const j = Math.floor(point.lng / TAILLE_CELLULE);
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        const voisines = this.cellules.get(`${i + di}:${j + dj}`);
        if (!voisines) continue;
        for (const autre of voisines) {
          if (autre.cle === cle && distanceMetres(autre.point, point) <= DISTANCE_DOUBLON_M) return true;
        }
      }
    }
    return false;
  }

  ajouter(nom, point) {
    const cle = cleNom(nom);
    if (!cle) return;
    const k = cleCellule(point);
    if (!this.cellules.has(k)) this.cellules.set(k, []);
    this.cellules.get(k).push({ cle, point });
  }
}

/* ── Statistiques et résumé ──────────────────────────────────────────────── */

/** Ordre d'affichage des familles dans le résumé (du plus attendu au plus marginal). */
const ORDRE_CATEGORIES = [
  'commerce',
  'restauration',
  'sante',
  'service_auto',
  'banque',
  'education',
  'administration',
  'culte',
  'transport',
  'hebergement',
  'autre',
];

const LIBELLE_CATEGORIE = {
  commerce: 'Commerces',
  restauration: 'Restauration',
  sante: 'Santé',
  service_auto: 'Services auto',
  banque: 'Banque',
  education: 'Éducation',
  administration: 'Administration',
  culte: 'Culte',
  transport: 'Transport',
  hebergement: 'Hébergement',
  autre: 'Autre',
};

function creerStats() {
  return {
    elements: 0,
    lus: 0,
    sansNom: 0,
    coordsInvalides: 0,
    sansType: 0,
    doublonsFichier: 0,
    doublonsBase: 0,
    refusesModele: 0,
    pretes: 0,
    avecTelephone: 0,
    sansTelephone: 0,
    parCategorie: new Map(),
    autresParTag: new Map(),
    rejets: [],
  };
}

/** Mémorise un rejet (5 exemples suffisent pour comprendre un problème de source). */
function noterRejet(stats, motif, nom) {
  if (stats.rejets.length >= 5) return;
  stats.rejets.push(`${motif}${nom ? ` — « ${nom} »` : ''}`);
}

const nombre = (n) => FR_NOMBRE.format(Number(n) || 0);

/**
 * Affiche le résumé complet. En simulation comme après écriture : c'est lui qui
 * permet de décider, chiffres en main, si l'import est acceptable.
 */
function afficherResume(stats, { ecriture, tailleMo }) {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  ${ecriture ? 'IMPORT TERMINÉ' : 'SIMULATION — AUCUNE ÉCRITURE EN BASE'}`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Fichier                          : ${FICHIER} (${tailleMo} Mo)`);
  console.log(`  Lieux dans le fichier (features)  : ${nombre(stats.elements)}`);
  console.log(
    `  Lieux examinés                    : ${nombre(stats.lus)}${LIMITE ? ` (limite --limite=${LIMITE})` : ''}`
  );
  console.log('');
  console.log('  ÉCARTÉS');
  console.log(`    · sans nom (inutile en annuaire)      : ${nombre(stats.sansNom)}`);
  console.log(`    · coordonnées inexploitables          : ${nombre(stats.coordsInvalides)}`);
  console.log(`    · pas un lieu (bâtiment, barrière…)   : ${nombre(stats.sansType)}`);
  console.log(`    · doublons du fichier (même nom < 50 m) : ${nombre(stats.doublonsFichier)}`);
  if (ecriture) {
    console.log(`    · déjà en base (même nom < 50 m)      : ${nombre(stats.doublonsBase)}`);
  }
  console.log(`    · refusés par le modèle               : ${nombre(stats.refusesModele)}`);
  for (const rejet of stats.rejets) console.log(`         – ${rejet}`);
  console.log('');
  console.log(
    `  ${ecriture ? 'FICHES CRÉÉES' : 'FICHES À CRÉER'} : ${nombre(stats.pretes)}` +
      `  (dont ${nombre(stats.avecTelephone)} avec téléphone, ${nombre(stats.sansTelephone)} à compléter)`
  );
  console.log('');
  console.log(`  ${ecriture ? 'RÉPARTITION' : 'RÉPARTITION PRÉVUE'} PAR CATÉGORIE`);
  const categories = [...stats.parCategorie.entries()].sort((a, b) => {
    const ia = ORDRE_CATEGORIES.indexOf(a[0]);
    const ib = ORDRE_CATEGORIES.indexOf(b[0]);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return b[1] - a[1];
  });
  for (const [categorie, total] of categories) {
    const libelle = (LIBELLE_CATEGORIE[categorie] || categorie).padEnd(16, ' ');
    console.log(`    ${libelle} : ${nombre(total)}`);
  }
  console.log('');
  // Les tags qui tombent dans « autre » faute de règle : c'est LA liste à relire
  // avant d'écrire, puisqu'elle décide du classement de milliers de fiches.
  const autres = [...stats.autresParTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (autres.length) {
    console.log('  TAGS CLASSÉS « AUTRE » (les plus fréquents — à arbitrer si besoin)');
    for (const [tag, total] of autres) console.log(`    ${String(tag).padEnd(26, ' ')} : ${nombre(total)}`);
    console.log('');
  }
  if (!ecriture) {
    console.log('  Rien n\'a été écrit. Pour créer ces fiches :');
    console.log('    npm run importer:osm -- --apply     (demande la phrase de confirmation)');
    console.log('');
  }
}

/* ── Écriture par lots ───────────────────────────────────────────────────── */

/**
 * Écrit un lot en une seule requête.
 *
 * `ordered: false` : si un document est refusé, Mongo écrit quand même les autres
 * et renvoie la liste des échecs — un import de dizaines de milliers de fiches ne
 * doit jamais être perdu pour une ligne douteuse.
 *
 * Sur erreur réseau (Atlas M0 qui se met en veille, coupure), on réessaie avec un
 * délai doublé au lieu d'abandonner l'import.
 */
async function insererLot(lot, numero, totalLots) {
  for (let essai = 1; essai <= ESSAIS_MAX; essai += 1) {
    try {
      const ecrits = await Establishment.insertMany(lot, { ordered: false });
      return { inseres: ecrits.length, echecs: [] };
    } catch (erreur) {
      const erreursEcriture = erreur?.writeErrors;
      if (Array.isArray(erreursEcriture) && erreursEcriture.length) {
        const inseres = Array.isArray(erreur.insertedDocs)
          ? erreur.insertedDocs.length
          : lot.length - erreursEcriture.length;
        return {
          inseres,
          echecs: erreursEcriture.slice(0, 3).map((e) => `lot ${numero} : ${e.errmsg || e.message || 'refusée'}`),
        };
      }
      if (essai === ESSAIS_MAX) throw erreur;
      const delai = 1000 * 2 ** (essai - 1);
      console.warn(`  lot ${numero}/${totalLots} : ${erreur.message} → nouvel essai dans ${delai / 1000} s`);
      await attendre(delai);
    }
  }
  return { inseres: 0, echecs: ['échec sans détail'] };
}

/* ── Programme principal ─────────────────────────────────────────────────── */

async function main() {
  console.log('=== Import OpenStreetMap — Côte d\'Ivoire ===');
  console.log(`Fichier : ${FICHIER}`);
  console.log(`Mode    : ${ECRITURE ? 'ÉCRITURE (--apply)' : 'SIMULATION — rien ne sera écrit (défaut)'}`);

  // 1) Lecture du fichier AVANT toute connexion : une simulation ne doit ni
  // toucher au cluster, ni même charger le pilote Mongo côté données.
  let contenu;
  try {
    contenu = readFileSync(FICHIER, 'utf8');
  } catch (erreur) {
    console.error('');
    console.error(`Lecture impossible : ${FICHIER}`);
    console.error(`  ${erreur.message}`);
    console.error("  Le fichier est-il bien dans backend/data/ ?");
    process.exitCode = 1;
    return;
  }
  const tailleMo = (Buffer.byteLength(contenu, 'utf8') / (1024 * 1024)).toFixed(2);

  let geojson;
  try {
    geojson = JSON.parse(contenu);
  } catch (erreur) {
    console.error(`Le fichier n'est pas un JSON valide : ${erreur.message}`);
    process.exitCode = 1;
    return;
  }

  const elements = Array.isArray(geojson?.features) ? geojson.features : [];
  if (!elements.length) {
    console.error('Aucun lieu dans le fichier (`features` vide) : rien à importer.');
    process.exitCode = 1;
    return;
  }

  // 2) Nettoyage en mémoire, sans écrire quoi que ce soit.
  const stats = creerStats();
  const indexFichier = new IndexDoublons();
  const docs = [];

  stats.elements = elements.length;
  const aExaminer = LIMITE > 0 ? elements.slice(0, LIMITE) : elements;

  for (const element of aExaminer) {
    stats.lus += 1;
    const proprietes = element?.properties || {};
    const nomBrut = texte(proprietes.name);

    // Règle 2 : un lieu sans nom ne sert à rien dans un annuaire.
    if (!nomBrut) {
      stats.sansNom += 1;
      continue;
    }

    // Règle 1 : [lng, lat] → { lat, lng } (voir pointDe).
    const point = pointDe(element);
    if (!point) {
      stats.coordsInvalides += 1;
      noterRejet(stats, 'coordonnées inexploitables', nomBrut);
      continue;
    }

    // Règle 4 : classement OSM → famille du modèle.
    const classement = classer(proprietes);
    if (!classement) {
      stats.sansType += 1;
      continue;
    }

    const { doc, rejet } = construireDoc(element, classement, point);
    if (rejet || !doc) {
      stats.refusesModele += 1;
      noterRejet(stats, rejet || 'fiche non construite', nomBrut);
      continue;
    }

    // Règle 5 : le même commerce à moins de 50 m est déjà retenu → on ignore.
    if (indexFichier.tropProche(doc.nom, doc.localisation)) {
      stats.doublonsFichier += 1;
      continue;
    }

    // Le modèle est le juge de paix : on utilise SA validation, celle de l'API.
    const erreurValidation = new Establishment(doc).validateSync();
    if (erreurValidation) {
      stats.refusesModele += 1;
      const premiere = Object.values(erreurValidation.errors)[0];
      noterRejet(stats, premiere?.message || 'refusée par le modèle', doc.nom);
      continue;
    }

    indexFichier.ajouter(doc.nom, doc.localisation);
    docs.push(doc);
    stats.pretes += 1;
    if (doc.telephone) stats.avecTelephone += 1;
    else stats.sansTelephone += 1;
    stats.parCategorie.set(doc.categorie, (stats.parCategorie.get(doc.categorie) || 0) + 1);
    if (doc.categorie === 'autre') {
      stats.autresParTag.set(classement.tag, (stats.autresParTag.get(classement.tag) || 0) + 1);
    }
  }

  console.log(`  ${nombre(docs.length)} fiche(s) prête(s) après nettoyage.`);

  // 3) Simulation : on s'arrête là. Aucun accès à MongoDB, aucune écriture.
  if (!ECRITURE) {
    if (docs.length) {
      const exemple = { ...docs[0] };
      delete exemple.avis;
      console.log('');
      console.log('  Exemple de fiche produite (extrait) :');
      console.log(
        JSON.stringify(exemple, null, 2)
          .split('\n')
          .map((ligne) => `    ${ligne}`)
          .join('\n')
      );
    }
    afficherResume(stats, { ecriture: false, tailleMo });
    return;
  }

  // 4) ÉCRITURE — à partir d'ici, la base est modifiée.
  //    a) garde-fou : la phrase de confirmation doit être tapée DANS un terminal ;
  //    b) connexion ;
  //    c) anti-doublon contre les fiches DÉJÀ en base (import compris) ;
  //    d) écriture par lots.
  const autorise = await exigerConfirmationProduction({
    action: `Import OSM : création de ${nombre(docs.length)} fiche(s)`,
    details: [
      `Fichier          : ${FICHIER}`,
      `Base visée       : « ${getMongoDbName()} » via ${masquerUri(getMongoUri())}`,
      `Doublons fichier : ${nombre(stats.doublonsFichier)} écartés`,
      'Aucune fiche existante n\'est supprimée ni modifiée : import additif.',
    ],
  });
  if (!autorise) {
    console.error('Import annulé : aucune fiche créée.');
    process.exitCode = 1;
    return;
  }

  await connectDB();
  console.log('  Connecté à MongoDB.');

  // Anti-doublon « même nom à moins de 50 m » contre TOUT le catalogue : une fiche
  // déjà publiée par son gérant ne doit jamais être dupliquée par un import.
  const indexBase = new IndexDoublons();
  const existantes = await Establishment.find({}).select('nom localisation').lean();
  for (const fiche of existantes) {
    const lat = Number(fiche?.localisation?.lat);
    const lng = Number(fiche?.localisation?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    indexBase.ajouter(fiche.nom, { lat, lng });
  }
  console.log(`  ${nombre(existantes.length)} fiche(s) déjà en base : référence anti-doublon.`);

  const aInserer = docs.filter((doc) => {
    if (indexBase.tropProche(doc.nom, doc.localisation)) {
      stats.doublonsBase += 1;
      return false;
    }
    return true;
  });

  // Le résumé doit décrire ce qui est RÉELLEMENT écrit : on recalcule les
  // compteurs après le filtre « déjà en base ».
  stats.parCategorie = new Map();
  stats.pretes = 0;
  stats.avecTelephone = 0;
  stats.sansTelephone = 0;
  for (const doc of aInserer) {
    stats.pretes += 1;
    if (doc.telephone) stats.avecTelephone += 1;
    else stats.sansTelephone += 1;
    stats.parCategorie.set(doc.categorie, (stats.parCategorie.get(doc.categorie) || 0) + 1);
  }

  if (!aInserer.length) {
    console.log('  Aucune fiche nouvelle : tout est déjà en base.');
    afficherResume(stats, { ecriture: true, tailleMo });
    await disconnectDB();
    return;
  }

  const totalLots = Math.ceil(aInserer.length / TAILLE_LOT);
  let inseres = 0;
  const echecs = [];
  for (let debut = 0; debut < aInserer.length; debut += TAILLE_LOT) {
    const numero = Math.floor(debut / TAILLE_LOT) + 1;
    const lot = aInserer.slice(debut, debut + TAILLE_LOT);
    const resultat = await insererLot(lot, numero, totalLots);
    inseres += resultat.inseres;
    echecs.push(...resultat.echecs);
    if (numero % 10 === 0 || numero === totalLots) {
      console.log(`  lot ${numero}/${totalLots} — ${nombre(inseres)} fiche(s) écrite(s)`);
    }
    // Pause entre les lots : le cluster gratuit (M0) limite le débit, et une
    // rafale d'insertions ferait échouer les derniers lots.
    if (numero < totalLots && PAUSE_MS) await attendre(PAUSE_MS);
  }

  for (const echec of echecs) console.error(`  ⚠ ${echec}`);

  console.log('');
  console.log(`  Fiches écrites                : ${nombre(inseres)}`);
  console.log(`  Fiches « source: osm » en base : ${nombre(await Establishment.countDocuments({ source: SOURCE }))}`);
  console.log(`  Total du catalogue            : ${nombre(await Establishment.countDocuments({}))}`);
  console.log('');
  console.log('  Les fiches sont importées, non réclamées : chaque gérant peut les');
  console.log('  reprendre depuis l\'application (« C\'est mon établissement ? »).');

  afficherResume(stats, { ecriture: true, tailleMo });
  await disconnectDB();
}

main().catch(async (erreur) => {
  console.error('');
  console.error('Import interrompu :', erreur?.message || erreur);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});








