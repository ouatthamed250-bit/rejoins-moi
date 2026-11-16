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
};
