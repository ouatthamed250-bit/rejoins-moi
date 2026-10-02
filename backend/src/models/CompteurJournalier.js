// CompteurJournalier.js — Marqueur de DÉDUPLICATION des compteurs d'établissement (§3).
//
// Problème résolu : POST /api/establishments/:id/visit et /:id/action sont publics.
// Sans garde-fou, n'importe qui peut gonfler les compteurs affichés (preuve sociale)
// en appelant l'endpoint en boucle. On veut donc UN SEUL incrément par jour et par
// identité (utilisateur connecté, sinon adresse IP).
//
// Le mécanisme : AVANT d'incrémenter, on pose un marqueur dont l'index UNIQUE
// ({ etablissement, type, cle, jour }) sert de verrou. Un second appel le même jour
// pour la même identité échoue avec le code duplicat (11000) : l'incrément est alors
// ignoré. C'est atomique et fonctionne même avec plusieurs instances de l'API.
//
// `jour` est au format « AAAA-MM-JJ ». Abidjan est à UTC+0 (pas d'heure d'été) : la
// date UTC correspond donc exactement à la journée locale.

import mongoose from 'mongoose';

const compteurJournalierSchema = new mongoose.Schema(
  {
    etablissement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Establishment',
      required: true,
    },
    // 'visit'  -> compteurVisites
    // 'action' -> compteurUtilisateurs
    type: { type: String, enum: ['visit', 'action'], required: true },

    // Identité du compteur : « u:<idUtilisateur> » si connecté, sinon « ip:<adresse> ».
    cle: { type: String, required: true },

    // Jour de l'incrément (AAAA-MM-JJ, Abidjan = UTC).
    jour: { type: String, required: true },
  },
  { timestamps: true }
);

// LA déduplication : une seule ligne par (fiche, type, identité, jour). Cette contrainte
// est la garantie que le compteur ne peut pas être gonflé par des appels répétés.
compteurJournalierSchema.index(
  { etablissement: 1, type: 1, cle: 1, jour: 1 },
  { unique: true }
);

// Purge automatique : on n'a pas besoin de conserver ces marqueurs plus de 40 jours.
compteurJournalierSchema.index({ createdAt: 1 }, { expireAfterSeconds: 40 * 86400 });

export default mongoose.model('CompteurJournalier', compteurJournalierSchema);
