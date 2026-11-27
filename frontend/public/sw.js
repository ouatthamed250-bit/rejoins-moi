/* sw.js — Service worker de Rejoins'Moi (PWA installable, sans APK natif).
 *
 * Objectif : l'app s'ouvre même quand le réseau 3G est mauvais ou coupé, sans
 * jamais mentir à l'utilisateur sur l'état de son argent. Trois règles :
 *
 *  1. APP SHELL (HTML, CSS, JS, icônes) -> mis en cache à l'installation, puis
 *     rafraîchi en tâche de fond (« stale-while-revalidate »). L'app démarre
 *     instantanément et se met à jour à la visite suivante.
 *  2. DONNÉES DYNAMIQUES (GET /api/... publics) -> « network first » : le réseau
 *     d'abord, la dernière copie connue seulement en secours (mode démo existant).
 *  3. PAIEMENTS / COMPTE -> JAMAIS de cache, jamais de lecture depuis le cache :
 *     tout ce qui touche à l'argent (CinetPay, abonnement, déblocage de contact)
 *     et tout ce qui touche à l'identité (connexion, inscription, profil privé)
 *     traverse toujours le réseau, et toute méthode non-GET est laissée telle
 *     quelle. Le serveur reste seul juge du paiement (règle de sécurité du projet).
 */

// v29 : assistant virtuel — FAQ interactive (26/11).
//       • Nouveau components/AssistantBot.jsx (bulle flottante sur toutes les
//         pages sauf le back-office, trois niveaux : sujets → questions →
//         réponse) alimenté par config/faq.js, en dur dans le bundle. Aucun appel
//         réseau : ce que la personne cherche ne sort pas du téléphone.
//       • App.jsx et Icons.jsx changent (nouvelle empreinte index-*.js) : nouveau
//         nom de cache — sinon un téléphone déjà installé continuerait d'afficher
//         l'application sans l'assistant, et sans les icônes « robot »/« réglages ».
//
// v28 : finitions de sécurité et refonte du back-office (26/11).
//       • Côté serveur, un document utilisateur sérialisé sans route explicite
//         (res.json(doc), populate renvoyé tel quel) sort désormais sous sa forme
//         PUBLIQUE : solde, favoris, dernière connexion, statut et motif de
//         suspension ne peuvent plus fuiter par oubli (User.toJSON).
//       • Le back-office gagne cinq onglets permanents (Vue d'ensemble,
//         Utilisateurs, Établissements, Annonces signalées, Mises en avant) et
//         deux écrans : le catalogue des fiches et la file des mises en avant.
//       Admin.jsx et admin.css changent (nouvelles empreintes index-*.css/js) :
//       nouveau nom de cache — sinon un poste déjà ouvert garderait l'ancien
//       back-office, sans les onglets.
//
// v27 : refonte Artisans/Emplois (26/11) — consentement de contact, offres de stage,
//       signalements et nettoyage final des mentions de gratuité.
//       • Le numéro n'apparaît sur une carte (annonce ou artisan) que si son
//         propriétaire a coché « J'accepte que mon numéro soit visible » ; sinon la
//         carte affiche « Contact masqué » et la mise en relation habituelle reste
//         seule voie d'accès (Job.contactPublic / User.contactPublic).
//       • Les offres de stage existent (typeAnnonce 'stage') et sont listées avec les
//         offres de boulot — sinon elles n'auraient aucun sous-onglet d'accueil.
//       • Chaque carte d'annonce gagne un bouton « Signaler » (icône drapeau) et le
//         back-office une section « Annonces signalées » pour retirer une annonce.
//       Jobs.jsx, JobBoard.jsx, Profile.jsx, Admin.jsx, ArtisansMisEnAvant.jsx,
//       BottomNav.jsx, MenuPrincipal.jsx et RegisterEstablishment.jsx changent :
//       nouvelles empreintes index-*.js, donc nouveau nom de cache — sinon un
//       téléphone déjà installé garderait l'ancien formulaire, sans la case de
//       consentement ni l'option « Offre de stage ».
//
// v25 : correction manuelle de la position par le propriétaire (26/11)
//       — une boulangerie créée sur un mauvais réseau avait reçu un point GPS
//       décalé de 2 km. « Gérer mon établissement » gagne une section
//       « Localisation » : le gérant déplace le repère sur la carte et la
//       correction est écrite immédiatement (PATCH localisation), avec mise à jour
//       de la distance et du tri sans rechargement. À l'inscription, une position
//       à plus de 500 m d'incertitude affiche désormais une alerte visible
//       (« Placer sur la carte »). EstablishmentProfile.jsx, RegisterEstablishment
//       .jsx et useGeolocation.js changent : nouvelles empreintes index-*.js, donc
//       nouveau nom de cache — sinon un téléphone déjà installé garderait l'ancien
//       panneau, sans le bouton de correction.
//

