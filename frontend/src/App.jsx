// App.jsx — Point d'entrée des routes
// /                      -> Feed
// /recherche             -> Search
// /etablissement/:id     -> EstablishmentProfile
// /pharmacies-cliniques  -> PharmaciesCliniques
// /inscription           -> RegisterEstablishment
// /jobs                  -> Jobs (offres de boulot + demandes de main-d'œuvre, ajout du 29/09)
// /main-doeuvre          -> JobBoard
// /messages              -> Messages
// /profil                -> Profile
//
// Organisation :
//  - <AuthProvider> enveloppe tout (profil + jeton accessibles partout via useAuth).
//  - <BrowserRouter> est ici (et non dans main.jsx) pour que les tests puissent
//    monter <App /> avec un <MemoryRouter> s'ils le souhaitent. Son `basename`
//    suit la base de déploiement (voir basenameApp) pour que l'app fonctionne
//    aussi dans un sous-dossier, comme GitHub Pages (/rejoins-moi/).
//  - <Structure /> gère la barre du haut / bas de page commune. Le profil
//    établissement est en plein écran (pas de bottom nav) : c'est une « fiche »
//    qu'on partage, elle doit ressembler à une page, pas à un onglet.
//  - <InstallAppButton /> (ajout PWA du 29/09) flotte au-dessus de la bottom nav
//    pour proposer l'installation de l'app sur l'écran d'accueil.
//  - <MiseAJourPWA /> (16/11) affiche un bandeau « Une nouvelle version est
//    disponible » dès qu'un service worker plus récent prend la main. Sans lui,
//    un téléphone qui gardait l'app ouverte continuait d'afficher l'ancienne
//    version pendant des jours (localisation GPS et fiche nettoyée invisibles),
//    alors que le déploiement était bien en ligne : le worker changeait, la page
//    restait en mémoire. Il est monté ici, hors des routes, pour couvrir aussi
//    les écrans plein écran (fiche établissement, /admin).

import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext.jsx';

import BottomNav from './components/BottomNav.jsx';
import TopBar from './components/TopBar.jsx';
import InfoBanner from './components/InfoBanner.jsx';
import InstallAppButton from './components/InstallAppButton.jsx';
import MiseAJourPWA from './components/MiseAJourPWA.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useAuth } from './hooks/useAuth.js';

import Feed from './pages/Feed.jsx';
import Search from './pages/Search.jsx';

const EstablishmentProfile = lazy(() => import('./pages/EstablishmentProfile.jsx'));
const PharmaciesCliniques = lazy(() => import('./pages/PharmaciesCliniques.jsx'));
const RegisterEstablishment = lazy(() => import('./pages/RegisterEstablishment.jsx'));
const JobBoard = lazy(() => import('./pages/JobBoard.jsx'));
const Jobs = lazy(() => import('./pages/Jobs.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const MentionsLegales = lazy(() => import('./pages/MentionsLegales.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

/** Routes affichées en plein écran : ni TopBar ni BottomNav. */
const ROUTES_PLEIN_ECRAN = [/^\/etablissement\//, /^\/admin\/?$/];

/**
 * Base de déploiement de l'app, telle que Vite l'a compilée :
 *  - « / » à la racine d'un domaine (Vercel, Netlify, serveur mutualisé) ;
 *  - « /rejoins-moi/ » si l'app est dans un sous-dossier (GitHub Pages).
 * L'option `base` de Vite ne réécrit que les URL des fichiers (JS, CSS,
 * manifeste, service worker) : React Router, lui, compare le chemin de la barre
 * d'adresse à ses routes et a donc besoin du même préfixe via `basename`. Sans
 * lui, « /rejoins-moi/profil » ne correspondrait à aucune route et la route de
 * secours renverrait tout le monde à la racine du domaine.
 * Hors build Vite (essai hors navigateur), on retombe sur « / ».
 */
function basenameApp() {
  let base = '/';
  try {
    base = import.meta.env?.BASE_URL || '/';
  } catch {
    base = '/';
  }
  // React Router attend « /rejoins-moi » (sans barre finale) ; « / » reste « / ».
  return base.replace(/\/+$/, '') || '/';
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={basenameApp()}>
        <ErrorBoundary>
          <Structure />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}

function Structure() {
  const { pathname } = useLocation();
  const { modeDemo } = useAuth();
  const pleinEcran = ROUTES_PLEIN_ECRAN.some((rx) => rx.test(pathname));

  // Conteneur général : VOLONTAIREMENT sans fond opaque (v2 du 30/09). L'ivoire
  // vient du `body` et le motif « traits fins » des pages se place DERRIÈRE le
  // contenu (z-index négatif) : un fond blanc ici le masquerait.
  return (
    <div className="min-h-full">
      {/* Bandeau « nouvelle version » : premier enfant, hors du flux visuel (fixed).
          Il doit pouvoir apparaître au-dessus de n'importe quel écran, y compris la
          fiche établissement qui n'a ni barre du haut ni navigation basse. */}
      <MiseAJourPWA />

      {modeDemo && (
        <div className="ecran pt-2">
          <InfoBanner variante="demo" titre="Mode démonstration">
            Le serveur est injoignable : vous consultez des données d’exemple. Rien ne sera enregistré.
          </InfoBanner>
        </div>
      )}

      {!pleinEcran && <TopBar />}

      <main className="pb-4">
        {/* Invitation d'installation (PWA) : DANS LE FLUX, en tête du contenu.
            Elle était auparavant flottante au-dessus de la navigation basse, où
            elle recouvrait une carte de résultat sur /recherche (correctif du
            16/11). Ici elle pousse le contenu au lieu de le masquer, et reste
            visible dès le premier écran. */}
        {!pleinEcran && <InstallAppButton />}
        <Suspense fallback={<div className="ecran py-8 text-center text-ink-muted">Chargement…</div>}>
          <Routes>

            <Route path="/" element={<Feed />} />
            <Route path="/recherche" element={<Search />} />
            <Route path="/etablissement/:id" element={<EstablishmentProfile />} />
            <Route path="/pharmacies-cliniques" element={<PharmaciesCliniques />} />
            <Route path="/inscription" element={<RegisterEstablishment />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/main-doeuvre" element={<JobBoard />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/profil" element={<Profile />} />
            <Route path="/connexion" element={<Login />} />
            {/* Page « Mentions légales » (bloc G) : données collectées, ce qui est public,
                et suppression/correction par WhatsApp — accessible depuis le profil, la
                connexion et le menu principal. */}
            <Route path="/mentions-legales" element={<MentionsLegales />} />
            {/* Back-office : écran plein écran, jeton admin distinct du compte utilisateur. */}
            <Route path="/admin" element={<Admin />} />
            {/* Toute route inconnue affiche la page 404. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      {!pleinEcran && <BottomNav />}
    </div>
  );
}

/** Réexport pratique pour les tests. */
export { Structure };

