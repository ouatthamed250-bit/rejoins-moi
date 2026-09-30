// EstablishmentCard.jsx — Carte réutilisable pour Feed et Search
// Props attendues : photo, nom, categorie, note, nbAvis, tags[], distanceKm, nbVisites, nbUtilisateurs
// variant: "feed" (grande carte) | "list" (carte compacte avec distance)
//
// ⚠️ RÈGLE CRITIQUE (§3) : `compteurVisites` et `compteurUtilisateurs` sont TOUJOURS
// affichés séparément — deux icônes distinctes (œil / personnes), deux chiffres
// distincts, deux libellés distincts. Aucun total, aucune somme, aucun « 4820+317 ».
// Il n'existe volontairement AUCUN champ agrégé dans ce composant.
//
// Le composant accepte soit un objet `etablissement` complet (ce que renvoie l'API),
// soit les props à plat (utile pour les tests et les données de démo).

import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import StarRating from './StarRating.jsx';
import TagBadge from './TagBadge.jsx';
import { formatCompteur, formatTelephone } from '../utils/format.js';
import { distanceDepuis, formatDistanceKm } from '../utils/distance.js';

/** Libellés de catégories (miroir de CATEGORIES dans data/demoData.js). */
const LIBELLES_CATEGORIES = {
  alimentation: 'Alimentation',
  beaute: 'Beauté',
  services: 'Services',
  artisanat: 'Artisanat',
  commerce: 'Commerce',
  sante: 'Santé',
  spiritualite: 'Spiritualité',
  autre: 'Autre',
};

/**
 * Les deux compteurs, côte à côte et jamais fusionnés.
 * Exporté pour que la fiche profil utilise EXACTEMENT le même rendu.
 */
export function CompteursSepares({ visites = 0, utilisateurs = 0, taille = 'md' }) {
  const classe = taille === 'sm' ? 'text-[10px]' : 'text-[11px]';
  return (
    <div className="flex items-center gap-3">
      <span className={`flex items-center gap-1 font-semibold text-ink-muted ${classe}`} title="Visites du profil">
        <Icon name="eye" size={taille === 'sm' ? 13 : 15} />
        {formatCompteur(visites)}
        <span className="sr-only">visites du profil</span>
      </span>
      <span
        className={`flex items-center gap-1 font-semibold text-ink-muted ${classe}`}
        title="Utilisateurs venus grâce à la fiche"
      >
        <Icon name="users" size={taille === 'sm' ? 13 : 15} />
        {formatCompteur(utilisateurs)}
        <span className="sr-only">utilisateurs venus grâce à la fiche</span>
      </span>
    </div>
  );
}