// v24 : migration complète des sous-catégories + barre d'onglets nettoyée (26/11)
//       — les 6 419 fiches restantes rejoignent la taxonomie locale (Restauration
//       et boissons, Commerces, Services de proximité), ce qui vide « Alimentation »
//       (2 fiches), « Commerce » au singulier, « Santé », « Spiritualité »,
//       « Lieux de culte » et « Autre » (2 fiches de test). Ces onglets sont
//       masqués via FAMILLES_VISIBLES (categories.js + CategoryFilter.jsx) ;
//       Beauté (893), Services (305) et Artisanat (200) restent visibles.
//       Nouvelles empreintes index-*.js : nouveau nom de cache, sinon un
//       téléphone déjà installé garderait les 13 onglets et les anciens libellés.
//
// v23 : libellés de famille (20/11) — la carte du feed et la fiche affichaient
//       « Autre » ou un slug brut (« restauration ») pour les fiches rangées dans
//       une famille locale : elles lisent désormais config/categories.js
//       (libelleFamille). EstablishmentCard.jsx et EstablishmentProfile.jsx
//       changent, donc nouvelles empreintes index-*.js : nouveau nom de cache,
//       sinon un téléphone déjà en v22 garderait les anciens libellés.
//
// v22 : adaptation ivoirienne des catégories (20/11) — familles locales
//       (Restauration et boissons, Commerces, Services de proximité, Lieux de culte
//       et communautaires), sous-catégories de rue (maquis, koutoukoudrom,
//       placalidrom, garbadrom, clé minute, lavage auto, WC publique…), raccourcis
//       « Utile près de moi » sur l'accueil et la recherche, proposition libre d'un
//       métier (« Autre (précisez) ») avec file de validation dans le back-office,
//       et aucun encart de mise en avant pour les lieux publics et les cultes.
//       Feed.jsx, Search.jsx, RegisterEstablishment.jsx, Profile.jsx, Admin.jsx,
//       dessinsContexte.js et le CSS changent : empreintes index-*.js/css
//       différentes, donc nouveau nom de cache — sinon un téléphone déjà installé
//       garderait l'ancien filtre à 8 familles et ne verrait ni maquis ni raccourcis.
//
// v21 : passage en mode 100 % GRATUIT (20/11) — tous les prix disparaissent de
//       l'interface, l'abonnement payant n'est plus proposé, une
//       liste d'attente « Je veux être mis en avant » apparaît sur le profil et le
//       back-office affiche les demandes. Jobs.jsx, JobBoard.jsx, Profile.jsx,
//       Admin.jsx, MentionsLegales.jsx et RegisterEstablishment.jsx changent : les
//       empreintes index-*.js/css changent, donc nouveau nom de cache — sinon un
//       téléphone déjà installé continuerait d'afficher les anciens prix.
//
// v20 : même publication que v19 (droit à l'effacement), texte corrigé — la zone
//       DANGER du profil et le tiroir d'administration annoncent désormais ce qui
//       arrive VRAIMENT aux fiches d'établissement : celles créées par la personne
//       sont supprimées, celles qu'elle a seulement revendiquées restent en ligne
//       sans son nom (l'ancienne phrase laissait croire qu'il fallait les retirer
//       soi-même avant de supprimer le compte). Profile.jsx et Admin.jsx changent :
//       nouvelles empreintes, donc nouveau nom de cache.
//
// v19 : droit à l'effacement (20/11) — le profil propose « Supprimer mon compte »,
//       le back-office gagne l'onglet « Effacés », la pastille « Effacé », le
//       masquage des numéros et une confirmation par saisie du nom. Profile.jsx,
//       Feed.jsx, Admin.jsx et admin.css changent : les empreintes index-*.js/css
//       changent, donc nouveau nom de cache — sinon un téléphone déjà installé
//       servirait l'ancien index.html en secours, sans le bouton de suppression et
//       avec l'ancienne console d'administration.
//
// v18 : nettoyage sécurité / affichage du 17/11 — les fiches jamais notées affichent
//       une pastille « Nouveau » au lieu de cinq étoiles vides et « 0 (0 avis) », les
//       noms qui sont en réalité des NUMÉROS de téléphone sont anonymisés dans les avis
//       et les annonces (« Utilisateur Rejoins'Moi »), et les contacts débloqués sont
//       effacés à la déconnexion (le déblocage payant ne profite plus au compte
//       suivant). Ces changements vivent dans le JS de l'app (StarRating, Jobs,
//       JobBoard, EstablishmentProfile, AuthContext) : les empreintes index-*.js
//       changent, donc nouveau nom de cache — sinon un téléphone déjà installé
//       servirait l'ancien index.html en secours et garderait les anciens écrans.
//
// v17 : bandeau « nouvelle version disponible » (16/11) — components/MiseAJourPWA.jsx
//       écoute ce worker : dès qu'une version prend la main, un bandeau s'affiche
//       en haut de l'écran et propose « Mettre à jour », avec un lien de secours
//       qui force le rechargement (worker désinscrit + caches `rejoinsmoi-*`
//       vidés). C'est la réponse au défaut constaté sur le terrain : un téléphone
//       gardait l'app ouverte et continuait d'afficher l'ANCIENNE version (sans la
//       localisation GPS, avec l'ancienne fiche surchargée) alors que le
//       déploiement était en ligne — le worker se mettait bien à jour, mais la page
//       restait en mémoire sans que rien ne l'indique. La fiche est aussi allégée
//       (un seul bouton « Modifier ma fiche », coche « Déjà visité » descendue dans
//       la barre du bas, médaillon entièrement visible). L'app shell change : sans
//       nouveau nom de cache, un téléphone déjà installé servirait l'ancien
//       index.html en secours, donc l'ANCIENNE app — sans bandeau.
//
// v15 : tableau de bord du gérant (16/11) — « Gérer mon établissement » : fermer
//       la fiche temporairement en un clic (avec une raison affichée au client :
//       « Fermé (Rupture de stock) »), la rouvrir, et corriger ses horaires après
//       publication (la grille de sept jours réapparaît dans un panneau).
//       EstablishmentProfile.jsx change → nouvelle empreinte index-*.js : sans
//       nouveau nom de cache, un téléphone déjà installé servirait l'ancien
//       index.html en secours, donc l'ANCIENNE fiche, sans le bouton « Gérer ».
//
// v14 : horaires structurés (16/11) — la fiche porte une pastille « Ouvert /
//       Fermé » calculée à l'heure présente, et l'inscription remplace le champ
//       libre « Horaires » par un éditeur de sept jours. L'app shell change :
//       nouvelle empreinte statutHoraire-*.js, EstablishmentProfile et
//       RegisterEstablishment réécrits. Sans nouveau nom de cache, un téléphone
//       déjà installé servirait l'ancien index.html en secours, donc l'ANCIENNE
//       app — sans pastille et avec l'ancien champ de saisie.
//

