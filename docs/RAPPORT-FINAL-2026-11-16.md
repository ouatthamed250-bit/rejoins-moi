# Rapport final — Rejoins’Moi, finalisation et publication (16/11/2026)

Suite du rapport d’audit `docs/RAPPORT-AUDIT-2026-11-16.md`. Ce document couvre la
**mission de finalisation** : correction des trois constats du §I de l’audit, contrôle
complet, puis publication (Render + GitHub Pages).

Toutes les valeurs de ce rapport sont **mesurées**, pas estimées : chaque test cité a
été relancé sur ce poste le 16/11/2026, sur un `dist` de production.

---

## A. Résumé exécutif

| Point | État |
|---|---|
| Bannière d’installation qui recouvre le contenu sur `/recherche` | **corrigé** — le bandeau vit désormais **dans le flux** de la page |
| Cartes « Artisans pour … » vides (rectangles beiges) | **corrigé** — squelette dessiné + état de secours photo (dessin du métier) |
| Test du parcours qui concluait sur « Ouverture de la fiche… » | **corrigé** — attente du **titre réel**, échec franc si la fiche ne s’affiche pas |
| 31 illustrations, 15 règles de choix | **vérifiées** — 73 contrôles passés |
| Contrôles existants (santé, mentions, phrase, PWA, permissions, barres, démarrage, sécurité) | **tous verts** (voir §E) |
| Build de production | **97 modules**, 459,19 kB (132,61 kB gzip) |

Aucun test n’a été assoupli pour « faire passer » quelque chose : le seul test modifié
(`verifier:parcours`) est **plus strict** qu’avant (18 vérifications au lieu de 10).

---

## B. Corrections

### B.1 — Bannière d’installation : plus de recouvrement (`InstallAppButton.jsx`, `App.jsx`)

**Cause racine.** Le bandeau était `position: fixed`, posé au-dessus du bloc fixe du
bas. Une surface fixe recouvre **par construction** ce qui défile dessous ; la marge de
pied de page (`--reserve-banniere`) ne protège que la **fin** du document. Sur
`/recherche`, une carte de résultat — et le texte de l’état vide — passaient donc sous
le bandeau (mesuré : bandeau de 63 px de haut à `top 618 → 681`, carte de résultat à
`636 → 673`).

**Correction.** Le bandeau est rendu **dans le flux**, en tête de `<main>` :
il pousse le contenu au lieu de le recouvrir. Rien d’autre ne change :

- les **quatre états** restent ceux de `useInstallation` (invite du navigateur, iOS,
  manuel, déjà installée) ;
- la fermeture reste comptée (`rejoinsmoi.installationIgnoree`, 3 refus max) ;
- `?pwa=1` réaffiche toujours l’invitation (chemin de diagnostic) ;
- l’installation reste accessible dans le menu hamburger, y compris après fermeture :
  la pastille flottante « Installer l’app » a été **supprimée** — c’était un second
  élément fixe susceptible de recouvrir un bouton ;
- petits écrans Android (360 px) : marges resserrées, bouton et croix `shrink-0`,
  texte secondaire limité à 3 lignes, et **textes raccourcis** dans
  `CONTENUS_INSTALLATION` pour tenir sur deux lignes sans coupure.

**Preuves.**

```
=== /recherche            (360 × 640, Chrome piloté)
 banniereRect  : [60, 121, 61]        ← en tête de page, dans le flux
 position CSS  : static               ← plus jamais `fixed`
 reserve       : 0px                  ← plus rien à réserver
 padding-bottom: 84px (= bloc 68px + marge 16px)
 recouvrement  : bouton(s)=[] texte(s)=[]
```

```
✓ sur l’accueil, le bandeau d’installation ne recouvre ni bouton ni texte — position=static
✓ sur la recherche, le bandeau d’installation est DANS LE FLUX (jamais superposé) — position=static
✓ sur la recherche, le bandeau ne recouvre ni bouton ni texte — bouton(s)=[] texte(s)=[]
✓ le bandeau d’installation est proposé au premier écran
✓ le bandeau se ferme en un clic (compteur de refus enregistré) — compteur=1
✓ ?pwa=1 réaffiche l’invitation (chemin de diagnostic)
```

### B.2 — Cartes « Artisans pour … » (`ArtisansMisEnAvant.jsx`)

Trois défauts distincts, tous corrigés :

1. **Rectangles beiges vides.** Les cartes de chargement étaient des `div` beiges sans
   contenu, et la rangée repassait en squelette à chaque re-résolution GPS. Elles ont
   maintenant la **silhouette d’une carte** (pastille, nom, métier, note, quartier),
   `animate-pulse`, `aria-hidden` + `role="status"` (« Chargement des artisans… »).
2. **Rangée vidée à chaque rechargement.** Les cartes déjà affichées restent à l’écran :
   le squelette ne sert qu’au tout premier chargement (`artisans.length === 0`). Plus de
   saut visuel quand la position arrive.
