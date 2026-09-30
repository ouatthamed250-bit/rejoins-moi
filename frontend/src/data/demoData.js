// demoData.js — Jeu de données de démonstration utilisé UNIQUEMENT quand l'API est
// injoignable (backend non démarré, MongoDB indisponible, réseau 3G perdu).
//
// Pourquoi c'est nécessaire : pendant la tournée terrain, l'app est testée dans des
// quartiers où le réseau tombe. Plutôt qu'un écran vide, on affiche ces profils
// réels-mais-fictifs d'Abidjan et un bandeau « mode démonstration » (voir
// EstablishmentCard / pages). Les coordonnées sont de vraies coordonnées
// d'Abidjan, donc le calcul de distance et le tri par proximité restent réalistes.

export const CATEGORIES = [
  { slug: 'tous', label: 'Tous', icone: 'grid' },
  { slug: 'alimentation', label: 'Alimentation', icone: 'utensils' },
  { slug: 'beaute', label: 'Beauté', icone: 'scissors' },
  { slug: 'services', label: 'Services', icone: 'tools' },
  { slug: 'artisanat', label: 'Artisanat', icone: 'hammer' },
  { slug: 'commerce', label: 'Commerce', icone: 'store' },
  { slug: 'sante', label: 'Santé', icone: 'heart' },
  { slug: 'spiritualite', label: 'Spiritualité', icone: 'church' },
  { slug: 'autre', label: 'Autre', icone: 'dot' },
];

/**
 * Tags proposés en bulles cliquables à l'inscription (§5), dépendants de la
 * catégorie choisie. Listes volontairement ancrées sur le vocabulaire local
 * (attiéké, garba, braisé, brosse...) plutôt que sur des termes génériques.
 */
export const TAGS_PAR_CATEGORIE = {
  alimentation: [
    'Attiéké',
    'Poisson braisé',
    'Poulet braisé',
    'Garba',
    'Spaghetti',
    'Café serré',
    'Café au lait',
    'Rognon',
    'Petit pois',
    'Baguette',
    'Croissant',
    'Jus naturels',
    'Glace',
    'Riz sauce graine',
  ],
  beaute: [
    'Tresses',
    'Brushing',
    'Coupe',
    'Soin capillaire',
    'Manucure',
    'Pédicure',
    'Maquillage',
    'Perruque',
    'Coloration',
    'Barbier',
  ],
  services: [
    'Vidange',
    'Freins',
    'Diagnostic',
    'Dépannage',
    'Pneumatique',
    'Lavage auto',
    'Transfert mobile money',
    'Photocopie',
    'Impression',
    'Retouche téléphone',
    'Cordonnerie',
  ],
  artisanat: [
    'Meubles sur mesure',
    'Portes',
    'Lits',
    'Placards',
    'Wax',
    'Kente',
    'Tenue de cérémonie',
    'Uniforme',
    'Soudure',
    'Carrelage',
    'Peinture',
    'Électricité',
    'Plomberie',
    'Maçonnerie',
  ],
  commerce: [
    'Café',
    'Sucre',
    'Biscuits',
    'Cigarettes',
    'Recharge crédit',
    'Savon',
    'Eau en sachet',
    'Boissons fraîches',
    'Pain',
    'Œufs',
  ],
  sante: ['Médicaments', 'Parapharmacie', 'Maternité', 'Urgences', 'Laboratoire'],
  spiritualite: ['Culte', 'Messe', 'Chorale', 'Prière', 'Jeunesse', 'Catéchèse'],
  autre: ['Autre service', 'À préciser'],
};

const photo = (seed, l = 700, h = 460) => `https://picsum.photos/seed/${seed}/${l}/${h}`;

/**
 * Établissements de démonstration.
 * Rappel §3 : `compteurVisites` et `compteurUtilisateurs` sont DEUX valeurs
 * indépendantes — ne jamais les additionner à l'affichage.
 */
