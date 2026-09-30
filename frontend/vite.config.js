import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite — configuration Rejoins'Moi
//
// Décisions :
//  - `server.host: true` : l'appli doit être testable depuis un téléphone sur le
//    même réseau Wi-Fi pendant la tournée terrain (http://192.168.x.x:5173).
//  - proxy `/api` -> backend Express (port 4000) : le frontend appelle donc des
//    URL relatives (`/api/...`), ce qui évite tout problème de CORS en dev et
//    fonctionne tel quel si le frontend est servi par le même domaine en prod.
//  - Pour un backend déployé ailleurs (Railway, Render...), définir
//    VITE_API_URL dans frontend/.env (ex. https://api.rejoinsmoi.ci).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
