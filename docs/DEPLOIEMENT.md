# Mise en ligne de Rejoins'Moi — MongoDB, HTTPS, déploiement

Ce document est le mode d'emploi **complet** pour passer de « l'app tourne sur mon PC » à
« l'app est en ligne en HTTPS et j'inscris de vrais artisans ».

Il répond aux trois blocages identifiés :

| Blocage | Cause | Solution | Où |
| --- | --- | --- | --- |
| `/jobs`, `/users/artisans`, `/subscriptions` répondent **503** | aucune base MongoDB branchée | cluster Atlas gratuit (M0) | §1 |
| Le bouton « Installer » et le mode hors ligne **ne fonctionnent pas** | un service worker (PWA) exige **HTTPS** | héberger le frontend (Vercel/Netlify) et l'API (Render/Railway) | §2 à §4 |
| Impossible de tester les deux formules d'abonnement sur le terrain | il faut une URL publique | même déploiement | §5 |

Ordre recommandé : **§1 (base de données) → §2 (GitHub) → §3 (API) → §4 (frontend) → §5 (test)**.
Comptez 30 à 45 minutes pour la première mise en ligne.

> ⚠️ **Aucun paiement n'est simulé dans ce projet.** Tant que les clés CinetPay ne sont pas
> configurées, le déblocage de contact et la souscription répondent `501` et **rien n'est
> activé**. Les tarifs d'abonnement (700 FCFA/semaine et 2 500 FCFA/mois) restent marqués
> « tarif provisoire » dans l'interface.

---

## §1. MongoDB Atlas (gratuit, sans rien installer) — 5 minutes

MongoDB Atlas héberge la base dans le cloud : rien à installer sur votre PC ni sur les
téléphones. L'offre **M0 (gratuite, 512 Mo)** suffit largement pour la tournée terrain.

### 1.1 Créer le compte et le cluster

1. Ouvrir <https://www.mongodb.com/cloud/atlas/register> et créer un compte
   (Google, ou e-mail + vérification). *Vérifiable uniquement par vous : l'activation se
   fait par e-mail.*