export const ETABLISSEMENTS_DEMO = [
  {
    id: 'demo-chez-fatou',
    nom: 'Chez Fatou',
    categorie: 'alimentation',
    description: 'Maquis populaire, plats du jour et attiéké poisson braisé.',
    photoDevanture: photo('fatou-devanture'),
    photoVendeur: photo('fatou-vendeur', 320, 320),
    tags: ['Attiéké', 'Poisson braisé', 'Spaghetti', 'Jus naturels', 'Café au lait'],
    localisation: { lat: 5.4045, lng: -3.9765 },
    commune: 'Cocody',
    quartier: 'Angré 8e tranche',
    horaires: 'Tous les jours 10h - 23h',
    telephone: '+2250707123456',
    whatsapp: '+2250707123456',
    texteBoutonAction: 'Aller chez Chez Fatou',
    noteMoyenne: 4.6,
    nombreAvis: 128,
    compteurVisites: 4820,
    compteurUtilisateurs: 317,
    verifie: true,
  },
  {
    id: 'demo-kiosque-emma',
    nom: 'Kiosque Emma',
    categorie: 'commerce',
    description: 'Kiosque de quartier : café serré, rognon, petit pois, cigarettes.',
    photoDevanture: photo('emma-devanture'),
    photoVendeur: photo('emma-vendeur', 320, 320),
    tags: ['Café serré', 'Café au lait', 'Rognon', 'Petit pois', 'Biscuits'],
    localisation: { lat: 5.3609, lng: -4.0247 },
    commune: 'Adjamé',
    quartier: 'Rue des Jardins',
    horaires: 'Lun - Sam 5h30 - 20h',
    telephone: '+2250708554433',
    whatsapp: '+2250708554433',
    texteBoutonAction: 'Aller chez Kiosque Emma',
    noteMoyenne: 4.3,
    nombreAvis: 64,
    compteurVisites: 2110,
    compteurUtilisateurs: 143,
    verifie: false,
  },
  {
    id: 'demo-pain-dore',
    nom: 'Boulangerie Le Pain Doré',
    categorie: 'alimentation',
    description: 'Pain frais toutes les 4 heures, viennoiseries le matin.',
    photoDevanture: photo('pain-devanture'),
    photoVendeur: photo('pain-vendeur', 320, 320),
    tags: ['Baguette', 'Croissant', 'Pain au chocolat', 'Gâteau', 'Pain de mie'],
    localisation: { lat: 5.2992, lng: -3.9869 },
    commune: 'Marcory',
    quartier: 'Zone 4',
    horaires: 'Tous les jours 5h - 21h',
    telephone: '+2250709221188',
    whatsapp: '+2250709221188',
    texteBoutonAction: 'Aller chez Le Pain Doré',
    noteMoyenne: 4.7,
    nombreAvis: 203,
    compteurVisites: 6390,
    compteurUtilisateurs: 505,
    verifie: true,
  },
  {
    id: 'demo-salon-awa',
    nom: 'Salon Beauté Awa',
    categorie: 'beaute',
    description: 'Tresses, brushing et soins capillaires à domicile ou au salon.',
    photoDevanture: photo('awa-devanture'),
    photoVendeur: photo('awa-vendeur', 320, 320),
    tags: ['Tresses', 'Brushing', 'Coupe', 'Soin capillaire', 'Manucure'],
    localisation: { lat: 5.3364, lng: -4.0721 },
    commune: 'Yopougon',
    quartier: 'Sicogi',
    horaires: 'Lun - Dim 8h - 20h',
    telephone: '+2250706332211',
    whatsapp: '+2250706332211',
    texteBoutonAction: 'Aller chez Salon Beauté Awa',
    noteMoyenne: 4.8,
    nombreAvis: 91,
    compteurVisites: 3320,
    compteurUtilisateurs: 268,
    verifie: false,
  },
  {
    id: 'demo-menuiserie-kouassi',
    nom: 'Atelier Kouassi Menuiserie',
    categorie: 'artisanat',
    description: 'Meubles sur mesure, portes, lits et réparations en bois.',
    photoDevanture: photo('kouassi-devanture'),
    photoVendeur: photo('kouassi-vendeur', 320, 320),
    tags: ['Meubles sur mesure', 'Portes', 'Lits', 'Réparation', 'Placards'],
    localisation: { lat: 5.3448, lng: -4.0853 },
    commune: 'Yopougon',
    quartier: 'Gesco',
    horaires: 'Lun - Sam 7h30 - 18h',
    telephone: '+2250704887766',
    whatsapp: '+2250704887766',
    texteBoutonAction: 'Aller chez Atelier Kouassi Menuiserie',
    noteMoyenne: 4.5,
    nombreAvis: 47,
    compteurVisites: 1620,
    compteurUtilisateurs: 118,
    verifie: false,
  },
  {
    id: 'demo-eglise-nouvelle-alliance',
    nom: 'Église Nouvelle Alliance',
    categorie: 'spiritualite',
    description: 'Cultes du dimanche, chorale et réunions de prière.',
    photoDevanture: photo('eglise-devanture'),
    photoVendeur: photo('eglise-vendeur', 320, 320),
    tags: ['Culte', 'Chorale', 'Prière', 'Jeunesse', 'Catéchèse'],
    localisation: { lat: 5.3663, lng: -3.9451 },
    commune: 'Cocody',
    quartier: 'Riviera 3',
    horaires: 'Dim 8h - 12h, Mer 18h',
    telephone: '+2250701556677',
    whatsapp: '+2250701556677',
    texteBoutonAction: 'Aller chez Église Nouvelle Alliance',
    noteMoyenne: 4.9,
    nombreAvis: 76,
    compteurVisites: 2980,
    compteurUtilisateurs: 190,
    verifie: true,
  },
  {
    id: 'demo-meca-express',
    nom: 'Garage Méca Express',
    categorie: 'services',
    description: 'Vidange, freins, diagnostic et dépannage sur route.',
    photoDevanture: photo('meca-devanture'),
    photoVendeur: photo('meca-vendeur', 320, 320),
    tags: ['Vidange', 'Freins', 'Diagnostic', 'Dépannage', 'Pneumatique'],
    localisation: { lat: 5.2564, lng: -4.0012 },
    commune: 'Port-Bouët',
    quartier: 'Vridi',
    horaires: 'Lun - Sam 8h - 19h',
    telephone: '+2250703778899',
    whatsapp: '+2250703778899',
    texteBoutonAction: 'Aller chez Garage Méca Express',
    noteMoyenne: 4.1,
    nombreAvis: 58,
    compteurVisites: 1870,
    compteurUtilisateurs: 132,
    verifie: false,
  },
  {
    id: 'demo-couture-binta',
    nom: 'Couture Madame Binta',
    categorie: 'artisanat',
    description: 'Wax, kente, tenues de cérémonie et retouches rapides.',
    photoDevanture: photo('binta-devanture'),
    photoVendeur: photo('binta-vendeur', 320, 320),
    tags: ['Wax', 'Kente', 'Tenue de cérémonie', 'Retouche', 'Uniforme'],
    localisation: { lat: 5.3556, lng: -4.0312 },
    commune: 'Adjamé',
    quartier: 'Belleville',
    horaires: 'Lun - Sam 9h - 19h',
    telephone: '+2250702990011',
    whatsapp: '+2250702990011',
    texteBoutonAction: 'Aller chez Couture Madame Binta',
    noteMoyenne: 4.6,
    nombreAvis: 112,
    compteurVisites: 4015,
    compteurUtilisateurs: 289,
    verifie: true,
  },
];

