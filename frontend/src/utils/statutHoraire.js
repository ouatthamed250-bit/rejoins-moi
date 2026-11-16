// statutHoraire.js — « Ouvert / Fermé, là, maintenant » pour une fiche.
//
// POURQUOI LE CALCUL EST CÔTÉ APPLICATION : l'heure qui compte est celle du
// client (« il est 19 h chez moi, est-ce encore ouvert ? »), et la pastille doit
// changer toute seule quand 18:00 sonne, sans requête ni rechargement. Le serveur
// publie donc les HORAIRES, jamais un statut qui serait périmé dès qu'il est écrit.
//
// RÈGLE DES FICHES IMPORTÉES : les 6 700 fiches de la base publique n'ont aucune
// grille structurée. La fonction renvoie alors `connu: false` et l'appelant
// n'affiche AUCUNE pastille. C'est volontaire : « Fermé » sur un commerce dont
// personne n'a jamais saisi les horaires serait une information inventée, et un
// client ferait le déplacement pour rien.

/**
 * Les sept jours, dans l'ordre d'affichage français. `cle` = nom du champ en base,
 * `court` = abréviation utilisée dans le résumé texte (« Lun–Sam 08:00–18:00 »).
 * Cet ordre est celui du modèle (backend/src/models/Establishment.js).
 */
export const JOURS_SEMAINE = [
  { cle: 'lundi', libelle: 'Lundi', court: 'Lun' },
  { cle: 'mardi', libelle: 'Mardi', court: 'Mar' },
  { cle: 'mercredi', libelle: 'Mercredi', court: 'Mer' },
  { cle: 'jeudi', libelle: 'Jeudi', court: 'Jeu' },
  { cle: 'vendredi', libelle: 'Vendredi', court: 'Ven' },
  { cle: 'samedi', libelle: 'Samedi', court: 'Sam' },
  { cle: 'dimanche', libelle: 'Dimanche', court: 'Dim' },
];

/** Ordre des jours renvoyés par `Date.prototype.getDay()` (0 = dimanche). */
const JOURS_JS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Heures de référence, identiques aux valeurs par défaut du modèle. */
const DEBUT_DEFAUT = '08:00';
const FIN_DEFAUT = '18:00';

/**
 * Grille neuve : lundi → samedi ouverts 08:00-18:00, dimanche fermé.
 * Toujours un NOUVEL objet (l'éditeur le modifie : jamais d'objet partagé).
 */
export function horairesParDefaut() {
  const grille = {};
  for (const { cle } of JOURS_SEMAINE) {
    grille[cle] = { ouvert: cle !== 'dimanche', debut: DEBUT_DEFAUT, fin: FIN_DEFAUT };
  }
  return grille;
}

/**
 * « 8:00 » / « 08:00 » → 480 (minutes depuis minuit) ; `null` si l'heure est
 * illisible ou hors bornes. Même tolérance que la route (backend), pour qu'une
 * grille enregistrée à la main ne casse jamais l'affichage.
 *
 * @param {unknown} valeur
 * @returns {number|null}
 */
export function heureEnMinutes(valeur) {
  const trouve = /^(\d{1,2}):(\d{2})$/.exec(String(valeur ?? '').trim());
  if (!trouve) return null;
  const heures = Number(trouve[1]);
  const minutes = Number(trouve[2]);
  if (heures > 23 || minutes > 59) return null;
  return heures * 60 + minutes;
}

