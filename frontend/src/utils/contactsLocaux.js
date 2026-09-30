// contactsLocaux.js — Miroir LOCAL des contacts débloqués (voir JobBoard.jsx).
//
// Pourquoi un miroir local ?
//  - §8 : « retrouver ses mises en relation ». L'historique d'interactions gardé
//    en mémoire par AuthContext est vidé par un simple rechargement de page.
//  - Le serveur reste SEUL juge du paiement : ce fichier ne mémorise jamais un
//    numéro deviné, uniquement celui que l'API a déjà révélé (`telephoneContact`)
//    après vérification de la transaction mobile money.
//
// Utilisé par JobBoard.jsx (écriture au déblocage) et par Messages.jsx (lecture
// de la liste des mises en relation).

export const CLE_CONTACTS = 'rejoinsmoi.contacts';

/** Lit le miroir local. Renvoie toujours un objet (jamais null). */
export function lireContactsLocaux() {
  try {
    const brut = localStorage.getItem(CLE_CONTACTS);
    const donnees = brut ? JSON.parse(brut) : null;
    return donnees && typeof donnees === 'object' ? donnees : {};
  } catch {
    return {};
  }
}

/** Persiste le miroir local (silencieux si le stockage est indisponible). */
export function ecrireContactsLocaux(contacts) {
  try {
    localStorage.setItem(CLE_CONTACTS, JSON.stringify(contacts || {}));
  } catch {
    /* navigation privée : on continue sans persistance */
  }
}

/**
 * Liste unifiée des mises en relation : fusionne le miroir local et l'historique
 * d'interactions de la session (les entrées les plus complètes gagnent).
 *
 * @returns {Array<{ id: string, libelle: string, telephone: string|null, at: string|undefined }>}
 */
export function listerMisesEnRelation(historique = []) {
  const parId = new Map();

  for (const interaction of historique || []) {
    if (interaction?.type !== 'contact') continue;
    const id = String(interaction.terme || '').replace(/^job:/, '');
    if (!id) continue;
    parId.set(id, {
      id,
      libelle: interaction.libelle || '',
      telephone: interaction.telephone || null,
      at: interaction.at,
    });
  }

  for (const [cle, contact] of Object.entries(lireContactsLocaux())) {
    const id = String(cle);
    const existant = parId.get(id) || {};
    parId.set(id, {
      id,
      libelle: contact?.libelle || existant.libelle || '',
      telephone: contact?.telephone || existant.telephone || null,
      at: contact?.at || existant.at,
    });
  }

  return [...parId.values()].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

export default { CLE_CONTACTS, lireContactsLocaux, ecrireContactsLocaux, listerMisesEnRelation };
