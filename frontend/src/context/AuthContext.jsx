// AuthContext.jsx — Contexte d'authentification de l'application.
//
// Décisions produit (§2, §10) :
//  - Connexion par NUMÉRO DE TÉLÉPHONE + mot de passe (pas d'e-mail) : c'est le
//    mode d'identification naturel ici, et le numéro sert déjà aux paiements
//    mobile money. Le backend renvoie un JWT conservé dans localStorage.
//  - L'application reste UTILISABLE sans compte (consultation du feed, recherche,
//    pharmacies). Seules les actions personnelles (favoris, publier, débloquer un
//    contact, laisser un avis) exigent une connexion : on redirige alors vers
//    /connexion en mémorisant la destination.
//  - MODE DÉMONSTRATION : si l'API est injoignable (backend non démarré, réseau 3G
//    perdu pendant la tournée terrain), la connexion crée un profil local marqué
//    `demo: true` au lieu de bloquer l'utilisateur. Le bandeau « mode
//    démonstration » prévient clairement l'utilisateur que rien n'est enregistré.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, getProfilLocal, getToken, setProfilLocal, setToken } from '../utils/api/client.js';
import { ecrireAbonnementLocal } from '../utils/abonnement.js';
import { PROFIL_DEMO } from '../data/demoData.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profil, setProfil] = useState(() => getProfilLocal());
  const [token, setTokenState] = useState(() => getToken());
  const [historique, setHistorique] = useState([]);
  const [chargement, setChargement] = useState(Boolean(getToken()));
  const [modeDemo, setModeDemo] = useState(false);
  const [messagesNonLus, setMessagesNonLus] = useState(0);

  const connecte = Boolean(profil);
  // Un profil marqué `demo` n'a pas de compte serveur : on empêche les actions
  // qui seraient perdues (publier un besoin, payer) tout en laissant explorer.
  const estDemo = Boolean(profil?.demo);

  const memoriser = useCallback((nouveauProfil) => {
    setProfil(nouveauProfil);
    setProfilLocal(nouveauProfil);
  }, []);

  // ── Restauration de session : on revérifie le profil auprès du serveur ──
  useEffect(() => {
    let annule = false;
    async function restaurer() {
      if (!getToken()) {
        setChargement(false);
        return;
      }
      try {
        const donnees = await api.get('/users/me');
        if (annule) return;
        memoriser(donnees.user);
        setHistorique(donnees.historique || []);
        setModeDemo(false);
      } catch (err) {
        if (annule) return;
        if (err.offline) {
          // Serveur injoignable : on garde le profil local et on passe en mode démo.
          setModeDemo(true);
        } else {
          // Jeton expiré ou invalide : on nettoie proprement.
          setToken(null);
          setTokenState(null);
          memoriser(null);
        }
      } finally {
        if (!annule) setChargement(false);
      }
    }
    restaurer();
    return () => {
      annule = true;
    };
  }, [memoriser]);

  /** Connexion par téléphone + mot de passe. */
  const connexion = useCallback(
    async (telephone, motDePasse) => {
      try {
        const donnees = await api.post('/users/login', { telephone, motDePasse }, { auth: false });
        setToken(donnees.token);
        setTokenState(donnees.token);
        memoriser(donnees.user);
        setModeDemo(false);
        return { ok: true, user: donnees.user };
      } catch (err) {
        if (err instanceof ApiError && err.offline) {
          // Mode démonstration : on laisse entrer avec un profil local.
          const local = { ...PROFIL_DEMO, telephone: String(telephone || PROFIL_DEMO.telephone), demo: true };
          memoriser(local);
          setModeDemo(true);
          return {
            ok: true,
            demo: true,
            user: local,
            avertissement: 'Serveur injoignable : connexion en mode démonstration, rien ne sera enregistré.',
          };
        }
        throw err;
      }
    },
    [memoriser]
  );

  /** Inscription (téléphone + mot de passe, §10). */
  const inscription = useCallback(
    async (donnees) => {
      const reponse = await api.post('/users/register', donnees, { auth: false });
      setToken(reponse.token);
      setTokenState(reponse.token);
      memoriser(reponse.user);
      setModeDemo(false);
      return reponse.user;
    },
    [memoriser]
  );

  /** Déconnexion : on efface le jeton et le profil local. */
  const deconnexion = useCallback(() => {
    setToken(null);
    setTokenState(null);
    memoriser(null);
    setHistorique([]);
    setModeDemo(false);
    // Le miroir local d'abonnement appartient au compte : on l'efface aussi,
    // sinon un second utilisateur verrait « contacts inclus » sans abonnement.
    ecrireAbonnementLocal(null);
  }, [memoriser]);

  const mettreAJourProfil = useCallback(
    async (patch) => {
      if (!token) {
        memoriser({ ...profil, ...patch });
        return { user: { ...profil, ...patch }, local: true };
      }
      const reponse = await api.patch('/users/me', patch);
      memoriser(reponse.user);
      return reponse;
    },
    [token, profil, memoriser]
  );

  /**
   * Enregistre une interaction (vue, recherche, clic...) pour nourrir
   * l'apprentissage progressif du feed (§3). En mode démo, on alimente uniquement
   * l'état local : le classement reste cohérent pendant la session.
   */
  const ajouterInteraction = useCallback(
    async (interaction) => {
      setHistorique((prec) => [...prec, { ...interaction, at: new Date().toISOString() }].slice(-300));
      if (!token || estDemo) return;
      try {
        await api.post('/users/me/interactions', interaction);
      } catch {
        // Un échec d'analytics ne doit jamais gêner l'utilisateur : on ignore.
      }
    },
    [token, estDemo]
  );

  /** Bascule un favori (optimiste : l'étoile réagit immédiatement). */
  const basculerFavori = useCallback(
    async (establishmentId) => {
      const dejaFavori = (profil?.favoris || []).map(String).includes(String(establishmentId));
      const favoris = dejaFavori
        ? (profil?.favoris || []).filter((f) => String(f) !== String(establishmentId))
        : [...(profil?.favoris || []), establishmentId];
      memoriser({ ...profil, favoris });

      if (token && !estDemo) {
        try {
          const reponse = await api.post(`/users/me/favoris/${establishmentId}`, {});
          memoriser({ ...profil, favoris: reponse.favoris });
        } catch {
          /* on garde l'état optimiste local */
        }
      }
      return !dejaFavori;
    },
    [profil, token, estDemo, memoriser]
  );

  const valeurContexte = useMemo(
    () => ({
      profil,
      token,
      connecte,
      estDemo,
      modeDemo,
      chargement,
      historique,
      favoris: (profil?.favoris || []).map(String),
      messagesNonLus,
      setMessagesNonLus,
      connexion,
      inscription,
      deconnexion,
      mettreAJourProfil,
      ajouterInteraction,
      basculerFavori,
    }),
    [
      profil,
      token,
      connecte,
      estDemo,
      modeDemo,
      chargement,
      historique,
      messagesNonLus,
      connexion,
      inscription,
      deconnexion,
      mettreAJourProfil,
      ajouterInteraction,
      basculerFavori,
    ]
  );

  return <AuthContext.Provider value={valeurContexte}>{children}</AuthContext.Provider>;
}

/** Accès au contexte d'authentification (lève une erreur explicite hors provider). */
export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() doit être utilisé à l'intérieur de <AuthProvider> (voir main.jsx).");
  }
  return ctx;
}

export default AuthContext;
