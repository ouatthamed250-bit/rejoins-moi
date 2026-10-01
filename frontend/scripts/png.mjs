// png.mjs — Lecteur et écrivain PNG minimalistes, SANS dépendance.
//
// Pourquoi écrire ça à la main ? Le dépôt n'a aucune dépendance d'image (ni
// sharp, ni canvas) et l'on ne veut pas en ajouter pour trois icônes. Node fournit
// déjà tout le nécessaire : `node:zlib` pour la compression, et rien d'autre. Le
// format utilisé est volontairement réduit à ce que produisent nos outils :
//   - 8 bits par canal, non entrelacé ;
//   - type couleur 6 (RVB + alpha) ou 2 (RVB) ;
//   - filtres de ligne 0 à 4 (les cinq de la spécification).
// Tout autre cas lève une erreur explicite plutôt que de produire une image
// silencieusement fausse.
//
// Usage :
//   import { ecrirePng, lirePng } from './png.mjs';
//   const image = lirePng('public/icons/icon-512.png'); // { width, height, pixels: RGBA }
//   ecrirePng('sortie.png', image);

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/* ─────────────────────────────── CRC32 (spécification PNG) ─────────────────── */

const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const octet of buffer) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ────────────────────────────────── Lecture ───────────────────────────────── */

function decouperChunks(donnees) {
  if (!donnees.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Ce fichier n’est pas un PNG (signature absente).');
  }
  const chunks = [];
  let position = 8;
  while (position < donnees.length) {
    const longueur = donnees.readUInt32BE(position);
    const type = donnees.toString('ascii', position + 4, position + 8);
    const corps = donnees.subarray(position + 8, position + 8 + longueur);
    chunks.push({ type, corps });
    position += 12 + longueur;
    if (type === 'IEND') break;
  }
  return chunks;
}

/** Défiltre une ligne (filtres 0 à 4 de la spécification PNG). */
function defiltrer(ligne, precedente, filtre, octetsParPixel) {
  const sortie = Buffer.from(ligne);
  for (let i = 0; i < sortie.length; i += 1) {
    const gauche = i >= octetsParPixel ? sortie[i - octetsParPixel] : 0;
    const haut = precedente ? precedente[i] : 0;
    const diagonale = precedente && i >= octetsParPixel ? precedente[i - octetsParPixel] : 0;
    switch (filtre) {
      case 0:
        break;
      case 1:
        sortie[i] = (sortie[i] + gauche) & 0xff;
        break;
      case 2:
        sortie[i] = (sortie[i] + haut) & 0xff;
        break;
      case 3:
        sortie[i] = (sortie[i] + ((gauche + haut) >> 1)) & 0xff;
        break;
      case 4: {
        const p = gauche + haut - diagonale;
        const pa = Math.abs(p - gauche);
        const pb = Math.abs(p - haut);
        const pc = Math.abs(p - diagonale);
        const prediction = pa <= pb && pa <= pc ? gauche : pb <= pc ? haut : diagonale;
        sortie[i] = (sortie[i] + prediction) & 0xff;
        break;
      }
      default:
        throw new Error(`Filtre PNG inconnu : ${filtre}`);
    }
  }
  return sortie;
}


/**
 * Lit un PNG et le rend sous forme RGBA 8 bits (les images RVB sont complétées
 * d'un alpha opaque).
 *
 * @param {string} chemin
 * @returns {{ width: number, height: number, pixels: Buffer }}
 */
export function lirePng(chemin) {
  const chunks = decouperChunks(readFileSync(chemin));
  const entete = chunks.find((c) => c.type === 'IHDR');
  if (!entete) throw new Error('PNG sans en-tête IHDR.');

  const width = entete.corps.readUInt32BE(0);
  const height = entete.corps.readUInt32BE(4);
  const profondeur = entete.corps[8];
  const typeCouleur = entete.corps[9];
  const entrelacement = entete.corps[12];

  if (profondeur !== 8) throw new Error(`Profondeur non gérée : ${profondeur} bits.`);
  if (entrelacement !== 0) throw new Error('PNG entrelacé : non géré.');
  if (typeCouleur !== 6 && typeCouleur !== 2) {
    throw new Error(`Type couleur non géré : ${typeCouleur} (attendu 2 ou 6).`);
  }

  const canaux = typeCouleur === 6 ? 4 : 3;
  const brut = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.corps))
  );

  const pixels = Buffer.alloc(width * height * 4);
  const ligneTaille = width * canaux;
  let precedente = null;
  for (let y = 0; y < height; y += 1) {
    const debut = y * (ligneTaille + 1);
    const filtre = brut[debut];
    const ligne = defiltrer(
      brut.subarray(debut + 1, debut + 1 + ligneTaille),
      precedente,
      filtre,
      canaux
    );
    precedente = ligne;
    for (let x = 0; x < width; x += 1) {
      const source = x * canaux;
      const cible = (y * width + x) * 4;
      pixels[cible] = ligne[source];
      pixels[cible + 1] = ligne[source + 1];
      pixels[cible + 2] = ligne[source + 2];
      pixels[cible + 3] = canaux === 4 ? ligne[source + 3] : 255;
    }
  }

  return { width, height, pixels };
}

/* ────────────────────────────────── Écriture ──────────────────────────────── */

function chunk(type, corps) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(corps.length, 0);
  const nom = Buffer.from(type, 'ascii');
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(Buffer.concat([nom, corps])), 0);
  return Buffer.concat([longueur, nom, corps, controle]);
}

/**
 * Écrit une image RGBA 8 bits en PNG (une seule passe, filtre 0 : nos icônes sont
 * petites et la compression reste correcte).
 *
 * @param {string} chemin
 * @param {{ width: number, height: number, pixels: Buffer }} image
 */
export function ecrirePng(chemin, image) {
  const { width, height, pixels } = image;
  const brut = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const debut = y * (width * 4 + 1);
    brut[debut] = 0;
    pixels.copy(brut, debut + 1, y * width * 4, (y + 1) * width * 4);
  }

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(width, 0);
  entete.writeUInt32BE(height, 4);
  entete[8] = 8; // 8 bits par canal
  entete[9] = 6; // RVB + alpha
  entete[10] = 0; // compression deflate
  entete[11] = 0; // filtre adaptatif standard
  entete[12] = 0; // non entrelacé

  writeFileSync(
    chemin,
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', entete),
      chunk('IDAT', deflateSync(brut, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

export default { lirePng, ecrirePng };