/**
 * Pharmacies & Cliniques de démonstration (§6).
 * AUCUNE note, AUCUN avis, AUCUN compteur de popularité : uniquement le statut de
 * garde auto-déclaré, la distance et les boutons Appeler / Itinéraire.
 */
export const SANTE_DEMO = [
  {
    id: 'demo-pharmacie-paix',
    nom: 'Pharmacie de la Paix',
    type: 'pharmacie',
    deGarde: true,
    deGardeUpdatedAt: new Date().toISOString(),
    localisation: { lat: 5.3242, lng: -4.0186 },
    commune: 'Plateau',
    quartier: 'Plateau',
    horaires: '24h/24',
    telephone: '+2250708990011',
    verifie: true,
  },
  {
    id: 'demo-pharmacie-sainte-marie',
    nom: 'Pharmacie Sainte-Marie',
    type: 'pharmacie',
    deGarde: false,
    deGardeUpdatedAt: new Date().toISOString(),
    localisation: { lat: 5.3489, lng: -3.9885 },
    commune: 'Cocody',
    quartier: 'Cocody Centre',
    horaires: '8h - 22h',
    telephone: '+2250708112233',
    verifie: false,
  },
  {
    id: 'demo-pharmacie-bon-samaritain',
    nom: 'Pharmacie du Bon Samaritain',
    type: 'pharmacie',
    deGarde: true,
    deGardeUpdatedAt: new Date().toISOString(),
    localisation: { lat: 5.3382, lng: -4.0754 },
    commune: 'Yopougon',
    quartier: 'Sicogi',
    horaires: '8h - 20h',
    telephone: '+2250708445566',
    verifie: true,
  },
  {
    id: 'demo-clinique-sainte-anne',
    nom: 'Clinique Sainte-Anne',
    type: 'clinique',
    deGarde: true,
    deGardeUpdatedAt: new Date().toISOString(),
    localisation: { lat: 5.3031, lng: -3.9932 },
    commune: 'Marcory',
    quartier: 'Marcory Résidentiel',
    horaires: 'Urgences 24h/24',
    telephone: '+2250709223344',
    verifie: true,
  },
  {
    id: 'demo-clinique-plateau',
    nom: 'Clinique Médicale du Plateau',
    type: 'clinique',
    deGarde: false,
    deGardeUpdatedAt: new Date().toISOString(),
    localisation: { lat: 5.3218, lng: -4.0231 },
    commune: 'Plateau',
    quartier: 'Plateau',
    horaires: 'Lun - Sam 7h - 20h',
    telephone: '+2250709556677',
    verifie: false,
  },
  {
    id: 'demo-clinique-koumassi',
    nom: 'Clinique Espoir Koumassi',
    type: 'clinique',
    deGarde: true,
    deGardeUpdatedAt: new Date().toISOString(),
    localisation: { lat: 5.2964, lng: -3.9512 },
    commune: 'Koumassi',
    quartier: 'Koumassi Grand Marché',
    horaires: 'Urgences 24h/24',
    telephone: '+2250709334455',
    verifie: true,
  },
];

