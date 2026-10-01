// generer-icones.mjs — Fabrique les icônes PLEIN CADRE de Rejoins'Moi.
//
// Le problème (relevé sur téléphone le 30/09) : l'icône posée sur l'écran
// d'accueil Android affichait « un carré orange plein derrière le logo », alors
// que les autres applications épousent la forme du lanceur. Deux causes :
//
//   1. `icon-maskable-*.png` avait été fabriquée en posant le logo sur un APLAT
//      orange de sécurité : un carré orange parfait, avec le logo au milieu. Sur
//      un lanceur qui applique son masque, on voyait donc un cadre orange de 12 %
//      de chaque côté ; sur un lanceur qui ne l'applique pas, un carré orange
//      plein. C'est ce cadre que la v2.1 supprime.
//   2. `apple-touch-icon-180.png` avait des coins TRANSPARENTS : iOS, qui n'aime
//      pas la transparence pour ce point d'entrée, y peint du noir.
//
// Ce que fait ce script : il reprend l'illustration telle quelle (le fichier
// `any`, qui porte le logo), l'agrandit légèrement autour de son centre pour
// qu'elle remplisse la tuile, puis PROLONGE ses bords dans les quelques pixels
// restés transparents (chaque pixel transparent prend la couleur du pixel opaque
// le plus proche). Résultat :
//   - 100 % opaque : aucun trou, aucun aplat rapporté ;
//   - l'illustration occupe toute la tuile, donc le masque du lanceur (cercle,
//     goutte, squircle…) découpe DANS l'illustration, sans cadre visible ;
//   - le sujet — l'épingle « R » — reste au centre, dans la zone sûre de 80 %
//     exigée par la spécification des icônes maskable.
//
// Usage : node scripts/generer-icones.mjs   (ou `npm run icones`)
//
// Aucune dépendance : le codage PNG est assuré par scripts/png.mjs.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ecrirePng, lirePng } from './png.mjs';

const DOSSIER = fileURLToPath(new URL('../public/icons/', import.meta.url));

/** Agrandissement de l'illustration : 1.15 remplit la tuile sans mordre sur l'épingle. */
const AGRANDISSEMENT = 1.15;

/* ───────────────────────────── Outils de dessin ───────────────────────────── */

/** Pixel (RGBA) d'une image, coordonnées bornées à l'image. */
function pixel(image, x, y) {
  const cx = Math.max(0, Math.min(image.width - 1, x));
  const cy = Math.max(0, Math.min(image.height - 1, y));
  const i = (cy * image.width + cx) * 4;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]];
}

/** Mélange linéaire de deux couleurs RGBA. */
function melange(a, b, t) {
  return a.map((valeur, i) => valeur + (b[i] - valeur) * t);
}

/**
 * Couleur d'un pixel de sortie, calculée depuis l'illustration.
 * `pas` = nombre de pixels source couverts par un pixel de sortie :
 *   - `pas <= 1`  (agrandissement) : interpolation bilinéaire ;
 *   - `pas > 1`   (réduction)      : moyenne des pixels couverts, pondérée par
 *     l'alpha (une simple moyenne ferait tirer les bords transparents vers le
 *     noir, d'où un liseré sombre autour du logo).
 */
function echantillon(image, x, y, pas) {
  if (pas <= 1) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    return melange(
      melange(pixel(image, x0, y0), pixel(image, x0 + 1, y0), fx),
      melange(pixel(image, x0, y0 + 1), pixel(image, x0 + 1, y0 + 1), fx),
      fy
    );
  }

  const debutX = x - pas / 2;
  const debutY = y - pas / 2;
  const somme = [0, 0, 0, 0];
  let alpha = 0;
  let nombre = 0;
  for (let sy = Math.floor(debutY); sy < debutY + pas; sy += 1) {
    for (let sx = Math.floor(debutX); sx < debutX + pas; sx += 1) {
      const p = pixel(image, sx, sy);
      for (let c = 0; c < 3; c += 1) somme[c] += p[c] * p[3];
      alpha += p[3];
      nombre += 1;
    }
  }
  if (alpha === 0) return [0, 0, 0, 0];
  return [somme[0] / alpha, somme[1] / alpha, somme[2] / alpha, alpha / nombre];
}


/**
 * Prolonge les bords : tout pixel transparent prend la couleur du pixel OPAQUE
 * le plus proche de sa ligne (1re passe), puis de sa colonne (2e passe, pour les
 * coins). C'est ce qui remplit la tuile sans jamais ajouter d'aplat rapporté.
 */
