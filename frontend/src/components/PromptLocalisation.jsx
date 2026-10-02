// PromptLocalisation.jsx — Bandeau « Activez la localisation » affiché tant que la
// vraie position GPS n'est pas obtenue. Il remplace l'ancien repli silencieux sur le
// Plateau, qui affichait des distances précises mais FAUSSES (ex. « 236 m » pour un
// lieu en réalité à 22 km).
//
// Le bouton « Activer » relance navigator.geolocation.getCurrentPosition() : c'est ce
// premier appel qui déclenche la demande de permission du navigateur. Dans une PWA
// installée sur Android (contexte sécurisé HTTPS), Chrome affiche alors la boîte
// « Autoriser la localisation ? ». Si l'utilisateur avait refusé définitivement, le
// navigateur ne re-demande plus : on l'oriente alors vers les réglages du site.

import InfoBanner from './InfoBanner.jsx';

export default function PromptLocalisation({ position, className = '' }) {
  if (position.loading || position.position) return null;

  return (
    <InfoBanner
      variante="alerte"
      titre="Localisation désactivée"
      action={{ libelle: 'Activer', onClick: () => position.relancer() }}
      className={className}
    >
      Activez la localisation pour voir les établissements proches de vous.
      {position.refuser && (
        <>
          {' '}
          Si la demande ne s’affiche plus, autorisez la localisation pour ce site dans les réglages du
          navigateur, puis revenez.
        </>
      )}
    </InfoBanner>
  );
}
