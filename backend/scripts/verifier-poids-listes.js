// verifier-poids-listes.js — PREUVE « aucune image base64 dans une liste » (bloc A).
//
// CONTEXTE : une photo d'établissement peut être stockée en data-URI base64
// (jusqu'à ~5,5 Mo de JSON). Tant que `GET /api/establishments` renvoyait le champ
// tel quel, UNE SEULE fiche inscrite depuis un téléphone faisait passer la page
// d'accueil de ~20 Ko à plusieurs mégaoctets : liste interminable à charger,
// voire jamais affichée sur un réseau lent.
//
// CE QUE CE SCRIPT PROUVE, sur la BASE RÉELLE et via le VRAI routeur :
//   1. une fiche portant une photo lourde est créée (puis supprimée en fin de test) ;
//   2. le JSON de la liste ne contient AUCUN « data:image » — jamais ;
//   3. cette fiche expose `photoDevanture: ''` + `photoDevantureUrl` ;
//   4. l'URL annoncée sert bien les octets de l'image (aller-retour complet) ;
//   5. le poids de la liste reste « léger » (Ko) au lieu du poids de l'image.
//
// La data-URI de test a une FORME valide (le stockage ne vérifie que la forme de la
// chaîne, pas le contenu de l'image). Ce que l'on mesure ici est le POIDS transporté
// et la présence ou non de base64 dans la réponse — pas le rendu de l'image.
//
// Écriture en base LIMITÉE à cette fiche de test, supprimée à la fin (même en cas
// d'échec). Aucune autre fiche n'est touchée. Lancement (depuis /backend) :
//   node scripts/verifier-poids-listes.js

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import establishmentsRouter from '../src/routes/establishments.js';
import Establishment from '../src/models/Establishment.js';

const NOM_TEST = 'ZZ TEST POIDS PHOTO (a supprimer)';
const PREFIXE_DATA_URI = 'data:image/jpeg;base64,';
const POIDS_IMAGE_VISE = 300 * 1024; // ~300 Ko d'image, comme une photo de téléphone réduite
const POIDS_LISTE_ACCEPTABLE = 120 * 1024; // au-delà, la page d'accueil est trop lourde

let reussis = 0;
const echecs = [];

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ✓ ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

const ko = (octets) => `${(octets / 1024).toFixed(1)} Ko`;

/** Fabrique une data-URI `image/jpeg` d'environ `octets` (forme valide, contenu de test). */
function dataUriLourde(octets) {
  const bloc = Buffer.alloc(3 * 1024, 0x5a);
  const parties = [];
  let cumul = 0;
  while (cumul < octets) {
    parties.push(bloc);
    cumul += bloc.length;
  }
  return `${PREFIXE_DATA_URI}${Buffer.concat(parties).toString('base64')}`;
}

const app = express();
app.use(express.json());
app.use('/api/establishments', establishmentsRouter);
const serveur = app.listen(0);
const origine = () => `http://127.0.0.1:${serveur.address().port}`;

