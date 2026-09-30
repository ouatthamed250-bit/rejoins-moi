// Profile.jsx — Profil de l'utilisateur connecté (écran complémentaire).
//
// Rôle : permettre à un ouvrier/artisan de compléter son profil (métier, segment,
// quartier), d'atteindre ses favoris et ses besoins publiés, et de se déconnecter.
//
// Décisions :
//  - Consultable sans compte, mais on invite alors à se connecter pour retrouver
//    ses favoris sur un autre appareil.
//  - Le segment « journalier » vs « spécialisé » est modifiable ici : c'est lui qui
//    conditionne la variante de gratuité du premier contact (§2).
//  - Les favoris sont affichés depuis l'état local (profil.favoris) : aucune requête
//    supplémentaire n'est nécessaire.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import EmptyState from '../components/EmptyState.jsx';
import InfoBanner from '../components/InfoBanner.jsx';
import AbonnementArtisan from '../components/AbonnementArtisan.jsx';
import { Icon } from '../components/Icons.jsx';
import { api } from '../utils/api/client.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatFcfa, formatTelephone, initiales } from '../utils/format.js';
import { METIERS, ETABLISSEMENTS_DEMO } from '../data/demoData.js';

const FORMULAIRE_VIDE = {
  prenom: '',
  nom: '',
  metier: '',
  segment: 'specialise',
  quartier: '',
  commune: '',
  // Capacités du compte unifié (ajout du 29/09) : ce sont elles qui décident si
  // l'utilisateur est trouvable comme artisan et s'il reçoit les annonces.
  estArtisan: false,
  chercheTravail: true,
};

