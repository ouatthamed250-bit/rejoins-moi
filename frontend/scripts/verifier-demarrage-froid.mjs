// verifier-demarrage-froid.mjs — preuve du correctif « démarrage à froid » (bloc A).
//
// CE QU'ON VÉRIFIE, ET POURQUOI ICI
// L'hébergement de l'API endort l'instance après quelques minutes d'inactivité : la
// toute première requête du matin traverse un démarrage à froid. Avant le correctif,
// le client abandonnait au bout de 20 s et l'écran d'accueil basculait sur les
// données d'EXEMPLE : l'utilisateur croyait l'annuaire vide. Le correctif tient en
// deux comportements qu'on ne peut pas deviner sans les rejouer :
//   1. le premier appel d'une session attend plus longtemps, et une LECTURE est
//      retentée une fois (les écritures jamais) ;
//   2. l'accueil garde les VRAIES fiches de la dernière visite au lieu de les
//      remplacer par des fiches d'exemple.
// Ce script rejoue tout cela hors navigateur (localStorage + fetch simulés), sans
// toucher au réseau réel : `npm run verifier:demarrage`.
//
// Options : `--rapide` saute l'observation en temps réel du délai long (22 s).

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ICI = dirname(fileURLToPath(import.meta.url));
const RAPIDE = process.argv.includes('--rapide');