// v13 : barre « Retour / Suivant » de l'inscription et bouton « + » de la
//       navigation : la barre tranchait le bouton surélevé (elles semblaient se
//       superposer). Nouveau CSS + nouveau JS : l'app shell change, donc nouveau
//       nom de cache — sinon un téléphone déjà équipé garderait l'ancien index.html
//       et ne verrait jamais le correctif.
//
// v12 : allègement du bundle initial (lazy loading des 10 pages non-first-screen) :
//       bundle principal 461 kB → 280 kB. ErrorBoundary global et page 404
//       explicite (NotFound). L'app shell change (nouvelles empreintes JS/CSS) :
//       sans nouveau nom de cache, un téléphone déjà installé servirait l'ancien
//       index.html en secours, donc l'ancienne app.

// v8 : VAGUE 1 (blocs B1/B2, C, D, E). L'écran d'inscription change visiblement (repère
//      « Placer sur la carte » déplaçable, compte créé DANS le parcours), le fil s'ouvre
//      par proximité, une fiche importée propose « C'est votre établissement ? » et
//      l'écran /admin gagne la file des réclamations. Les empreintes JS/CSS changent :
//      sans nouveau nom de cache, un téléphone déjà installé garderait l'ANCIEN index.html
//      en secours — donc l'ancienne app, sans réclamations ni compte créé au parcours.
// v3 : passage aux icônes DÉFINITIVES (logo du fondateur, jeu PNG).
// v6 : correctifs du 30/09 (soir) — fondu d'en-tête continu, plus de bandeau
//      d'installation une fois l'app installée, icônes d'écran d'accueil refaites
//      en plein cadre. Les ICÔNES sont en « cache d'abord » : sans nouveau nom de
//      cache, un téléphone déjà installé garderait l'ANCIENNE icône maskable
//      (l'aplat orange avec le logo au milieu) et croirait que rien n'a changé.
//      Le nouveau nom de cache force le retéléchargement des icônes.
// v5 : correctifs visuels du 30/09 (plus d'aplat orange plein sur les fiches sans
//      photo ni sur la bannière d'installation). Les fichiers CSS/JS du build
//      portent une empreinte dans leur nom : l'ANCIEN index.html en cache réclame
//      des fichiers qui n'existent plus dans la nouvelle publication. Sans nouveau
//      nom de cache, l'app installerait cet index.html périmé et la page
//      s'afficherait SANS style jusqu'à la visite suivante.
// v4 : refonte visuelle du 30/09 (fond ivoire dominant, orange en accent).
//      L'app shell est servi « stale-while-revalidate » : sans nouveau nom de
//      cache, un téléphone déjà installé afficherait l'ANCIEN thème à la
//      première visite après la mise à jour (l'utilisateur croirait que la
//      refonte n'est pas passée). `activate` supprime les caches des versions
//      passées, donc le nouveau thème est visible dès le premier chargement.
// v7 : publication du back-office ADMINISTRATEUR (écran /admin) et du dépôt de
//      contact. Nouveau nom de cache : l'app shell change (nouvelles empreintes
//      JS/CSS), un téléphone déjà installé garderait sinon l'ancien index.html
//      en secours, donc l'ANCIENNE app — sans l'écran /admin.
// v9 : correctif des barres basses (08/10) — la barre d'action se POSE sur la
//      navigation au lieu de flotter à 68px au-dessus, et la réserve d'espace du
//      bas suit la hauteur RÉELLE mesurée du bloc. L'app shell change (empreintes
//      JS/CSS) : sans nouveau nom de cache, un téléphone déjà installé servirait
//      l'ancien index.html en secours, donc l'ANCIENNE app — avec la barre qui
//      flotte avec un interstice, exactement le bug corrigé.
// v10 : publication du build du 17/10 — correctif d'accessibilité (le zoom du
//      navigateur n'est plus bloqué par `maximum-scale` / `user-scalable=no`) et
//      nouvelles empreintes JS/CSS. Trois changements, sans effet sur la logique
//      métier :
//        a) `install` précharge désormais les JS/CSS réellement cités par
//           index.html (lus dans la page, jamais devinés) : la coquille hors
//           ligne est complète dès l'installation, et non plus au 2e chargement ;
//        b) le cache applicatif de la génération précédente survit 24 h après
//           l'activation : un onglet resté ouvert peut encore demander un chunk
//           de l'ancienne version (chargé à la demande) sans recevoir le 404 de
//           GitHub Pages. Ensuite il est supprimé — jamais plus d'un ancien
//           cache, jamais indéfiniment (voir entretenirCaches) ;
//        c) le cache de DONNÉES d'une version passée, lui, reste supprimé sans
//           délai : aucune réponse d'API d'une ancienne version ne resservira.
// v11 : publication du build du 16/11 — 13 illustrations crayon (kiosque, église,
//      mosquée, pharmacie, salon de beauté, atelier de couture, chantier, électricité,
//      plomberie, taxi-moto, mobile money, enveloppe, hors ligne), bandeau
//      d'installation PWA déplacé DANS LE FLUX (il recouvrait une carte de résultat
//      sur /recherche) et état de secours des photos. L'app shell change (nouvelles
//      empreintes JS/CSS) : sans nouveau nom de cache, un téléphone déjà installé
//      servirait l'ancien index.html en secours, donc l'ANCIENNE app — avec la
//      bannière qui masque une carte, exactement le défaut corrigé.
// v16 : publication du 16/11 — le médaillon du gérant s'affiche ENTIER (il était
//      peint SOUS la photo de couverture : `<header>` en `position: relative` est
//      peint après les blocs non positionnés), plus l'édition des informations de la
//      fiche (nom, description, contacts, horaires) et les raccourcis « Mon
//      établissement » du Profil et du Menu. L'app shell change (nouvelles empreintes
//      JS) : sans nouveau nom de cache, un téléphone déjà installé servirait l'ancien
//      index.html en secours, donc l'ANCIENNE app — médaillon toujours rogné.
// Changer la version est indispensable dès que les fichiers « cache d'abord »
// (icônes) ou l'app shell changent de façon visible.
// v26 : retrait des mentions de gratuité dans l'interface (26/11)
//       — les pages Jobs / Main-d'œuvre / Profil / Mentions légales n'affichent
//       plus de bandeau ni de bouton « gratuit » : le contact s'obtient
//       naturellement (« Voir le contact »). Même publication que le correctif
//       backend qui acceptait « GRATUIT » dans l'enum moyenPaiement.
// v30 : profil artisan + cartes cliquables (26/11)
//       — les cartes « Artisans mis en avant » affichaient un nom, un métier et
//       une note sans mener nulle part. Elles ouvrent maintenant /artisan/:id
//       (nouvelle page ArtisanProfile.jsx) : grande photo, nom, métier,
//       quartier, note et nombre d'avis, bio, puis les actions — « Appeler » et
//       « WhatsApp » si l'artisan a publié son numéro, sinon « Envoyer un
//       message ». Les boutons de contact posés DANS la carte gardent leur
//       geste propre : ils n'ouvrent pas la fiche.
//       App.jsx et ArtisansMisEnAvant.jsx changent (nouvelles empreintes JS),
//       d'où ce nouveau nom de cache : sans lui, un téléphone déjà installé
//       servirait l'ancien index.html et garderait des cartes qui ne réagissent
//       pas au clic.
// v31 : messagerie interne (26/11)
//       — l'onglet Messages devient un vrai chat : recherche d'un artisan ou d'un
//       commerce, conversation privée, aucun numéro échangé. Les boutons
//       « Message » des fiches remplacent le renvoi vers WhatsApp, et le
//       back-office gagne la modération des messages (recherche + export JSON
//       pour réquisition). Pages Messages.jsx, Admin.jsx, EstablishmentProfile.jsx,
//       ArtisanProfile.jsx et le client admin changent : nouveau nom de cache
//       obligatoire, sinon un téléphone déjà installé garderait l'ancien écran
//       « le contact passe par WhatsApp ».
// v32 : agents de terrain et anti-fraude (26/11)
//       — l'inscription accepte un code agent de 6 caractères (facultatif) et
//       exige une case de consentement « ma fiche, mes photos et mon numéro sont
//       visibles » ; le back-office gagne l'écran « Agents de terrain » (codes,
//       fiches créées, export CSV de paie, fiches à vérifier). Les inscriptions
//       suspectes (numéro en double, GPS < 20 m, plus de 5 fiches en 24 h par
//       appareil) ne sont pas bloquées : elles sont marquées pour relecture.
//       Admin.jsx et RegisterEstablishment.jsx changent : nouveau nom de cache
//       obligatoire, sinon un téléphone déjà installé garderait l'ancien
//       formulaire — sans champ code agent ni case de consentement.
// v33 : onglet « Modération des messages » réparé (26/11)
//       — dans le back-office, l'écran de modération avait été enfermé dans une
//       autre vue par une accolade décalée : au clic sur son onglet, le rendu
//       levait « VueModerationMessages is not defined » et tout le back-office
//       tombait. Le composant est revenu au niveau du module, là où la fonction
//       est visible depuis l'aiguillage des onglets.
//       Ce numéro de version existe pour les appareils qui gardaient encore
//       l'ancien Admin-*.js en cache : à la prochaine ouverture, l'app remplace
//       la coquille et les paquets périmés, puis l'onglet s'ouvre normalement.
//       (La recherche par nom/numéro, l'aperçu et l'export JSON, eux, étaient
//       déjà écrits : c'est bien la portée du composant qui était en cause.)
// v34 : espace AGENT DE TERRAIN + suivi GPS (27/11)
//       — nouvelle route plein écran /agent (AgentApp.jsx) : connexion par numéro
//       et mot de passe, activation par code remis par l'administrateur, prise et
//       fin de service, pointage GPS toutes les 5 minutes UNIQUEMENT en service,
//       inscription d'un commerce avec le compte du gérant (mot de passe tapé par
//       le gérant), puis fermeture automatique de la session ;
//       — back-office : « Agents de terrain » gère désormais le cycle de vie
//       complet (génération du code d'activation affiché une seule fois, statut
//       actif / en attente / suspendu, suppression) et une nouvelle section
//       « Carte des agents » suit en temps réel les agents en service (Leaflet
//       chargé à la demande, rafraîchissement toutes les 30 s).
//       App.jsx, AgentApp.jsx, Admin.jsx et le client admin changent : sans
//       nouveau nom de cache, un téléphone déjà installé n'aurait ni la route
//       /agent ni la carte — l'ancien index.html resterait servi en secours.
// v35 : onglet « Import de données » du back-office (27/11)
//       — nouvelle section Admin : état du catalogue par famille concernée par
//       l'import OpenStreetMap, commande à lancer en local (le navigateur ne peut
//       pas écrire 30 000 fiches), et rappel des deux règles de l'import
//       (estImporte / reclame:false, donc chaque gérant peut reprendre sa fiche) ;
//       — sept familles ajoutées à la taxonomie (administration, banque, transport,
//       education, culte, hebergement, service_auto) : sans nouveau nom de cache,
//       un poste déjà ouvert garderait l'ancien bundle et afficherait le slug brut
//       « administration » au lieu de « Administration ».
//       Admin.jsx, config/categories.js et le modèle changent : nouveau nom de cache.
// v36 : import OSM appliqué + nouvelles familles dans la barre d'onglets (27/11)
//       — les sept familles de l'import (administration, banque, transport,
//       education, culte, hebergement, service_auto) ne sont plus masquées : elles
//       apparaissent dans CategoryFilter, dans la recherche et dans le choix de
//       famille de l'espace agent ; 30 022 fiches importées arrivent avec elles.
//       config/categories.js change pour TOUS les écrans : sans nouveau nom de
//       cache, un téléphone déjà installé garderait l'ancien bundle (donc les
//       anciens onglets) pendant toute la durée de grâce.
// v37 : page « Pharmacies & Cliniques » réparée (27/11)
//       — la page lisait la seule collection HealthFacility (0 fiche) et affichait
//       « Aucune pharmacie » alors que 2 277 fiches `sante` étaient en base depuis
//       l'import OSM ; elle lit désormais les deux sources et filtre côté serveur
//       (compteur exact : 2 277 fiches, 967 pharmacies, 1 310 cliniques) ;
//       — PharmaciesCliniques.jsx change : nouveau nom de cache obligatoire, sinon
//       les téléphones déjà installés garderaient la page vide pendant la grâce.
// v39 : notifications push (Web Push) (27/11)
//       — écouteur « push » : reçoit les notifications du serveur (clés VAPID)
//       et les affiche via self.registration.showNotification ;
//       — écouteur « notificationclick » : ferme la notification et ouvre l'URL
//       de destination (ex. /messages) ;
//       — le cache GPS de 30 min à 5 min et les accusés de lecture de la
//       messagerie (v38) restent actifs.
const VERSION = 'v39';
const CACHE_APP = `rejoinsmoi-app-${VERSION}`;
const CACHE_DONNEES = `rejoinsmoi-donnees-${VERSION}`;
const CACHES_ACTUELS = [CACHE_APP, CACHE_DONNEES];

