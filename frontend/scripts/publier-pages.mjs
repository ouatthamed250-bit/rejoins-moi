// publier-pages.mjs — Publie frontend/dist sur la branche « gh-pages » du dépôt
// GitHub, ce qui met à jour la version de test :
//     https://ouatthamed250-bit.github.io/rejoins-moi/
//
// Pourquoi un dossier temporaire plutôt que le dossier de travail ? Parce que la
// branche gh-pages ne contient QUE le site compilé : elle est totalement séparée
// de la branche main (le code source reste dans main, jamais dupliqué). On
// assemble donc une copie jetable du build, on y ajoute les deux fichiers que
// GitHub Pages attend (404.html pour les accès directs aux pages, .nojekyll pour
// que le dossier assets/ ne soit pas filtré), puis on force la branche gh-pages.
//
// Usage : npm run deploy:pages   (depuis le dossier frontend)
//
// Ce déploiement est un CONFORT DE TEST : l'app y tourne en mode démonstration
// puisque l'API n'est pas exposée. La mise en service réelle passe par Vercel ou
// Netlify (voir docs/DEPLOIEMENT.md), qui servent l'app à la racine du domaine.

import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPOT = 'https://github.com/ouatthamed250-bit/rejoins-moi.git';
const BRANCHE = 'gh-pages';
const ADRESSE_PUBLIQUE = 'https://ouatthamed250-bit.github.io/rejoins-moi/';

const dossierFrontend = fileURLToPath(new URL('..', import.meta.url));
const build = join(dossierFrontend, 'dist');

if (!existsSync(join(build, 'index.html'))) {
  console.error('✗ Aucun build trouvé dans frontend/dist. Lancez d’abord « npm run build:pages ».');
  process.exit(1);
}

const travail = join(tmpdir(), 'rejoins-moi-gh-pages');
rmSync(travail, { recursive: true, force: true });
mkdirSync(travail, { recursive: true });
cpSync(build, travail, { recursive: true });

// GitHub Pages sert 404.html pour toute adresse inconnue : en y copiant
// index.html, un accès direct à /rejoins-moi/profil affiche l'app (le routeur
// prend le relais) au lieu d'une page blanche.
copyFileSync(join(travail, 'index.html'), join(travail, '404.html'));
// .nojekyll : sans lui, Jekyll ignore certains dossiers commençant par « _ ».
writeFileSync(join(travail, '.nojekyll'), '');

/** Exécute une commande git dans le dossier de publication, en montrant sa sortie. */
function git(...args) {
  execFileSync('git', args, { cwd: travail, stdio: 'inherit' });
}

console.log('→ Publication sur la branche', BRANCHE, '…');
git('init', '-b', BRANCHE);
git('config', 'core.autocrlf', 'false');
git('add', '-A');
git('commit', '-m', `Publication du site compile (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
git('remote', 'add', 'origin', DEPOT);
git('push', '--force', 'origin', BRANCHE);

console.log('\n✓ Publié. La mise à jour est visible dans une à deux minutes sur :');
console.log('  ' + ADRESSE_PUBLIQUE);
