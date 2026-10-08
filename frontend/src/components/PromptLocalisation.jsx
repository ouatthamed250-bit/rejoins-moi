// PromptLocalisation.jsx — « Activez la localisation » ET « désignez votre position ».
//
// RÉÉCRITURE DU BLOC B. Ce que faisait l'ancien bandeau : il proposait « Activer »
// et, en cas de refus, renvoyait aux réglages du navigateur — sans jamais dire où.
// Résultat sur le terrain : un utilisateur qui avait refusé la première demande (la
// plus fréquente, car elle tombait sans explication) restait définitivement sans
// distances, et sur iPhone la relance échouait en silence (Safari exige un geste).
//
// Ce que fait le nouveau, selon l'état RÉEL de l'autorisation (lu par le hook) :
//   - rien à faire (position obtenue)      → aucun bandeau ;
//   - point choisi sur la carte            → bandeau discret qui le dit, et propose
//                                            de revenir au GPS ;
//   - refus enregistré                     → marche à suivre PRÉCISE (Android et
//                                            iPhone), plus un repli immédiat :
//                                            « choisir ma position sur la carte » ;
//   - demande jamais posée / geste requis  → on explique À QUOI ça sert, puis on
//                                            demande (le geste rend la demande
//                                            possible sur tous les navigateurs).
// Le repli par la carte est le vrai apport : sans GPS, l'utilisateur obtient quand
// même des distances, à partir d'un point qu'il a choisi lui-même.

import { Suspense, lazy, useState } from 'react';

import InfoBanner from './InfoBanner.jsx';

// Chargement À LA DEMANDE : Leaflet ne descend sur le téléphone que si l'utilisateur
// ouvre la carte (voir ChoisirPosition.jsx). Le reste de l'application ne paie rien.
const ChoisirPosition = lazy(() => import('./ChoisirPosition.jsx'));

export default function PromptLocalisation({ position, className = '' }) {
  const [carteOuverte, setCarteOuverte] = useState(false);

  const obtenue = Boolean(position.position);
  const manuelle = position.source === 'manuel';
  const refusEnregistre = Boolean(position.refuser);
  const gesteRequis = Boolean(position.gesteRequis);
  const demandeRequise = Boolean(position.demandeRequise);

  function ouvrirCarte() {
    setCarteOuverte(true);
  }

  // Bandeau affiché (ou non) selon l'état. Le nom `actif` évite d'évaluer un cas
  // après l'autre : un seul message à l'écran, jamais deux qui se contredisent.
  let bandeau = null;
  if (position.loading) {
    bandeau = null;
  } else if (obtenue && !manuelle) {
    bandeau = null; // position GPS : rien à demander, rien à expliquer
  } else if (obtenue && manuelle) {
    bandeau = (
      <InfoBanner
        variante="info"
        titre="Position choisie sur la carte"
        className={className}
        actions={[
          { libelle: 'Changer de point', onClick: ouvrirCarte },
          { libelle: 'Revenir au GPS', onClick: () => position.relancer?.() },
        ]}
      >
        Les distances partent de ce point, jusqu’à ce que vous en changiez. Ce n’est pas une mesure
        GPS.
      </InfoBanner>
    );
  } else if (refusEnregistre) {
    bandeau = (
      <InfoBanner
        variante="alerte"
        titre="Localisation bloquée pour ce site"
        className={className}
        actions={[
          { libelle: 'Choisir sur la carte', onClick: ouvrirCarte },
          { libelle: 'Réessayer', onClick: () => position.relancer?.() },
        ]}
      >
        {position.error || "Aucune distance n'est affichée sans autorisation."}{' '}
        <span className="font-bold">Pour la débloquer :</span> touchez le cadenas (ou les trois
        points) à côté de l’adresse du site, puis « Autorisations » → « Position » → « Autoriser ».
        Sur iPhone : Réglages → Safari → Position → « Demander ». Vous pouvez aussi désigner votre
        position sur la carte tout de suite.
      </InfoBanner>
    );
  } else if (gesteRequis) {
    bandeau = (
      <InfoBanner
        variante="alerte"
        titre="Autorisez la localisation"
        className={className}
        actions={[
          { libelle: 'Activer', onClick: () => position.relancer?.() },
          { libelle: 'Choisir sur la carte', onClick: ouvrirCarte },
        ]}
      >
        {position.error || 'Le navigateur a besoin que vous touchiez « Activer » pour demander la position.'}
      </InfoBanner>
    );
  } else {
    bandeau = (
      <InfoBanner
        variante="alerte"
        titre="Localisation désactivée"
        className={className}
        actions={[
          { libelle: 'Activer', onClick: () => position.relancer?.() },
          { libelle: 'Choisir sur la carte', onClick: ouvrirCarte },
        ]}
      >
        Activez la localisation pour voir les établissements proches de vous.{' '}
        {demandeRequise
          ? 'Le téléphone affichera une demande d’autorisation : acceptez-la pour que les distances apparaissent.'
          : null}
      </InfoBanner>
    );
  }

  return (
    <>
      {bandeau}
      {carteOuverte && (
        <Suspense fallback={null}>
          <ChoisirPosition
            ouvert={carteOuverte}
            onFermer={() => setCarteOuverte(false)}
            centre={position.position}
            onValider={(lat, lng) => {
              position.choisirPosition?.(lat, lng);
              setCarteOuverte(false);
            }}
            onGps={() => position.relancer?.()}
          />
        </Suspense>
      )}
    </>
  );
}