/** Bandeau d'avertissement obligatoire de la section santé (§6) — texte figé. */
export const AVERTISSEMENT_GARDE =
  "Statut mis à jour par l'établissement, à confirmer par téléphone en cas d'urgence.";

/**
 * Besoins de main-d'œuvre de démonstration (§1-2).
 * `telephoneContact` reste volontairement ABSENT tant que le contact n'est pas
 * débloqué : même en mode démo, on ne révèle pas un numéro gratuitement.
 */
export const BESOINS_DEMO = [
  // ── Offres de boulot (sous-onglet « offres » de la page Jobs) ──
  {
    id: 'demo-job-offre-chauffeur',
    typeAnnonce: 'offre',
    metier: 'Chauffeur',
    titre: 'Chauffeur livreur (temps plein)',
    intitule: 'Chauffeur livreur (temps plein)',
    description: 'Livraisons dans Abidjan pour une quincaillerie. Permis B exigé, poste stable.',
    localisation: { lat: 5.3005, lng: -3.9862 },
    commune: 'Marcory',
    quartier: 'Zone 4',
    urgence: false,
    budgetFcfa: 120000,
    duree: 'CDI',
    segment: 'specialise',
    premierContactGratuit: false,
    nomPosteur: 'Quincaillerie Ivoire',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 1,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 5400 * 1000).toISOString(),
  },
  {
    id: 'demo-job-offre-cuisiniere',
    typeAnnonce: 'offre',
    metier: 'Cuisinier',
    titre: 'Cuisinière pour un maquis',
    intitule: 'Cuisinière pour un maquis',
    description: 'Tous les jours de 9h à 15h : plats du jour d’un maquis à Angré.',
    localisation: { lat: 5.4048, lng: -3.977 },
    commune: 'Cocody',
    quartier: 'Angré',
    urgence: false,
    budgetFcfa: 90000,
    duree: 'CDI',
    segment: 'journalier',
    premierContactGratuit: true,
    nomPosteur: 'Chez Fatou',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 0,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 10800 * 1000).toISOString(),
  },
  {
    id: 'demo-job-electricien',
    metier: 'Électricien',
    description: 'Installation de 12 prises et d’un tableau électrique dans une villa en finition.',
    localisation: { lat: 5.4068, lng: -3.9721 },
    commune: 'Cocody',
    quartier: 'Angré 9e tranche',
    urgence: true,
    budgetFcfa: 45000,
    duree: '3 jours',
    segment: 'specialise',
    premierContactGratuit: false,
    nomPosteur: 'M. Yao',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 3,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  },
  {
    id: 'demo-job-journaliers',
    metier: 'Journalier',
    description: 'Besoin de 4 journaliers pour décharger un camion de ciment demain matin 6h.',
    localisation: { lat: 5.3612, lng: -4.0229 },
    commune: 'Adjamé',
    quartier: 'Liberté',
    urgence: true,
    budgetFcfa: 5000,
    duree: '1 journée',
    segment: 'journalier',
    premierContactGratuit: true,
    nomPosteur: 'Mme Traoré',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 7,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 7200 * 1000).toISOString(),
  },
  {
    id: 'demo-job-plombier',
    metier: 'Plombier',
    description: 'Fuite d’eau sous l’évier de la cuisine et remplacement du siphon.',
    localisation: { lat: 5.2989, lng: -3.9881 },
    commune: 'Marcory',
    quartier: 'Zone 4',
    urgence: false,
    budgetFcfa: 15000,
    duree: '1 journée',
    segment: 'specialise',
    premierContactGratuit: false,
    nomPosteur: 'M. Koné',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 1,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
  },
  {
    id: 'demo-job-couturier',
    metier: 'Couturier',
    description: 'Confection de 6 tenues en wax pour un mariage dans 3 semaines.',
    localisation: { lat: 5.3298, lng: -4.0817 },
    commune: 'Yopougon',
    quartier: 'Niangon',
    urgence: false,
    budgetFcfa: 60000,
    duree: '3 semaines',
    segment: 'specialise',
    premierContactGratuit: false,
    nomPosteur: 'Mme Diomandé',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 0,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
  },
  {
    id: 'demo-job-macon',
    metier: 'Maçon',
    description: 'Montage d’un mur de clôture de 20 mètres, matériaux déjà sur place.',
    localisation: { lat: 5.4211, lng: -4.0148 },
    commune: 'Abobo',
    quartier: 'Abobo Sagbé',
    urgence: false,
    budgetFcfa: 80000,
    duree: '1 semaine',
    segment: 'specialise',
    premierContactGratuit: false,
    nomPosteur: 'M. Gbagbo',
    statut: 'ouvert',
    telephoneContact: null,
    contactMasque: true,
    nombreDeblocages: 2,
    dejaDebloque: false,
    createdAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
  },
];

