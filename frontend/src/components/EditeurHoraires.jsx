// EditeurHoraires.jsx — éditeur des horaires d'ouverture, sept jours (ajout du 16/11).
//
// Il remplace le champ texte libre « Horaires » : une ligne par jour (lundi →
// dimanche), une bascule Ouvert / Fermé, deux heures (début, fin) quand le jour
// est ouvert. C'est ce que le client veut savoir : « est-ce ouvert, là ? » — et
// c'est cette grille que lit la pastille de la fiche (utils/statutHoraire.js).
//
// Décisions :
//  - CONTRÔLÉ : le composant ne détient rien. Il reçoit la grille (`valeur`) et la
//    renvoie complète par `onChange`, avec TOUJOURS les sept jours : le parent
//    peut l'envoyer telle quelle à l'API sans la recompléter.
//  - Les heures sont des <input type="time"> natifs : sur téléphone, ils ouvrent
//    le sélecteur d'heure du système. Rien à installer, aucun format à deviner, et
//    la valeur reste « HH:MM » — exactement ce que stocke le serveur.
//  - Une fermeture APRÈS MINUIT reste légale (20:00 → 02:00), un maquis ferme
//    rarement à 18 h. On l'annonce sous la ligne concernée pour qu'elle ne passe
//    pas pour une faute de frappe : le calcul du badge sait lire cette plage.
//  - Le jour fermé GARDE ses deux heures : le gérant qui rouvre un jour retrouve
//    ses horaires au lieu de devoir tout retaper.

import { JOURS_SEMAINE, heureEnMinutes, horairesParDefaut } from '../utils/statutHoraire.js';

/**
 * Grille toujours complète : un jour absent (fiche ancienne, valeur partielle)
 * reprend la valeur par défaut du modèle. Sans ça, un `<input>` afficherait
 * « --:-- » et l'utilisateur croirait avoir perdu sa saisie.
 */
function grilleComplete(valeur) {
  const defaut = horairesParDefaut();
  const grille = {};
  for (const { cle } of JOURS_SEMAINE) {
    const jour = valeur?.[cle];
    grille[cle] = {
      ouvert: typeof jour?.ouvert === 'boolean' ? jour.ouvert : defaut[cle].ouvert,
      debut: jour?.debut || defaut[cle].debut,
      fin: jour?.fin || defaut[cle].fin,
    };
  }
  return grille;
}

/**
 * @param {{ valeur?: object, onChange: (grille: object) => void, desactive?: boolean }} props
 * `desactive` bloque la saisie pendant que le parent enregistre.
 */
export default function EditeurHoraires({ valeur, onChange, desactive = false }) {
  const grille = grilleComplete(valeur);

  function modifierJour(cle, modification) {
    onChange({ ...grille, [cle]: { ...grille[cle], ...modification } });
  }

  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-sm font-bold text-ink">Horaires d’ouverture</p>
      <p className="mb-2 text-[11px] leading-snug text-ink-muted">
        Un jour fermé ? Laissez la bascule sur « Fermé ». Une fermeture après minuit est acceptée
        (ex. 20:00 → 02:00 pour un maquis) : indiquez simplement l’heure de fin.
      </p>

      <div className="flex flex-col gap-1.5">
        {JOURS_SEMAINE.map(({ cle, libelle }) => {
          const jour = grille[cle];
          const debutMin = heureEnMinutes(jour.debut);
          const finMin = heureEnMinutes(jour.fin);
          // Plage à cheval sur minuit : on le signale explicitement.
          const apresMinuit = jour.ouvert && debutMin != null && finMin != null && finMin < debutMin;
          const journeeComplete =
            jour.ouvert && debutMin != null && finMin != null && finMin === debutMin;

          return (
            <div
              key={cle}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-2"
            >
              <span className="w-20 shrink-0 text-sm font-bold text-ink">{libelle}</span>

              {/* Bascule Ouvert / Fermé. `role="switch"` : les lecteurs d'écran
                  annoncent « ouvert » ou « fermé », pas une case cochée. */}
              <button
                type="button"
                role="switch"
                aria-checked={jour.ouvert}
                aria-label={`${libelle} : ${jour.ouvert ? 'ouvert' : 'fermé'}`}
                disabled={desactive}
                onClick={() => modifierJour(cle, { ouvert: !jour.ouvert })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  jour.ouvert ? 'bg-health' : 'bg-line'
                } disabled:opacity-60`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-all ${
                    jour.ouvert ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </button>

              <span
                className={`w-12 shrink-0 text-xs font-bold ${
                  jour.ouvert ? 'text-health-dark' : 'text-ink-muted'
                }`}
              >
                {jour.ouvert ? 'Ouvert' : 'Fermé'}
              </span>

              {jour.ouvert ? (
                <div className="ml-auto flex items-center gap-1">
                  <input
                    type="time"
                    value={jour.debut}
                    disabled={desactive}
                    aria-label={`Heure d’ouverture du ${libelle.toLowerCase()}`}
                    onChange={(e) => modifierJour(cle, { debut: e.target.value || jour.debut })}
                    className="rounded-md border border-line px-2 py-1.5 text-sm font-semibold text-ink outline-none focus:border-primary disabled:opacity-60"
                  />
                  <span aria-hidden="true" className="text-xs text-ink-muted">
                    →
                  </span>
                  <input
                    type="time"
                    value={jour.fin}
                    disabled={desactive}
                    aria-label={`Heure de fermeture du ${libelle.toLowerCase()}`}
                    onChange={(e) => modifierJour(cle, { fin: e.target.value || jour.fin })}
                    className="rounded-md border border-line px-2 py-1.5 text-sm font-semibold text-ink outline-none focus:border-primary disabled:opacity-60"
                  />
                </div>
              ) : (
                <span className="ml-auto text-xs text-ink-muted">Jour de fermeture</span>
              )}

              {apresMinuit && (
                <p className="basis-full text-[11px] leading-snug text-ink-muted">
                  Ferme le lendemain à {jour.fin} : la plage passe minuit.
                </p>
              )}
              {journeeComplete && (
                <p className="basis-full text-[11px] leading-snug text-ink-muted">
                  Début et fin identiques : la fiche annoncera « ouvert 24 h/24 ».
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
