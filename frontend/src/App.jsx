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
//    monter <App /> avec un <MemoryRouter> s'ils le souhaitent.
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

/** Routes affichées en plein écran : ni TopBar ni BottomNav. */
const ROUTES_PLEIN_ECRAN = [/^\/etablissement\//];

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Structure />
      </BrowserRouter>
    </AuthProvider>
  );
}

function Structure() {
  const { pathname } = useLocation();
  const { modeDemo } = useAuth();
  const pleinEcran = ROUTES_PLEIN_ECRAN.some((rx) => rx.test(pathname));

  return (
    <div className="min-h-full bg-white">
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