/** Avis clients de démonstration (uniquement pour les ÉTABLISSEMENTS — jamais pour la santé). */
export const AVIS_DEMO = [
  {
    id: 'demo-avis-1',
    auteurNom: 'Akissi B.',
    note: 5,
    commentaire: 'Toujours frais et servis vite. Le café au lait est parfait le matin.',
    at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 'demo-avis-2',
    auteurNom: 'Ibrahim K.',
    note: 4,
    commentaire: 'Bon rapport qualité-prix, un peu d’attente à midi.',
    at: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 'demo-avis-3',
    auteurNom: 'Mariam T.',
    note: 5,
    commentaire: 'Personnel très accueillant, je recommande dans le quartier.',
    at: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
  },
];

/** Métiers du formulaire « poster un besoin » (miroir de backend/src/routes/jobs.js). */
export const METIERS = [
  'Électricien',
  'Plombier',
  'Maçon',
  'Couturier',
  'Menuisier',
  'Carreleur',
  'Peintre',
  'Mécanicien',
  'Soudeur',
  'Coiffeur',
  'Cuisinier',
  'Ménagère / Repassage',
  'Manœuvre',
  'Journalier',
  'Gardien',
  'Jardinier',
  'Chauffeur',
  'Autre',
];

/** Profil utilisé avant toute connexion : l'app reste consultable sans compte. */
export const PROFIL_DEMO = {
  id: 'demo-visiteur',
  nom: 'Koné',
  prenom: 'Awa',
  nomComplet: 'Awa Koné',
  telephone: '+2250700000003',
  // Compte unifié (ajout du 29/09) : plus de « typeCompte », deux capacités.
  estArtisan: true,
  chercheTravail: true,
  roles: ['prestataire', 'employeur', 'travailleur'],
  metier: 'Coiffeur',
  bio: '',
  photoProfil: '',
  quartier: 'Angré',
  commune: 'Cocody',
  solde: 0,
  noteMoyenne: 4.5,
  nombreAvis: 8,
  segment: '',
  favoris: [],
  // Abonnement : faux en démonstration — aucun paiement n'est possible.
  abonnementActif: false,
  abonnement: null,
  misEnAvant: false,
};

