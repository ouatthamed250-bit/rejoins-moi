# Rapport d’audit — illustrations « crayon » du 16/11/2026

> **Statut : livré en local, NON poussé, NON déployé.** Aucun `git push`, aucune
> publication GitHub Pages, aucun redéploiement Render n’a été exécuté. La suite
> (`commit` puis `push`) attend votre autorisation explicite.

Ce rapport répond à une seule question : *les 13 nouveaux dessins sont-ils
réellement branchés, et l’application est-elle toujours saine ?* Chaque affirmation
ci-dessous est accompagnée de la commande qui la produit, pour que vous puissiez la
rejouer vous-même.

---

## A. Ce qui a été livré

1. **13 dessins** ajoutés à la planche `src/components/illustrations/tracesEsquisse.jsx`
   (31 dessins au total) :
   `kiosque`, `eglise`, `mosquee`, `pharmacie`, `salonBeaute`, `atelierCouture`,
   `chantier`, `electricite`, `plomberie`, `taxiMoto`, `mobileMoney`, `enveloppe`,
   `horsLigne`.
2. **Un module de choix partagé**, `src/components/illustrations/dessinsContexte.js`,
   pour que le feed, les annonces de main-d’œuvre et les bandeaux ne divergent
   jamais : une seule table `REGLES_DESSIN` (15 règles) + un repli par catégorie.
3. **Un contrôle automatique**, `scripts/verifier-dessins.mjs` (`npm run
   verifier:dessins`) : 73 vérifications, sans serveur ni base.
4. **Un script de démonstration enrichi** : `demoData.js` reçoit une mosquée
   (« Mosquée An-Nour ») pour que le dessin `mosquee` soit visible hors ligne, comme
   l’église l’était déjà.

## B. Règle de choix (et pourquoi elle est ainsi)

| Ordre | Source | Exemple réel (base de production) |
|---|---|---|
| 1 | métier de l’annonce | « Plombier » → `plomberie` |
| 2 | sous-catégorie de la fiche | « Transfert d'argent » → `mobileMoney` |
| 3 | tags choisis par le gérant | « Pharmacie » → `pharmacie` |
| 4 | catégorie (repli) | `alimentation` → `marmite` |

Le **nom** de l’établissement n’est jamais lu : « Salon de thé » n’est pas un salon de
beauté, et une heuristique sur les noms se tromperait sans preuve. Les expressions
régulières ne sont **pas globales** (`/g`) : une regex globale conserve un `lastIndex`
entre deux appels et raterait une fiche sur deux. Un test le vérifie explicitement
(« coiffeur, 2ᵉ appel »).

## C. Preuve que l’API fournit bien la donnée

Le choix repose sur `sousCategorie` et `tags`. Vérifié dans le code **et** sur l’API
locale (MongoDB Atlas connectée) :

```
frontend> node -e "…"   → backend/src/models/Establishment.js
  255 | sousCategorie: this.sousCategorie || '',
  262 | tags: this.tags || [],
backend/src/routes/establishments.js
  483 | return doc.toCardJSON({ distanceKm, base: basePublique(req) });
  811 | etablissement: doc.toCardJSON({ distanceKm, base: basePublique(req) }),
```

Réponse réelle de `GET /api/establishments?limit=3&sort=recent` (16/11/2026) :

```
total=6721
Hhhh | cat=alimentation | sousCat= | tags=Spaghetti,Garba,Café serré
Western Union, Point Mobile Money | cat=services | sousCat=Transfert d'argent | tags=Transfert d'argent
```

Répartition par catégorie au même instant : alimentation 3 949 · services 1 365 ·
beauté 983 · artisanat 423 · commerce 0. Les sous-catégories observées
(`Restauration`, `Cosmetiques`, `Transfert d'argent`, `Quincaillerie`) tombent
toutes sur le dessin attendu, vérifié par `npm run verifier:dessins`.

## D. Où chaque dessin est branché

