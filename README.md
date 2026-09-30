# Rejoins'Moi

Application ivoirienne de mise en relation main-d'œuvre/métiers informels + découverte locale géolocalisée (Abidjan, Côte d'Ivoire).

## Structure du projet

```
rejoins-moi/
├── frontend/                  # Application web (React + Vite)
│   └── src/
│       ├── pages/             # Les 5 écrans principaux + écrans secondaires
│       ├── components/        # Composants réutilisables (cartes, badges, nav...)
│       ├── styles/            # Design tokens (couleurs, typographie)
│       ├── assets/            # Logos, images placeholder
│       ├── hooks/             # Hooks React custom (géoloc, auth, etc.)
│       └── utils/             # Fonctions utilitaires (calcul distance, etc.)
├── backend/                   # API (Node.js + Express)
│   └── src/
│       ├── routes/            # Endpoints API
│       ├── models/            # Schémas de données
│       ├── config/            # Connexion DB, variables d'environnement
│       └── middleware/        # Auth, validation, etc.
├── docs/
│   └── cahier-des-charges.md  # Spécifications fonctionnelles complètes
└── PROMPT_DEEPSEEK.md         # Prompt à donner à DeepSeek pour générer le code complet
```

## Comment l'utiliser

1. Ouvre ce dossier dans ton éditeur/terminal local.
2. Ouvre `PROMPT_DEEPSEEK.md`, copie tout son contenu.
3. Donne-le à DeepSeek (en local ou via son interface) en lui demandant de compléter chaque fichier squelette selon les instructions.
4. `docs/cahier-des-charges.md` contient toutes les décisions produit prises jusqu'ici — à garder comme référence pendant tout le développement.

## Mise en ligne (MongoDB, HTTPS, PWA)

➡️ **Mode d'emploi complet : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md)**
(base de données MongoDB Atlas gratuite, déploiement de l'API et du frontend en HTTPS,
vérifications pas à pas).

Sans base de données branchée, l'API répond `503` sur les routes `/jobs`, `/users/artisans`
et `/subscriptions`, et le frontend bascule sur ses données de démonstration.

Deux commandes suffisent pour prouver que tout est en ordre :

```powershell
cd backend
npm run verifier:base          # routes sans 503 + inscription réellement persistée
npm run verifier:abonnement    # deux formules (semaine/mois) : prix, durées, prolongations
```

## Stack retenue (par défaut, ajustable)

- **Frontend** : React + Vite + Tailwind CSS (rapide à monter, marche en web mobile / PWA, facilite le passage éventuel vers React Native plus tard)
- **Backend** : Node.js + Express + MongoDB (schéma flexible, adapté à des profils hétérogènes : artisan, kiosque, clinique, église...)
- **Paiement** : intégration Wave + Orange Money (CinetPay comme passerelle recommandée)
- **Géolocalisation** : API navigateur (web) + calcul de distance côté backend

Si tu préfères une autre stack (React Native pour une vraie app mobile native, Firebase au lieu de MongoDB, etc.), dis-le à DeepSeek en tête de prompt — la logique métier dans le cahier des charges reste valable quelle que soit la techno.