/* Entretien des caches : petits marqueurs de date, jamais servis à une page. Ce
 * cache n'est volontairement PAS versionné : il doit survivre aux publications
 * pour que la fenêtre de grâce d'un ancien cache puisse expirer normalement. */
const CACHE_ENTRETIEN = 'rejoinsmoi-entretien';
const DUREE_GRACE_ANCIEN_CACHE = 24 * 60 * 60 * 1000; // 24 h
const ANCIENS_CACHES_APP_MAX = 1;

/* Base d'installation, déduite de l'emplacement du worker lui-même :
 *  - « / » si l'app est à la racine d'un domaine (Vercel, Netlify) ;
 *  - « /rejoins-moi/ » si l'app est dans un sous-dossier (GitHub Pages).
 * Sans cela, la coquille serait préchargée à la racine du domaine : sur Pages,
 * les 7 fichiers répondraient 404 et le mode hors ligne serait inopérant. */
const BASE_APPLICATION = new URL(self.location.href).pathname.replace(/[^/]*$/, '');

/* Fichiers strictement nécessaires au premier écran (l'app shell). */
const APP_SHELL = [
  BASE_APPLICATION,
  `${BASE_APPLICATION}index.html`,
  `${BASE_APPLICATION}manifest.json`,
  `${BASE_APPLICATION}icons/icon-192.png`,
  `${BASE_APPLICATION}icons/icon-512.png`,
  `${BASE_APPLICATION}icons/apple-touch-icon-180.png`,
];