function prolongerBords(image) {
  const { width, height, pixels } = image;
  const seuil = 250; // un pixel franchement opaque fait foi comme donneur
  const opaque = (x, y) => pixels[(y * width + x) * 4 + 3] >= seuil;

  for (let y = 0; y < height; y += 1) {
    let gauche = -1;
    let droite = -1;
    for (let x = 0; x < width; x += 1) if (opaque(x, y)) { gauche = x; break; }
    for (let x = width - 1; x >= 0; x -= 1) if (opaque(x, y)) { droite = x; break; }
    if (gauche < 0) continue;
    for (let x = 0; x < width; x += 1) {
      if (opaque(x, y)) continue;
      const donneur = x - gauche <= droite - x ? gauche : droite;
      recopier(pixels, (y * width + donneur) * 4, (y * width + x) * 4);
    }
  }

  for (let x = 0; x < width; x += 1) {
    let haut = -1;
    let bas = -1;
    for (let y = 0; y < height; y += 1) if (opaque(x, y)) { haut = y; break; }
    for (let y = height - 1; y >= 0; y -= 1) if (opaque(x, y)) { bas = y; break; }
    if (haut < 0) continue;
    for (let y = 0; y < height; y += 1) {
      if (opaque(x, y)) continue;
      const donneur = y - haut <= bas - y ? haut : bas;
      recopier(pixels, (donneur * width + x) * 4, (y * width + x) * 4);
    }
  }
  return image;
}

/** Recopie RVB du donneur vers la cible et rend la cible opaque. */
function recopier(pixels, source, cible) {
  pixels[cible] = pixels[source];
  pixels[cible + 1] = pixels[source + 1];
  pixels[cible + 2] = pixels[source + 2];
  pixels[cible + 3] = 255;
}

/**
 * Opacité franche : un pixel presque opaque (alpha ≥ 250) le devient tout à fait.
 * L'illustration d'origine vient d'un export qui laisse passer 1 à 2 % de
 * transparence sur ses aplats ; un lanceur qui compose l'icône sur un fond (c'est
 * le cas des icônes maskable) laisserait alors deviner ce fond. Les pixels
 * réellement transparents — les coins du logo — ne sont pas touchés.
 */
function opaciteFranche(image) {
  for (let i = 3; i < image.pixels.length; i += 4) {
    if (image.pixels[i] >= 250) image.pixels[i] = 255;
  }
  return image;
}

/** Illustration agrandie autour de son centre, puis prolongée jusqu'aux bords. */
function pleinCadre(illustration, taille) {
  const sortie = { width: taille, height: taille, pixels: Buffer.alloc(taille * taille * 4) };
  const centreSource = (illustration.width - 1) / 2;
  const centreSortie = (taille - 1) / 2;
  const pas = illustration.width / taille / AGRANDISSEMENT;

  for (let y = 0; y < taille; y += 1) {
    for (let x = 0; x < taille; x += 1) {
      const [r, v, b, a] = echantillon(
        illustration,
        centreSource + (x - centreSortie) * pas,
        centreSource + (y - centreSortie) * pas,
        pas
      );
      const i = (y * taille + x) * 4;
      sortie.pixels[i] = r;
      sortie.pixels[i + 1] = v;
      sortie.pixels[i + 2] = b;
      sortie.pixels[i + 3] = a;
    }
  }
  return opaciteFranche(prolongerBords(sortie));
}


/* ────────────────────────────── Statistiques ──────────────────────────────── */

/** Chiffres affichés après génération : la preuve que la tuile est bien pleine. */
function relever(image) {
  let opaques = 0;
  for (let i = 3; i < image.pixels.length; i += 4) if (image.pixels[i] === 255) opaques += 1;
  const coin = (x, y) =>
    Array.from(image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
  return {
    taille: `${image.width}x${image.height}`,
    couverture: `${((100 * opaques) / (image.width * image.height)).toFixed(1)} %`,
    coins: [
      coin(0, 0),
      coin(image.width - 1, 0),
      coin(0, image.height - 1),
      coin(image.width - 1, image.height - 1),
    ],
    centre: coin(Math.floor(image.width / 2), Math.floor(image.height / 2)),
  };
}

/* ─────────────────────────────── Fabrication ──────────────────────────────── */

const illustration = opaciteFranche(lirePng(join(DOSSIER, 'icon-512.png')));
console.log(`Illustration de départ : icon-512.png (${illustration.width}x${illustration.height})`);

// Les deux fichiers « any » sont réécrits aussi : MÊMES pixels, mais opacité
// franche (voir opaciteFranche). Leurs coins restent transparents : c'est le logo
// seul, sans fond ajouté.
for (const nom of ['icon-512.png', 'icon-192.png']) {
  ecrirePng(join(DOSSIER, nom), opaciteFranche(lirePng(join(DOSSIER, nom))));
  console.log(`Opacité franche appliquée à ${nom} (aucun ajout de fond).`);
}

const cibles = [
  ['icon-maskable-512.png', 512],
  ['icon-maskable-192.png', 192],
  ['apple-touch-icon-180.png', 180],
];

for (const [nom, taille] of cibles) {
  const image = pleinCadre(illustration, taille);
  ecrirePng(join(DOSSIER, nom), image);
  const infos = relever(image);
  console.log(`\n${nom} — ${infos.taille}, ${infos.couverture} de pixels opaques`);
  console.log(`  quatre coins : ${infos.coins.map((c) => c.join(',')).join(' | ')}`);
  console.log(`  centre       : ${infos.centre.join(',')} (épingle « R »)`);
}

console.log('\nTerminé. Les fichiers « any » (icon-192.png, icon-512.png) gardent leurs coins');
console.log('transparents : c’est le logo seul, sans fond ajouté, celui que la barre d’état et');
console.log('les onglets utilisent. Les tuiles plein cadre sont réservées à l’écran d’accueil.');