function ImageSecours({ nom, className = '' }) {
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-primary-light to-primary-dark text-white ${className}`}
    >
      <span className="px-2 text-center text-xs font-bold uppercase tracking-wide">{nom}</span>
    </div>
  );
}

/**
 * @param {{ variant?: 'feed'|'list', etablissement?: object, photo?: string, nom?: string,
 *   categorie?: string, note?: number, nbAvis?: number, tags?: string[], distanceKm?: number,
 *   nbVisites?: number, nbUtilisateurs?: number, texteBoutonAction?: string,
 *   verifie?: boolean, position?: {lat:number,lng:number}, onTagClick?: (tag:string)=>void,
 *   onAction?: (etablissement: object) => void, telephone?: string }} props
 */
export default function EstablishmentCard({
  variant = 'feed',
  etablissement,
  photo,
  nom = '',
  categorie = 'autre',
  note = 0,
  nbAvis = 0,
  tags = [],
  distanceKm = null,
  nbVisites = 0,
  nbUtilisateurs = 0,
  texteBoutonAction = '',
  verifie = false,
  position = null,
  onTagClick,
  onAction,
  telephone = '',
}) {
  const navigate = useNavigate();

  // Fusion : l'objet `etablissement` a priorité, les props à plat servent de repli.
  const e = {
    id: etablissement?.id ?? etablissement?._id ?? '',
    nom: etablissement?.nom ?? nom,
    categorie: etablissement?.categorie ?? categorie,
    photoDevanture: etablissement?.photoDevanture ?? photo ?? '',
    noteMoyenne: Number(etablissement?.noteMoyenne ?? note) || 0,
    nombreAvis: Number(etablissement?.nombreAvis ?? nbAvis) || 0,
    tags: etablissement?.tags ?? tags ?? [],
    compteurVisites: Number(etablissement?.compteurVisites ?? nbVisites) || 0,
    compteurUtilisateurs: Number(etablissement?.compteurUtilisateurs ?? nbUtilisateurs) || 0,
    texteBoutonAction: etablissement?.texteBoutonAction || texteBoutonAction || `Aller chez ${nom}`,
    verifie: Boolean(etablissement?.verifie ?? verifie),
    telephone: etablissement?.telephone ?? telephone,
    localisation: etablissement?.localisation,
  };

  const distance =
    distanceKm != null
      ? Number(distanceKm)
      : position
        ? distanceDepuis(position, etablissement || { localisation: null })
        : null;
  const fichier = `/etablissement/${e.id}`;
  const libelleCategorie = LIBELLES_CATEGORIES[e.categorie] || e.categorie;

  // ── Variante compacte (résultats de recherche, §4) ──
  if (variant === 'list') {
    return (
      <article className="carte flex items-stretch gap-3 p-2 animate-fade-up">
        <Link to={fichier} className="shrink-0" aria-label={`Ouvrir ${e.nom}`}>
          {e.photoDevanture ? (
            <img src={e.photoDevanture} alt={e.nom} className="h-[86px] w-[86px] rounded-md object-cover" />
          ) : (
            <ImageSecours nom={e.nom} className="h-[86px] w-[86px] rounded-md" />
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <Link to={fichier} className="block">
            <div className="flex items-start gap-1">
              <h3 className="truncate text-sm font-bold text-ink">{e.nom}</h3>
              {e.verifie && <Icon name="verified" size={14} className="mt-0.5 shrink-0 text-primary" />}
            </div>
            <p className="text-[11px] font-semibold text-primary">{libelleCategorie}</p>
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StarRating note={e.noteMoyenne} nombreAvis={e.nombreAvis} taille={13} />
            {distance != null && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-ink-muted">
                <Icon name="mapPin" size={13} />
                {formatDistanceKm(distance)}
              </span>
            )}
          </div>

          {/* Les deux compteurs, séparés (§3) */}
          <div className="mt-1">
            <CompteursSepares visites={e.compteurVisites} utilisateurs={e.compteurUtilisateurs} taille="sm" />
          </div>
        </div>
      </article>
    );
  }

  // ── Variante feed (grande carte, §3) ──
  return (
    <article className="carte animate-fade-up">
      <Link to={fichier} className="relative block">
        {e.photoDevanture ? (
          <img src={e.photoDevanture} alt={`Devanture de ${e.nom}`} className="h-44 w-full object-cover" />
        ) : (
          <ImageSecours nom={e.nom} className="h-44 w-full" />
        )}

        <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
          {libelleCategorie}
        </span>
        {e.verifie && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-white">
            <Icon name="verified" size={12} />
            Vérifié
          </span>
        )}
        {distance != null && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white">
            <Icon name="mapPin" size={12} />
            {formatDistanceKm(distance)}
          </span>
        )}
      </Link>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={fichier}>
              <h3 className="truncate text-base font-bold leading-tight text-ink">{e.nom}</h3>
            </Link>
            <div className="mt-0.5">
              <StarRating note={e.noteMoyenne} nombreAvis={e.nombreAvis} taille={15} />
            </div>
          </div>
          {/* Les deux compteurs, séparés (§3) */}
          <CompteursSepares visites={e.compteurVisites} utilisateurs={e.compteurUtilisateurs} />
        </div>

        {e.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.tags.slice(0, 4).map((tag) => (
              <TagBadge key={tag} label={tag} taille="sm" onClick={onTagClick ? () => onTagClick(tag) : undefined} />
            ))}
            {e.tags.length > 4 && (
              <span className="self-center text-[11px] font-semibold text-ink-muted">+{e.tags.length - 4}</span>
            )}
          </div>
        )}

        {/* Bouton d'action dynamique : « Aller chez <nom> » (§5) */}
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          onClick={() => (onAction ? onAction(etablissement || e) : navigate(fichier))}
        >
          <Icon name="route" size={18} />
          {e.texteBoutonAction}
        </button>

        {e.telephone && (
          <p className="mt-2 text-center text-[11px] text-ink-muted">
            Contact direct : <span className="font-semibold">{formatTelephone(e.telephone)}</span>
          </p>
        )}
      </div>
    </article>
  );
}