/* URL absolue de la page de démarrage : clé unique de la copie hors ligne. */
const URL_INDEX = new URL(`${BASE_APPLICATION}index.html`, self.location.origin).href;

/* Références JS/CSS lues dans index.html (`src="…"`, `href="…"`).
 * Volontairement limité à .js et .css : ni images, ni données, ni URL externes.
 * Seules les ressources du premier écran sont préchargées, et seulement si la
 * page les cite vraiment — aucun nom de fichier n'est écrit à la main. */
const MOTIF_RESSOURCES_INDEX = /(?:src|href)\s*=\s*["']([^"'#?\s]+\.(?:js|css))["']/gi;

/* Zones interdites au cache : on ne touche même pas à la requête. */
const CHEMINS_SENSIBLES = [
  /^\/api\/subscriptions/, // formules, souscrire, résilier, webhook CinetPay
  /unlock-contact/, // déblocage d'un contact (argent)
  /^\/api\/jobs\/[^/]+\/(unlock|pay)/,
  /^\/api\/users\/(login|register|me|mot-de-passe|token)/, // identité
  /^\/api\/auth/,
  /^\/api\/admin/, // back-office : jeton admin + données privées des comptes
];

/** Hôtes de la passerelle de paiement : le service worker ne s'en mêle jamais. */
const HOTES_PAIEMENT = ['cinetpay.com', 'cinetpay.net', 'paytech'];

