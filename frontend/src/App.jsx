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

import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';

import BottomNav from './components/BottomNav.jsx';
import TopBar from './components/TopBar.jsx';
import InfoBanner from './components/InfoBanner.jsx';
import InstallAppButton from './components/InstallAppButton.jsx';
import { useAuth } from './hooks/useAuth.js';

import Feed from './pages/Feed.jsx';
import Search from './pages/Search.jsx';
import EstablishmentProfile from './pages/EstablishmentProfile.jsx';
import PharmaciesCliniques from './pages/PharmaciesCliniques.jsx';
import RegisterEstablishment from './pages/RegisterEstablishment.jsx';
import JobBoard from './pages/JobBoard.jsx';
import Jobs from './pages/Jobs.jsx';
import Messages from './pages/Messages.jsx';
import Profile from './pages/Profile.jsx';
import Login from './pages/Login.jsx';
import Admin from './pages/Admin.jsx';

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
        <Structure />
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
      {modeDemo && (
        <div className="ecran pt-2">
          <InfoBanner variante="demo" titre="Mode démonstration">
            Le serveur est injoignable : vous consultez des données d’exemple. Rien ne sera enregistré.
          </InfoBanner>
        </div>
      )}

      {!pleinEcran && <TopBar />}

      <main className="pb-4">
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
          {/* Back-office : écran plein écran, jeton admin distinct du compte utilisateur. */}
          <Route path="/admin" element={<Admin />} />
          {/* Toute route inconnue revient au feed : jamais d'écran blanc. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!pleinEcran && <BottomNav />}

      {/* Invitation d'installation (PWA) : au-dessus de la bottom nav, visible sur
          tous les écrans sauf les fiches plein écran partagées par lien. */}
      {!pleinEcran && <InstallAppButton />}
    </div>
  );
}

/** Réexport pratique pour les tests. */
export { Structure };

