// verifier-reclamations.js — PREUVE du bloc D (doublons et « réclamer ma fiche »).
//
// ⚠️ Mis à jour le 27/11 avec le correctif de sécurité : la demande n'est PLUS jamais
// acceptée automatiquement sur la foi de coordonnées GPS envoyées par le client.
//
// CE QU'ON VÉRIFIE, sur la BASE RÉELLE et via les VRAIS routeurs :
//   1. une demande de reprise, MÊME À 45 m DE LA FICHE, entre en file d'attente (202)
//      et ne modifie RIEN tant qu'un humain n'a pas tranché ;
//   2. le message renvoyé annonce l'examen « sous 24h » ; un second appel est idempotent ;
//   3. le back-office liste les demandes (`GET /api/admin/demandes-revendication`),
//      les VALIDE (rattachement de la fiche existante, aucune copie, aucun écrasement)
//      ou les REJETTE (la fiche reste réclamable, motif conservé) ;
//   4. une fiche DÉJÀ réclamée est refusée (409) ;
//   5. un DOUBLON EXACT (même nom normalisé à moins de 50 m) est refusé à la création (409),
//      alors qu'un commerce VOISIN au nom différent reste possible.
//
// TOUTES les données du test sont créées puis SUPPRIMÉES : fiches préfixées « ZZ TEST »,
// comptes de test et demandes de revendication associées. Le compte administrateur RÉEL
// n'est ni créé, ni modifié, ni utilisé : un compte admin jetable sert à la file
// d'attente, puis il est supprimé.
//
// Lancement (depuis /backend) : node scripts/verifier-reclamations.js

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import establishmentsRouter from '../src/routes/establishments.js';
import usersRouter from '../src/routes/users.js';
import adminRouter from '../src/routes/admin.js';
import Establishment from '../src/models/Establishment.js';
import User from '../src/models/User.js';
import DemandeRevendication from '../src/models/DemandeRevendication.js';
import { normalizePhone } from '../src/utils/validators.js';
import { errorHandler, notFound } from '../src/middleware/errorHandler.js';

const PORT = Number(process.env.PORT_VERIFICATION_RECLAMATIONS) || 4109;
const BASE = `http://127.0.0.1:${PORT}`;
const PREFIXE_TEST = 'ZZ TEST';

// Positions RÉELLES : le Plateau d'Abidjan, et 45 m à côté (un gérant devant sa porte).
const POSITION_FICHE = { lat: 5.3242, lng: -4.0206 };
const POSITION_SUR_PLACE = { lat: 5.3246, lng: -4.0206 }; // ~45 m de la fiche
const POSITION_LOIN = { lat: 5.35, lng: -4.07 }; // Yopougon : ~6 km

const MOT_DE_PASSE = 'MotdepasseTest1';

