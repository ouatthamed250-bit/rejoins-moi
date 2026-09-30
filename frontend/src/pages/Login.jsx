// Login.jsx — Connexion / inscription par numéro de téléphone (écran complémentaire
// aux 9 écrans maquettés : indispensable dès qu'une action est personnelle).
//
// Décisions produit (§2, §10) :
//  - Identification par TÉLÉPHONE + mot de passe, pas d'e-mail : c'est l'usage local,
//    et le numéro est déjà l'identifiant du mobile money.
//  - UN SEUL TYPE DE COMPTE (cahier des charges, ajout du 29/09) : l'écran ne demande
//    plus « je suis… ». Le métier, facultatif, active simplement la visibilité
//    artisan — les capacités se règlent ensuite dans le profil.
//  - Un seul écran avec deux onglets (Connexion / Créer un compte) : sur mobile,
//    moins d'écrans = moins d'abandons.
//  - Après connexion, on renvoie l'utilisateur là où il voulait aller
//    (location.state.depuis), sinon vers l'accueil.
//  - Si le serveur est injoignable, useAuth bascule en mode démonstration et
//    l'affiche clairement : on ne prétend jamais avoir créé un compte.

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import InfoBanner from '../components/InfoBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { Icon } from '../components/Icons.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { METIERS } from '../data/demoData.js';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { connexion, inscription, connecte, chargement } = useAuth();

  const [onglet, setOnglet] = useState('connexion');
  const [formulaire, setFormulaire] = useState({
    telephone: '',
    motDePasse: '',
    prenom: '',
    nom: '',
    metier: '',
  });
  const [erreur, setErreur] = useState('');
  const [avertissement, setAvertissement] = useState('');
  const [enCours, setEnCours] = useState(false);

  const destination = location.state?.depuis || '/';

  function maj(champ, valeur) {
    setFormulaire((prec) => ({ ...prec, [champ]: valeur }));
  }

  async function soumettre(evt) {
    evt.preventDefault();
    setErreur('');
    setAvertissement('');
    setEnCours(true);
    try {
      if (onglet === 'connexion') {
        const resultat = await connexion(formulaire.telephone, formulaire.motDePasse);
        if (resultat?.avertissement) setAvertissement(resultat.avertissement);
        navigate(destination, { replace: true });
      } else {
        if (formulaire.motDePasse.length < 6) {
          throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
        }
        await inscription(formulaire);
        // Un compte tout neuf n'a pas encore d'établissement : on enchaîne sur l'inscription.
        navigate('/inscription', { replace: true });
      }
    } catch (err) {
      setErreur(err?.message || 'Connexion impossible. Vérifiez vos identifiants.');
    } finally {
      setEnCours(false);
    }
  }

  if (connecte) {
    return (
      <div className="ecran py-6">
        <EmptyState
          icone="check"
          titre="Vous êtes déjà connecté"
          description="Votre session est active sur cet appareil."
          action={{ libelle: 'Retour à l’accueil', onClick: () => navigate('/') }}
        />
      </div>
    );
  }

  return (
    <div className="ecran py-4">
      <h1 className="text-xl font-bold text-ink">
        {onglet === 'connexion' ? 'Content de vous revoir' : 'Bienvenue sur Rejoins’Moi'}
      </h1>
      <p className="mb-4 text-sm text-ink-muted">
        {onglet === 'connexion'
          ? 'Connectez-vous avec votre numéro de téléphone.'
          : 'Créez votre compte en 30 secondes : un numéro, un mot de passe.'}
      </p>

      {/* Onglets */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-soft p-1">
        {[
          { cle: 'connexion', libelle: 'Se connecter' },
          { cle: 'inscription', libelle: 'Créer un compte' },
        ].map((t) => (
          <button
            key={t.cle}
            type="button"
            onClick={() => setOnglet(t.cle)}
            className={`rounded-sm px-3 py-2 text-sm font-bold transition ${
              onglet === t.cle ? 'bg-white text-primary shadow-card' : 'text-ink-muted'
            }`}
          >
            {t.libelle}
          </button>
        ))}
      </div>

      {erreur && (
        <InfoBanner variante="erreur" titre="Connexion impossible" className="mb-3">
          {erreur}
        </InfoBanner>
      )}
      {avertissement && (
        <InfoBanner variante="demo" titre="Mode démonstration" className="mb-3">
          {avertissement}
        </InfoBanner>
      )}

      <form onSubmit={soumettre} className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-ink">Numéro de téléphone</span>
          <input
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel"
            value={formulaire.telephone}
            onChange={(e) => maj('telephone', e.target.value)}
            placeholder="07 07 12 34 56"
            className="w-full rounded-md border border-line px-3 py-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-bold text-ink">Mot de passe</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={onglet === 'connexion' ? 'current-password' : 'new-password'}
            value={formulaire.motDePasse}
            onChange={(e) => maj('motDePasse', e.target.value)}
            placeholder="Au moins 6 caractères"
            className="w-full rounded-md border border-line px-3 py-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        {onglet === 'inscription' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-ink">Prénom</span>
                <input
                  type="text"
                  value={formulaire.prenom}
                  onChange={(e) => maj('prenom', e.target.value)}
                  className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-ink">Nom</span>
                <input
                  type="text"
                  value={formulaire.nom}
                  onChange={(e) => maj('nom', e.target.value)}
                  className="w-full rounded-md border border-line px-3 py-3 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>

            {/* Compte UNIQUE (ajout du 29/09) : plus de choix « je suis… ». Les
                capacités (proposer mes services, chercher du travail) se règlent
                après l'inscription, depuis le profil — et à tout moment. */}
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] leading-snug text-ink-muted">
              <p className="flex items-center gap-2 text-xs font-bold text-ink">
                <Icon name="check" size={15} className="text-primary" />
                Un seul compte, tous les usages
              </p>
              <p className="mt-1">
                Avec ce même compte, vous pourrez chercher du travail, être trouvé comme artisan ou
                prestataire, et publier une offre de boulot ou un besoin de main-d’œuvre.
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-bold text-ink">
                Mon métier <span className="font-normal text-ink-muted">(facultatif)</span>
              </span>
              <select
                value={formulaire.metier}
                onChange={(e) => maj('metier', e.target.value)}
                className="w-full rounded-md border border-line bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-primary"
              >
                <option value="">Choisir…</option>
                {METIERS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] leading-snug text-ink-muted">
                Renseignez-le si vous proposez vos services : votre profil deviendra visible comme
                artisan (modifiable à tout moment dans votre profil).
              </span>
            </label>
          </>
        )}

        <button type="submit" className="bouton-principal mt-1 w-full" disabled={enCours || chargement}>
          {enCours ? 'Patientez…' : onglet === 'connexion' ? 'Se connecter' : 'Créer mon compte'}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
        Vos données (numéro, photo, position) ne sont collectées qu’avec votre accord et servent uniquement à la mise
        en relation (déclaration ARTCI en cours).{' '}
        <Link to="/" className="font-semibold text-primary underline">
          Continuer sans compte
        </Link>
      </p>
    </div>
  );
}