3. **État de secours réel.** Nouveau composant `PastilleArtisan` : photo si elle existe
   **et se charge**, sinon **dessin crayon du métier** (`dessinDeContexte({ metier })`
   — électricien → `electricite`, coiffeuse → `salonBeaute`…), sinon initiales. Une URL
   de photo morte (`onError`) ne laisse plus de trou.

Mêmes dimensions qu’avant (cartes `w-[150px]`, pastille `h-9 w-9`) : alignements
conservés.

### B.3 — État de secours des photos (`EstablishmentCard.jsx`, `EstablishmentProfile.jsx`)

Mission §2.B : « prévoir un véritable état de secours lorsqu’une photo manque **ou
échoue** ». Une URL morte affichait un cadre vide ou l’icône « image brisée » du
navigateur. Désormais `onError` bascule sur `PhotoSecours` — **mêmes dimensions**
(`h-44 w-full` en carte, `h-56 w-full` en en-tête de fiche, `h-[86px] w-[86px]` en
liste, `h-20 w-20` pour le médaillon du gérant) : aucun décalage de mise en page.

### B.4 — Test du parcours (`scripts/verifier-parcours-nouveau.mjs`)

- **Attente du titre réel** : après la navigation vers `/etablissement/…`, le test
  attend que le **nom saisi** soit présent dans la page (`maxMs 20000`) et vérifie que
  l’écran « Ouverture de la fiche… » n’est plus affiché. Un blocage réel de la fiche
  fait donc **échouer** le test au lieu de passer inaperçu.
- **Recouvrement mesuré, pas supposé** : deux nouvelles sondes —
  `recouvrementBandeau()` (rectangles du bandeau vs boutons **et lignes de texte**) et
  `boutonsMasques(ignorer)` qui **ignore explicitement** les blocs fixes prévus
  (navigation, barre d’action) : leur géométrie est vérifiée à part par
  `verifier:barres` (257 contrôles), et les exclure évite de déclarer « défaut » ce qui
  est le comportement normal d’une barre de navigation.
- **États du bandeau** vérifiés en conditions réelles : affiché → fermé (compteur) →
  réaffiché par `?pwa=1`.

Résultat : **18/18** (10 auparavant, dont 2 faux échecs).

---

## C. Illustrations (31 dessins, 15 règles)

Rien n’a été réécrit : le module partagé `src/components/illustrations/dessinsContexte.js`
reste **la seule** table de décision (métier → sous-catégorie → tags → catégorie). Les
13 dessins du 16/11 sont branchés dans : accueil (cartes sans photo), fiche
établissement (en-tête + dessin de fond), recherche, pharmacie/clinique (teinte santé),
jobs + main-d’œuvre (pastilles d’annonces), messages, profil, inscription, états vides
et bandeaux hors ligne.

`npm run verifier:dessins` :

```
1. Cohérence avec la planche de dessins
2. Les 13 dessins du 16/11 sont atteignables
3. Cas réels — sous-catégories des fiches importées
4. Cas réels — métiers des annonces de main-d’œuvre
5. Cas réels — catégories du serveur et de la démo
6. Comportement d’origine préservé
✓ 73 vérifications passées : 31 dessins, 15 règles.
```

Les 13 clés : `kiosque, eglise, mosquee, pharmacie, salonBeaute, atelierCouture,
chantier, electricite, plomberie, taxiMoto, mobileMoney, enveloppe, horsLigne`.


Capture : `frontend/captures-parcours/06-recherche-nouvelle-fiche.png` (bandeau en haut,
carte de résultat et bouton « Chercher une pharmacie » entièrement visibles).

---

## D. Fichiers modifiés

```
 frontend/src/App.jsx                                        |  bandeau dans <main>
 frontend/src/components/InstallAppButton.jsx                |  réécrit : bandeau dans le flux
 frontend/src/components/ArtisansMisEnAvant.jsx              |  squelette + secours photo
 frontend/src/components/EstablishmentCard.jsx               |  onError → PhotoSecours
 frontend/src/components/PhotoSecours.jsx                    |  dessin de secours du 16/11
 frontend/src/components/InfoBanner.jsx                      |  dessins de bandeau
 frontend/src/components/EmptyState.jsx                      |  dessins d’état vide
 frontend/src/components/AbonnementArtisan.jsx               |  dessin d’offre
 frontend/src/components/MenuPrincipal.jsx                   |  commentaire (bandeau)
 frontend/src/components/illustrations/tracesEsquisse.jsx    |  +13 dessins
 frontend/src/components/illustrations/dessinsContexte.js    |  (nouveau)
 frontend/src/data/demoData.js                               |  tags des fiches de démo
 frontend/src/hooks/useInstallation.js                       |  textes courts, commentaires
 frontend/src/styles/theme.css                               |  --reserve-banniere = 0
 frontend/src/pages/EstablishmentProfile.jsx                 |  secours photo + dessins
 frontend/src/pages/{Feed,Search,Jobs,JobBoard,Messages,Profile,
                     PharmaciesCliniques,RegisterEstablishment}.jsx | dessins
 frontend/scripts/verifier-dessins.mjs                       |  (nouveau) 73 contrôles
 frontend/scripts/verifier-parcours-nouveau.mjs              |  titre réel + recouvrement
 frontend/package.json                                       |  script verifier:dessins
 docs/RAPPORT-AUDIT-2026-11-16.md                            |  audit du lot illustré
 docs/RAPPORT-FINAL-2026-11-16.md                            |  ce document
```