let echecs = 0;
let reussis = 0;
function verifier(intitule, ok, detail = '') {
  if (ok) {
    reussis += 1;
    console.log(`  ✓ ${intitule}${detail ? ` — ${detail}` : ''}`);
  } else {
    echecs += 1;
    console.log(`  ✗ ${intitule}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── localStorage simulé (le client et le cache y accèdent) ───────────────────
const memoireLocale = new Map();
let quotaPlein = false;
globalThis.localStorage = {
  getItem: (cle) => (memoireLocale.has(cle) ? memoireLocale.get(cle) : null),
  setItem: (cle, valeur) => {
    if (quotaPlein) throw new Error('QuotaExceededError');
    memoireLocale.set(cle, String(valeur));
  },
  removeItem: (cle) => memoireLocale.delete(cle),
};

// ── fetch simulé : on décide, appel par appel, du comportement « serveur » ───
let appels = [];
let comportement = async () => reponseJson(200, { items: [], total: 0 });

globalThis.fetch = (url, options = {}) => {
  appels.push({ url: String(url), method: options.method || 'GET' });
  return comportement(String(url), options);
};

function reponseJson(statut, corps) {
  const texte = JSON.stringify(corps);
  return {
    status: statut,
    ok: statut >= 200 && statut < 300,
    headers: { get: (nom) => (String(nom).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    text: async () => texte,
  };
}

/** Promesse qui ne se résout jamais de son propre chef, mais rejette si le client coupe. */
function pendJusquAnnulation(options) {
  return new Promise((_, rejeter) => {
    options.signal?.addEventListener('abort', () => rejeter(new Error('aborted')), { once: true });
  });
}

const cache = await import('../src/utils/cacheAnnuaire.js');

// Chaque scénario repart d'une SESSION NEUVE : le client retient « l'API est-elle
// endormie ? » au niveau du module, comme dans l'application (une seule session par
// onglet). Un import avec un suffixe distinct réévalue le module — équivalent simulé
// d'un onglet fraîchement ouvert, sans ajouter de fonction de test dans le code livré.
//
// Note méthodologique : le client livré lit `import.meta.env.VITE_API_URL`, une
// variable fournie par Vite. Node n'a pas de `import.meta.env` : on travaille donc
// sur une COPIE du fichier où cette lecture est remplacée par un objet vide (l'URL de
// base n'intervient pas ici puisque `fetch` est entièrement simulé). La copie est
// supprimée à la fin du script.
const SOURCE_CLIENT = readFileSync(join(ICI, '..', 'src', 'utils', 'api', 'client.js'), 'utf8')
  .replace(/import\.meta\.env/g, '({})');
const FICHIER_CLIENT_SIMULE = join(tmpdir(), `rejoinsmoi-client-simule-${process.pid}.mjs`);
writeFileSync(FICHIER_CLIENT_SIMULE, SOURCE_CLIENT, 'utf8');

let compteurModule = 0;
async function clientFrais() {
  compteurModule += 1;
  return import(`${pathToFileURL(FICHIER_CLIENT_SIMULE).href}?session=${compteurModule}`);
}

const FICHE = { id: 'abc', nom: 'Boutique test', categorie: 'beaute', localisation: { lat: 5.32, lng: -4.02 } };

console.log('\n▶ Démarrage à froid : le client ne renonce plus et ne montre plus de fausses fiches');
console.log('  (fetch et localStorage simulés — aucun appel réseau réel)\n');

// ── 1) Le cas qui cassait tout : l'instance dort plus de 20 s puis répond ────
console.log('1) Instance endormie : la 1re réponse arrive tardivement');
{
  const client = await clientFrais();
  let numero = 0;
  comportement = async (_url, options) => {
    numero += 1;
    if (numero === 1) return pendJusquAnnulation(options); // le serveur dort
    return reponseJson(200, { items: [FICHE], total: 1 });
  };
  appels = [];
  const debut = Date.now();
  // Délai raccourci ici pour que la preuve tourne en quelques secondes : c'est le
  // MÉCANISME qu'on vérifie (nouvel essai après un délai dépassé). La valeur de
  // production (60 s) est mesurée en temps réel au point 2.
  const resultat = await client.api.get('/establishments', { auth: false, timeoutMs: 400 });
  const duree = Date.now() - debut;
  verifier('la liste est finalement renvoyée (plus de repli sur les données d’exemple)', resultat?.items?.length === 1);
  verifier('le client a bien relancé une requête après le délai dépassé', appels.length === 2, `${appels.length} appel(s)`);
  verifier('le 1er essai a réellement expiré avant le second', duree >= 400, `${duree} ms`);
}

// ── 2) Le délai de production dépasse bien les 20 s d'avant ──────────────────
console.log('\n2) Premier appel d’une session : le délai n’est plus de 20 s (temps réel)');
let client = await clientFrais();
verifier('constante de réveil exportée', client.REVEIL_TIMEOUT_MS === 60000, `${client.REVEIL_TIMEOUT_MS} ms`);
verifier('délai des appels suivants inchangé', client.TIMEOUT_DEFAUT_MS === 20000, `${client.TIMEOUT_DEFAUT_MS} ms`);
verifier(
  'budget total borné à 90 s (60 s puis 30 s) : jamais d’attente illimitée',
  client.BUDGET_REVEIL_MS === 90000 && client.BUDGET_REVEIL_MS === client.REVEIL_TIMEOUT_MS + 30000,
  `${client.BUDGET_REVEIL_MS} ms`
);
verifier('budget suffisant face au froid mesuré en production (23,7 s)', client.REVEIL_TIMEOUT_MS > 23700);
verifier('l’API est considérée endormie au 1er appel', client.apiProbablementEndormie() === true);
if (RAPIDE) {
  console.log('  ⏭  Observation en temps réel ignorée (--rapide)');
} else {
  let libere = null;
  comportement = () => new Promise((resoudre) => { libere = resoudre; });
  appels = [];
  const requeteEnCours = client.api.get('/establishments', { auth: false }).then(
    (valeur) => ({ ok: true, valeur }),
    (erreur) => ({ ok: false, erreur })
  );
  await new Promise((r) => setTimeout(r, 21500)); // 20 s d'ancien délai + 1,5 s de marge
  const etat = await Promise.race([requeteEnCours, new Promise((r) => setTimeout(() => r('EN_COURS'), 50))]);
  verifier(
    'à 21,5 s la requête attend encore (l’ancien délai de 20 s aurait déjà renoncé)',
    etat === 'EN_COURS',
    etat === 'EN_COURS' ? 'toujours en attente' : 'la requête s’est terminée trop tôt'
  );
  libere(reponseJson(200, { items: [FICHE], total: 1 })); // le service est réveillé
  const fin = await requeteEnCours;
  verifier('réponse obtenue dès le réveil du service', fin.ok === true && fin.valeur?.items?.length === 1);
}
if (RAPIDE) {
  comportement = async () => reponseJson(200, { items: [FICHE], total: 1 });
  await client.api.get('/establishments', { auth: false }); // réponse immédiate simulée
}
verifier('après une réponse, l’API n’est plus « endormie » (délai court rétabli)', client.apiProbablementEndormie() === false);

// ── 3) L'hébergeur annonce lui-même le démarrage (502/503) ───────────────────
console.log('\n3) Hébergeur en cours de démarrage : 503 puis réponse');
{
  const c = await clientFrais();
  let numero = 0;
  comportement = async () => {
    numero += 1;
    if (numero === 1) return reponseJson(503, { error: 'Service en cours de démarrage', offline: true });
    return reponseJson(200, { items: [FICHE], total: 1 });
  };
  appels = [];
  const resultat = await c.api.get('/establishments', { auth: false });
  verifier('la lecture aboutit malgré le 503 initial', resultat?.items?.length === 1);
  verifier('un seul nouvel essai a été tenté', appels.length === 2, `${appels.length} appel(s)`);
}

// ── 4) Une ÉCRITURE n'est jamais rejouée (risque de doublon / double débit) ──
console.log('\n4) Écriture : aucun nouvel essai, même sur un 503');
{
  const c = await clientFrais();
  comportement = async () => reponseJson(503, { error: 'Service en cours de démarrage', offline: true });
  appels = [];
  let erreur = null;
  try {
    await c.api.post('/payments/initier', { montant: 5000 });
  } catch (err) {
    erreur = err;
  }
  verifier('l’écriture échoue proprement', Boolean(erreur) && erreur.offline === true, erreur?.message || 'aucune erreur');
  verifier('AUCUN nouvel essai : pas de risque de doublon ni de double paiement', appels.length === 1, `${appels.length} appel(s)`);
}

// ── 5) Réseau réellement coupé : on échoue VITE (pas une minute d'attente) ───
console.log('\n5) Réseau coupé : échec immédiat, pas d’attente inutile');
{
  const c = await clientFrais();
  comportement = async () => {
    throw new TypeError('fetch failed'); // serveur injoignable : échec franc
  };
  appels = [];
  const debut = Date.now();
  let erreur = null;
  try {
    await c.api.get('/establishments', { auth: false });
  } catch (err) {
    erreur = err;
  }
  const duree = Date.now() - debut;
  verifier('erreur marquée « injoignable »', erreur?.offline === true);
  verifier('échec en moins d’une seconde (aucune attente de 60 s)', duree < 1000, `${duree} ms`);
  verifier('aucun nouvel essai sur un réseau mort', appels.length === 1, `${appels.length} appel(s)`);
}

// ── 6) Mémoire locale de l'annuaire (les vraies fiches, pas des exemples) ────
console.log('\n6) Mémoire locale de la dernière liste d’établissements');
{
  const CLE_ATTENDUE = 'rejoinsmoi.annuaire.derniereListe';
  memoireLocale.clear();
  const trente = Array.from({ length: 30 }, (_, i) => ({ ...FICHE, id: `f${i}` }));
  cache.ecrireCacheAnnuaire('tous', trente, 6719);
  const lu = cache.lireCacheAnnuaire('tous');
  verifier('les fiches réelles sont relues telles quelles', lu?.items?.length === 30 && lu.items[0].id === 'f0');
  verifier('le total de l’annuaire est mémorisé', lu?.total === 6719, String(lu?.total));
  verifier('la liste mémorisée est fraîche (0 min)', lu?.ageMinutes === 0, `${lu?.ageMinutes} min`);
  verifier('aucune donnée mémorisée pour une catégorie jamais consultée', cache.lireCacheAnnuaire('beaute') === null);

  const quaranteCinq = Array.from({ length: 45 }, (_, i) => ({ ...FICHE, id: `g${i}` }));
  cache.ecrireCacheAnnuaire('tous', quaranteCinq, 6719);
  verifier('on ne mémorise que la 1re page (30 fiches au plus)', cache.lireCacheAnnuaire('tous')?.items?.length === 30);

  cache.ecrireCacheAnnuaire('beaute', trente.slice(0, 4), 120);
  verifier(
    'chaque catégorie a sa propre mémoire',
    cache.lireCacheAnnuaire('beaute')?.items?.length === 4 && cache.lireCacheAnnuaire('tous')?.items?.length === 30
  );

  cache.ecrireCacheAnnuaire('tous', [], 0);
  verifier(
    'une liste vide n’écrase pas la mémoire (jamais de faux « annuaire vide »)',
    cache.lireCacheAnnuaire('tous')?.items?.length === 30
  );

  for (let i = 1; i <= 7; i += 1) {
    cache.ecrireCacheAnnuaire(`c${i}`, [FICHE], 1);
    await new Promise((r) => setTimeout(r, 5));
  }
  const brutes = JSON.parse(memoireLocale.get(CLE_ATTENDUE) || '{}');
  const cles = Object.keys(brutes);
  verifier('la mémoire est bornée à 6 catégories', cles.length === 6, `${cles.length} catégorie(s)`);
  verifier('la catégorie la plus ancienne est évincée', !cles.includes('c1') && cles.includes('c7'), cles.join(', '));

  memoireLocale.set(CLE_ATTENDUE, '{ceci n’est pas du JSON');
  verifier('une mémoire corrompue ne fait pas planter l’écran', cache.lireCacheAnnuaire('tous') === null);

  const avant = memoireLocale.get(CLE_ATTENDUE);
  quotaPlein = true;
  let leve = false;
  try {
    cache.ecrireCacheAnnuaire('tous', trente, 6719);
  } catch {
    leve = true;
  }
  quotaPlein = false;
  verifier('un stockage plein (navigation privée) ne bloque jamais l’application', leve === false);
  verifier('le contenu existant reste intact après l’échec d’écriture', memoireLocale.get(CLE_ATTENDUE) === avant);

  const sourceCache = readFileSync(join(ICI, '..', 'src', 'utils', 'cacheAnnuaire.js'), 'utf8');
  verifier('la clé de stockage porte un préfixe applicatif explicite', CLE_ATTENDUE.startsWith('rejoinsmoi.'));
  verifier(
    'la mémoire ne touche ni compte, ni abonnement, ni paiement, ni administration',
    !/users\/me|abonnement|paiement|payments|\badmin\b/i.test(sourceCache.replace(/\/\/[^\n]*/g, '')),
    'aucune de ces routes n’apparaît dans le module'
  );
  verifier(
    'aucun champ privé dans la charge mémorisée',
    !/motDePasse|password|token|authorization/i.test(JSON.stringify(lu?.items || []))
  );
}

// ── 7) Garde-fous dans l'écran d'accueil (le vrai risque : de fausses fiches) ─
console.log('\n7) Écran d’accueil : mémoire d’abord, exemples seulement en dernier recours');
{
  const sourceFeed = readFileSync(join(ICI, '..', 'src', 'pages', 'Feed.jsx'), 'utf8');
  const positionDemo = sourceFeed.indexOf('filtrerEtablissementsDemo({ categorie })');
  const avantDemo = sourceFeed.slice(Math.max(0, positionDemo - 320), positionDemo);
  verifier('le repli sur les exemples n’a lieu QUE sans liste mémorisée', /numeroPage === 1 && !memoire/.test(avantDemo));
  verifier('les fiches mémorisées sont conservées en cas d’échec réseau', /else if \(memoire\)/.test(sourceFeed));
  verifier('la mémoire n’est écrite que pour la 1re page', /if \(numeroPage === 1\) \{\s*ecrireCacheAnnuaire/.test(sourceFeed));
  verifier('l’attente d’un service endormi est expliquée à l’écran', sourceFeed.includes('Réveil du service en cours'));
  verifier('un bouton permet de réessayer sans quitter l’écran', sourceFeed.includes("libelle: 'Réessayer'"));
  verifier(
    'les fiches d’exemple sont annoncées comme telles',
    sourceFeed.includes('ils ne correspondent à aucun commerce réel')
  );
}

console.log(`\n${'─'.repeat(72)}`);
console.log(`  Résultat : ${reussis} vérification(s) réussie(s), ${echecs} échec(s)`);
console.log('');
try {
  unlinkSync(FICHIER_CLIENT_SIMULE); // aucune trace laissée derrière le script
} catch {
  /* rien à supprimer */
}
if (echecs > 0) process.exitCode = 1;
