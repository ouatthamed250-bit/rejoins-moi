// Job.js — Schéma Mongoose pour une ANNONCE de boulot.
//
// Une seule collection sert les deux sous-onglets de la page Jobs (cahier des
// charges, ajout du 29/09), distingués par `typeAnnonce` :
//   • 'offre'   -> offre de boulot : un emploi proposé (poste, salaire, durée)
//   • 'demande' -> demande de main-d'œuvre : une mission ponctuelle (artisan,
//                  journalier) — c'est le cas historique, donc la valeur par défaut
// Champs : typeAnnonce, metier, intitule?, description, localisation {lat, lng},
//          urgence (bool), posteParUserId, statut ("ouvert" | "pourvu" | "annule"),
//          contactDebloquePar[] (moyen de paiement 500 FCFA ou ABONNEMENT)

import mongoose from 'mongoose';

/** Trace d'un déblocage de contact payant (500 FCFA) — sert d'audit mobile money. */
const deblocageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    montant: { type: Number, default: 500 },
    devise: { type: String, default: 'XOF' },
    moyenPaiement: { type: String, enum: ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY', 'GRATUIT_JOURNALIER', 'ABONNEMENT', 'SOLDE'], default: 'WAVE' },
    transactionId: { type: String, trim: true },
    statutPaiement: { type: String, enum: ['ACCEPTED', 'PENDING', 'REFUSED'], default: 'ACCEPTED' },
    // Déblocage couvert par l'abonnement en cours (aucun frais à l'unité) — permet
    // de mesurer plus tard ce que l'abonnement « coûte » en déblocages offerts.
    viaAbonnement: { type: Boolean, default: false },
    // Déblocage validé PAR UN ADMIN après un dépôt mobile money manuel (voir
    // models/Depot.js + routes/admin.js). Distinct de l'abonnement et du gratuit.
    viaDepot: { type: Boolean, default: false },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    // 'offre' = offre de boulot / 'demande' = demande de main-d'œuvre (défaut,
    // valeur historique : les annonces déjà en base restent des demandes).
    typeAnnonce: { type: String, enum: ['offre', 'demande'], default: 'demande', index: true },

    metier: { type: String, required: [true, 'Le métier recherché est obligatoire'], trim: true, index: true },

    // Intitulé du poste pour une offre de boulot (« Vendeuse en boutique »,
    // « Chauffeur livreur »). Facultatif : on retombe sur `metier` à l'affichage.
    intitule: { type: String, trim: true, maxlength: 120, default: '' },

    description: { type: String, required: [true, 'La description est obligatoire'], trim: true, maxlength: 1200 },

    localisation: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },
    commune: { type: String, trim: true, default: '' },
    quartier: { type: String, trim: true, default: '' },

    urgence: { type: Boolean, default: false, index: true },

    // Budget indicatif (journalier 4 000–5 000 FCFA/jour, §10)
    budgetFcfa: { type: Number, min: 0, default: 0 },
    duree: { type: String, trim: true, default: '' }, // ex. "1 journée", "2 semaines"

    posteParUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    nomPosteur: { type: String, trim: true, default: '' },
    // Contact masqué par défaut ; révélé seulement après paiement des 500 FCFA (§2)
    telephoneContact: { type: String, required: true, trim: true },

    statut: { type: String, enum: ['ouvert', 'pourvu', 'annule'], default: 'ouvert', index: true },

    segment: { type: String, enum: ['journalier', 'specialise'], default: 'specialise', index: true },

    contactDebloquePar: [deblocageSchema],

    // Variante journalier (point ouvert §2) : le premier contact est gratuit et le
    // paiement n'intervient qu'après confirmation de la mission par le posteur.
    premierContactGratuit: { type: Boolean, default: false },

    vues: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

jobSchema.index({ metier: 'text', description: 'text', commune: 'text', quartier: 'text' });

/** L'utilisateur a-t-il déjà débloqué le contact de ce besoin ? */
jobSchema.methods.dejaDebloquePar = function dejaDebloquePar(userId) {
  if (!userId) return false;
  return this.contactDebloquePar.some((d) => String(d.userId) === String(userId));
};

/**
 * Sérialisation. `masquerContact` doit rester true tant que le contact n'est pas débloqué.
 * Les compteurs visites/utilisateurs (§3) ne s'appliquent pas ici : un besoin de
 * main-d'œuvre n'a qu'un contrepoids utile, le nombre de déblocages.
 */
jobSchema.methods.toJSONFor = function toJSONFor({ userId, masquerContact = true } = {}) {
  const debloque = this.dejaDebloquePar(userId);
  const masque = masquerContact && !debloque;
  const monDeblocage = (this.contactDebloquePar || []).find((d) => String(d.userId) === String(userId));
  return {
    id: this._id,
    typeAnnonce: this.typeAnnonce || 'demande',
    // Titre prêt à afficher : l'intitulé du poste s'il existe, sinon le métier.
    titre: this.intitule || this.metier,
    intitule: this.intitule || '',
    metier: this.metier,
    description: this.description,
    localisation: this.localisation,
    commune: this.commune,
    quartier: this.quartier,
    urgence: this.urgence,
    budgetFcfa: this.budgetFcfa,
    duree: this.duree,
    nomPosteur: this.nomPosteur,
    statut: this.statut,
    segment: this.segment,
    premierContactGratuit: this.premierContactGratuit,
    telephoneContact: masque ? null : this.telephoneContact,
    contactMasque: masque,
    nombreDeblocages: this.contactDebloquePar.length,
    dejaDebloque: debloque,
    // Déblocage couvert par l'abonnement de l'appelant (facturation 0 FCFA).
    debloqueViaAbonnement: Boolean(monDeblocage?.viaAbonnement),
    vues: this.vues,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('Job', jobSchema);

