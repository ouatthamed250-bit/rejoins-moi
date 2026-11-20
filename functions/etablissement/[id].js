// [id].js — Cloudflare Pages Function pour /etablissement/:id
//
// RÔLE : servir la MÊME application React que d'habitude, mais avec les balises
// d'aperçu de LA fiche demandée. Le robot de WhatsApp (ou Facebook, ou Google)
// lit alors le vrai nom, la vraie phrase et la vraie photo au lieu du texte
// générique de l'index.html — et le bloc JSON-LD `LocalBusiness` permet à Google
// d'indexer la fiche individuellement.
//
// CE FICHIER EXISTE EN DEUX EXEMPLAIRES IDENTIQUES, volontairement :
//   - functions/etablissement/[id].js          (racine du dépôt)
//   - frontend/functions/etablissement/[id].js (si la racine du projet Cloudflare
//     est le dossier frontend/)
// Cloudflare Pages cherche les fonctions dans « <racine>/functions » : selon la
// configuration du tableau de bord, c'est l'un ou l'autre. Les deux appellent le
// MÊME code (functions/_lib/og-etablissement.js) : la logique n'est écrite
// qu'une fois. Si la configuration est un jour figée, supprimez la copie inutile.
//
// POURQUOI UNE FONCTION, ET PAS 6 700 FICHIERS HTML PRÉ-GÉNÉRÉS : les fiches
// changent tous les jours (nom, photos, horaires). Ici la page est construite à
// la demande puis mise en cache au bord du réseau (s-maxage=1800), donc quasi
// gratuite à servir.
//
// TEST LOCAL : `npx wrangler pages dev dist` (depuis frontend/, après un build).

import { gererRequeteEtablissement } from '../_lib/og-etablissement.js';

/** GET /etablissement/:id — voir gererRequeteEtablissement (aucune erreur 500). */
export function onRequestGet(context) {
  return gererRequeteEtablissement(context);
}