export default function Profile() {
  const navigate = useNavigate();
  const { profil, connecte, estDemo, deconnexion, mettreAJourProfil, favoris } = useAuth();
  const [edition, setEdition] = useState(false);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [message, setMessage] = useState('');
  const [mesBesoins, setMesBesoins] = useState([]);

  useEffect(() => {
    if (!profil) return;
    setFormulaire({
      prenom: profil.prenom || '',
      nom: profil.nom || '',
      metier: profil.metier || '',
      segment: profil.segment || 'specialise',
      quartier: profil.quartier || '',
      commune: profil.commune || '',
      estArtisan: Boolean(profil.estArtisan),
      chercheTravail: profil.chercheTravail !== false,
    });
  }, [profil]);

  // Besoins publiés par l'utilisateur connecté (encart non critique).
  useEffect(() => {
    let annule = false;
    async function chargerMesBesoins() {
      if (!connecte || estDemo || !profil?.id) return;
      try {
        const reponse = await api.get('/jobs?limit=50');
        if (annule) return;
        setMesBesoins(
          (reponse.items || []).filter((j) => String(j.posteParUserId || '') === String(profil.id))
        );
      } catch {
        /* silencieux */
      }
    }
    chargerMesBesoins();
    return () => {
      annule = true;
    };
  }, [connecte, estDemo, profil?.id]);

  async function enregistrer(evt) {
    evt.preventDefault();
    setMessage('');
    try {
      await mettreAJourProfil(formulaire);
      setEdition(false);
      setMessage('Profil mis à jour.');
    } catch (err) {
      setMessage(err?.message || 'Mise à jour impossible pour le moment.');
    }
  }

  if (!connecte) {
    return (
      <div className="ecran py-6">
        <EmptyState
          icone="user"
          titre="Votre profil Rejoins’Moi"
          description="Connectez-vous avec votre numéro de téléphone pour enregistrer vos favoris, publier un besoin ou inscrire votre établissement."
          action={{ libelle: 'Se connecter', onClick: () => navigate('/connexion', { state: { depuis: '/profil' } }) }}
        />
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/main-doeuvre')}>
            <Icon name="briefcase" size={18} />
            Voir les besoins de main-d’œuvre
          </button>
          <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/pharmacies-cliniques')}>
            <Icon name="pharmacy" size={18} />
            Pharmacies & Cliniques
          </button>
        </div>
      </div>
    );
  }

  const etablissementsFavoris = ETABLISSEMENTS_DEMO.filter((e) => favoris.includes(String(e.id)));
  // Compte unifié : le libellé se déduit des CAPACITÉS, pas d'un type de compte.
  const libelleType = [
    profil.estArtisan ? `Artisan · ${profil.metier || 'métier à préciser'}` : null,
    profil.chercheTravail ? 'Cherche du travail' : null,
    'Peut employer (publier une offre ou un besoin)',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="ecran py-3">
      {/* En-tête du profil */}
      <section className="carte flex items-center gap-3 p-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-lg font-bold text-primary">
          {profil.photoProfil ? (
            <img src={profil.photoProfil} alt={profil.nomComplet} className="h-full w-full object-cover" />
          ) : (
            initiales(profil.nomComplet || 'Utilisateur')
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-ink">{profil.nomComplet || 'Mon profil'}</h1>
          <p className="text-xs font-semibold text-ink-muted">{formatTelephone(profil.telephone)}</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {libelleType}
            {profil.segment === 'journalier' ? ' · journalier' : ''}
          </p>
        </div>
        <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setEdition((v) => !v)}>
          {edition ? 'Annuler' : 'Modifier'}
        </button>
      </section>

      {/* Abonnement (ajout du 29/09) : l'option qui débloque en une fois les offres de
          boulot, les demandes de main-d'œuvre et la mise en avant du profil artisan. */}
      <div className="mt-3">
        <AbonnementArtisan />
      </div>

      {message && !edition && (
        <InfoBanner variante="succes" className="mt-3" action={{ libelle: 'OK', onClick: () => setMessage('') }}>
          {message}
        </InfoBanner>
      )}

      {estDemo && (
        <InfoBanner variante="demo" titre="Compte de démonstration" className="mt-3">
          Ce profil n’existe pas côté serveur : les modifications ne sont pas conservées.
        </InfoBanner>
      )}
      {message && (
        <InfoBanner variante="succes" className="mt-3" action={{ libelle: 'OK', onClick: () => setMessage('') }}>
          {message}
        </InfoBanner>
      )}

      {/* Portefeuille : solde interne utilisé pour les mises en relation (§2) */}
      <section className="carte mt-3 flex items-center gap-3 p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name="wallet" size={20} />
        </span>
        <div className="flex-1">
          <p className="text-xs font-semibold text-ink-muted">Solde de mise en relation</p>
          <p className="text-base font-bold text-ink">{formatFcfa(profil.solde || 0)}</p>
        </div>
        <button type="button" className="bouton-principal px-3 py-2 text-xs" onClick={() => navigate('/main-doeuvre')}>
          Débloquer un contact
        </button>
      </section>

      {edition && (
        <form onSubmit={enregistrer} className="carte mt-3 flex flex-col gap-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Prénom</span>
              <input
                value={formulaire.prenom}
                onChange={(e) => setFormulaire({ ...formulaire, prenom: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Nom</span>
              <input
                value={formulaire.nom}
                onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-bold text-ink">Métier (artisan / ouvrier)</span>
            <select
              value={formulaire.metier}
              onChange={(e) => setFormulaire({ ...formulaire, metier: e.target.value })}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-primary"
            >
              <option value="">Non renseigné</option>
              {METIERS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="mb-1 text-xs font-bold text-ink">Type de travail recherché</legend>
            <div className="flex gap-2">
              {[
                { cle: 'specialise', libelle: 'Missions spécialisées' },
                { cle: 'journalier', libelle: 'Journalier' },
              ].map((s) => (
                <button
                  key={s.cle}
                  type="button"
                  onClick={() => setFormulaire({ ...formulaire, segment: s.cle })}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-bold transition ${
                    formulaire.segment === s.cle ? 'border-primary bg-primary/10 text-primary-dark' : 'border-line'
                  }`}
                >
                  {s.libelle}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              En tant que journalier, votre premier contact sur une mission d’une journée est gratuit.
            </p>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Quartier</span>
              <input
                value={formulaire.quartier}
                onChange={(e) => setFormulaire({ ...formulaire, quartier: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink">Commune</span>
              <input
                value={formulaire.commune}
                onChange={(e) => setFormulaire({ ...formulaire, commune: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <fieldset className="rounded-md border border-line p-2.5">
            <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              Ce que je fais avec ce compte
            </legend>
            <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={formulaire.estArtisan}
                onChange={(e) => setFormulaire((prec) => ({ ...prec, estArtisan: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Je propose mes services (artisan / prestataire)
                <span className="block text-[10px] font-normal text-ink-muted">
                  Mon profil apparaît dans l’annuaire des artisans et dans le feed.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={formulaire.chercheTravail}
                onChange={(e) =>
                  setFormulaire((prec) => ({ ...prec, chercheTravail: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Je cherche du travail
                <span className="block text-[10px] font-normal text-ink-muted">
                  Je parcours les offres de boulot et les demandes de mon quartier.
                </span>
              </span>
            </label>
            <p className="pt-1 text-[10px] font-normal normal-case text-ink-muted">
              Un seul compte suffit : publier une offre ou un besoin est ouvert à tout le monde.
            </p>
          </fieldset>

          <button type="submit" className="bouton-principal w-full">
            Enregistrer
          </button>
        </form>
      )}

      {/* Favoris */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Mes favoris ({favoris.length})</h2>
        {etablissementsFavoris.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Touchez le bouton d’action d’une fiche pour ajouter un établissement à vos favoris.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {etablissementsFavoris.map((e) => (
              <li key={e.id}>
                <Link to={`/etablissement/${e.id}`} className="carte flex items-center gap-3 p-2">
                  <img src={e.photoDevanture} alt={e.nom} className="h-12 w-12 rounded-md object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{e.nom}</span>
                    <span className="block text-[11px] text-ink-muted">
                      {e.quartier}, {e.commune}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} className="text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mes besoins publiés */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Mes besoins publiés ({mesBesoins.length})</h2>
        {mesBesoins.length === 0 ? (
          <button
            type="button"
            className="btn-ghost w-full text-sm"
            onClick={() => navigate('/main-doeuvre?mode=poster')}
          >
            <Icon name="plus" size={18} />
            Poster un besoin (gratuit)
          </button>
        ) : (
          <ul className="flex flex-col gap-2">
            {mesBesoins.map((j) => (
              <li key={j.id} className="carte p-3">
                <p className="text-sm font-bold text-ink">{j.metier}</p>
                <p className="text-[11px] text-ink-muted">{j.description}</p>
                <p className="mt-1 text-[11px] font-semibold text-primary">
                  {j.nombreDeblocages} déblocage{j.nombreDeblocages > 1 ? 's' : ''} · statut {j.statut}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5 flex flex-col gap-2">
        <button type="button" className="btn-ghost w-full text-sm" onClick={() => navigate('/inscription')}>
          <Icon name="store" size={18} />
          Inscrire un établissement
        </button>
        <button
          type="button"
          className="btn w-full bg-red-50 text-sm text-danger"
          onClick={() => {
            deconnexion();
            navigate('/');
          }}
        >
          <Icon name="close" size={18} />
          Se déconnecter
        </button>
      </div>

      <p className="mt-4 text-center text-[11px] leading-snug text-ink-muted">
        Conformité ARTCI (Loi n°2013-450) : vous pouvez demander la suppression de vos données à tout moment depuis
        l’onglet Messages.
      </p>
    </div>
  );
}
