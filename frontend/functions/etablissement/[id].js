// [id].js — Cloudflare Pages Function pour /etablissement/:id
//
// Copie de functions/etablissement/[id].js, pour le cas où la racine du projet
// Cloudflare Pages est le dossier frontend/ (l'hébergeur cherche alors les
// fonctions dans frontend/functions/). Le code, lui, n'est pas dupliqué : il est
// dans functions/_lib/og-etablissement.js, réexporté par le _lib/ voisin.
//
// RÔLE : servir la MÊME application React que d'habitude, mais avec les balises
// d'aperçu de LA fiche demandée (titre, description, photo) et un bloc JSON-LD
// `LocalBusiness` pour Google. Aucune erreur 500 : fiche introuvable ou API
// muette => index.html d'origine, statut 200.

import { gererRequeteEtablissement } from '../_lib/og-etablissement.js';

/** GET /etablissement/:id — voir gererRequeteEtablissement (aucune erreur 500). */
export function onRequestGet(context) {
  return gererRequeteEtablissement(context);
}