async function principal() {
  console.log('\n▶ Poids des listes : aucune image base64 dans GET /api/establishments\n');

  const connecte = await connectDB({ reessais: false, silencieux: true });
  if (!connecte) {
    console.error('  ✗ MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    return;
  }

  let fiche = null;
  try {
    // ── 1) Fiche de test avec une photo LOURDE ──
    const photo = dataUriLourde(POIDS_IMAGE_VISE);
    fiche = await Establishment.create({
      nom: NOM_TEST,
      categorie: 'autre',
      description: 'Fiche technique temporaire — vérification du poids des listes.',
      photoDevanture: photo,
      photoVendeur: '',
      tags: ['test', 'technique', 'temporaire'],
      localisation: { lat: 5.3242, lng: -4.0206 },
      telephone: '+2250700000000',
      commune: 'Abidjan',
      quartier: 'Plateau',
    });
    console.log(`  Fiche de test créée  : ${fiche._id}`);
    console.log(`  Photo en base        : ${ko(photo.length)} de JSON pour ${ko(POIDS_IMAGE_VISE)} d'image\n`);

    // ── 2) La liste complète (60 fiches, comme le feed) ──
    const requete = new URLSearchParams({
      limit: '60',
      page: '1',
      diversite: '0',
      lat: '5.3242',
      lng: '-4.0206',
    });
    const reponse = await fetch(`${origine()}/api/establishments?${requete.toString()}`);
    const corps = await reponse.text();
    const donnees = JSON.parse(corps);

    verifier('la liste répond 200', reponse.status === 200, `HTTP ${reponse.status}`);
    verifier(
      'le corps de la liste ne contient AUCUN "data:image"',
      !corps.includes('data:image'),
      'du base64 a été trouvé dans la réponse'
    );

    const item = donnees.items.find((i) => String(i.id) === String(fiche._id));
    verifier('la fiche de test figure bien dans la liste', Boolean(item));
    if (item) {
      verifier(
        'photoDevanture ne transporte pas l’image (champ vide)',
        item.photoDevanture === '',
        `reçu : ${String(item.photoDevanture).slice(0, 40)}…`
      );
      verifier(
        'photoDevantureUrl est fournie',
        typeof item.photoDevantureUrl === 'string' &&
          item.photoDevantureUrl.endsWith(`/api/establishments/${fiche._id}/photo/devanture`),
        `reçu : ${item.photoDevantureUrl}`
      );
      verifier('photoVendeurUrl est vide (aucune photo vendeur)', item.photoVendeurUrl === '', `reçu : ${item.photoVendeurUrl}`);
    }

    // ── 3) Poids : liste « légère » vs poids de l'image ──
    const poidsItem = JSON.stringify(item || {}).length;
    console.log(`\n  Poids de la liste (60 fiches)  : ${ko(corps.length)}`);
    console.log(`  Poids de la fiche dans la liste : ${poidsItem} octets`);
    console.log(`  Poids de l'image seule          : ${ko(photo.length)}`);
    console.log(
      `  Poids AVANT ce correctif        : ≈ ${ko(corps.length + photo.length)} (l'image était dans le JSON)\n`
    );
    verifier(
      `la liste reste légère (< ${ko(POIDS_LISTE_ACCEPTABLE)})`,
      corps.length < POIDS_LISTE_ACCEPTABLE,
      `reçu : ${ko(corps.length)}`
    );
    verifier('l’image ne pèse plus dans la liste (fiche < 2 Ko)', poidsItem < 2048, `reçu : ${poidsItem} octets`);

    // ── 4) Aller-retour : l'URL annoncée sert bien les octets de l'image ──
    const reponsePhoto = await fetch(item.photoDevantureUrl);
    const octets = Buffer.from(await reponsePhoto.arrayBuffer());
    const cache = reponsePhoto.headers.get('cache-control') || '';
    verifier('la route photo répond 200', reponsePhoto.status === 200, `HTTP ${reponsePhoto.status}`);
    verifier(
      'la route photo renvoie un type image',
      String(reponsePhoto.headers.get('content-type') || '').startsWith('image/'),
      reponsePhoto.headers.get('content-type') || ''
    );
    verifier(
      'les octets renvoyés sont EXACTEMENT ceux de l’image stockée',
      octets.toString('base64') === photo.slice(PREFIXE_DATA_URI.length),
      `${octets.length} octets reçus`
    );
    verifier('la route photo est cacheable par le navigateur', /max-age=\d{3,}/.test(cache), cache);
    console.log(`  Photo servie à la demande      : ${ko(octets.length)} (cache : ${cache})`);

    console.log(`\n${'─'.repeat(72)}`);
    console.log(`  Résultat : ${reussis} vérification(s) réussie(s), ${echecs.length} échec(s)`);
    echecs.forEach((e) => console.log(`    ✗ ${e}`));
    console.log('');
  } finally {
    // ── Nettoyage : on ne laisse AUCUNE trace de test en base ──
    if (fiche) {
      await Establishment.deleteOne({ _id: fiche._id }).catch(() => {});
      const reste = await Establishment.countDocuments({ nom: NOM_TEST }).catch(() => 0);
      console.log(`  Fiche de test supprimée (restant en base : ${reste}).\n`);
    }
    serveur.close();
    await mongoose.disconnect().catch(() => {});
  }

  if (echecs.length) process.exitCode = 1;
}

principal().catch((err) => {
  console.error('❌ Vérification impossible :', err.message);
  process.exitCode = 1;
});
