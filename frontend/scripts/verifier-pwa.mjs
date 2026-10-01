// verifier-pwa.mjs — vérifie le mécanisme d'affichage du bandeau d'installation.
//
// Pourquoi un script ? Parce qu'un bandeau qui « ne s'affiche plus » sur un téléphone
// n'a que trois causes possibles côté app, et qu'on ne peut pas le deviner depuis un
// ordinateur : le compteur de refus (localStorage), l'état du service worker, ou la
// disponibilité de l'invite du navigateur. Ce script rejoue le mécanisme hors
// navigateur (localStorage + URL simulés) et affiche le résultat — lancé avec
// `npm run verifier:pwa`.
//
// Rappel : sur un vrai téléphone, ouvrir l'app avec `?pwa=1` affiche le même
// diagnostic à l'écran, et remet le compteur de refus à zéro.

const store = new Map();
globalThis.window = {
  location: { href: 'https://example.test/rejoins-moi/?pwa=1' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 10)', platform: 'Linux' },
  configurable: true,
  writable: true,
});
globalThis.document = { readyState: 'complete' };

const pwa = await import('../src/utils/pwa.js');

let echecs = 0;
function verifier(intitule, obtenu, attendu) {
  const ok = obtenu === attendu;
  if (!ok) echecs += 1;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${intitule} : ${obtenu}${ok ? '' : ` (attendu ${attendu})`}`);
}

console.log('1. Appareil neuf (aucune invitation fermée)');
verifier('invitations fermées', pwa.lireIgnorances(), 0);
verifier('invitation masquée', pwa.invitationMasquee(), false);

pwa.ignorerInvitation();
pwa.ignorerInvitation();
pwa.ignorerInvitation();
console.log('2. Après 3 fermetures (le compteur vit dans localStorage, il survit aux mises à jour)');
verifier('invitations fermées', pwa.lireIgnorances(), 3);
verifier('invitation masquée', pwa.invitationMasquee(), true);

pwa.reinitialiserInvitation();
console.log('3. Après réinitialisation (pastille « Installer l’app » ou ?pwa=1)');
verifier('invitation masquée', pwa.invitationMasquee(), false);
verifier('?pwa=1 force l’affichage', pwa.invitationForcee(), true);

// Correctif du 30/09 : une app DÉJÀ installée continuait d'afficher la bannière
// flottante (et la pastille) au-dessus du contenu, sur toutes les pages. On
// vérifie ici que la détection fonctionne : dès que le navigateur annonce le mode
// « standalone » (app ouverte depuis l'écran d'accueil), l'état devient
// 'installee'. InstallAppButton ne rend alors PLUS RIEN, et l'option
// d'installation ne vit plus que dans le menu hamburger (MenuPrincipal).
console.log('4. App ouverte depuis l’écran d’accueil (display-mode: standalone)');
globalThis.window.matchMedia = (requete) => ({
  matches: String(requete).includes('display-mode: standalone'),
  addEventListener() {},
});
verifier('application considérée comme installée', pwa.estApplicationInstallee(), true);
verifier('état affiché', pwa.etatInvitation(), 'installee');

console.log(`\nChemin du service worker attendu : ${pwa.CHEMIN_SERVICE_WORKER}`);
console.log(echecs === 0 ? 'Tout est conforme.' : `${echecs} vérification(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
