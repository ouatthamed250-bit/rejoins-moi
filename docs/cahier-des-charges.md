# Rejoins'Moi — Cahier des charges

## 1. Concept général
Application ivoirienne à deux volets fusionnés en une seule plateforme sociale locale :
- **Mise en relation main-d'œuvre/métiers** : chercheurs de main-d'œuvre/travaux ↔ hommes de métier (électriciens, plombiers, couturiers, manœuvres, patrons de chantier, etc.), avec système de réputation.
- **Découverte locale géolocalisée** : tout acteur local (artisan, coiffeur, boulangerie, kiosque, église, clinique, pharmacie...) a un profil consultable, façon "Facebook des commerces de quartier".

## 2. Modèle économique
- Gratuit pour poster un besoin de main-d'œuvre ou chercher du travail.
- L'ouvrier/artisan recharge son compte de **500 FCFA** pour débloquer le numéro de contact de la personne qui cherche de la main-d'œuvre, une fois la mise en relation faite.
- Paiement via **Wave / Orange Money** (même logique que le projet Ma Racine).
- Point ouvert à trancher : pour le segment "journalier" (main-d'œuvre précaire, ~4 000-5 000 FCFA/jour), envisager une variante où le premier contact est gratuit et le paiement n'intervient qu'après confirmation de la mission, pour ne pas freiner l'adoption.

## 3. Feed / découverte (façon Facebook)
- Défilement vertical : cartes de profils d'établissements avec photo de devanture, nom, étoiles, tags produits/services en pastilles.
- **Deux compteurs affichés séparément** (jamais fusionnés) : nombre de visites du profil / nombre d'utilisateurs-clients (ex. clics sur le bouton d'action).
- Algorithme de personnalisation : démarre simple (proximité + note + tags déclarés), apprend au fur et à mesure des interactions (vues, recherches, clics) pour affiner ce qui est montré à chaque utilisateur — pas de modèle pré-entraîné figé, apprentissage progressif dès le lancement.

## 4. Recherche
- Barre de recherche par mot-clé/catégorie (ex. taper "kiosque").
- Résultats triés par proximité géographique, avec distance affichée.
- Filtres par catégorie : Tous / Alimentation / Beauté / Services / Artisanat (extensible).

## 5. Profil établissement
- **Deux photos à l'inscription** : photo de la devanture du local + photo de la personne qui vend/tient le commerce.
- Tags produits/services sélectionnés à l'inscription façon TikTok (ex. spaghetti, café au lait, café serré, rognon, petit pois, attiéké, jus naturels...).
- Étoiles/notes + commentaires des clients.
- Compteurs visites / utilisateurs affichés séparément.
- Bouton d'action dont le **texte s'adapte au nom de l'établissement** (ex. "Aller chez Chez Fatou").

## 6. Pharmacies & Cliniques — traitement spécifique
**Raison** : la déontologie médicale (via l'Ordre des médecins/pharmaciens, inspirée du droit proche du droit français applicable en Côte d'Ivoire) restreint fortement la publicité comparative pour les actes médicaux. Pour rester prudent :
- Section de menu **séparée** du feed social, pas de notes ni d'avis publics.
- Affichage minimal : nom, statut **"De garde" / "Non de garde"**, distance depuis la position de l'utilisateur, boutons Appeler / Itinéraire.
- Design distinct : **vert et blanc**, épuré, façon appli de VTC/taxi-moto — pas orange.
- Statut "de garde" auto-déclaré par l'établissement au lancement (option la plus réaliste pour démarrer) ; ajouter une mention "statut mis à jour par l'établissement, à confirmer par téléphone en cas d'urgence" pour limiter la responsabilité de l'app. Évolution possible plus tard vers une synchronisation avec le tableau de garde officiel de l'Ordre des Pharmaciens.

## 7. Conformité légale (Côte d'Ivoire)
- Toute collecte de données personnelles (photos, numéros de téléphone, localisation) doit faire l'objet d'une **déclaration auprès de l'ARTCI** (Loi n°2013-450 du 19 juin 2013) avant une ouverture publique large. ARTCI a déjà fait désactiver l'app Yango pour non-conformité — point à ne pas négliger avant un vrai lancement (pas bloquant pour une phase de test/tournée terrain).
- Pas de biométrie (empreinte, reconnaissance faciale) sans autorisation préalable spécifique de l'ARTCI — à éviter pour l'instant.
- Cliniques/pharmacies : pas de notation publique ni de mise en avant comparative des actes médicaux (voir section 6).

## 8. Identité visuelle
- Couleur dominante : **orange chaleureux, pas trop foncé** (type corail/mandarine), varié selon les pages, combiné au blanc — jamais criard.
- Section Pharmacies & Cliniques : **vert et blanc**, ambiance rassurante façon appli de VTC/taxi-moto.
- Animations et transitions fluides, "captives" (donnent envie de rester sur l'app) — pas génériques.
- Style général : "Facebook à l'ivoirienne chic".
- Structure barre du haut : menu/recherche à gauche, logo/infos contextuelles au centre, photo de profil utilisateur à droite.
- Navigation basse (bottom nav) : Accueil, Explorer, + (publier/poster), Messages, Profil.

## 9. Écrans de référence (déjà maquettés, voir images fournies par le fondateur)
1. Écran d'accueil / Feed
2. Recherche par catégorie
3. Fiche profil complet d'un établissement
4. Pharmacies & Cliniques (vert/blanc)
5. Inscription établissement (2 photos + tags produits/services)

## 10. Contexte marché (pour calibrer les priorités produit)
- Secteur informel ≈ 93,6% de l'emploi en Côte d'Ivoire, ≈ 60% du PIB — marché énorme et non structuré.
- Concurrent principal : **Mon Artisan** (depuis 2017, ~3 800 prestations/an, commission 20% sur la main-d'œuvre). Rejoins'Moi se différencie par un coût fixe de 500 FCFA par mise en relation, bien plus supportable pour un artisan/journalier.
- Mobile money archi-mûr : 85% des transactions digitales passent par mobile money ; Wave (~40% des transactions) et Orange Money (leader en abonnés) à intégrer en priorité.
- Le recrutement de main-d'œuvre journalière (4 000-5 000 FCFA/jour) passe aujourd'hui par des agences d'intérim classiques qui opèrent déjà par WhatsApp (photo pièce d'identité + numéro envoyés en message) — Rejoins'Moi digitalise un réflexe déjà existant plutôt que d'en créer un nouveau.
