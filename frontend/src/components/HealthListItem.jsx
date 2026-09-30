// HealthListItem.jsx — Ligne pour la page Pharmacies & Cliniques
// Props : nom, type ("pharmacie" | "clinique"), deGarde (bool), distanceKm, telephone
// Design vert/blanc uniquement, PAS d'étoiles ni d'avis (voir cahier-des-charges §6)
//
// ⚠️ Ce composant ne doit JAMAIS importer StarRating ni afficher de compteur de
// visites/utilisateurs : la déontologie médicale interdit la notation publique et
// la mise en avant comparative des actes médicaux. Ne pas « enrichir » cette ligne
// sans validation juridique explicite (voir §6 et §7 du cahier des charges).

import { Icon } from './Icons.jsx';
import { formatDistanceKm } from '../utils/distance.js';
import { formatTelephone } from '../utils/format.js';

/**
 * @param {{ nom?: string, type?: 'pharmacie'|'clinique', deGarde?: boolean,
 *   distanceKm?: number|null, telephone?: string, adresse?: string, commune?: string,
 *   quartier?: string, horaires?: string, onAppeler?: () => void, onItineraire?: () => void,
 *   etablissement?: object }} props
 */
export default function HealthListItem({
  nom = '',
  type = 'pharmacie',
  deGarde = false,
  distanceKm = null,
  telephone = '',
  adresse = '',
  commune = '',
  quartier = '',
  horaires = '',
  onAppeler,
  onItineraire,
  etablissement,
}) {
  const s = {
    nom: etablissement?.nom ?? nom,
    type: etablissement?.type ?? type,
    deGarde: Boolean(etablissement?.deGarde ?? deGarde),
    distanceKm: etablissement?.distanceKm ?? distanceKm,
    telephone: etablissement?.telephone ?? telephone,
    adresse: etablissement?.adresse ?? adresse,
    commune: etablissement?.commune ?? commune,
    quartier: etablissement?.quartier ?? quartier,
    horaires: etablissement?.horaires ?? horaires,
  };

  const estPharmacie = s.type === 'pharmacie';
  const icone = estPharmacie ? 'pharmacy' : 'hospital';
  const libelleType = estPharmacie ? 'Pharmacie' : 'Clinique';
  const lieu = [s.quartier, s.commune].filter(Boolean).join(', ') || s.adresse;

  return (
    <article className="carte-health flex items-stretch gap-3 border-l-4 border-l-health p-3 animate-fade-up">
      {/* Icône distincte pharmacie / clinique (§6) */}
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${
          s.deGarde ? 'bg-health text-white' : 'bg-health-light text-health-dark'
        }`}
      >
        <Icon name={icone} size={22} />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-ink">{s.nom}</h3>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold">
          <span className="text-health-dark">{libelleType}</span>

          {/* Badge de garde : vert si de garde, gris sinon (§6) */}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              s.deGarde ? 'bg-health text-white' : 'bg-line text-ink-muted'
            }`}
          >
            {s.deGarde ? 'De garde' : 'Non de garde'}
          </span>

          {s.distanceKm != null && (
            <span className="flex items-center gap-1 text-ink-muted">
              <Icon name="mapPin" size={12} />
              {formatDistanceKm(s.distanceKm)}
            </span>
          )}
        </div>

        {lieu && <p className="mt-0.5 truncate text-[11px] text-ink-muted">{lieu}</p>}
        {s.horaires && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted">
            <Icon name="clock" size={12} />
            {s.horaires}
          </p>
        )}

        {/* Actions : Appeler / Itinéraire (les seules actions autorisées ici) */}
        <div className="mt-2 flex gap-2">
          <a
            href={s.telephone ? `tel:${String(s.telephone).replace(/\s/g, '')}` : undefined}
            onClick={onAppeler}
            className={`btn-health flex-1 py-2 text-xs ${s.telephone ? '' : 'pointer-events-none opacity-50'}`}
          >
            <Icon name="phone" size={15} />
            Appeler
          </a>
          <button type="button" className="btn-health-ghost flex-1 py-2 text-xs" onClick={onItineraire}>
            <Icon name="route" size={15} />
            Itinéraire
          </button>
        </div>

        {s.telephone && (
          <p className="mt-1 text-[11px] text-ink-muted">
            Téléphone : <span className="font-semibold">{formatTelephone(s.telephone)}</span>
          </p>
        )}
      </div>
    </article>
  );
}

