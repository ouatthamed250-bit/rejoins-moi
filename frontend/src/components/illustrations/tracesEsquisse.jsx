// tracesEsquisse.jsx — Collection d'illustrations « dessinées au crayon ».
//
// Pourquoi un fichier séparé de Icons.jsx ? Une icône répond à un besoin de
// SIGNE (24×24, un seul trait, lisible à 16 px : « chercher », « fermer »…) ;
// une illustration répond à un besoin d'IMAGE : elle raconte Abidjan (soleil,
// palmier, lagune, marché, braise, wax) et se regarde à 96–160 px. Les mélanger
// dans un même dictionnaire aurait effacé la règle « une icône n'est pas un
// dessin », et fait exploser le poids des écrans qui n'ont besoin que d'icônes.
//
// Contrat, identique pour toutes les traces :
//   • boîte de référence 120×120, `fill: none`, trait en `currentColor` — la
//     couleur vient donc du parent (orange du feed, vert de la santé…), comme
//     pour les icônes : aucune illustration n'impose sa teinte ;
//   • chaque trace est une FONCTION qui reçoit `id`. Raison : celle qui pose un
//     `<pattern>` dans `<defs>` (motifWax) a besoin d'un identifiant UNIQUE —
//     sans cela, deux exemplaires sur la même page porteraient le même `id` et
//     le second motif ne serait plus rendu. L'identifiant vient de `useId()`
//     (voir Illustration.jsx) ;
//   • aucune couleur écrite en dur, à une exception près : les trois bandeaux
//     du drapeau ivoirien, et uniquement par variables CSS (styles/esquisse.css).
//     La classe `.esquisse--mono` les neutralise : c'est le mode utilisé par les
//     écrans SANTÉ, où l'orange est interdit (§6) ;
//   • pas de texte, pas de style en ligne : le rendu est piloté par
//     Illustration.jsx (taille, épaisseur du trait) et par esquisse.css
//     (double trait clair, hachures, pastilles pleines).
//
// Les tracés sont volontairement IMPARFAITS — segments de longueurs inégales,
// second passage décalé, hachures d'ombre : c'est précisément ce qui distingue
// un dessin au crayon d'un pictogramme géométrique. Un tracé « propre » ici est
// un défaut, pas une qualité.