let reussis = 0;
const echecs = [];
function verifier(libelle, ok, detail = '') {
  if (ok) {
    reussis += 1;
    console.log(`  ✓ ${libelle}${detail ? ` — ${detail}` : ''}`);
  } else {
    echecs.push(libelle);
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/api/establishments', establishmentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);
// Même contrat d'erreur qu'en production : sans ces deux middlewares, les refus
// sortiraient en HTML et les tests ne vérifieraient pas le vrai format `{ error, details }`.
app.use(notFound);
app.use(errorHandler);
const serveur = app.listen(PORT);

/** Appel HTTP JSON : renvoie { statut, corps }. */
async function appel(chemin, { methode = 'GET', token = null, corps = null } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: {
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    donnees = null;
  }
  return { statut: reponse.status, corps: donnees };
}

/**
 * Crée un compte de test par la VRAIE route d'inscription (qui rend déjà un jeton) et
 * rend `{ token, id, statuts }`. Pour l'administrateur, on ouvre le compte puis on le
 * marque `estAdmin` — comme le ferait l'équipe — et on se connecte par `/api/admin/login`
 * pour éprouver le vrai chemin d'authentification du back-office.
 */
async function creerCompte(telephone, prenom, { admin = false } = {}) {
  // Même normaliseur que l'API : le numéro réellement stocké est celui-là.
  const enregistre = normalizePhone(telephone) || telephone;
  // Un passage interrompu ne doit pas fausser la mesure : on repart d'un état propre.
  await User.deleteMany({ telephone: enregistre });

  const inscription = await appel('/api/users/register', {
    methode: 'POST',
    corps: { telephone: enregistre, motDePasse: MOT_DE_PASSE, prenom, nom: 'Test D' },
  });
  const id = inscription.corps?.user?.id || null;
  if (!admin) return { token: inscription.corps?.token || null, id, statuts: `inscription ${inscription.statut}` };

  if (id) await User.updateOne({ _id: id }, { $set: { estAdmin: true } });
  const connexion = await appel('/api/admin/login', {
    methode: 'POST',
    corps: { identifiant: enregistre, motDePasse: MOT_DE_PASSE },
  });
  return {
    token: connexion.corps?.token || null,
    id,
    statuts: `inscription ${inscription.statut}, connexion admin ${connexion.statut}`,
  };
}

/** Fiche de test, écrite directement en base (comme le fait l'import des fiches publiques). */
function creerFiche(nom, position, { reclame = false } = {}) {
  return Establishment.create({
    nom,
    categorie: 'alimentation',
    description: 'Fiche technique temporaire — vérification des réclamations.',
    tags: ['Attiéké', 'Café serré', 'Baguette'],
    localisation: position,
    quartier: 'Plateau',
    commune: 'Abidjan',
    telephone: '0700000000',
    estImporte: true,
    reclame,
    sourceImport: 'test-verifier-reclamations',
  });
}

async function principal() {
  console.log('\n▶ Doublons et « réclamer ma fiche » (bloc D)');
  const connecte = await connectDB({ reessais: false, silencieux: true });
  if (!connecte) {
    console.error('  ✗ MongoDB indisponible : renseignez MONGODB_URI dans backend/.env.');
    return;
  }

  const fichesCreees = [];
  const comptesCrees = [];

  try {
    // ── Données de test ──────────────────────────────────────────────────────
    const ficheProche = await creerFiche(`${PREFIXE_TEST} KIOSQUE AWA`, POSITION_FICHE);
    const ficheLoin = await creerFiche(`${PREFIXE_TEST} KIOSQUE LOIN`, POSITION_LOIN);
    const ficheLoin2 = await creerFiche(`${PREFIXE_TEST} KIOSQUE LOIN 2`, POSITION_LOIN);
    const fichePrise = await creerFiche(`${PREFIXE_TEST} KIOSQUE PRIS`, POSITION_FICHE, { reclame: true });
    fichesCreees.push(ficheProche, ficheLoin, ficheLoin2, fichePrise);

    const telProche = '+2250700000001';
    const telLoin = '+2250700000002';
    const telAdmin = '+2250700000003';
    // Comptes créés un par un : trois inscriptions simultanées n'apportent rien et
    // brouillent la lecture du limiteur anti-abus des routes d'authentification.
    const compteProche = await creerCompte(telProche, 'Awa');
    const compteLoin = await creerCompte(telLoin, 'Bakary');
    const compteAdmin = await creerCompte(telAdmin, 'AdminTest', { admin: true });
    const tokenProche = compteProche.token;
    const tokenLoin = compteLoin.token;
    const tokenAdmin = compteAdmin.token;
    comptesCrees.push(...[compteProche, compteLoin, compteAdmin].map((c) => c.id).filter(Boolean));
    verifier(
      'les comptes de test se connectent (dont un administrateur jetable)',
      Boolean(tokenProche && tokenLoin && tokenAdmin),
      [compteProche, compteLoin, compteAdmin].map((c) => c.statuts).join(' | ')
    );

    // ── 1) « C'est votre établissement ? » ───────────────────────────────────
    console.log('\n  1) La fiche voisine non réclamée est proposée au nouveau venu');
    const recherche = await appel(
      `/api/establishments/rapprochement?nom=Kiosque%20Awa&lat=${POSITION_SUR_PLACE.lat}&lng=${POSITION_SUR_PLACE.lng}`,
      { token: tokenProche }
    );
    const candidat = (recherche.corps?.candidats || []).find((c) => c.id === String(ficheProche._id));
    verifier('la fiche importée voisine est proposée', Boolean(candidat), `${recherche.corps?.candidats?.length || 0} candidat(s)`);
    verifier(
      'la distance annoncée est celle du terrain (≈ 45 m)',
      Boolean(candidat) && candidat.distanceMetres <= 150 && candidat.distanceMetres >= 20,
      candidat ? `${candidat.distanceMetres} m` : 'absente'
    );

    // ── 2) AUCUNE acceptation automatique, MÊME à 45 m de la fiche ───────────
    console.log('\n  2) Gérant sur place (≤ 150 m) : demande EN ATTENTE, pas d’attribution');
    const avant = await Establishment.countDocuments({ nom: new RegExp(`^${PREFIXE_TEST}`) });
    const reclamationProche = await appel(`/api/establishments/${ficheProche._id}/reclamer`, {
      methode: 'POST',
      token: tokenProche,
      corps: { ...POSITION_SUR_PLACE, nomDeclare: 'Kiosque Awa' },
    });
    const apres = await Establishment.countDocuments({ nom: new RegExp(`^${PREFIXE_TEST}`) });
    const ficheProcheApres = await Establishment.findById(ficheProche._id).lean();
    const compteProcheEnBase = await User.findById(compteProche.id).select('etablissementId').lean();
    const demandeProche = await DemandeRevendication.findOne({
      etablissementId: ficheProche._id,
      userId: compteProche.id,
    }).lean();
    verifier(
      'la revendication est mise en attente, jamais acceptée d’office',
      reclamationProche.statut === 202 && reclamationProche.corps?.statut === 'en_attente',
      `HTTP ${reclamationProche.statut}`
    );
    verifier(
      'le message annonce l’examen sous 24 h',
      /sous 24h/.test(String(reclamationProche.corps?.message || '')),
      reclamationProche.corps?.message || 'absent'
    );
    verifier(
      'la fiche n’est PAS rattachée par la simple déclaration GPS',
      ficheProcheApres.reclame === false && !ficheProcheApres.createdByUserId
    );
    verifier('le compte ne pointe PAS encore sur la fiche', !compteProcheEnBase?.etablissementId);
    verifier('AUCUNE nouvelle fiche n’a été créée (pas de doublon)', avant === apres, `${avant} → ${apres}`);
    verifier(
      'la demande est tracée dans DemandeRevendication (en_attente)',
      demandeProche?.statut === 'en_attente',
      demandeProche ? String(demandeProche._id) : 'absente'
    );

    // Second appel identique : idempotent (une seule demande en attente par fiche).
    await appel(`/api/establishments/${ficheProche._id}/reclamer`, {
      methode: 'POST',
      token: tokenProche,
      corps: { ...POSITION_SUR_PLACE, nomDeclare: 'Kiosque Awa' },
    });
    verifier(
      'un second appel ne crée pas de doublon de demande',
      (await DemandeRevendication.countDocuments({ etablissementId: ficheProche._id })) === 1
    );

    // ── 3) Un utilisateur À DISTANCE n'écrase rien : il entre dans la file ───
    console.log('\n  3) Gérant à distance : demande EN ATTENTE, rien n’est modifié');
    // Le demandeur est au PLATEAU, la fiche est à Yopougon (~6 km) : trop loin pour
    // décider à sa place, c'est justement le cas « une personne doit trancher ».
    const reclamationLoin = await appel(`/api/establishments/${ficheLoin._id}/reclamer`, {
      methode: 'POST',
      token: tokenLoin,
      corps: { ...POSITION_FICHE, nomDeclare: 'Kiosque Loin' },
    });
    const ficheLoinApres = await Establishment.findById(ficheLoin._id).lean();
    verifier(
      'la demande part en file d’attente (202)',
      reclamationLoin.statut === 202 && reclamationLoin.corps?.statut === 'en_attente',
      `HTTP ${reclamationLoin.statut}`
    );
    verifier('la fiche n’est PAS réclamée tant que personne n’a tranché', ficheLoinApres.reclame === false);
    verifier(
      'la distance déclarée est conservée (indication, jamais une preuve)',
      ficheLoinApres.reclamation?.distanceMetres > 1000,
      `${ficheLoinApres.reclamation?.distanceMetres} m`
    );

    // Deuxième demande à distance, pour tester le REFUS de l'équipe.
    await appel(`/api/establishments/${ficheLoin2._id}/reclamer`, {
      methode: 'POST',
      token: tokenLoin,
      corps: { ...POSITION_FICHE, nomDeclare: 'Kiosque Loin 2' },
    });

    // ── 4) La file d'attente du back-office ─────────────────────────────────
    console.log('\n  4) Back-office : file des demandes, puis une décision humaine');
    const sansJeton = await appel('/api/admin/demandes-revendication');
    verifier(
      'la file d’attente exige un administrateur (401 sans jeton)',
      sansJeton.statut === 401,
      `HTTP ${sansJeton.statut}`
    );

    const file = await appel('/api/admin/demandes-revendication', { token: tokenAdmin });
    const lignes = file.corps?.demandes || [];
    const ligneProche = lignes.find((l) => l.etablissementId === String(ficheProche._id));
    const ligneLoin = lignes.find((l) => l.etablissementId === String(ficheLoin._id));
    const ligneLoin2 = lignes.find((l) => l.etablissementId === String(ficheLoin2._id));
    verifier(
      'les trois demandes en attente sont dans la file',
      Boolean(ligneProche && ligneLoin && ligneLoin2),
      `${lignes.length} ligne(s)`
    );
    verifier(
      'chaque ligne porte de quoi décider (nom déclaré, distance, demandeur)',
      Boolean(ligneLoin?.nomDeclare) &&
        ligneLoin?.distanceDeclareeMetres > 1000 &&
        Boolean(ligneLoin?.demandeur?.telephone),
      ligneLoin ? `${ligneLoin.nomDeclare}, ${ligneLoin.distanceDeclareeMetres} m` : 'absente'
    );

    const acceptation = await appel(
      `/api/admin/demandes-revendication/${ligneProche?.id}/valider`,
      { methode: 'PATCH', token: tokenAdmin }
    );
    const ficheProcheValidee = await Establishment.findById(ficheProche._id).lean();
    const compteProcheValide = await User.findById(compteProche.id).select('etablissementId').lean();
    verifier(
      'valider rattache la fiche existante au demandeur',
      acceptation.corps?.reclame === true &&
        ficheProcheValidee.reclame === true &&
        String(ficheProcheValidee.createdByUserId) === String(compteProche.id)
    );
    verifier(
      'le compte pointe sur la fiche',
      String(compteProcheValide?.etablissementId) === String(ficheProche._id)
    );
    verifier(
      'la fiche garde ses informations publiques (aucun écrasement)',
      ficheProcheValidee.sourceImport === 'test-verifier-reclamations' &&
        ficheProcheValidee.tags.length === 3
    );
    const revalidation = await appel(
      `/api/admin/demandes-revendication/${ligneProche?.id}/valider`,
      { methode: 'PATCH', token: tokenAdmin }
    );
    verifier(
      'une demande déjà validée ne peut pas être revalidée (409)',
      revalidation.statut === 409,
      `HTTP ${revalidation.statut}`
    );

    const refus = await appel(`/api/admin/demandes-revendication/${ligneLoin2?.id}/rejeter`, {
      methode: 'PATCH',
      token: tokenAdmin,
      corps: { noteAdmin: 'Nom différent de la fiche' },
    });
    const ficheLoin2Refusee = await Establishment.findById(ficheLoin2._id).lean();
    const demandeLoin2 = await DemandeRevendication.findById(ligneLoin2?.id).lean();
    verifier(
      'rejeter laisse la fiche réclamable',
      refus.corps?.demande?.statut === 'rejetee' && ficheLoin2Refusee.reclame === false
    );
    verifier(
      'le motif du rejet est conservé',
      demandeLoin2?.noteAdmin === 'Nom différent de la fiche',
      demandeLoin2?.noteAdmin || 'absent'
    );

    const idInvalide = await appel('/api/admin/demandes-revendication/pas-un-id/valider', {
      methode: 'PATCH',
      token: tokenAdmin,
    });
    verifier(
      'un identifiant de demande invalide est refusé (400)',
      idInvalide.statut === 400,
      `HTTP ${idInvalide.statut}`
    );

    // ── 5) Fiche DÉJÀ réclamée : refusée ────────────────────────────────────
    console.log('\n  5) Fiche déjà réclamée : refusée');
    const dejaPrise = await appel(`/api/establishments/${fichePrise._id}/reclamer`, {
      methode: 'POST',
      token: tokenProche,
      corps: { ...POSITION_SUR_PLACE },
    });
    verifier('réclamer une fiche déjà réclamée est refusé (409)', dejaPrise.statut === 409, `HTTP ${dejaPrise.statut}`);
    // ── 6) Doublon exact : création refusée ─────────────────────────────────
    console.log('\n  6) Doublon exact (même nom à moins de 50 m) : création refusée');
    const nouvelleFiche = await appel('/api/establishments', {
      methode: 'POST',
      token: tokenLoin,
      corps: {
        nom: `${PREFIXE_TEST} Kiosque Awa`,
        categorie: 'alimentation',
        description: 'Tentative de doublon.',
        tags: ['Attiéké', 'Baguette', 'Café serré'],
        localisation: { lat: POSITION_FICHE.lat + 0.0001, lng: POSITION_FICHE.lng },
        quartier: 'Plateau',
        commune: 'Abidjan',
        telephone: '0700000002',
      },
    });
    verifier('la création est refusée (409) au lieu de créer une seconde fiche', nouvelleFiche.statut === 409, `HTTP ${nouvelleFiche.statut}`);
    verifier(
      'le refus propose de REPRENDRE la fiche existante',
      nouvelleFiche.corps?.details?.reprisePossible === true,
      String(nouvelleFiche.corps?.error || '')
    );
    verifier(
      'aucune fiche n’a été ajoutée en base',
      (await Establishment.countDocuments({ nom: new RegExp(`^${PREFIXE_TEST}`) })) === 4
    );

    // Contrôle INVERSE : un commerce VOISIN au nom différent reste possible (deux commerces
    // peuvent voisiner) — sans quoi le garde-fou bloquerait de vraies inscriptions.
    const autreCommerce = await appel('/api/establishments', {
      methode: 'POST',
      token: tokenLoin,
      corps: {
        nom: `${PREFIXE_TEST} POISSONNERIE DU COIN`,
        categorie: 'alimentation',
        description: 'Commerce voisin, nom différent.',
        tags: ['Poisson braisé', 'Attiéké', 'Baguette'],
        localisation: { lat: POSITION_FICHE.lat + 0.0002, lng: POSITION_FICHE.lng },
        quartier: 'Plateau',
        commune: 'Abidjan',
        telephone: '0700000002',
      },
    });
    if (autreCommerce.corps?.etablissement?.id) fichesCreees.push({ _id: autreCommerce.corps.etablissement.id });
    verifier('un commerce VOISIN au nom différent n’est pas bloqué', autreCommerce.statut === 201, `HTTP ${autreCommerce.statut}`);
  } finally {
    // ── Nettoyage : rien ne doit rester de ce test en base ──────────────────
    const ids = fichesCreees.map((f) => f._id).filter(Boolean);
    const { deletedCount } = await Establishment.deleteMany({ _id: { $in: ids } }).catch(() => ({ deletedCount: 0 }));
    // Demandes de revendication liées aux fiches de test (collection ajoutée le 27/11).
    const { deletedCount: demandesSupprimees } = await DemandeRevendication.deleteMany({
      etablissementId: { $in: ids },
    }).catch(() => ({ deletedCount: 0 }));
    // Comptes : suppression par identifiant, PLUS un filet sur les numéros de test
    // (0700000001/2/3) pour qu'un passage interrompu ne laisse rien derrière lui.
    const { deletedCount: comptesSupprimes } = await User.deleteMany({
      $or: [{ _id: { $in: comptesCrees } }, { telephone: { $regex: '070000000[123]$' } }],
    }).catch(() => ({ deletedCount: 0 }));
    const reste = await Establishment.countDocuments({ nom: new RegExp(`^${PREFIXE_TEST}`) }).catch(() => 0);
    console.log(
      `\n  Nettoyage : ${deletedCount} fiche(s), ${comptesSupprimes} compte(s) et ${demandesSupprimees} demande(s) de test supprimés.`
    );
    console.log(`  Fiches « ${PREFIXE_TEST} » restantes : ${reste}.`);

    console.log(`\n${'─'.repeat(72)}`);
    console.log(`  Résultat : ${reussis} vérification(s) réussie(s), ${echecs.length} échec(s)`);
    for (const e of echecs) console.log(`   • ${e}`);
    console.log('');
    process.exitCode = echecs.length === 0 ? 0 : 1;

    serveur.close();
    serveur.closeAllConnections?.();
    await mongoose.disconnect().catch(() => {});
  }
}

principal().catch((err) => {
  console.error('❌ Échec du script :', err.message);
  process.exitCode = 1;
});