/** Nombre d'entrées maximum gardées dans le cache de données (téléphone modeste). */
const MAX_ENTREES_DONNEES = 60;

/* ─────────────────────── Préchargement de l'app shell ─────────────────────── */

/** Vrai si l'URL est de même origine, dans l'app, et hors zone sensible. */
function estRessourceDeLApplication(url) {
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith(BASE_APPLICATION) &&
    !CHEMINS_SENSIBLES.some((motif) => motif.test(url.pathname))
  );
}

/**
 * Précharge les fichiers JS/CSS que index.html réclame réellement.
 *
 * Pourquoi : APP_SHELL ne peut pas les lister (leur nom porte une empreinte qui
 * change à chaque build). Sans ce préchargement, la coquille mise en cache à
 * l'installation contient un index.html qui réclame des fichiers absents du
 * cache : une ouverture hors ligne juste après l'installation afficherait une
 * page sans style ni script. On lit donc la page déjà mise en cache (ou, à
 * défaut, le réseau) et on ajoute ce qu'elle cite — sans jamais inventer de nom.
 *
 * Ne lève jamais : une ressource secondaire absente ne bloque pas l'installation.
 */
async function precargerRessourcesIndex(cache) {
  try {
    let html = '';
    const enCache = await cache.match(URL_INDEX);
    if (enCache) {
      html = await enCache.text();
    } else {
      const reponse = await fetch(new Request(URL_INDEX, { cache: 'reload' }));
      if (reponse && reponse.ok) html = await reponse.text();
    }
    if (!html) return;

    const urls = new Set();
    const motif = new RegExp(MOTIF_RESSOURCES_INDEX.source, 'gi');
    let trouve = motif.exec(html);
    while (trouve) {
      try {
        const url = new URL(trouve[1], URL_INDEX);
        if (estRessourceDeLApplication(url)) urls.add(url.href);
      } catch {
        /* référence illisible : ignorée */
      }
      trouve = motif.exec(html);
    }

    await Promise.all(
      [...urls].map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      )
    );
  } catch {
    /* page illisible : on garde la coquille minimale décrite par APP_SHELL */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP);
      // `addAll` échoue en bloc si UN fichier manque : on tolère les absents pour
      // ne jamais bloquer l'installation (les icônes de l'app peuvent changer).
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
      // Les JS/CSS de la page : le cache v10 est complet AVANT de prendre la main,
      // ce qui évite la page blanche hors ligne juste après une mise à jour.
      await precargerRessourcesIndex(cache);
      // Le bandeau « nouvelle version disponible » (components/MiseAJourPWA.jsx)
      // prévient l'utilisateur dès qu'un worker prend la main : c'est le seul
      // moyen de lui faire recharger une page restée des jours en mémoire. On
      // prend néanmoins la main TOUT DE SUITE, comme avant (v17) : la prochaine
      // ouverture est ainsi déjà à jour même si le bandeau a été fermé (« Plus
      // tard »). Le risque pour un onglet resté ouvert est traité par la fenêtre
      // de grâce d'un jour sur l'ancien cache (voir entretenirCaches).
      await self.skipWaiting();
    })()
  );
});

/* ─────────────────────────── Entretien des caches ─────────────────────────── */

/** Clé du marqueur d'échéance d'un ancien cache applicatif (jamais servie). */
function cleMarqueur(nom) {
  return new Request(
    new URL(`${BASE_APPLICATION}__entretien/${encodeURIComponent(nom)}`, self.location.origin).href
  );
}

