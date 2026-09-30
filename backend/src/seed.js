// seed.js — Jeu de données de démonstration (Abidjan) pour tester l'app sans
// attendre la collecte terrain. Lancement : `npm run seed` dans /backend.
//
// Décision produit : les photos de démo pointent vers picsum.photos (léger, pas
// d'authentification). À remplacer par de vraies photos d'établissements lors de
// la tournée terrain. Le frontend retombe sur un dégradé local si une image ne
// charge pas (connexions lentes), donc aucune image cassée visible.
//
// Ce script VIDE les collections puis les recrée : ne jamais le lancer en production.

import 'dotenv/config';
import { connectDB, disconnectDB } from './config/db.js';
import Establishment from './models/Establishment.js';
import HealthFacility from './models/HealthFacility.js';
import Job from './models/Job.js';
import User from './models/User.js';
import Subscription from './models/Subscription.js';
import { ABONNEMENT } from './config/abonnement.js';

const photo = (seed) => `https://picsum.photos/seed/${seed}/700/460`;
const portrait = (seed) => `https://picsum.photos/seed/${seed}/320/320`;

const ETABLISSEMENTS = [
  {
    nom: 'Chez Fatou',
    categorie: 'alimentation',
    description: 'Maquis populaire, plats du jour et attiéké poisson braisé.',
    quartier: 'Angré 8e tranche',
    commune: 'Cocody',
    lat: 5.4045,
    lng: -3.9765,
    telephone: '+2250707123456',
    horaires: 'Tous les jours 10h - 23h',
    tags: ['Attiéké', 'Poisson braisé', 'Spaghetti', 'Jus naturels', 'Café au lait'],
    noteMoyenne: 4.6,
    nombreAvis: 128,
    compteurVisites: 4820,
    compteurUtilisateurs: 317,
    verifie: true,
  },
  {
    nom: 'Kiosque Emma',
    categorie: 'commerce',
    description: 'Kiosque de quartier : café serré, rognon, petit pois, cigarettes.',
    quartier: 'Rue des Jardins',
    commune: 'Adjamé',
    lat: 5.3609,
    lng: -4.0247,
    telephone: '+2250708554433',
    horaires: 'Lun - Sam 5h30 - 20h',
    tags: ['Café serré', 'Café au lait', 'Rognon', 'Petit pois', 'Biscuits'],
    noteMoyenne: 4.3,
    nombreAvis: 64,
    compteurVisites: 2110,
    compteurUtilisateurs: 143,
  },
  {
    nom: 'Boulangerie Le Pain Doré',
    categorie: 'alimentation',
    description: 'Pain frais toutes les 4 heures, viennoiseries le matin.',
    quartier: 'Zone 4',
    commune: 'Marcory',
    lat: 5.2992,
    lng: -3.9869,
    telephone: '+2250709221188',
    horaires: 'Tous les jours 5h - 21h',
    tags: ['Baguette', 'Croissant', 'Pain au chocolat', 'Gâteau', 'Pain de mie'],
    noteMoyenne: 4.7,
    nombreAvis: 203,
    compteurVisites: 6390,
    compteurUtilisateurs: 505,
    verifie: true,
  },
  {
    nom: 'Salon Beauté Awa',
    categorie: 'beaute',
    description: 'Tresses, brushing et soins capillaires à domicile ou au salon.',
    quartier: 'Sicogi',
    commune: 'Yopougon',
    lat: 5.3364,
    lng: -4.0721,
    telephone: '+2250706332211',
    horaires: 'Lun - Dim 8h - 20h',
    tags: ['Tresses', 'Brushing', 'Coupe', 'Soin capillaire', 'Manucure'],
    noteMoyenne: 4.8,
    nombreAvis: 91,
    compteurVisites: 3320,
    compteurUtilisateurs: 268,
  },
  {
    nom: 'Atelier Kouassi Menuiserie',
    categorie: 'artisanat',
    description: 'Meubles sur mesure, portes, lits et réparations en bois.',
    quartier: 'Gesco',
    commune: 'Yopougon',
    lat: 5.3448,
    lng: -4.0853,
    telephone: '+2250704887766',
    horaires: 'Lun - Sam 7h30 - 18h',
    tags: ['Meubles sur mesure', 'Portes', 'Lits', 'Réparation', 'Placards'],
    noteMoyenne: 4.5,
    nombreAvis: 47,
    compteurVisites: 1620,
    compteurUtilisateurs: 118,
  },
  {
    nom: 'Église Nouvelle Alliance',
    categorie: 'spiritualite',
    description: 'Cultes du dimanche, chorale et réunions de prière.',
    quartier: 'Riviera 3',
    commune: 'Cocody',
    lat: 5.3663,
    lng: -3.9451,
    telephone: '+2250701556677',
    horaires: 'Dim 8h - 12h, Mer 18h',
    tags: ['Culte', 'Chorale', 'Prière', 'Jeunesse', 'Catéchèse'],
    noteMoyenne: 4.9,
    nombreAvis: 76,
    compteurVisites: 2980,
    compteurUtilisateurs: 190,
  },
  {
    nom: 'Garage Méca Express',
    categorie: 'services',
    description: 'Vidange, freins, diagnostic et dépannage sur route.',
    quartier: 'Vridi',
    commune: 'Port-Bouët',
    lat: 5.2564,
    lng: -4.0012,
    telephone: '+2250703778899',
    horaires: 'Lun - Sam 8h - 19h',
    tags: ['Vidange', 'Freins', 'Diagnostic', 'Dépannage', 'Pneumatique'],
    noteMoyenne: 4.1,
    nombreAvis: 58,
    compteurVisites: 1870,
    compteurUtilisateurs: 132,
  },
  {
    nom: 'Couture Madame Binta',
    categorie: 'artisanat',
    description: 'Wax, kente, tenues de cérémonie et retouches rapides.',
    quartier: 'Belleville',
    commune: 'Adjamé',
    lat: 5.3556,
    lng: -4.0312,
    telephone: '+2250702990011',
    horaires: 'Lun - Sam 9h - 19h',
    tags: ['Wax', 'Kente', 'Tenue de cérémonie', 'Retouche', 'Uniforme'],
    noteMoyenne: 4.6,
    nombreAvis: 112,
    compteurVisites: 4015,
    compteurUtilisateurs: 289,
  },
];

