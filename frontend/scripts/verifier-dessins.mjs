// verifier-dessins.mjs — Contrôle du choix des illustrations « crayon ».
//
// Le module `src/components/illustrations/dessinsContexte.js` décide QUEL dessin
// accompagne une fiche, une annonce ou un bandeau. Une erreur ici ne casse pas le
// build : elle affiche simplement un dessin hors sujet (« Transfert d'argent » avec
// une boîte à outils), ce qui ne se voit qu'à l'œil. D'où ce contrôle automatique.
//
// Ce qu'il vérifie :
//   1. chaque clé renvoyée existe VRAIMENT dans tracesEsquisse.jsx (aucune faute de
//      frappe silencieuse — `Illustration` n'affiche rien pour une clé inconnue) ;
//   2. les 13 dessins ajoutés le 16/11 sont tous atteignables (aucun dessin « mort ») ;
//   3. les cas réels : sous-catégories des 6 719 fiches importées, métiers des
//      annonces de démonstration, catégories accentuées du serveur (« Beauté ») ;
//   4. le comportement historique : sans catégorie → null (aucun dessin ajouté),
//      catégorie inconnue → « maison ».
//
// Usage : node scripts/verifier-dessins.mjs   (aucun serveur, aucune base requis)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DESSIN_PAR_CATEGORIE,
  DESSIN_PAR_DEFAUT,
  REGLES_DESSIN,
  dessinDeContexte,
  dessinPourTexte,
  normaliser,
} from '../src/components/illustrations/dessinsContexte.js';

const ici = dirname(fileURLToPath(import.meta.url));
const sourceTraces = readFileSync(join(ici, '../src/components/illustrations/tracesEsquisse.jsx'), 'utf8');

/** Clés réellement définies dans la planche : `  nomDeTrace: () => (` ou `({ id })`. */
const CLES_PLANCHE = new Set(
  [...sourceTraces.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): \(/gm)].map((m) => m[1])
);

let echecs = 0;
let verifications = 0;