/** Nom du cache porté par un marqueur. */
function nomDuMarqueur(cle) {
  try {
    return decodeURIComponent(new URL(cle.url).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
}

/**
 * Trie les caches `rejoinsmoi-*` à chaque activation :
 *
 *  - caches ACTUELS (v10) et cache d'entretien : jamais touchés ;
 *  - cache de DONNÉES d'une version passée : supprimé immédiatement — aucune
 *    réponse d'API d'une ancienne version ne doit resservir ;
 *  - cache APPLICATIF de la version précédente : conservé DUREE_GRACE_ANCIEN_CACHE
 *    (24 h) à compter de la première activation qui le voit comme « ancien ».
 *    C'est ce qui permet à un onglet encore ouvert de charger un chunk de
 *    l'ancienne version (nom haché, chargé à la demande) au lieu de recevoir un
 *    404 de GitHub Pages. Un seul ancien cache est conservé, et seulement le
 *    temps de la grâce : ANCIENS_CACHES_APP_MAX ;
 *  - tout autre cache `rejoinsmoi-*` : supprimé (anciens noms, restes de tests).
 *
 * Les échéances sont datées dans CACHE_ENTRETIEN (petit cache non versionné) :
 * elles expirent donc normalement même après plusieurs publications, et les
 * marqueurs orphelins sont effacés. Aucun cache d'une autre application n'est
 * jamais touché.
 */
async function entretenirCaches() {
  const maintenant = Date.now();
  const entretien = await caches.open(CACHE_ENTRETIEN);
  const noms = await caches.keys();
  const aGarder = [];
  const aSupprimer = [];

  // 1) Tout ce qui n'est pas un cache applicatif d'une version passée.
  for (const nom of noms) {
    if (CACHES_ACTUELS.includes(nom) || nom === CACHE_ENTRETIEN) continue;
    if (!nom.startsWith('rejoinsmoi-')) continue; // jamais les caches d'autres apps
    if (!nom.startsWith('rejoinsmoi-app-')) aSupprimer.push(nom);
  }

  // 2) Les caches applicatifs des versions passées.
  const anciens = noms.filter(
    (nom) => nom.startsWith('rejoinsmoi-app-') && !CACHES_ACTUELS.includes(nom)
  );
  const echeances = new Map();
  for (const nom of anciens) {
    const marque = await entretien.match(cleMarqueur(nom));
    echeances.set(nom, marque ? Number(await marque.text()) : NaN);
  }

  // 2a) Ceux qui viennent d'être remplacés (pas encore de marqueur) : ce sont eux
  //     qui peuvent encore servir un onglet ouvert. On ouvre la grâce.
  for (const nom of anciens.filter((nom) => !Number.isFinite(echeances.get(nom)))) {
    if (aGarder.length < ANCIENS_CACHES_APP_MAX) {
      aGarder.push(nom);
      await entretien.put(
        cleMarqueur(nom),
        new Response(String(maintenant + DUREE_GRACE_ANCIEN_CACHE))
      );
    } else {
      aSupprimer.push(nom); // déjà un ancien cache : aucune accumulation
    }
  }

  // 2b) Ceux déjà en grâce : on ne prolonge jamais, on supprime à l'échéance.
  for (const nom of anciens.filter((nom) => Number.isFinite(echeances.get(nom)))) {
    if (echeances.get(nom) > maintenant && aGarder.length < ANCIENS_CACHES_APP_MAX) {
      aGarder.push(nom);
    } else {
      aSupprimer.push(nom);
    }
  }

  await Promise.all(aSupprimer.map((nom) => caches.delete(nom)));

  // 3) Marqueurs orphelins (cache supprimé ou disparu autrement).
  const restants = new Set(await caches.keys());
  for (const cle of await entretien.keys()) {
    if (!restants.has(nomDuMarqueur(cle))) await entretien.delete(cle);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Un entretien impossible ne doit jamais empêcher l'activation.
      try {
        await entretenirCaches();
      } catch {
        /* stockage indisponible : les caches restent en l'état, l'app fonctionne */
      }
      // Navigation preload : le navigateur lance la requête en parallèle du
      // démarrage du worker (gain réel sur réseau lent). Ignoré si indisponible.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => null);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1) Toute méthode autre que GET : réseau pur, aucun cache (POST /souscrire...).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 2) Paiement : jamais d'interception, dans un sens comme dans l'autre.
  if (HOTES_PAIEMENT.some((hote) => url.hostname.includes(hote))) return;

  // 3) Origine différente (API déployée ailleurs, Google Fonts) : hors périmètre.
  if (url.origin !== self.location.origin) return;

  // 4) Argent / identité : le réseau décide, le cache n'existe pas pour ces URL.
  if (CHEMINS_SENSIBLES.some((motif) => motif.test(url.pathname))) return;

  // 5) Ouverture de l'app (navigation) : réseau d'abord, app shell en secours.
  if (request.mode === 'navigate') {
    event.respondWith(gererNavigation(event));
    return;
  }

  // 6) Données dynamiques de l'API : réseau d'abord, dernière copie en secours.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(gererDonnees(request));
    return;
  }

  // 7) Fichiers statiques de l'app : cache d'abord, rafraîchissement en fond.
  event.respondWith(gererStatique(request));
});

/**
 * Navigation : on sert la page fraîche, sinon l'app shell mis en cache.
 *
 * Dernier recours seulement : le cache applicatif d'une génération précédente
 * (encore en grâce). Mieux vaut afficher l'app de la version d'avant que l'écran
 * « hors ligne » — ses fichiers sont dans le même ancien cache, donc cohérents.
 */
async function gererNavigation(event) {
  try {
    const reponse = await (event.preloadResponse || fetch(event.request));
    if (reponse && reponse.ok) {
      const cache = await caches.open(CACHE_APP);
      cache.put(URL_INDEX, reponse.clone()).catch(() => null);
    }
    return reponse;
  } catch {
    const cache = await caches.open(CACHE_APP);
    return (
      (await cache.match(URL_INDEX)) ||
      (await cache.match(BASE_APPLICATION)) ||
      (await chercherDansAnciensCaches(new Request(URL_INDEX))) ||
      new Response('Rejoins’Moi est hors ligne.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

/**
 * Données : le réseau gagne toujours ; on ne garde la réponse que si elle est
 * vraiment bonne (200, réponse d'origine) et on s'en sert UNIQUEMENT si le réseau
 * est indisponible. Jamais de données périmées présentées comme fraîches.
 */
async function gererDonnees(request) {
  try {
    const reponse = await fetch(request);
    if (reponse && reponse.status === 200 && reponse.type === 'basic') {
      const cache = await caches.open(CACHE_DONNEES);
      await cache.put(request, reponse.clone());
      elaguer(cache);
    }
    return reponse;
  } catch (erreur) {
    const cache = await caches.open(CACHE_DONNEES);
    const secours = await cache.match(request);
    if (!secours) throw erreur;
    // En-tête informatif : le front peut signaler « données d'exemple »
    // (InfoBanner « Mode démonstration » déjà en place).
    const entetes = new Headers(secours.headers);
    entetes.set('X-RejoinsMoi-Cache', 'hors-ligne');
    return new Response(await secours.blob(), {
      status: 200,
      statusText: 'OK (cache hors ligne)',
      headers: entetes,
    });
  }
}

/**
 * Statique : réponse immédiate depuis le cache, mise à jour en tâche de fond.
 *
 * Si le cache v10 ne connaît pas le fichier ET que le réseau ne fournit rien
 * (hors ligne, ou 404 pour une empreinte de l'ancienne version encore réclamée
 * par un onglet resté ouvert), on cherche dans le cache applicatif précédent,
 * conservé quelques heures pour ce cas précis. Les caches de DONNÉES ne sont
 * jamais consultés ici : aucune donnée d'API ne ressort d'une ancienne version.
 */
async function gererStatique(request) {
  const cache = await caches.open(CACHE_APP);
  const enCache = await cache.match(request);
  const reseau = fetch(request)
    .then((reponse) => {
      if (reponse && reponse.status === 200 && reponse.type === 'basic') {
        cache.put(request, reponse.clone()).catch(() => null);
      }
      return reponse;
    })
    .catch(() => null);

  if (enCache) return enCache;

  const reponse = await reseau;
  if (reponse && reponse.ok) return reponse;

  return (await chercherDansAnciensCaches(request)) || reponse || Response.error();
}

/** Dernier recours : le cache applicatif d'une version précédente (jamais les données). */
async function chercherDansAnciensCaches(request) {
  try {
    const noms = await caches.keys();
    for (const nom of noms) {
      if (nom === CACHE_APP || !nom.startsWith('rejoinsmoi-app-')) continue;
      const ancien = await caches.open(nom);
      const trouve = await ancien.match(request);
      if (trouve) return trouve;
    }
  } catch {
    /* stockage refusé : on laisse l'appelant décider */
  }
  return null;
}

/** Garde le cache de données borné : on retire les entrées les plus anciennes. */
async function elaguer(cache) {
  const cles = await cache.keys();
  if (cles.length <= MAX_ENTREES_DONNEES) return;
  const enTrop = cles.slice(0, cles.length - MAX_ENTREES_DONNEES);
  await Promise.all(enTrop.map((cle) => cache.delete(cle)));
}

/* ─────────────────────── Notifications push (Web Push) ─────────────────────── */

/**
 * Écouteur « push » : le service de push du navigateur (Chrome, Firefox,
 * Safari…) appelle ce worker quand le serveur envoie une notification.
 * Le payload JSON contient { titre, corps, url }. Aucune donnée personnelle
 * n'est affichée : titre, corps et URL de destination uniquement.
 */
self.addEventListener('push', (event) => {
  let donnees = { titre: 'Rejoins’Moi', corps: 'Nouvelle notification', url: '/' };
  try {
    donnees = event.data ? event.data.json() : donnees;
  } catch {
    /* payload illisible : on garde les valeurs par défaut */
  }
  const options = {
    body: String(donnees.corps || ''),
    icon: `${BASE_APPLICATION}icons/icon-192.png`,
    badge: `${BASE_APPLICATION}icons/icon-192.png`,
    data: { url: donnees.url || '/' },
    // `tag` permet de remplacer une notification précédente du même tag plutôt
    // que d'en afficher plusieurs (ex. plusieurs messages non lus).
    tag: 'rejoinsmoi-notification',
    requireInteraction: false,
  };
  event.waitUntil(
    self.registration.showNotification(donnees.titre || 'Rejoins’Moi', options)
  );
});

/**
 * Écouteur « notificationclick » : l'utilisateur clique sur la notification.
 * On la ferme et on ouvre l'URL de destination (ex. /messages) dans l'app.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || BASE_APPLICATION;
  event.waitUntil(clients.openWindow(url));
});

/* Message du front (« mise à jour disponible ») : on active tout de suite. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
