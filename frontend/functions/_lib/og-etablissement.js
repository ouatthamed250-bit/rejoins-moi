// og-etablissement.js — Renvoi vers le socle unique du dépôt.
//
// Ce dossier existe pour un cas de configuration Cloudflare Pages précis : quand
// la « racine » du projet est le dossier frontend/, l'hébergeur cherche les
// fonctions dans frontend/functions/ et ignore celles de la racine du dépôt.
//
// La logique n'est PAS dupliquée : ce fichier ne fait que réexporter
// functions/_lib/og-etablissement.js (une seule implémentation, donc une seule
// chose à corriger). Le bundler de Cloudflare résout les imports relatifs dans
// tout le dépôt et embarque le code dans la fonction déployée.
//
// Si la configuration Cloudflare est un jour figée sur la racine du dépôt,
// supprimez simplement le dossier frontend/functions/.

export * from '../../../functions/_lib/og-etablissement.js';