function verifier(condition, libelle, detail = '') {
  verifications += 1;
  if (condition) return;
  echecs += 1;
  console.error(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
}

function attendreDessin(contexte, attendu, libelle) {
  const obtenu = dessinDeContexte(contexte);
  verifier(obtenu === attendu, libelle, `attendu « ${attendu} », obtenu « ${obtenu} »`);
}

console.log('1. Cohérence avec la planche de dessins');
verifier(CLES_PLANCHE.size >= 31, 'la planche contient au moins 31 dessins', `trouvés : ${CLES_PLANCHE.size}`);
for (const dessin of Object.values(DESSIN_PAR_CATEGORIE)) {
  verifier(CLES_PLANCHE.has(dessin), `repli de catégorie « ${dessin} » absent de la planche`);
}
for (const regle of REGLES_DESSIN) {
  verifier(
    CLES_PLANCHE.has(regle.dessin),
    `règle ${regle.motif} pointe vers « ${regle.dessin} », absent de la planche`
  );
}
verifier(CLES_PLANCHE.has(DESSIN_PAR_DEFAUT), `repli universel « ${DESSIN_PAR_DEFAUT} » absent de la planche`);

console.log('2. Les 13 dessins du 16/11 sont atteignables');
const NOUVEAUX = [
  'kiosque',
  'eglise',
  'mosquee',
  'pharmacie',
  'salonBeaute',
  'atelierCouture',
  'chantier',
  'electricite',
  'plomberie',
  'taxiMoto',
  'mobileMoney',
  'enveloppe',
  'horsLigne',
];
const atteignables = new Set([...Object.values(DESSIN_PAR_CATEGORIE), ...REGLES_DESSIN.map((r) => r.dessin)]);
for (const dessin of NOUVEAUX) {
  // `enveloppe` est posé explicitement par l'écran Messages (aucune règle de texte :
  // un message n'a pas de mot-clé fiable) ; il doit au moins exister dans la planche.
  if (dessin === 'enveloppe') {
    verifier(CLES_PLANCHE.has(dessin), '« enveloppe » absent de la planche');
    continue;
  }
  verifier(atteignables.has(dessin), `« ${dessin} » n'est atteignable par aucune règle ni repli`);
}

console.log('3. Cas réels — sous-catégories des fiches importées');
attendreDessin({ categorie: 'Services', sousCategorie: "Transfert d'argent" }, 'mobileMoney', "Transfert d'argent");
attendreDessin({ categorie: 'Beauté', sousCategorie: 'Coiffeurs(ses)' }, 'salonBeaute', 'Coiffeurs(ses)');
attendreDessin({ categorie: 'Beauté', sousCategorie: 'Accessoires de beaute' }, 'salonBeaute', 'Accessoires de beaute');
attendreDessin({ categorie: 'Alimentation', sousCategorie: 'Commodites' }, 'kiosque', 'Commodites');
attendreDessin({ categorie: 'Artisanat', sousCategorie: 'Quincaillerie' }, 'boiteOutils', 'Quincaillerie');
attendreDessin({ categorie: 'Services', sousCategorie: 'Reparation de voitures' }, 'boiteOutils', 'Reparation de voitures');
attendreDessin({ categorie: 'Services', sousCategorie: 'Nettoyage a sec' }, 'boiteOutils', 'Nettoyage a sec');
attendreDessin({ categorie: 'Services', sousCategorie: 'Agences de telephonie' }, 'mobileMoney', 'Agences de telephonie');
attendreDessin({ categorie: 'Alimentation', sousCategorie: 'Restaurant' }, 'marmite', 'Restaurant (repli catégorie)');

console.log('3 bis. Familles locales (prompt 6) — chaque sous-catégorie a un dessin juste');
attendreDessin({ categorie: 'restauration' }, 'marmite', 'restauration (repli famille)');
attendreDessin({ categorie: 'restauration', sousCategorie: 'Maquis' }, 'barbecue', 'Maquis');
attendreDessin({ categorie: 'restauration', sousCategorie: 'Garbadrom' }, 'barbecue', 'Garbadrom');
attendreDessin({ categorie: 'restauration', sousCategorie: 'Koutoukoudrom' }, 'barbecue', 'Koutoukoudrom');
attendreDessin({ categorie: 'restauration', sousCategorie: 'Placalidrom' }, 'barbecue', 'Placalidrom');
attendreDessin({ categorie: 'restauration', sousCategorie: 'Market' }, 'etalMarche', 'Market');
attendreDessin({ categorie: 'commerces' }, 'etalMarche', 'commerces (repli famille)');
attendreDessin({ categorie: 'commerces', sousCategorie: 'Vêtements' }, 'etalMarche', 'Vêtements (boutique)');
attendreDessin({ categorie: 'commerces', sousCategorie: 'Chaussures' }, 'etalMarche', 'Chaussures');
attendreDessin({ categorie: 'proximite', sousCategorie: 'Clé minute' }, 'kiosque', 'Clé minute');
attendreDessin({ categorie: 'proximite', sousCategorie: "Transfert d'argent" }, 'mobileMoney', "Transfert d'argent (proximité)");
attendreDessin({ categorie: 'proximite', sousCategorie: 'Pressing' }, 'boiteOutils', 'Pressing');
attendreDessin({ categorie: 'proximite', sousCategorie: 'Lavage auto' }, 'boiteOutils', 'Lavage auto');
attendreDessin({ categorie: 'proximite', sousCategorie: 'Imprimerie' }, 'boiteOutils', 'Imprimerie (repli famille)');
attendreDessin({ categorie: 'proximite', sousCategorie: 'WC publique' }, 'repere', 'WC publique');
attendreDessin({ categorie: 'cultes', sousCategorie: 'Mosquée' }, 'mosquee', 'Mosquée (famille cultes)');
attendreDessin({ categorie: 'cultes', sousCategorie: 'Église' }, 'eglise', 'Église (famille cultes)');
attendreDessin({ categorie: 'cultes', sousCategorie: 'Association' }, 'paillote', 'Association (repli famille)');

console.log('4. Cas réels — métiers des annonces de main-d’œuvre');
attendreDessin({ metier: 'Plombier' }, 'plomberie', 'Plombier');
attendreDessin({ metier: 'Électricien' }, 'electricite', 'Électricien (accent)');
attendreDessin({ metier: 'Maçon' }, 'chantier', 'Maçon (cédille)');
attendreDessin({ metier: 'Couturier' }, 'atelierCouture', 'Couturier');
attendreDessin({ metier: 'Coiffeur' }, 'salonBeaute', 'Coiffeur');
attendreDessin({ metier: 'Chauffeur' }, 'taxiMoto', 'Chauffeur');
attendreDessin({ metier: 'Cuisinier' }, null, 'Cuisinier (aucun dessin dédié → icône)');
attendreDessin({ metier: 'Journalier' }, null, 'Journalier (aucun dessin dédié → icône)');

console.log('5. Cas réels — catégories du serveur et de la démo');
attendreDessin({ categorie: 'beaute' }, 'motifWax', 'beaute');
attendreDessin({ categorie: 'Beauté' }, 'motifWax', 'Beauté (accent + capitale)');
attendreDessin({ categorie: 'alimentation' }, 'marmite', 'alimentation');
attendreDessin({ categorie: 'spiritualite' }, 'paillote', 'spiritualite');
attendreDessin({ categorie: 'commerce' }, 'etalMarche', 'commerce');
attendreDessin({ categorie: 'sante' }, 'croixSante', 'sante');
attendreDessin({ categorie: 'inexistante' }, 'maison', 'catégorie inconnue');
attendreDessin({ categorie: 'spiritualite', tags: ['Chorale'] }, 'eglise', 'église (tag Chorale)');
attendreDessin({ categorie: 'spiritualite', tags: ['Coran'] }, 'mosquee', 'mosquée (tag Coran)');
attendreDessin({ categorie: 'sante', tags: ['Pharmacie de garde'] }, 'pharmacie', 'pharmacie (tag)');

console.log('6. Comportement d’origine préservé');
verifier(dessinDeContexte() === null, 'sans catégorie, aucun dessin n’est imposé');
verifier(dessinDeContexte({}) === null, 'contexte vide → aucun dessin');
verifier(dessinPourTexte('') === null, 'texte vide → aucun dessin');
verifier(dessinPourTexte(null) === null, 'texte null → aucun dessin');
verifier(normaliser('Électricien') === 'electricien', 'normaliser retire accents et capitale');
verifier(dessinPourTexte('Kiosque') === 'kiosque', '« Kiosque » → kiosque');
// Deux appels successifs : une expression régulière globale raterait le second.
verifier(dessinPourTexte('Coiffeur') === 'salonBeaute', 'coiffeur (1er appel)');
verifier(dessinPourTexte('Coiffeur') === 'salonBeaute', 'coiffeur (2e appel, pas de lastIndex résiduel)');

if (echecs > 0) {
  console.error(`\n✗ ${echecs} vérification(s) en échec sur ${verifications}.`);
  process.exit(1);
}
console.log(
  `\n✓ ${verifications} vérifications passées : ${CLES_PLANCHE.size} dessins, ${REGLES_DESSIN.length} règles.`
);