/** 480 → « 08:00 ». */
function minutesEnHeure(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Grille d'un jour, toujours complète (les trous prennent la valeur par défaut). */
function jourDe(grille, cle) {
  const jour = grille?.[cle];
  return {
    ouvert: typeof jour?.ouvert === 'boolean' ? jour.ouvert : cle !== 'dimanche',
    debut: jour?.debut ?? DEBUT_DEFAUT,
    fin: jour?.fin ?? FIN_DEFAUT,
  };
}


/**
 * Statut d'ouverture à l'instant `quand`.
 *
 * Ordre de lecture — c'est l'ordre du réel, pas celui des champs :
 *   1. fermeture temporaire active (« Rupture de stock », panne, deuil…) : elle
 *      prime sur la grille, sinon une boutique fermée s'afficherait « Ouvert »
 *      parce que la grille dit 08:00-18:00 ;
 *   2. grille absente (fiches importées, fiches créées avant le 16/11) → inconnu ;
 *   3. jour fermé → « Fermé » ;
 *   4. sinon comparaison de l'heure avec la plage du jour.
 *
 * @param {object|null|undefined} etablissement fiche telle que renvoyée par l'API
 *   (`horairesStructures`, `fermetureTemporaire`)
 * @param {Date} [quand] instant de référence — injectable pour les vérifications
 * @returns {{ ouvert: boolean|null, connu: boolean, texte: string }}
 *   `texte` est prêt à afficher : « Ouvert jusqu’à 18:00 », « Fermé »,
 *   « Fermé (Rupture) ». `connu: false` ⇒ `ouvert: null` : aucune pastille.
 */
export function estOuvertMaintenant(etablissement, quand = new Date()) {
  const maintenant = quand instanceof Date ? quand : new Date(quand);
  if (Number.isNaN(maintenant.getTime())) return { ouvert: null, connu: false, texte: '' };

  // 1) Fermeture temporaire — la raison est affichée telle que saisie.
  const fermeture = etablissement?.fermetureTemporaire;
  if (fermeture?.actif === true) {
    const raison = String(fermeture.raison || '').trim();
    return {
      ouvert: false,
      connu: true,
      texte: raison ? `Fermé (${raison})` : 'Fermé (fermeture temporaire)',
    };
  }

  // 2) Aucune grille : statut inconnu, l'appelant n'affiche rien.
  const grille = etablissement?.horairesStructures;
  if (!grille || typeof grille !== 'object') return { ouvert: null, connu: false, texte: '' };

  const jour = jourDe(grille, JOURS_JS[maintenant.getDay()]);

  // 3) Jour de fermeture.
  if (jour.ouvert !== true) return { ouvert: false, connu: true, texte: 'Fermé' };

  const debut = heureEnMinutes(jour.debut);
  const fin = heureEnMinutes(jour.fin);
  // Heures illisibles malgré la validation du serveur (grille écrite à la main) :
  // on ne peut pas affirmer « ouvert ».
  if (debut == null || fin == null) return { ouvert: false, connu: true, texte: 'Fermé' };

  const minuteActuelle = maintenant.getHours() * 60 + maintenant.getMinutes();

  // 4) Comparaison. Deux cas particuliers :
  //    · fin > debut  : plage ordinaire (08:00 → 18:00) ;
  //    · fin <= debut : plage À CHEVAL SUR MINUIT (20:00 → 02:00, un maquis, une
  //      pharmacie de garde). Elle est alors coupée en deux : « à partir de 20:00 »
  //      le soir, « avant 02:00 » le matin. `debut === fin` = ouvert 24 h/24.
  const journeeComplete = debut === fin;
  const ouvert = journeeComplete
    ? true
    : fin > debut
      ? minuteActuelle >= debut && minuteActuelle < fin
      : minuteActuelle >= debut || minuteActuelle < fin;

  return {
    ouvert,
    connu: true,
    // « Ouvert jusqu’à 00:00 » n'aurait aucun sens : on annonce la journée entière.
    texte: ouvert
      ? journeeComplete
        ? 'Ouvert 24 h/24'
        : `Ouvert jusqu’à ${minutesEnHeure(fin)}`
      : 'Fermé',
  };
}

/**
 * Résumé texte de la grille, pour le champ historique `horaires` (String) que
 * continuent d'afficher la fiche, l'annuaire et les 6 700 fiches importées.
 * Les jours qui partagent la même configuration sont regroupés :
 * `Lun–Sam 08:00–18:00 · Dim fermé`.
 *
 * @param {object|null|undefined} grille
 * @returns {string} '' si la grille est absente
 */
export function resumerHoraires(grille) {
  if (!grille || typeof grille !== 'object') return '';

  // Regroupement des jours CONSÉCUTIFS identiques (lundi → dimanche).
  const groupes = [];
  for (const { cle, court } of JOURS_SEMAINE) {
    const jour = jourDe(grille, cle);
    const signature = jour.ouvert ? `${jour.debut}-${jour.fin}` : 'ferme';
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.signature === signature) {
      dernier.dernierJour = court;
    } else {
      groupes.push({ signature, premierJour: court, dernierJour: court, jour });
    }
  }

  // Un établissement ouvert sept jours sur sept n'a pas besoin de la liste des
  // jours : « Tous les jours 08:00–18:00 » se lit mieux que « Lun–Dim … ».
  if (groupes.length === 1 && groupes[0].jour.ouvert) {
    const { debut, fin } = groupes[0].jour;
    return debut === fin ? 'Tous les jours, 24 h/24' : `Tous les jours ${debut}–${fin}`;
  }

  return groupes
    .map((g) => {
      const jours =
        g.premierJour === g.dernierJour ? g.premierJour : `${g.premierJour}–${g.dernierJour}`;
      if (!g.jour.ouvert) return `${jours} fermé`;
      // Même plage vide = ouvert en continu : on le dit, « 00:00–00:00 » ne se lit pas.
      return g.jour.debut === g.jour.fin
        ? `${jours} 24 h/24`
        : `${jours} ${g.jour.debut}–${g.jour.fin}`;
    })
    .join(' · ');
}