export const TRACES_ESQUISSE = {
  // ── Le ciel et la lumière (accueil, états vides) ──
  soleil: () => (
    <>
      <circle cx="60" cy="58" r="19.5" />
      <circle cx="60" cy="58" r="15.4" className="esquisse-clair" />
      {/* Huit rayons : longueurs et inclinaisons inégales, comme à la main. */}
      <path d="M86 58.4 95.5 57.4" />
      <path d="M78.6 75.8 85.4 82.6" />
      <path d="M60.5 84.2 59.4 93.6" />
      <path d="M41.8 76.3 34.6 83" />
      <path d="M34.2 58.3 24.9 58.9" />
      <path d="M42.3 40.4 34.4 33.2" />
      <path d="M60.4 31.7 61.6 22.6" />
      <path d="M78.9 40.7 86.2 33.6" />
      <path d="M52 82.5h16" className="esquisse-hachure" />
      <path d="M56.5 87h8" className="esquisse-hachure" />
    </>
  ),

  palmier: () => (
    <>
      {/* Tronc : deux traits qui se rapprochent vers le sommet, avec les
          cicatrices des palmes coupées. */}
      <path d="M52 104c1.5-18 3.5-34 8-51" />
      <path d="M63 104c-.6-17-1.4-34 2-51" />
      <path d="M55.5 88h6M57 76h6M59 64h6" className="esquisse-hachure" />
      {/* Six palmes partant du même point : un palmier n'en a jamais cinq. */}
      <path d="M62.5 52C49 45 33 49 20.5 60" />
      <path d="M62.5 52C49 39 34 33 21.5 33.5" />
      <path d="M62.5 52C62 38 60.5 27 57 16.5" />
      <path d="M62.5 52C75 40 85 29 90.5 18.5" />
      <path d="M62.5 52C77 45 93 46.5 105 56.5" />
      <path d="M62.5 52C77 57 91 64.5 99 75" />
      <circle cx="58.5" cy="55.5" r="3.2" />
      <circle cx="66.5" cy="56.5" r="2.6" />
      <path d="M38 104.5h44" className="esquisse-hachure" />
    </>
  ),

  // ── Le pays (accueil, en-têtes, fiche partagée) ──
  carteCoteDIvoire: () => (
    <>
      {/* Silhouette simplifiée : côte au sud, frontières ouest en escalier. */}
      <path d="M31 25.5 74 21.5l13 8 4 20-6 15 6 15-4 16-14 8-7.5-8-6 4-6-8.5-10-4-4-14-9.5-11.5z" />
      <path d="M45 34.5c9-3 22-4 32-1.5" className="esquisse-hachure" />
      <path d="M41 52c8 4 16 6 25 6" className="esquisse-hachure" />
      {/* Abidjan : une pastille, à l'endroit où la côte se creuse. */}
      <circle cx="79" cy="85" r="4.2" />
      <circle cx="79" cy="85" r="1.6" className="esquisse-plein" />
      <path d="M79 92.5v7" className="esquisse-clair" />
    </>
  ),

  drapeau: () => (
    <>
      <path d="M36 24v82" />
      <path d="M30.5 106h12" />
      <path d="M36 25.5h50v33H36z" />
      {/* Les deux bandeaux extrêmes, en variables CSS : les trois couleurs du
          drapeau ivoirien, ou `none` en mode mono (écrans santé, §6). */}
      <path d="M36.2 25.6h16.5v32.8H36.2z" style={{ fill: 'var(--esquisse-bande-1, none)' }} />
      <path d="M69.4 25.6h16.4v32.8H69.4z" style={{ fill: 'var(--esquisse-bande-3, none)' }} />
      <path d="M52.8 26v33M69.5 26v33" className="esquisse-clair" />
      <path d="M39 28.5h5M39 33h4" className="esquisse-hachure" />
    </>
  ),

  feuilleTropicale: () => (
    <>
      {/* Feuille de bananier : une nervure, deux bords, des veinules. */}
      <path d="M26 96c14-36 40-56 70-58-6 34-32 58-70 58z" />
      <path d="M28.5 93.5c13-30 36-48 65.5-55" className="esquisse-clair" />
      <path d="M40 88c6-9 14-17 22-22M52 74c5-8 11-14 18-18M66 56c4-5 9-9 14-11" className="esquisse-hachure" />
    </>
  ),

  vagues: () => (
    <>
      {/* La lagune Ébrié : trois lignes d'eau, plus un second passage clair. */}
      <path d="M16 44c10-9 20 7 30-1s20 7 30-1 20 7 30-1" />
      <path d="M16 62c10-9 20 7 30-1s20 7 30-1 20 7 30-1" />
      <path d="M16 80c10-9 20 7 30-1s20 7 30-1 20 7 30-1" />
      <path d="M18 49c10-9 20 7 30-1s20 7 30-1" className="esquisse-clair" />
      <path d="M18 67c10-9 20 7 30-1s20 7 30-1" className="esquisse-clair" />
      <circle cx="103" cy="86" r="1.6" className="esquisse-plein" />
    </>
  ),

  // ── Motif wax : la seule trace qui a besoin d'un identifiant unique ──
  motifWax: ({ id }) => (
    <>
      <defs>
        <pattern id={`${id}-wax`} width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M15 3.4 26.6 15 15 26.6 3.4 15z" className="esquisse-clair" />
          <circle cx="15" cy="15" r="2.2" className="esquisse-plein" />
        </pattern>
      </defs>
      <rect x="10" y="10" width="100" height="100" rx="12" fill={`url(#${id}-wax)`} />
      <path d="M18 22c26-8 56-8 84 0" className="esquisse-hachure" />
    </>
  ),

  // ── Le quartier (accueil, menu, états vides) ──
  maison: () => (
    <>
      <path d="M20 62 60 32l40 30" />
      <path d="M29 58v44h62V58" />
      <path d="M54 102V78h12v24" />
      <path d="M38 70h12v12H38z" />
      <path d="M44 70v12M38 76h12" className="esquisse-hachure" />
      <circle cx="63" cy="90" r="1.5" className="esquisse-plein" />
      <path d="M26 66h18M36 72h14" className="esquisse-hachure" />
      <path d="M105 102V90" />
      <circle cx="105" cy="79" r="9.5" />
      <path d="M22 102h84" className="esquisse-hachure" />
    </>
  ),

  paillote: () => (
    <>
      {/* Toit de paille : trois épaisseurs, du bord vers le faîte. */}
      <path d="M18 56C36 28 84 28 102 56" />
      <path d="M23 56c14-8 60-8 74 0" className="esquisse-clair" />
      <path d="M28.5 56c12-5 51-5 63 0" className="esquisse-hachure" />
      <path d="M30 56v46M90 56v46" />
      <path d="M20 102h80" />
      {/* Une table et une calebasse sous l'ombre du toit. */}
      <path d="M46 102V84h28v18" />
      <path d="M52 84c0-4 3-6 8-6s8 2 8 6" className="esquisse-clair" />
      <circle cx="81" cy="94" r="5" />
      <path d="M76 88h10" className="esquisse-hachure" />
    </>
  ),

  repere: () => (
    <>
      {/* Épingle de carte : l'ombre hachurée est à gauche, la lumière à droite. */}
      <path d="M60 104S89 74 89 53a29 29 0 1 0-58 0c0 21 29 51 29 51z" />
      <circle cx="60" cy="52" r="10.5" />
      <circle cx="60" cy="52" r="2" className="esquisse-plein" />
      <path d="M42.5 40c-3 5-4.5 10-4.5 14M46.5 30c-6 5-8.5 12-8.5 19" className="esquisse-hachure" />
      <path d="M34 110h52" className="esquisse-clair" />
    </>
  ),

  coeur: () => (
    <>
      {/* Cœur cousu main : les points de couture sont sur le lobe gauche. */}
      <path d="M60 99C34 80 20 64 20 47.5A21 21 0 0 1 60 35a21 21 0 0 1 40 12.5C100 64 86 80 60 99z" />
      <path d="M32 46h8M34 53h7M38 60h6M44 67h5" className="esquisse-hachure" />
      <path d="M70 22l14-8" className="esquisse-clair" />
    </>
  ),

  etoile: () => (
    <>
      {/* Branches inégales : une étoile tracée à main levée, pas un logo. */}
      <path d="M60 22 70.5 49.5 99 51 77 69l7.5 28L60 81 35.5 97 43 69 21 51l28.5-1.5z" />
      <path d="M46 74l6-14" className="esquisse-hachure" />
      <path d="M96 24l3-7M103 38l7-1M89 15l-2 6" className="esquisse-clair" />
    </>
  ),

  // ── Le marché (alimentation, catégories, états vides) ──
  panierMarche: () => (
    <>
      <path d="M28 62h64l-6 40H34z" />
      <path d="M34 74h52M31.5 86h57" className="esquisse-hachure" />
      <path d="M40 74v28M52 74v28M68 74v28M80 74v28" className="esquisse-clair" />
      <path d="M44 62c3-24 29-24 32 0" />
      {/* Trois achats qui dépassent : deux tomates et une aubergine. */}
      <circle cx="48" cy="54" r="6.5" />
      <circle cx="66" cy="52" r="7" />
      <path d="M84 56c-5-2-8-6-7-11 5 0 9 4 10 9z" />
      <path d="M62 62h20" className="esquisse-hachure" />
    </>
  ),

  etalMarche: () => (
    <>
      {/* Auvent rayé, deux pieds, un comptoir. */}
      <path d="M16 42h88l-8 18H24z" />
      <path d="M34 43 28 60M52 43 48 60M70 43 68 60M88 43 88 60" className="esquisse-clair" />
      <path d="M24 60v42M96 60v42" />
      <path d="M20 76h80v26H20z" />
      <path d="M20 86h80" className="esquisse-hachure" />
      {/* Deux cageots et leurs fruits, un seau à droite. */}
      <path d="M26 76v-9h18v9M54 76v-9h18v9" className="esquisse-clair" />
      <circle cx="31" cy="63.5" r="3" />
      <circle cx="39" cy="63.5" r="3" />
      <circle cx="59" cy="63.5" r="3" />
      <circle cx="67" cy="63.5" r="3" />
      <path d="M80 86h14l-2 11H82z" />
      <path d="M83 86c0-4 2-6 5-6s5 2 5 6" className="esquisse-clair" />
    </>
  ),

  marmite: () => (
    <>
      <path d="M30 72h60c0 21-13 30-30 30S30 93 30 72z" />
      <path d="M27 72c9-11 57-11 66 0" />
      <circle cx="60" cy="56" r="3.6" />
      <path d="M60 56v-5" className="esquisse-clair" />
      {/* La vapeur : animable en option (.esquisse--anime), jamais par défaut. */}
      <g className="esquisse-clair esquisse-fumee">
        <path d="M46 46c4-7-3-11 1-18M60 44c4-8-3-12 1-19M74 46c4-7-3-11 1-18" />
      </g>
      {/* Les trois pierres du foyer */}
      <path d="M42 106c3-5 9-5 12 0M70 106c3-5 9-5 12 0M56 108c3-4 9-4 11 0" className="esquisse-hachure" />
      {/* Cuillère en bois posée à droite */}
      <path d="M96 76c6 4 6 14 0 19" />
      <path d="M93 74c4-2 7 1 6 4s-5 3-7 0z" className="esquisse-clair" />
    </>
  ),

  // ── Le barbecue : grille, brochettes, braise, fumée, étincelles ──
  barbecue: () => (
    <>
      {/* Grille vue de trois quarts : le bord arrière est plus court. */}
      <path d="M28 62h64l6 15H22z" />
      <path d="M41 62 37.4 76M54 62 52 74.8M66 62 68 73.6M79 62 82.6 72.4" className="esquisse-clair" />
      {/* Le brasero, sous la grille, et ses braises hachurées. */}
      <path d="M26 79h68l-4 14c-16 5-44 5-60-1z" />
      <path d="M36 84h12M54 86h10M70 84h9" className="esquisse-hachure" />
      {/* Deux brochettes posées en travers, avec leurs morceaux. */}
      <path d="M18 70 100 66" />
      <path d="M20 76.5 102 71.5" className="esquisse-clair" />
      <path d="M30 68.7 34.2 74.6M46 68 50.3 73.9M62 67.3 66.3 73.2M78 66.6 82.3 72.4" className="esquisse-hachure" />
      {/* Fumée et étincelles : groupes animables en option seulement. */}
      <g className="esquisse-clair esquisse-fumee">
        <path d="M50 56c4-7-3-11 1-18M64 54c5-8-3-12 2-19M76 53c3-6-2-10 1-16" />
      </g>
      <g className="esquisse-clair esquisse-etincelle">
        <path d="M34 52l2-5M86 48l-3-5M60 40l1-5" />
      </g>
      <circle cx="45" cy="44" r="1.4" className="esquisse-plein" />
      <circle cx="92" cy="58" r="1.2" className="esquisse-plein" />
    </>
  ),

  // ── La santé (VERT exclusivement, §6 — l'appelant utilise .esquisse--mono) ──
  croixSante: () => (
    <>
      <rect x="26" y="26" width="68" height="68" rx="16" />
      <path d="M53 40h14v13h13v14H67v13H53V67H40V53h13z" />
      <path d="M56 44h8M44 57h8M68 57h8M56 72h8" className="esquisse-hachure" />
    </>
  ),

  // ── Le travail (main-d'œuvre, artisanat, services) ──
  boiteOutils: () => (
    <>
      <path d="M22 58h76v42H22z" />
      <path d="M22 68h76" className="esquisse-clair" />
      <path d="M50 58c0-12 20-12 20 0" />
      <path d="M56 64h8v5h-8z" className="esquisse-clair" />
      {/* Une scie qui dépasse : la main-d'œuvre arrive toujours chargée. */}
      <path d="M34 58 54 38" />
      <path d="M40 52l2.5 2.5M46 46l2.5 2.5M52 40l2.5 2.5" className="esquisse-hachure" />
      <path d="M20 104h80" />
    </>
  ),
  // ── Les lieux du quartier (suite) ─────────────────────────────────────────
  // Quatre lieux réels que le premier kit laissait sans dessin : le kiosque
  // (§4, l'exemple même donné pour la recherche), l'église et la mosquée (§1,
  // « spiritualité »), et l'officine (§6) — la croix de `croixSante` dit
  // « santé », pas « pharmacie » où l'on entre acheter. Aucun de ces dessins
  // n'introduit de couleur : ils vivent tous en `currentColor`.

  kiosque: () => (
    <>
      {/* L'auvent, posé de travers : un kiosque de rue n'est jamais d'aplomb. */}
      <path d="M22 52 96 47l6 11H18z" />
      <path d="M30 52.6 29 57.6M43 51.4 42.4 56.8M56 50.3 56 56M69 49.3 70 55.4M82 48.4 84 54.7" className="esquisse-clair" />
      {/* Deux montants, un comptoir, trois tablettes. */}
      <path d="M26 57v45M94 56v46" />
      <path d="M26 82h68" />
      <path d="M32 82v20M60 82v20M88 82v20" className="esquisse-clair" />
      {/* La marchandise : trois paquets, deux bouteilles debout. */}
      <path d="M33 72h9v7h-9zM47 71h9v8h-9zM61 72h8v7h-8z" className="esquisse-clair" />
      <path d="M76 73v-5h4v5M83 74v-6h4v6" />
      <path d="M20 104h80" />
      <path d="M34 100h12M58 101h9M76 100h10" className="esquisse-hachure" />
    </>
  ),

  eglise: () => (
    <>
      {/* Nef et clocher : deux volumes, le clocher plus étroit. */}
      <path d="M28 102V62l22-14 22 14v40" />
      <path d="M46 48V26h18v22" />
      <path d="M43 26 55 17l12 9" />
      {/* La croix : un grand trait, un plus court. */}
      <path d="M55 17V8M50.5 12h9" />
      {/* Porte en plein cintre et deux fenêtres hautes. */}
      <path d="M53 102V84c0-6 10-6 10 0v18" className="esquisse-clair" />
      <path d="M34 76c0-4 6-4 6 0v8h-6zM60 76c0-4 6-4 6 0v8h-6z" />
      <path d="M30 90h8M66 68h8M30 68h6" className="esquisse-hachure" />
      <path d="M20 104h80" />
    </>
  ),

  mosquee: () => (
    <>
      {/* Le dôme, puis son tambour : deux arcs, pas un cercle. */}
      <path d="M38 62c0-14 10-24 22-24s22 10 22 24" />
      <path d="M38 62h44" />
      {/* Le croissant, d'un seul trait courbe. */}
      <path d="M58 33c0-5 4-8 8-8-3 2-4 5-4 8s1 6 4 8c-4 0-8-3-8-8z" />
      {/* Deux minarets, avec leur petite coupole. */}
      <path d="M28 102V48l5-8 5 8v54M82 102V48l5-8 5 8v54" />
      <path d="M33 44v-5M87 44v-5" className="esquisse-clair" />
      {/* Trois arcades, la centrale plus haute. */}
      <path d="M44 102V86c0-4 6-4 6 0v16M57 102V85c0-5 6-5 6 0v17M70 102V86c0-4 6-4 6 0v16" className="esquisse-clair" />
      <path d="M40 70h40" className="esquisse-hachure" />
      <path d="M20 104h80" />
    </>
  ),

  pharmacie: () => (
    <>
      {/* Le flacon : corps, col, bouchon. */}
      <path d="M48 50h24v44c0 5-4 8-8 8H56c-4 0-8-3-8-8z" />
      <path d="M54 50V38h12v12" className="esquisse-clair" />
      <path d="M52 34h16v5H52z" />
      {/* L'étiquette et la croix : le seul signe encore lisible à 32 px. */}
      <path d="M51 64h18v20H51z" className="esquisse-clair" />
      <path d="M57 68h6v5h5v6h-5v5h-6v-5h-5v-6h5z" />
      {/* Une cuillère-dose posée à côté : l'officine, pas l'hôpital. */}
      <path d="M86 92c0-9 8-9 8 0s-8 9-8 0zM90 92v9" className="esquisse-clair" />
      <path d="M20 104h80" className="esquisse-hachure" />
    </>
  ),

  // ── Les métiers (suite) ───────────────────────────────────────────────────
  // Le cahier des charges nomme les métiers un par un (§1) : coiffeur, couturier,
  // électricien, plombier, patron de chantier. `boiteOutils` disait « travail »
  // en général ; ces cinq dessins disent LEQUEL — c'est ce qui distingue une
  // annonce de plomberie d'une annonce de couture dans un état vide.

  salonBeaute: () => (
    <>
      {/* Le miroir sur pied : le poste de la coiffeuse. */}
      <ellipse cx="60" cy="46" rx="21" ry="26" />
      <ellipse cx="60" cy="46" rx="16.5" ry="21" className="esquisse-clair" />
      <path d="M60 72v14M50 100h20" />
      <path d="M54 76 50 100M66 76l4 24" className="esquisse-clair" />
      {/* Un reflet : deux traits, jamais un aplat. */}
      <path d="M47 34c-3 5-3 12-1 17" className="esquisse-clair" />
      {/* Les ciseaux, ouverts, à gauche. */}
      <path d="M22 38 38 62M22 62 38 38" />
      <circle cx="19.5" cy="35" r="4" />
      <circle cx="19.5" cy="65" r="4" />
      {/* Le peigne, à droite : le dos, puis les dents inégales. */}
      <path d="M92 34v34M92 34c6 1 8 3 8 7v27" className="esquisse-clair" />
      <path d="M94 44v14M97 42v16M100 44v14" className="esquisse-hachure" />
      <path d="M30 104h60" className="esquisse-hachure" />
    </>
  ),

  atelierCouture: () => (
    <>
      {/* Socle massif, puis le bras qui porte l'aiguille. */}
      <path d="M24 88h62l6-8H26z" />
      <path d="M82 80V40H46" />
      <path d="M46 40v18" />
      {/* Le volant et sa manivelle. */}
      <circle cx="82" cy="52" r="9" />
      <circle cx="82" cy="52" r="3" className="esquisse-clair" />
      <path d="M82 43v-4" className="esquisse-clair" />
      {/* L'aiguille, puis le fil qui fait une boucle. */}
      <path d="M46 58v10M44 68h4" />
      <path d="M64 40c-8-8 2-14 6-8s-2 10 4 12" className="esquisse-clair" />
      {/* Le tissu qui sort, ondulé : on coud, on ne range pas. */}
      <path d="M30 88c8-5 14 3 22-1s14 3 22-2" className="esquisse-clair" />
      <path d="M32 94h48" className="esquisse-hachure" />
      <path d="M20 104h80" />
    </>
  ),

  chantier: () => (
    <>
      {/* Le casque : calotte, rebord, visière. C'est lui qu'on lit à 32 px. */}
      <path d="M30 58c0-16 12-26 26-26s26 10 26 26" />
      <path d="M24 58h72l-4 7H28z" />
      <path d="M60 32v-5M46 62v3M74 62v3" className="esquisse-clair" />
      {/* Le niveau, posé en travers : ce trait-là est droit. */}
      <path d="M28 74h26" />
      <path d="M35 71h8v6h-8z" className="esquisse-clair" />
      {/* Les briques : une rangée à gauche, une pile à droite. */}
      <path d="M20 89h40v11H20zM30 89v11M40 89v11M50 89v11" className="esquisse-clair" />
      <path d="M74 78h26v11H74zM82 78v11M90 78v11" />
      <path d="M20 104h80" className="esquisse-hachure" />
    </>
  ),

  electricite: () => (
    <>
      {/* L'ampoule : bulbe, culot, filament. */}
      <path d="M60 22c-14 0-24 11-24 24 0 10 6 14 9 20h30c3-6 9-10 9-20 0-13-10-24-24-24z" />
      <path d="M46 72h28v8H46z" />
      <path d="M48 80h24M50 86h20" className="esquisse-hachure" />
      <path d="M53 62c2-8 5-12 7-12s5 4 7 12M60 50v-6" className="esquisse-clair" />
      {/* L'éclair : trois segments, angles francs. */}
      <path d="M86 40 78 54h8l-6 14" />
      {/* Le fil et sa prise, à gauche. */}
      <path d="M22 96c10-2 14-8 16-16" className="esquisse-clair" />
      <path d="M26 96h-8v6h8" className="esquisse-clair" />
      <path d="M30 104h60" className="esquisse-hachure" />
    </>
  ),

  plomberie: () => (
    <>
      {/* Le tuyau coudé, avec sa bride. */}
      <path d="M26 40h26v34" />
      <path d="M22 36v8M22 36h8M22 44h8" className="esquisse-clair" />
      <path d="M52 74h22" />
      <path d="M70 78v26M74 74v30" className="esquisse-clair" />
      {/* La clé à tuyau : manche long, mâchoire carrée. */}
      <path d="M62 30 92 60" />
      <path d="M58 26h10v8H58z" />
      <path d="M88 56l8 8-6 6-8-8z" className="esquisse-clair" />
      {/* La goutte et l'éclaboussure : ce qui fuit. */}
      <path d="M34 92c0 4 3 6 6 6s6-2 6-6-6-10-6-10-6 6-6 10z" className="esquisse-clair" />
      <path d="M46 100c2 1 4 1 6 0" className="esquisse-hachure" />
      <path d="M20 104h30" />
    </>
  ),


  // ── La mise en relation et le réseau ──────────────────────────────────────
  // Quatre situations que l'app vit tous les jours et qu'aucun dessin ne disait :
  // l'itinéraire (le taxi-moto, repère du §6), le paiement de 500 F (§2,
  // Wave/Orange Money), les contacts débloqués (écran Messages) et le serveur
  // injoignable — le cas « connexion lente » que le bloc H traite sans jamais
  // afficher de fiche d'exemple. Comme partout dans ce fichier, aucun visage,
  // aucun texte : un dessin ne doit jamais porter seul une information.

  taxiMoto: () => (
    <>
      {/* Deux roues BASSES et petites : c'est ce qui distingue une moto d'un
          vélo. Le corps, lui, occupe tout l'espace entre elles. */}
      <circle cx="38" cy="84" r="11" />
      <circle cx="86" cy="84" r="11" />
      <circle cx="38" cy="84" r="2.6" className="esquisse-clair" />
      <circle cx="86" cy="84" r="2.6" className="esquisse-clair" />
      {/* Le cadre, du moyeu arrière au réservoir, puis à la fourche. */}
      <path d="M38 84h12l8-16h12l4 8h10l6 8" />
      {/* Le réservoir : une forme FERMÉE, pas un trait de plus. */}
      <path d="M60 60h14l4 8H58z" />
      {/* Le carter, sous le réservoir : ce qui reste d'une moto quand on
          enlève les roues. Il casse le triangle du cadre de vélo. */}
      <path d="M52 78h20l4 6H54z" />
      {/* La selle, la fourche, le guidon et le phare. */}
      <path d="M48 62h10l-2 6H48z" />
      <path d="M86 84 88 50M84 48l8 4" />
      <circle cx="94" cy="58" r="3.4" />
      {/* Le pot d'échappement, double trait, et sa fumée : le moteur tourne.
          C'est ce que la fumée dit, et qu'aucun vélo ne dira jamais. */}
      <path d="M68 90h18M68 93h18M88 89v4" className="esquisse-clair" />
      <g className="esquisse-clair esquisse-fumee">
        <path d="M92 92c4-3 2-7 5-9M98 94c3-2 2-5 4-7" />
      </g>
      {/* Trois traits de vitesse, courts et inégaux. */}
      <path d="M8 52h10M6 60h11M12 68h8" className="esquisse-hachure" />
      <path d="M22 102h76" />
    </>
  ),

  mobileMoney: () => (
    <>
      {/* Le téléphone : l'écran est allumé, les touches sont deux traits. */}
      <rect x="40" y="30" width="34" height="58" rx="7" />
      <path d="M52 36h10M54 82h6" className="esquisse-clair" />
      <path d="M48 46h18v20H48z" className="esquisse-clair" />
      {/* Le billet glissé derrière : deux plis, aucune valeur écrite. */}
      <path d="M78 52c10 0 16 3 16 8v26c0 5-6 8-16 8h-4V52z" />
      <path d="M82 60h8M82 68h8M82 76h5" className="esquisse-hachure" />
      {/* Les ondes du paiement sans contact. */}
      <path d="M30 44c-5 5-5 13 0 18M24 38c-8 8-8 22 0 30" className="esquisse-clair" />
      {/* Une pièce au sol : le montant n'est jamais dessiné. */}
      <circle cx="30" cy="96" r="7" />
      <path d="M27 96h6M30 93v6" className="esquisse-clair" />
      <path d="M20 104h80" className="esquisse-hachure" />
    </>
  ),

  enveloppe: () => (
    <>
      {/* L'enveloppe ouverte : corps, rabat, plis. */}
      <path d="M26 52h68v44H26z" />
      <path d="M26 52l34 24 34-24" />
      <path d="M26 96l24-22M94 96 70 74" className="esquisse-clair" />
      <path d="M40 52V38c0-3 2-5 5-5h30c3 0 5 2 5 5v14" className="esquisse-clair" />
      {/* La bulle de réponse, avec ses trois points. */}
      <path d="M70 24c0-5 5-9 11-9s11 4 11 9-5 9-11 9c-2 0-4 0-5-1l-6 4 1-6c-1-2-1-4-1-6z" className="esquisse-clair" />
      <circle cx="76" cy="24" r="1.4" className="esquisse-plein" />
      <circle cx="81" cy="24" r="1.4" className="esquisse-plein" />
      <circle cx="86" cy="24" r="1.4" className="esquisse-plein" />
      <path d="M20 104h80" className="esquisse-hachure" />
    </>
  ),

  horsLigne: () => (
    <>
      {/* Le nuage : trois bosses, pas un ovale. */}
      <path d="M36 60c-8 0-14-6-14-13 0-8 7-14 15-13 3-8 11-13 20-11 8 2 13 9 13 17 7 1 12 7 12 14 0 6-5 11-12 11H36z" />
      {/* Deux arcs de réseau, puis le point : ce qui reste quand ça coupe. */}
      <path d="M46 76c6-7 20-7 26 0M54 84c2-2 8-2 10 0" className="esquisse-clair" />
      <circle cx="59" cy="90" r="1.7" className="esquisse-plein" />
      {/* La barre : un seul trait net, pas une croix d'erreur. */}
      <path d="M36 66 84 96" />
      <path d="M20 104h80" className="esquisse-hachure" />
    </>
  ),

};