// ── Pharmacies & Cliniques (§6) : AUCUNE note, AUCUN avis, uniquement statut de garde ──
const SANTE = [
  { nom: 'Pharmacie de la Paix', type: 'pharmacie', quartier: 'Plateau', commune: 'Plateau', lat: 5.3242, lng: -4.0186, telephone: '+2250708990011', horaires: '24h/24', deGarde: true },
  { nom: 'Pharmacie Sainte-Marie', type: 'pharmacie', quartier: 'Cocody Centre', commune: 'Cocody', lat: 5.3489, lng: -3.9885, telephone: '+2250708112233', horaires: '8h - 22h', deGarde: false },
  { nom: 'Pharmacie du Bon Samaritain', type: 'pharmacie', quartier: 'Sicogi', commune: 'Yopougon', lat: 5.3382, lng: -4.0754, telephone: '+2250708445566', horaires: '8h - 20h', deGarde: true },
  { nom: 'Pharmacie de la Riviera', type: 'pharmacie', quartier: 'Riviera Palmeraie', commune: 'Cocody', lat: 5.3702, lng: -3.9489, telephone: '+2250708778899', horaires: '8h - 21h', deGarde: false },
  { nom: 'Clinique Sainte-Anne', type: 'clinique', quartier: 'Marcory Résidentiel', commune: 'Marcory', lat: 5.3031, lng: -3.9932, telephone: '+2250709223344', horaires: 'Urgences 24h/24', deGarde: true },
  { nom: 'Clinique Médicale du Plateau', type: 'clinique', quartier: 'Plateau', commune: 'Plateau', lat: 5.3218, lng: -4.0231, telephone: '+2250709556677', horaires: 'Lun - Sam 7h - 20h', deGarde: false },
  { nom: 'Centre de Santé Abobo Baoulé', type: 'clinique', quartier: 'Abobo Baoulé', commune: 'Abobo', lat: 5.4187, lng: -4.0204, telephone: '+2250709889900', horaires: 'Lun - Dim 7h - 21h', deGarde: false },
  { nom: 'Clinique Espoir Koumassi', type: 'clinique', quartier: 'Koumassi Grand Marché', commune: 'Koumassi', lat: 5.2964, lng: -3.9512, telephone: '+2250709334455', horaires: 'Urgences 24h/24', deGarde: true },
];

