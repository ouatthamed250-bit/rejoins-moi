# Sauvegarde et restauration de la base

La production (cluster Atlas M0, base `rejoins-moi`) ne contient que des données
vivantes : comptes artisans, fiches revendiquées, avis, abonnements. Ce document
décrit comment en produire une copie **chiffrée**, où elle est rangée, et comment
la restaurer sans jamais écraser la production par erreur.

> ⚠️ **Ne jamais stocker le mot de passe de sauvegarde dans le code source ou sur
> GitHub.** Il vit dans un gestionnaire de mots de passe (ou une enveloppe
> scellée), jamais dans ce dépôt, jamais dans un fichier `backups/`.

---

## 1. Lancer une sauvegarde

```bash
cd backend
npm run sauvegarder:base
```

Le script :

1. demande le mot de passe **deux fois** (saisie masquée, 8 caractères minimum) ;
2. lit toutes les collections et tous leurs documents ;
3. sérialise en EJSON (les `ObjectId` et les `Date` gardent leur type), compresse
   en GZIP, puis chiffre en **AES-256-GCM** (clé dérivée du mot de passe par
   scrypt, sel et IV aléatoires, tag d'authentification) ;
4. écrit le fichier, puis **le relit et le déchiffre** pour prouver qu'il est
   restaurable ;
5. affiche la taille finale et le nombre de documents par collection.

Pour un lancement **sans interaction** (tâche planifiée, script) :

```powershell
# PowerShell — la variable ne survit pas à la session
$env:BACKUP_PASSWORD = "votre-mot-de-passe"
npm run sauvegarder:base
```

```bash
# bash
BACKUP_PASSWORD="votre-mot-de-passe" npm run sauvegarder:base
```

En cas d'échec (MongoDB injoignable, mot de passe refusé), **aucun fichier**
n'est produit : le script écrit d'abord, vérifie ensuite, et n'annonce un succès
qu'après la contre-vérification.

## 2. Où se trouve le fichier

```
rejoins-moi/
└── backups/
    └── backup-rejoins-moi-2026-11-26_12-10-09.json.gz.enc
```

- À la **racine du dépôt**, dans `backups/`, dossier **ignoré par Git**
  (`.gitignore`) : les archives contiennent des données personnelles.
- Nom = `backup-rejoins-moi-<AAAA-MM-JJ>_<HH-MM-SS>.json.gz.enc`. L'heure est
  incluse pour qu'une nouvelle sauvegarde **n'écrase jamais** la précédente.
- Format : `« RMBK1 » (5 o) | sel scrypt (16 o) | IV (12 o) | tag GCM (16 o) | données`.
  Sans le mot de passe, le contenu est illisible — y compris pour nous.
- Ordre de grandeur mesuré (nov. 2026) : **616 Ko** pour 6 798 documents
  répartis sur 7 collections (JSON brut : 5,76 Mo).

## 3. Restaurer (procédure en 5 étapes)

1. **Base de test d'abord.** Même cluster Atlas, autre nom :
   `rejoins-moi-restore-test`. On ne restaure jamais directement sur
   `rejoins-moi` : une restauration partielle écraserait les données réelles.
2. **Mot de passe** dans `BACKUP_PASSWORD` (celui utilisé à la sauvegarde).
3. **Déchiffrer** : `dechiffrer()` de `backend/scripts/sauvegarder-base.js`
   (vérifie la signature `RMBK1`, dérive la clé par scrypt, authentifie le tag
   GCM) puis `gunzipSync()`.
4. **Restaurer** : `EJSON.parse()` (jamais `JSON.parse`, qui laisserait des
   champs `$oid` invalides) puis `insertMany()` par lots de 500 sur la base de
   test.
5. **Contrôler** : comparer les comptages collection par collection avec la
   production, vérifier un document échantillon, puis seulement ensuite décider
   d'une bascule (`MONGODB_DB_NAME`). Terminer par un `dropDatabase()` sur la
   base de test.

Le script de preuve utilisé pour valider cette procédure
(`backend/scripts/tester-restauration.js`) a été supprimé après usage ; les
commandes ci-dessous le remplacent :

```powershell
cd backend
$env:BACKUP_PASSWORD = "votre-mot-de-passe"                        # 1. mot de passe
$env:MONGODB_URI_TEST = "mongodb+srv://…/rejoins-moi-restore-test" # 2. base de test
```

```bash
# 3-4. déchiffrer puis restaurer dans la base de test
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import mongoose from 'mongoose';
import { dechiffrer } from './scripts/sauvegarder-base.js';
const { EJSON } = mongoose.mongo.BSON;
const archive = EJSON.parse(gunzipSync(dechiffrer(readFileSync(process.argv[1]), process.env.BACKUP_PASSWORD)).toString('utf8'));
const conn = mongoose.createConnection(process.env.MONGODB_URI_TEST, { dbName: 'rejoins-moi-restore-test' });
await conn.asPromise();
for (const [nom, docs] of Object.entries(archive.collections)) {
  if (docs.length) await conn.db.collection(nom).insertMany(docs, { ordered: false });
}
console.log('Restauré :', archive.totalDocuments, 'document(s)');
await conn.close();
" ../backups/backup-rejoins-moi-AAAA-MM-JJ_HH-MM-SS.json.gz.enc
```

```bash
# 5. contrôler les comptages, puis supprimer la base de test
mongosh "$MONGODB_URI_TEST" --eval "db.getCollectionNames().forEach(c => print(c, db[c].countDocuments())); db.dropDatabase()"
```

Les index ne sont pas dans l'archive : Mongoose les recrée au démarrage du
serveur (`autoIndex`). L'index `2dsphere` des établissements est donc rétabli
automatiquement à la première connexion.

## 4. Garde-fous sur les scripts destructeurs

`npm run seed` (vide 5 collections) et `npm run importer:etablissements`
(écrit 6 724 fiches, `--remplacer` en supprime) refusent désormais de toucher la
production sans confirmation humaine :

- détection de la cible (`NODE_ENV=production`, hôte `*.mongodb.net`, ou base
  `rejoins-moi` hors MongoDB local) par `backend/src/utils/gardeFouProduction.js` ;
- message `DANGER : Tentative de modification de la base de production. Action annulée.` ;
- sans terminal interactif, le script s'arrête (aucune variable d'environnement
  ne permet de contourner) ;
- dans un terminal, il faut taper exactement
  `OUI JE VEUX EFFACER LA PRODUCTION` pour continuer.

`npm run importer:etablissements -- --simulation` n'écrit rien : il reste
utilisable sans confirmation.

## 5. À retenir

- Une sauvegarde **non testée** n'est pas une sauvegarde : la restauration a été
  prouvée sur `rejoins-moi-restore-test` (comptages identiques, base détruite
  ensuite).
- Fréquence conseillée : une sauvegarde avant chaque opération risquée
  (import, migration, correction de données) et une sauvegarde hebdomadaire.
- `backups/` ne doit jamais être commité, copié dans `frontend/public/` ni
  envoyé par e-mail en clair.