/**
 * Artisans de démonstration (annuaire + bandeau « mis en avant »).
 * Miroir de ce que renvoie GET /api/users/artisans : `misEnAvant: true` = artisan
 * abonné, remonté en tête de liste. Les numéros ne sont JAMAIS inclus : la mise en
 * relation passe par la page Jobs.
 */
export const ARTISANS_DEMO = [
  {
    id: 'demo-artisan-jean',
    nom: 'Kouassi',
    prenom: 'Jean',
    nomComplet: 'Jean Kouassi',
    estArtisan: true,
    chercheTravail: true,
    metier: 'Électricien',
    bio: 'Électricien bâtiment, 12 ans d’expérience, dépannage rapide.',
    photoProfil: photo('ouvrier-jean', 320, 320),
    quartier: 'Angré',
    commune: 'Cocody',
    localisation: { lat: 5.4045, lng: -3.9765 },
    noteMoyenne: 4.7,
    nombreAvis: 34,
    misEnAvant: true,
    abonnementActif: true,
    telephoneMasque: true,
  },
  {
    id: 'demo-artisan-awa',
    nom: 'Diomandé',
    prenom: 'Awa',
    nomComplet: 'Awa Diomandé',
    estArtisan: true,
    chercheTravail: true,
    metier: 'Coiffeur',
    bio: 'Coiffeuse à domicile : tresses, brushing et soins, sur rendez-vous.',
    photoProfil: photo('artisan-awa', 320, 320),
    quartier: 'Sicogi',
    commune: 'Yopougon',
    localisation: { lat: 5.3364, lng: -4.0721 },
    noteMoyenne: 4.9,
    nombreAvis: 21,
    misEnAvant: false,
    abonnementActif: false,
    telephoneMasque: true,
  },
  {
    id: 'demo-artisan-kone',
    nom: 'Koné',
    prenom: 'Ismaël',
    nomComplet: 'Ismaël Koné',
    estArtisan: true,
    chercheTravail: true,
    metier: 'Plombier',
    bio: 'Plomberie et dépannage fuite, intervention le jour même.',
    photoProfil: photo('artisan-kone', 320, 320),
    quartier: 'Zone 4',
    commune: 'Marcory',
    localisation: { lat: 5.2989, lng: -3.9881 },
    noteMoyenne: 4.4,
    nombreAvis: 12,
    misEnAvant: false,
    abonnementActif: false,
    telephoneMasque: true,
  },
];

