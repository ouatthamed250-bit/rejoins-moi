// useAuth.js — Point d'entrée unique pour l'authentification dans les composants.
// Le contexte vit dans src/context/AuthContext.jsx ; ce hook ne fait que le réexposer
// (c'est le chemin d'import utilisé partout dans l'app : `useAuth()`).

import { useAuthContext } from '../context/AuthContext.jsx';

export function useAuth() {
  return useAuthContext();
}

export default useAuth;