`git diff --stat` : **24 fichiers modifiés, ~930 insertions, ~420 suppressions** (dont
la réécriture de deux composants).

---

## E. Tests exécutés (16/11/2026, sur ce poste)

| Commande | Résultat |
|---|---|
| `npm run verifier:dessins` | **73/73** (31 dessins, 15 règles) |
| `npm run verifier:sante` | **21/21** |
| `npm run verifier:mentions` | **29/29** |
| `npm run verifier:phrase` | **14/14** |
| `npm run verifier:pwa` | **conforme** (8 OK, SW `/sw.js`) |
| `npm run verifier:permissions` | **69/69**, 0 échec |
| `npm run verifier:barres` | **257/257** (bloc du bas posé, uni, opaque, mesuré) |
| `npm run verifier:demarrage:rapide` | **37/37**, 0 échec |
| `node backend/scripts/verifier-securite.js` | **47/47** |
| `npm run verifier:parcours` | **18/18**, 0 échec |
| `npm run build` | **OK** — 97 modules, 459,19 kB (132,61 kB gzip) |

Parcours navigateur réel (Chrome piloté, 390 × 844, API locale branchée sur la base
Atlas) — journal intégral :

```
✓ un numéro neuf arrive directement sur la création de profil
✓ le parcours « établissement » mène bien à l’étape des informations
✓ la position du téléphone est reprise automatiquement
✓ le compte se crée DANS le parcours : téléphone et mot de passe demandés ici
✓ la fiche est publiée et s’ouvre (aucune redirection vers la connexion) — /etablissement/6afb0222…
✓ la fiche affiche son TITRE (et non l’écran « Ouverture de la fiche… »)
✓ la fiche porte bien le nom saisi
✓ aucun bouton de la fiche n’est recouvert (barre d’action prévue exclue) — 6 boutons
✓ la fiche apparaît dans l’accueil, à proximité
✓ sur l’accueil, le bandeau d’installation ne recouvre ni bouton ni texte — position=static
✓ la fiche apparaît dans la recherche
✓ sur la recherche, le bandeau d’installation est DANS LE FLUX — position=static
✓ sur la recherche, le bandeau ne recouvre ni bouton ni texte — bouton(s)=[] texte(s)=[]
✓ aucun bouton de la recherche n’est recouvert par un élément imprévu — 17 boutons
✓ le bandeau d’installation est proposé au premier écran
✓ le bandeau se ferme en un clic (compteur de refus enregistré) — compteur=1
✓ après fermeture, aucun bouton n’est recouvert — 16 boutons
✓ ?pwa=1 réaffiche l’invitation (chemin de diagnostic)
```

**Nettoyage vérifié** (données temporaires isolées, aucune donnée réelle touchée) :

```
Compte(s) : +2250700000084 | Fiche(s) : ZZ TEST PARCOURS 74784
Supprimés : 1 fiche(s), 1 compte(s).
Fiches « ZZ TEST » restantes en base : 0.
```

Aucun paiement déclenché : `paiement.configure = false` sur l’API locale comme sur
Render ; les tests qui touchent aux dépôts utilisent le jeu d’essai et n’appellent
jamais la passerelle.

---

## F. Sécurité (rejouée, rien n’a été désactivé)

`backend/scripts/verifier-securite.js` — **47/47** :

```
Statuts /api/admin/login : 401 ×8 → 429            (limitation de débit)
Webhook non signé : 401 | signature fausse : 401 | signature valide : 200
photo 310 Ko → 400 (refus)   |   photo 250 Ko → 200 (acceptée)
URL https acceptée sans plafond (image non stockée chez nous)
```

Aucune protection n’a été retirée dans ce lot : le bandeau PWA ne touche ni
l’authentification, ni le jeton admin (12 h), ni CORS/Helmet, ni le plafond photo de
300 Ko, ni le webhook fail-closed.

---

## G. Performance

| Mesure | Avant (audit) | Après (ce lot) | Écart |
|---|---|---|---|
| Modules transformés | 97 | 97 | = |
| Bundle principal | 458,91 kB (132,52 kB gzip) | 459,19 kB (132,61 kB gzip) | **+0,28 kB** (+0,09 kB gzip) |
| Chunk carte (paresseux) | 149,98 kB (43,55 kB gzip) | idem | = |
| CSS | 53,89 kB (11,63 kB gzip) | idem | = |

Aucune dépendance ajoutée. Les illustrations sont du SVG inline (aucune requête) : les
13 dessins pèsent quelques centaines d’octets gzip, pas d’image à télécharger. Le
bandeau dans le flux **supprime** une opération de mise en page (plus de mesure
`offsetHeight` + écriture de variable CSS à chaque rendu).