// ── Helpers consommés par les pages en mode hors-ligne ───────────────────────

/** Filtre local : catégorie + mot-clé (mêmes règles que l'API, §4). */
export function filtrerEtablissementsDemo({ categorie = 'tous', q = '' } = {}) {
  const terme = String(q).trim().toLowerCase();
  return ETABLISSEMENTS_DEMO.filter((e) => {
    const okCategorie = !categorie || categorie === 'tous' || e.categorie === categorie;
    if (!okCategorie) return false;
    if (!terme) return true;
    const sac = [e.nom, e.description, e.quartier, e.commune, ...(e.tags || [])].join(' ').toLowerCase();
    return sac.includes(terme);
  });
}

/**
 * Filtre local des annonces de boulot (métier + mot-clé + type d'annonce).
 * `typeAnnonce` vaut 'offre', 'demande' ou 'tous'. Une entrée sans `typeAnnonce`
 * est considérée comme une demande de main-d'œuvre (même règle que l'API).
 */
export function filtrerBesoinsDemo({ metier = 'tous', q = '', typeAnnonce = 'tous' } = {}) {
  const terme = String(q).trim().toLowerCase();
  return BESOINS_DEMO.filter((b) => {
    const okMetier = !metier || metier === 'tous' || b.metier === metier;
    if (!okMetier) return false;
    if (typeAnnonce && typeAnnonce !== 'tous') {
      const type = b.typeAnnonce || 'demande';
      if (type !== typeAnnonce) return false;
    }
    if (!terme) return true;
    return [b.titre, b.metier, b.description, b.commune, b.quartier]
      .join(' ')
      .toLowerCase()
      .includes(terme);
  });
}

/** Filtre local des artisans (métier + mot-clé), abonnés (« mis en avant ») en tête. */
export function filtrerArtisansDemo({ metier = 'tous', q = '', limite = 8 } = {}) {
  const terme = String(q).trim().toLowerCase();
  return ARTISANS_DEMO.filter((a) => {
    if (metier && metier !== 'tous' && a.metier !== metier) return false;
    if (!terme) return true;
    return [a.metier, a.bio, a.nomComplet, a.commune, a.quartier].join(' ').toLowerCase().includes(terme);
  })
    .sort((a, b) => {
      if (a.misEnAvant !== b.misEnAvant) return a.misEnAvant ? -1 : 1;
      return (b.noteMoyenne || 0) - (a.noteMoyenne || 0);
    })
    .slice(0, limite);
}

/** Pharmacies/cliniques : filtre type + statut de garde (§6). */
export function filtrerSanteDemo({ type = 'tous', deGardeSeulement = false } = {}) {
  return SANTE_DEMO.filter((s) => {
    if (type !== 'tous' && s.type !== type) return false;
    if (deGardeSeulement && !s.deGarde) return false;
    return true;
  });
}

export default {
  CATEGORIES,
  TAGS_PAR_CATEGORIE,
  ETABLISSEMENTS_DEMO,
  SANTE_DEMO,
  BESOINS_DEMO,
  ARTISANS_DEMO,
  AVIS_DEMO,
  METIERS,
  PROFIL_DEMO,
  AVERTISSEMENT_GARDE,
  filtrerEtablissementsDemo,
  filtrerBesoinsDemo,
  filtrerArtisansDemo,
  filtrerSanteDemo,
};