| Écran | Composant modifié | Dessin posé | Preuve |
|---|---|---|---|
| Accueil — fiche sans photo | `PhotoSecours.jsx` | selon métier/sous-catégorie/tags | 9 fiches de démo → 7 dessins distincts |
| Accueil — bandeau « dernière visite » / « données d'exemple » | `InfoBanner.jsx` | `horsLigne` | capture `accueil-demo.png` |
| Accueil — catégorie vide | `EmptyState.jsx` | catégorie choisie (`croixSante`, `kiosque`…) | capture `vide-sante.png` |
| Recherche — aucun résultat | `EmptyState.jsx` | `repere` | capture `recherche-vide.png` |
| Recherche — bandeau démo | `InfoBanner.jsx` | `horsLigne` | idem |
| Messages — liste vide | `EmptyState.jsx` | `enveloppe` | `git diff Messages.jsx` |
| Main-d’œuvre / Jobs — pastille de métier | `Jobs.jsx`, `JobBoard.jsx` | `plomberie`, `electricite`, `chantier`, `atelierCouture`, `salonBeaute`, `taxiMoto` | `DESSIN_PAR_CATEGORIE` + `metier` |
| Pharmacies & Cliniques — liste vide | `EmptyState.jsx` | `pharmacie` (teinte `text-health`) | `git diff PharmaciesCliniques.jsx` |
| Pharmacies & Cliniques — serveur injoignable | `InfoBanner.jsx` | `horsLigne` | capture `pharmacies.png` |
| Fiche établissement | `EstablishmentProfile.jsx` | passe désormais `categorie`/`tags`/`sousCategorie` | `git diff` |
| Profil (non connecté) | `EmptyState.jsx` | `maison` | capture `profil.png` |
| Abonnement artisan | `AbonnementArtisan.jsx` | `mobileMoney` (remplace l’icône portefeuille) | `git diff` |
| Inscription — « Demande envoyée » | `InfoBanner.jsx` | `kiosque` | `git diff RegisterEstablishment.jsx` |

Le dessin d’état vide reste **décoratif** (`aria-hidden`) : il n’ajoute aucune
information à annoncer, et le titre porte déjà le sens. L’illustration est en
`position: absolute` + `-z-10` dans un contexte `isolate` : elle ne pousse aucun
élément, ne décale aucune mise en page et ne capte aucun clic
(`pointer-events-none`).

## E. Captures (390 × 844, Chrome piloté, `sansPhoto` = fiches sans photo)

Dossier `frontend/captures-signature/apres-16-11/` :

| Fichier | Ce qu’il montre |
|---|---|
| `accueil-demo.png` | 9 cartes, 9 dessins ; bannière `horsLigne` dans le coin bas-droit |
| `vide-sante.png` | état vide « Aucun établissement dans cette catégorie » + `croixSante` |
| `recherche-vide.png` | état vide « Aucun résultat » + `repere` |
| `pharmacies.png` | deux `horsLigne` (bandeau + état vide) |
| `profil.png` | état vide de connexion + `maison` |
| `inscription.png` | formulaire, aucun dessin (aucun état vide : volontaire) |

Mesures extraites du `_rapport.json` (accueil) :

```
photoSecours 9 | distincts marmite, etalMarche, salonBeaute, boiteOutils, eglise, mosquee, atelierCouture
DOM: palmier@ornement · horsLigne@conteneur · marmite · etalMarche · marmite · salonBeaute ·
     boiteOutils · eglise · mosquee · boiteOutils · atelierCouture
```

Avant (`captures-signature/apres/_rapport.json`, 5 dessins distincts) :
`marmite, etalMarche, motifWax, boiteOutils, paillote` — l’église affichait une
paillote et le salon de beauté un motif wax ; ils ont maintenant leur propre dessin.

## F. Vérifications automatisées (rejouées le 16/11/2026)

| Commande | Résultat |
|---|---|
| `cd frontend && npm run verifier:dessins` | **73 vérifications passées** — 31 dessins, 15 règles, aucune clé morte |
| `npm run verifier:pwa` | **« Tout est conforme »** (8 contrôles OK : invitations fermées, `?pwa=1`, état « installee ») |
| `npm run verifier:sante` | **21/21** (bloc H « Pharmacies & Cliniques ») |
| `npm run verifier:mentions` | **29/29** (bloc G « Textes légaux ») |
| `npm run verifier:phrase` | **14/14** (bloc I « Phrase du fil ») |
| `npm run verifier:permissions` | **69 réussies, 0 échec** |
| `npm run verifier:barres` | **257 vérifications réussies** (bloc du bas posé, uni, opaque, mesuré) |
| `npm run verifier:demarrage:rapide` | **37 réussies, 0 échec** (dont : réseau coupé → échec en 2 ms) |
| `cd backend && node scripts/verifier-securite.js` | **47/47** (dont `401 ×8 → 429`, webhook non signé 401, signature valide 200) |
| `npm run verifier:parcours` | **8 réussies, 2 échecs** — voir §J |
| `npx vite build` | ✅ 97 modules, 458,91 kB (132,52 kB gzip) |

## G. Sécurité — ce que ces 47 contrôles couvrent réellement