const BESOINS = [
  // ―― Offres de boulot (page Jobs, sous-onglet « offres de boulot ») ――
  { typeAnnonce: 'offre', metier: 'Chauffeur', intitule: 'Chauffeur livreur (temps plein)', description: 'Livraisons dans Abidjan pour une quincaillerie. Permis B exigé, poste stable.', commune: 'Marcory', quartier: 'Zone 4', lat: 5.3005, lng: -3.9862, urgence: false, budgetFcfa: 120000, duree: 'CDI', segment: 'specialise', nom: 'Quincaillerie Ivoire' },
  { typeAnnonce: 'offre', metier: 'Cuisinier', intitule: 'Cuisinière pour un maquis', description: 'Tous les jours de 9h à 15h : plats du jour d’un maquis à Angré.', commune: 'Cocody', quartier: 'Angré', lat: 5.4048, lng: -3.977, urgence: false, budgetFcfa: 90000, duree: 'CDI', segment: 'journalier', nom: 'Chez Fatou' },
  { typeAnnonce: 'offre', metier: 'Vendeur', intitule: 'Vendeuse en boutique', description: 'Boutique de pagne au marché : accueil, encaissement, tenue des stocks.', commune: 'Adjamé', quartier: 'Liberté', lat: 5.3596, lng: -4.0224, urgence: false, budgetFcfa: 80000, duree: 'CDD 6 mois', segment: 'specialise', nom: 'Boutique Adjamé Centre' },
  { metier: 'Électricien', description: 'Installation de 12 prises et d’un tableau électrique dans une villa en finition.', commune: 'Cocody', quartier: 'Angré 9e tranche', lat: 5.4068, lng: -3.9721, urgence: true, budgetFcfa: 45000, duree: '3 jours', segment: 'specialise', nom: 'M. Yao' },
  { metier: 'Journalier', description: 'Besoin de 4 journaliers pour décharger un camion de ciment demain matin 6h.', commune: 'Adjamé', quartier: 'Liberté', lat: 5.3612, lng: -4.0229, urgence: true, budgetFcfa: 5000, duree: '1 journée', segment: 'journalier', nom: 'Mme Traoré' },
  { metier: 'Plombier', description: 'Fuite d’eau sous l’évier de la cuisine et remplacement du siphon.', commune: 'Marcory', quartier: 'Zone 4', lat: 5.2989, lng: -3.9881, urgence: false, budgetFcfa: 15000, duree: '1 journée', segment: 'specialise', nom: 'M. Koné' },
  { metier: 'Couturier', description: 'Confection de 6 tenues en wax pour un mariage dans 3 semaines.', commune: 'Yopougon', quartier: 'Niangon', lat: 5.3298, lng: -4.0817, urgence: false, budgetFcfa: 60000, duree: '3 semaines', segment: 'specialise', nom: 'Mme Diomandé' },
  { metier: 'Maçon', description: 'Montage d’un mur de clôture de 20 mètres, matériaux déjà sur place.', commune: 'Abobo', quartier: 'Abobo Sagbé', lat: 5.4211, lng: -4.0148, urgence: false, budgetFcfa: 80000, duree: '1 semaine', segment: 'specialise', nom: 'M. Gbagbo' },
  { metier: 'Ménagère / Repassage', description: 'Aide ménagère 3 fois par semaine, matin, quartier Marcory.', commune: 'Marcory', quartier: 'Biétry', lat: 5.2902, lng: -3.9795, urgence: false, budgetFcfa: 4000, duree: 'Long terme', segment: 'journalier', nom: 'Mme Kouadio' },
];