2. **Create a cluster** → choisir **M0 / FREE** → fournisseur **AWS** → région
   **Europe (Ireland) eu-west-1** (la plus proche d'Abidjan parmi les régions gratuites) →
   nom du cluster : `rejoins-moi` → **Create Deployment**.
3. Atlas propose « Create a database user » : gardez l'utilisateur proposé ou mettez
   `rejoinsmoi`, cliquez sur **Autogenerate Secure Password**, puis **copiez ce mot de
   passe tout de suite** (il ne sera plus affiché). Rôle : *Read and write to any database*.

### 1.2 Autoriser la connexion

4. Menu **Network Access** → **Add IP Address**.
   - Pour tester depuis votre PC (adresse qui change) **et** pour que Render/Railway (IP
     dynamiques) puissent se connecter : choisissez **Allow Access from Anywhere**
     (`0.0.0.0/0`).
   - La base reste protégée par le mot de passe de l'utilisateur ; vous pourrez resserrer
     cette règle plus tard si nécessaire.

### 1.3 Récupérer l'URI complète

5. **Clusters** → bouton **Connect** → **Drivers** → **Node.js** → copiez la chaîne, qui
   ressemble à :

   ```
   mongodb+srv://rejoinsmoi:<db_password>@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
   ```

6. Remplacer `<db_password>` par le mot de passe copié à l'étape 3.
   **Si le mot de passe contient `@ # / : ?`**, encodez-le : `@` devient `%40`, `#` devient
   `%23`, `/` devient `%2F`.

### 1.4 La brancher sur le projet

7. Dans le dossier `backend/`, copiez `.env.example` en `.env`, puis renseignez :

   ```ini
   MONGODB_URI=mongodb+srv://rejoinsmoi:MOT_DE_PASSE@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=rejoins-moi
   JWT_SECRET=<une longue chaîne aléatoire, différente de l'exemple>
   ```

   Le nom de base est forcé à `rejoins-moi` : sans cela, une URI Atlas sans nom de base
   créerait une base nommée `test` (piège classique).

### 1.5 Vérifier : les 503 disparaissent et les inscriptions persistent

8. Dans `backend/` :

   ```powershell
   npm run verifier:base
   ```

   Ce script **démarre réellement l'API**, puis :
   - vérifie que `/api/health` répond `baseDonnees: "connectée"` ;
   - interroge **toutes** les routes publiques et échoue si l'une répond encore `503` ;
   - **crée un artisan de test par l'API**, se reconnecte, lit `/api/users/me` ;
   - relit le compte **directement en base** (preuve de persistance, plus le hash du mot de passe) ;
   - vérifie qu'**aucun abonnement n'est activé sans paiement confirmé** ;
   - supprime le compte de test (ajoutez `-- --garder` pour le conserver).

   Sortie attendue : `✅ Base de données : N/N vérifications réussies.`

9. Facultatif mais recommandé avant la tournée : remplir la base avec le jeu de démonstration
   (établissements, pharmacies, annonces, comptes de test) :

   ```powershell
   npm run seed
   ```

   ⚠️ `npm run seed` **vide** les collections avant de les recréer : ne le lancez jamais sur
   une base contenant de vraies inscriptions.

### 1.6 En cas de problème (le script vous le dit déjà en clair)

| Message | Cause | Correction |
| --- | --- | --- |
| `Nom d'hôte introuvable` | URI incomplète, ou DNS « SRV » bloqué (VPN/réseau d'entreprise) | recopier l'URI complète depuis Atlas > Connect > Drivers |
| `Mot de passe refusé` | caractères spéciaux non encodés (`@` → `%40`), ou mot de passe réinitialisé | réinitialiser dans Atlas > Database Access |
| `IP non autorisée` | Network Access | ajouter votre IP ou `0.0.0.0/0` |
| `Délai dépassé` | cluster M0 en veille, réseau lent | ouvrir la console Atlas (le cluster se réveille), relancer |
| `baseDonnees: "indisponible"` | le serveur tourne sans base | vérifier `backend/.env` (fichier bien nommé `.env`, pas `.env.txt`) |

> **Ce qui ne peut pas être fait à votre place** : la création du compte Atlas exige une
> vérification par e-mail et une session navigateur. Si vous préférez malgré tout que je
> crée le cluster à votre place, fournissez une clé API Atlas
> (`ATLAS_PUBLIC_KEY` / `ATLAS_PRIVATE_KEY`) et l'identifiant d'organisation : la création
> du cluster, de l'utilisateur et de la règle IP peut se faire par API (§7).

---

## §2. Mettre le code sur GitHub (nécessaire pour Render/Vercel)

Le projet n'est pas encore un dépôt Git : c'est la première chose à faire, car Render et
Vercel déploient **depuis un dépôt** (public ou privé, les deux sont gratuits).

```powershell
cd "c:\Users\Mr ZOGBO\Desktop\rejoins-moi"
git init
git add .
git commit -m "Rejoins'Moi : socle frontend + API + PWA + deux formules d'abonnement"
git branch -M main
git remote add origin https://github.com/VOTRE_COMPTE/rejoins-moi.git
git push -u origin main
```

Le fichier `.gitignore` à la racine exclut déjà `node_modules/`, `dist/` et **les fichiers
`.env`** : le mot de passe MongoDB ne doit **jamais** partir sur GitHub.

> Si `git push` demande une connexion : GitHub n'accepte plus le mot de passe du compte,
> il faut un **Personal Access Token** (GitHub > Settings > Developer settings > Tokens)
> utilisé comme mot de passe, ou l'application GitHub Desktop.

---

## §3. Déployer l'API (backend) — Render, gratuit, HTTPS automatique

Le fichier `render.yaml` à la racine décrit le service : Render s'occupe du reste.

1. <https://render.com> → **Get Started** → connexion avec GitHub.
2. **New** → **Blueprint** → sélectionner le dépôt `rejoins-moi` → **Connect**.
3. Render lit `render.yaml` et affiche le service `rejoins-moi-api`. Il demande les
   variables marquées secrètes :
   - `MONGODB_URI` : l'URI Atlas du §1.3 ;
   - `CLIENT_URL` : laissez vide pour l'instant (à compléter au §4), ou mettez
     `http://localhost:5173` en attendant.
4. **Apply** → Render installe les dépendances (`npm ci`) et démarre `npm start`.
5. Une fois « Live », ouvrez :

   ```
   https://rejoins-moi-api.onrender.com/api/health
   ```

   Réponse attendue :

   ```json
   { "ok": true, "baseDonnees": "connectée", "paiement": { "configure": false },
     "abonnement": { "formules": [ { "cle": "artisan_hebdo", "prixFcfa": 700 },
                                   { "cle": "artisan_mensuel", "prixFcfa": 2500 } ],
                     "periodicitesActives": ["hebdomadaire", "mensuel"],
                     "formuleParDefaut": "artisan_hebdo" } }
   ```

   - `baseDonnees: "connectée"` = la base est branchée ✅
   - `paiement.configure: false` = normal tant que CinetPay n'est pas configuré (501, aucun
     faux paiement).

> **Offre gratuite Render** : le service **s'endort après ~15 minutes** sans trafic. Le
> premier appel suivant met 30 à 60 secondes à répondre. Avant d'aller sur le terrain,
> ouvrez l'application une fois (ou `/api/health`) pour le réveiller.

### Variante Railway (équivalent)

1. <https://railway.app> → **New Project** → **Deploy from GitHub repo** → choisir le dépôt.
2. **Settings** → **Root Directory** = `backend` (le `Procfile` s'en occupe ensuite).
3. **Variables** → coller les mêmes clés que dans `backend/.env.example`
   (`MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL`, `SUBSCRIPTION_*`, plus tard `CINETPAY_*`).
4. Railway attribue un domaine HTTPS (`Settings > Networking > Generate Domain`) :
   `https://rejoins-moi-api-production.up.railway.app`.

---

## §4. Déployer le frontend (PWA) — Vercel, gratuit, HTTPS automatique

### Avec Vercel (recommandé : le fichier `frontend/vercel.json` est déjà prêt)

1. <https://vercel.com> → **Add New…** → **Project** → **Import Git Repository** → le dépôt
   `rejoins-moi`.
2. **Root Directory** : `frontend` (bouton *Edit*). Framework détecté : **Vite**.
3. **Environment Variables** : ajouter

   | Nom | Valeur |
   | --- | --- |
   | `VITE_API_URL` | `https://rejoins-moi-api.onrender.com` (l'URL HTTPS du §3, **sans slash final**) |

4. **Deploy** → l'URL publique ressemble à `https://rejoins-moi.vercel.app`.

### Avec Netlify (équivalent : `frontend/netlify.toml` est déjà prêt)

1. <https://app.netlify.com> → **Add new site** → **Import an existing project** → GitHub.
2. **Base directory** : `frontend` — commande `npm run build`, dossier publié `dist`
   (déjà écrit dans `netlify.toml`).
3. **Site configuration > Environment variables** : `VITE_API_URL` = l'URL du §3.
4. **Deploy site** → l'URL ressemble à `https://rejoins-moi.netlify.app`.

### ⚠️ Dernière étape, indispensable : autoriser le frontend dans l'API

L'API refuse par défaut les origines inconnues (sécurité CORS). Retournez sur Render (ou
Railway) → **Environment** → mettez

```
CLIENT_URL=https://rejoins-moi.vercel.app
```

(les deux URL séparées par une virgule si vous avez Vercel **et** Netlify, plus
`http://localhost:5173` pour continuer à développer). Enregistrez : l'API redémarre seule.

Sans cette étape, le frontend affichera « Serveur injoignable » et basculera sur ses
données de démonstration.

---

## §5. Vérifier l'installation PWA (elle exige HTTPS, donc l'URL publique)

Sur l'URL HTTPS du §4 (`https://rejoins-moi.vercel.app`) :

1. **Contrôles de base** — ouvrez directement ces deux adresses dans le navigateur :
   - `…/manifest.json` → doit afficher du JSON (nom, icônes, `start_url: "/"`) ;
   - `…/sw.js` → doit afficher du JavaScript (le service worker).
2. **Android (Chrome)** : ouvrez l'app → menu ⋮ → **Installer l'application** (ou le bouton
   « Installer l'appli » affiché dans l'app). L'icône apparaît sur l'écran d'accueil et
   l'app s'ouvre en plein écran, sans barre d'adresse.
3. **iPhone (Safari)** : bouton **Partager** → **Sur l'écran d'accueil**.
4. **Mode hors ligne** : ouvrez l'app une première fois (pour que le service worker
   installe la coquille), activez le mode avion, rouvrez : l'app doit s'afficher avec les
   dernières données connues et un message « hors ligne » — c'est le comportement prévu
   pour la tournée terrain.
5. **Ce qui ne fonctionne JAMAIS hors ligne (par conception)** : paiements CinetPay,
   inscription, connexion, abonnements. Le service worker ne met **jamais** en cache ces
   appels (aucun risque de paiement fantôme).

> En développement local (`http://192.168.x.x:5173`), ni le service worker ni le bouton
> d'installation n'apparaissent : c'est normal, le navigateur exige `https://` ou
> `localhost`. Testez donc systématiquement l'installation sur l'URL Vercel/Netlify.

---

## §6. Après la mise en ligne : ce qui reste à trancher

1. **Tarifs d'abonnement.** Deux formules sont vendues en parallèle, prix **provisoires** :
   - `artisan_hebdo` — 700 FCFA / 7 jours (porte d'entrée présélectionnée) ;
   - `artisan_mensuel` — 2 500 FCFA / 30 jours (ancien prix de référence).

   L'interface affiche « tarif provisoire » sur chacune. Après la tournée terrain, pour ne
   garder que la formule préférée, une seule variable suffit (aucune ligne de code) :

   ```ini
   SUBSCRIPTION_PERIODICITY=mensuel        # ou: hebdomadaire
   ```

   *(pour tester les deux, laissez `hebdomadaire,mensuel` — c'est la valeur par défaut).*
   Pour changer un prix sans redéployer : `SUBSCRIPTION_PRICE_WEEKLY_FCFA=…` ou
   `SUBSCRIPTION_PRICE_MONTHLY_FCFA=…`.
2. **Paiement réel (CinetPay)** : nécessaire pour encaisser. Créez un compte marchand sur
   <https://cinetpay.com>, puis renseignez `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`,
   `CINETPAY_SECRET_KEY`, `CINETPAY_NOTIFY_URL` (`https://<backend>/api/subscriptions/webhook/cinetpay`
   et la même pour les contacts : `/api/jobs/webhook/cinetpay`). `GET /api/health` doit
   alors afficher `paiement.configure: true`.
3. **Décisions produit encore ouvertes** (à valider, le code s'y adaptera) : accès Jobs
   réservé aux abonnés, période de test des deux formules, purge des photos base64 vers un
   stockage objet (Cloudinary/S3), statut `expire` calculé par un cron.

---

## §7. Ce dont j'ai besoin pour terminer à votre place

Trois choses seulement me manquent, et je les exécute ensuite intégralement :

| Ce que vous me donnez | Ce que je fais immédiatement |
| --- | --- |
| `MONGODB_URI` (Atlas) | je la mets dans `backend/.env`, je lance `npm run verifier:base`, puis `npm run seed`, et je vous renvoie le rapport (routes 200, inscription persistée) |
| un jeton Vercel (`VERCEL_TOKEN`) | je déploie le frontend et je vous donne l'URL HTTPS : `npx vercel deploy --prod --yes --cwd frontend --token=…` |
| un jeton Railway (`RAILWAY_TOKEN`) **ou** une clé Render (`RENDER_API_KEY`) | je déploie l'API et je vous donne l'URL HTTPS + `/api/health` |

> 🔐 **Ces jetons donnent un accès complet à vos comptes.** Créez-les pour l'occasion,
> transmettez-les, puis **révoquez-les** (Vercel : Account Settings > Tokens ;
> Railway : Account > Tokens ; Render : Account Settings > API Keys). Je n'écris aucun
> secret dans le dépôt : tout va dans `.env` (exclu par `.gitignore`) ou dans les
> variables d'environnement de l'hébergeur.

Rappel : la création du **compte** Atlas/Render/Vercel (e-mail, vérification,
éventuellement carte bancaire de vérification) ne peut pas être automatisée de mon côté.

---

## §8. Commandes utiles (pense-mémo)

| Commande (dans le dossier indiqué) | Effet |
| --- | --- |
| `backend/ npm run dev` | lance l'API en local (port 4000) |
| `backend/ npm run verifier:abonnement` | vérifie les deux formules, les durées et les prolongations (sans base) |
| `backend/ npm run verifier:base` | vérifie la base : plus de 503, inscription persistée, aucun faux paiement |
| `backend/ npm run verifier` | les deux d'un coup |
| `backend/ npm run seed` | jeu de démonstration (⚠️ vide les collections) |
| `frontend/ npm run dev` | lance l'app en local (`http://localhost:5173`, proxy `/api` → 4000) |
| `frontend/ npm run build` | build de production (dossier `dist/`) |
| `frontend/ npx vercel deploy --prod` | déploie le frontend (si la CLI est connectée) |