| Contrôle | Résultat obtenu |
|---|---|
| `/api/admin/login` martelé | `401 → 401 → 401 → 401 → 401 → 401 → 401 → 401 → 429` : le limiteur coupe avant la 9ᵉ tentative |
| Webhook paiement | corps non signé **401**, signature falsifiée **401**, signature valide **200** |
| Photos identiques sur deux fiches | toujours refusées (règle du 30/09 conservée) |
| Autorisation de localisation | refus géré : écran utile, geste ou carte proposés ; distances déjà obtenues conservées |
| Deux comptes, mêmes numéros | cloisonnement vérifié par `verifier:permissions` (69/69) |

Rien de tout cela n’a été modifié par ce lot : ces chiffres servent de **non-régression**,
pas de nouvelle preuve de sécurité.

## H. Limites de l’audit (à lire avant de pousser)

1. **Pas d’audit de charge.** 6 721 fiches en base ; les tests couvrent la pagination
   et la proximité, pas 100 utilisateurs simultanés.
2. **L’API de production Render ne répond pas** depuis ce poste (`/api/health` sur
   `:5000` muet ; `:4000` local OK). Les parcours ont donc été rejoués sur l’API
   **locale** branchée sur la base Atlas, avec un `dist` construit pour l’occasion
   (`VITE_API_URL=http://127.0.0.1:4000`), puis reconstruit sans variable. Le
   comportement « écran injoignable » observé sans cette variable est conforme
   (`verifier:demarrage:rapide`, 4/5).
3. **Accessibilité** : contrastes et zones tactiles vérifiés par `verifier:barres`
   (≥ 16 px de marge) et `verifier:permissions`, mais **aucun test lecteur d’écran**
   (NVDA/TalkBack) n’a été exécuté.
4. **Safari/iOS** non testé (Chrome desktop piloté en 390×844).
5. Les dessins sont **décoratifs et facultatifs** : leur absence (fiche avec photo)
   ne casse rien.

## I. Constats du §I — CORRIGÉS le 16/11 (mission de finalisation)

Les trois constats ci-dessous ont été traités dans le lot de finalisation. Le détail des
corrections, les mesures et les preuves sont dans `docs/RAPPORT-FINAL-2026-11-16.md`
(§B). Résumé :

| # | Constat | Correction | Preuve |
|---|---|---|---|
| 1 | Sur `/recherche`, la bannière « Installer Rejoins’Moi » **recouvre du texte et une carte** | le bandeau vit désormais **DANS LE FLUX**, en tête de `<main>` (`position: static`) : il pousse le contenu au lieu de le recouvrir. Pastille flottante supprimée (l’installation reste dans le menu) | parcours : `position=static`, `bouton(s)=[] texte(s)=[]` sur `/` **et** `/recherche` |
| 2 | Cartes « Artisans pour … » en **rectangles beiges vides** | squelette dessiné (pastille + lignes + `role="status"`), cartes conservées pendant les rechargements, secours par **dessin du métier** puis initiales, `onError` sur la photo | `ArtisansMisEnAvant.jsx` réécrit ; capture 360 px « chargement » puis « cartes » |
| 3 | `04-fiche-publiee.png` capturée pendant « Ouverture de la fiche… » | le test attend le **titre réel** (`maxMs 20000`) et vérifie que l’écran d’ouverture a disparu — et **échoue** si ce n’est pas le cas | parcours : « la fiche affiche son TITRE » ✓, capture `04-fiche-publiee.png` refaite |

Le point 3 était bien un **défaut de test**, pas de l’application : la vérification est
maintenant plus stricte qu’avant, elle ne masque plus rien.


## J. Parcours d’un nouveau venu — lecture détaillée

Rejoué **après corrections** le 16/11 : **18/18**, dont les deux vérifications qui
échouaient (titre réel de la fiche, recouvrement sur `/recherche`). Journal intégral
dans `docs/RAPPORT-FINAL-2026-11-16.md` (§E). Extrait :

```
✓ la fiche affiche son TITRE (et non l’écran « Ouverture de la fiche… »)
✓ sur la recherche, le bandeau ne recouvre ni bouton ni texte — bouton(s)=[] texte(s)=[]
✓ aucun bouton de la recherche n’est recouvert par un élément imprévu — 17 boutons
```

Le compte et la fiche créés par le test ont été **supprimés** :

```
Compte(s) : +2250700000084 | Fiche(s) : ZZ TEST PARCOURS 74784
Supprimés : 1 fiche(s), 1 compte(s).
Fiches « ZZ TEST » restantes en base : 0.
```

## K. Plan de livraison

Le découpage prévu a été respecté (commits explicites, `origin/main`, puis
`npm run deploy:pages`). Les empreintes, les statuts Render/GitHub Pages et les
vérifications du site publié sont consignés dans `docs/RAPPORT-FINAL-2026-11-16.md`
(§H et §I).




