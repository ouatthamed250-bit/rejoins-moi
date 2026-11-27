// sanitize.js — Nettoyage des textes libres AVANT enregistrement (sécurité, 27/11).
//
// POURQUOI : le pentest a montré que `PATCH /api/users/me` stockait tel quel
// `nom = "PENTEST<b>xss</b>"` et `bio = "<script>alert(1)</script>"`. Aujourd'hui
// React échappe ces valeurs à l'affichage (pas d'exécution), mais rien ne garantit
// qu'un futur export HTML/CSV, un e-mail ou un `innerHTML` ne les interprète pas :
// on ferme la porte à la SOURCE, côté serveur, plutôt que de dépendre du rendu.
//
// CHOIX D'IMPLÉMENTATION : pas de dépendance externe (le projet n'a ni
// `sanitize-html` ni `xss` dans package.json, et tient à rester léger). On retire
// donc les constructions dangereuses par expressions régulières :
//   1. les blocs à contenu (`<script>…</script>`, `<style>`, `<iframe>`, `<object>`,
//      `<embed>`, `<noscript>`) sont supprimés ENTIERS, contenu compris ;
//   2. toute balise restante (`<b>`, `<img src=x onerror=…>`, `<svg/onload=…>`) est
//      retirée : il ne reste que le texte ;
//   3. les gestionnaires d'événements orphelins (`onerror=`, `onclick=`…) et les
//      schémas actifs (`javascript:`, `data:text/html`) sont effacés ;
//   4. les caractères de contrôle (sauf saut de ligne et tabulation) sont retirés.
//
// LIMITE ASSUMÉE : ce n'est pas un analyseur HTML complet. Il est volontairement
// strict (on préfère perdre un `<` légitime dans une biographie plutôt que garder
// une balise), et il ne remplace pas l'échappement de sortie — qui reste la
// dernière ligne de défense.

/** Balises dont on supprime AUSSI le contenu (une regex par paire ouvrante/fermante). */
const BLOCS_A_CONTENU = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'];

/** Toute balise restante, y compris malformée (`< img`, `<svg/onload=`). */
const BALISE = /<\s*\/?\s*[a-zA-Z][^>]*>/g;

/** Gestionnaires d'événements HTML orphelins (`onerror=`, `onclick =`). */
const GESTIONNAIRE_EVENEMENT = /\bon[a-z]+\s*=/gi;

/** Schémas d'URL actifs à l'intérieur d'un texte libre. */
const SCHEMA_ACTIF = /(javascript|vbscript)\s*:|data\s*:\s*text\/html/gi;

/** Caractères de contrôle interdits (on garde \n, \r et \t). */
const CARACTERES_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Nettoie un texte libre destiné à être stocké puis affiché.
 * @param {unknown} valeur
 * @returns {string}
 */
export function nettoyerTexte(valeur) {
  if (valeur === null || valeur === undefined) return '';
  let texte = String(valeur);

  for (const balise of BLOCS_A_CONTENU) {
    // `[\s\S]` plutôt que `.` : le contenu peut contenir des sauts de ligne.
    texte = texte.replace(new RegExp(`<\\s*${balise}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${balise}\\s*>`, 'gi'), ' ');
    // Balise auto-fermante ou ouvrante jamais fermée : on retire au moins la balise.
    texte = texte.replace(new RegExp(`<\\s*\\/?\\s*${balise}\\b[^>]*>`, 'gi'), ' ');
  }

  texte = texte
    .replace(BALISE, ' ')
    .replace(GESTIONNAIRE_EVENEMENT, '')
    .replace(SCHEMA_ACTIF, '')
    .replace(CARACTERES_CONTROLE, '');

  // Les remplacements laissent des espaces multiples : on normalise sans casser
  // les sauts de ligne d'une biographie ou d'une description.
  return texte
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Middleware : nettoie UNIQUEMENT les champs texte listés.
 *
 * Pourquoi une liste blanche de champs et non un parcours générique du corps ?
 * Parce que certains champs ne doivent jamais être touchés : `motDePasse` (un `<`
 * légitime dans un mot de passe casserait la connexion suivante), les photos
 * base64 (`data:image/…`, volumineuses et sensibles à toute réécriture) et les
 * tableaux déjà validés (`tags`, `photos`). Chaque route déclare donc ce qu'elle
 * accepte comme texte libre.
 *
 * @param {string[]} champs
 * @returns {import('express').RequestHandler}
 */
export function assainirChamps(champs = []) {
  return function assainir(req, _res, next) {
    const corps = req.body;
    if (corps && typeof corps === 'object' && !Array.isArray(corps)) {
      for (const champ of champs) {
        if (typeof corps[champ] === 'string') corps[champ] = nettoyerTexte(corps[champ]);
      }
    }
    return next();
  };
}

export default { nettoyerTexte, assainirChamps };
