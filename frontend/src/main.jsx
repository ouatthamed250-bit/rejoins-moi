// main.jsx — Bootstrap React (ReactDOM.createRoot, import App, import ./styles/theme.css)
//
// Depuis l'ajout PWA (29/09), c'est aussi ici que démarre le service worker :
// il met l'app shell en cache pour que l'app s'ouvre même sans réseau, et il est
// programmé pour ne JAMAIS mettre en cache ce qui touche aux paiements (sw.js).

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { enregistrerServiceWorker } from './utils/pwa.js';
import './styles/theme.css';
// Feuille de style du BACK-OFFICE (espace /admin) : volontairement séparée de theme.css —
// le back-office est un outil de travail (tableaux, densité, police système), pas la vitrine
// mobile. Les deux fichiers cohabitent sans se marcher dessus (tout est préfixé `bo-`).
import './styles/admin.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Après le rendu : le worker est un confort, il ne doit jamais retarder l'affichage.
enregistrerServiceWorker();