async function lancer() {
  const connecte = await connectDB();
  if (!connecte) {
    console.error(
      "❌ MongoDB injoignable. Démarrez un serveur MongoDB (local ou Atlas) et renseignez MONGODB_URI, puis relancez `npm run seed`."
    );
    process.exitCode = 1;
    return;
  }

  console.log('🧹 Nettoyage des collections…');
  await Promise.all([
    User.deleteMany({}),
    Establishment.deleteMany({}),
    HealthFacility.deleteMany({}),
    Job.deleteMany({}),
    Subscription.deleteMany({}),
  ]);

  // ── Comptes de démonstration (téléphone + mot de passe) ──
  // Un seul type de compte (ajout du 29/09) : les capacités `estArtisan` /
  // `chercheTravail` remplacent l'ancien `typeCompte`.
  const motDePasseHash = await User.hashMotDePasse('motdepasse');
  const [artisan, client] = await User.create([
    {
      telephone: '+2250700000001',
      nom: 'Kouassi',
      prenom: 'Jean',
      motDePasseHash,
      estArtisan: true,
      chercheTravail: true,
      metier: 'Électricien',
      segment: 'specialise',
      bio: 'Électricien bâtiment, 12 ans d’expérience, dépannage rapide.',
      photoProfil: portrait('ouvrier-jean'),
      commune: 'Cocody',
      quartier: 'Angré',
      localisation: { lat: 5.4045, lng: -3.9765 },
      noteMoyenne: 4.7,
      nombreAvis: 34,
    },
    {
      telephone: '+2250700000002',
      nom: 'Yao',
      prenom: 'Aké',
      motDePasseHash,
      // Compte unifié : pas de « type de compte », juste des capacités. Ce compte
      // n'est pas artisan (il ne propose pas de service) mais peut chercher du travail.
      estArtisan: false,
      chercheTravail: true,
      commune: 'Marcory',
      quartier: 'Zone 4',
      localisation: { lat: 5.2992, lng: -3.9869 },
    },
    // Deuxième artisan, SANS abonnement : permet de voir la différence de tri
    // entre « profil mis en avant » (abonné) et profil classique dans l'annuaire.
    {
      telephone: '+2250700000004',
      nom: 'Diomandé',
      prenom: 'Awa',
      motDePasseHash,
      estArtisan: true,
      chercheTravail: true,
      metier: 'Coiffeur',
      segment: 'specialise',
      bio: 'Coiffeuse à domicile : tresses, brushing et soins, sur rendez-vous à Yopougon.',
      photoProfil: portrait('artisan-awa'),
      commune: 'Yopougon',
      quartier: 'Sicogi',
      localisation: { lat: 5.3364, lng: -4.0721 },
      noteMoyenne: 4.9,
      nombreAvis: 21,
    },
  ]);

  // ── Abonnement de démonstration (page Jobs + mise en avant de l'artisan) ──
  // Le montant vient de config/abonnement.js : rien n'est écrit en dur ici.
  const abonnement = await Subscription.activerOuProlonger({
    userId: artisan._id,
    formule: ABONNEMENT.cle,
    montant: ABONNEMENT.prixFcfa,
    moyenPaiement: 'WAVE',
    transactionId: 'SEED-DEMO-ABONNEMENT',
  });

  // ── Établissements : 2 photos distinctes + tags (§5) ──
  const etablissements = await Establishment.create(
    ETABLISSEMENTS.map((e, i) => ({
      nom: e.nom,
      categorie: e.categorie,
      description: e.description,
      photoDevanture: photo(`${e.categorie}-devanture-${i}`),
      photoVendeur: photo(`${e.categorie}-vendeur-${i}`),
      tags: e.tags,
      localisation: { lat: e.lat, lng: e.lng },
      commune: e.commune,
      quartier: e.quartier,
      telephone: e.telephone,
      whatsapp: e.telephone,
      horaires: e.horaires,
      texteBoutonAction: `Aller chez ${e.nom}`,
      noteMoyenne: e.noteMoyenne || 0,
      nombreAvis: e.nombreAvis || 0,
      compteurVisites: e.compteurVisites || 0,
      compteurUtilisateurs: e.compteurUtilisateurs || 0,
      verifie: Boolean(e.verifie),
      createdByUserId: client._id,
    }))
  );

  // ── Santé : statut de garde seulement, jamais de note ──
  const sante = await HealthFacility.create(
    SANTE.map((s) => ({
      nom: s.nom,
      type: s.type,
      telephone: s.telephone,
      localisation: { lat: s.lat, lng: s.lng },
      commune: s.commune,
      quartier: s.quartier,
      horaires: s.horaires,
      deGarde: s.deGarde,
      deGardeUpdatedAt: new Date(),
      verifie: true,
      createdByUserId: client._id,
    }))
  );

  // ── Besoins de main-d'œuvre (poster est gratuit, §2) ──
  const jobs = await Job.create(
    BESOINS.map((b) => ({
      typeAnnonce: b.typeAnnonce || 'demande',
      intitule: b.intitule || '',
      metier: b.metier,
      description: b.description,
      localisation: { lat: b.lat, lng: b.lng },
      commune: b.commune,
      quartier: b.quartier,
      urgence: b.urgence,
      budgetFcfa: b.budgetFcfa,
      duree: b.duree,
      segment: b.segment,
      premierContactGratuit: b.segment === 'journalier',
      posteParUserId: client._id,
      nomPosteur: b.nom,
      telephoneContact: client.telephone,
    }))
  );

  console.log('');
  console.log('✅ Données de démonstration insérées :');
  console.log(`   • ${etablissements.length} établissements (2 photos + ≥3 tags chacun)`);
  console.log(`   • ${sante.length} pharmacies/cliniques (de garde : ${sante.filter((s) => s.deGarde).length})`);
  console.log(`   • ${jobs.length} annonces de boulot (offres : ${jobs.filter((j) => j.typeAnnonce === 'offre').length})`);
  console.log(`   • ${await User.countDocuments()} comptes unifiés, mot de passe « motdepasse » :`);
  console.log(`       - ${artisan.telephone} (artisan + abonnement en cours jusqu'au ${abonnement.finAt.toISOString().slice(0, 10)})`);
  console.log(`       - ${client.telephone} (cherche du travail, sans abonnement)`);
  console.log('       - +2250700000004 (artisane sans abonnement : comparaison du tri)');
  console.log('');

  await disconnectDB();
}

lancer().catch(async (err) => {
  console.error('❌ Échec du seed :', err);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});


