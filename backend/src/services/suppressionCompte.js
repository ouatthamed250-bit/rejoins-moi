// suppressionCompte.js — Droit à l'effacement (« droit à l'oubli »).
//
// POURQUOI ANONYMISER PLUTÔT QUE SUPPRIMER LE DOCUMENT User ?
// Un compte est référencé par des données que la loi nous oblige à conserver :
// historique des dépôts mobile money et des abonnements (obligation comptable),
// déblocages de contacts DÉJÀ PAYÉS par d'autres personnes (preuve d'achat), et
// annonces/avis qui structurent la place de marché. Effacer la ligne `User`
// laisserait ces références orphelines : les écrans afficheraient « compte
// inconnu », et surtout on perdrait la trace des paiements.
//
// On applique donc la méthode recommandée par la CNIL : SUPPRESSION DES DONNÉES
// IDENTIFIANTES + conservation d'un identifiant technique pseudonymisé.
//   • le document User reste, mais vidé de toute donnée personnelle ;
//   • `telephone` devient un jeton non composable (`supprime_<horodatage>_<id>`)
//     qui libère le vrai numéro pour un futur compte et rend la connexion
//     impossible (aucun format ivoirien ne correspond) ;
//   • le mot de passe est remplacé par un hash aléatoire que personne ne connaît ;
//   • `supprimeAt` est renseigné : `protect` / `protectAdmin` refusent alors tout
//     jeton déjà émis (il n'y a pas de table de sessions à vider : les JWT sont
//     sans état, c'est donc le contrôle en base qui coupe la session) ;
//   • avis, annonces et fiches sont ANONYMISÉS EN PLACE (le contenu des autres
//     utilisateurs n'est jamais détruit), sauf les fiches créées par la personne,
//     qui lui appartiennent et sont réellement supprimées ;
//   • dépôts et abonnements sont CONSERVÉS (montants, références, dates), seuls
//     les numéros de payeur sont retirés.
//
// GARDE-FOU : un compte administrateur ne peut pas être effacé (il faut d'abord
// retirer le rôle depuis le back-office), sinon on peut se verrouiller dehors.

import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Establishment from '../models/Establishment.js';
import Job from '../models/Job.js';
import Depot from '../models/Depot.js';
import Subscription from '../models/Subscription.js';
import { ApiError } from '../middleware/errorHandler.js';

/** Nom public affiché à la place de l'identité effacée (avis, annonces). */
export const NOM_COMPTE_SUPPRIME = 'Utilisateur supprimé';

/** Préfixe du numéro technique : jamais un numéro ivoirien, donc jamais connectable. */
export const PREFIXE_TELEPHONE_SUPPRIME = 'supprime_';

/**
 * Efface les données personnelles d'un compte et anonymise ses contributions.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{
 *   dejaSupprime: boolean,
 *   userId: string,
 *   telephoneAnonyme: string,
 *   nomAffiche: string,
 *   supprimeAt: Date,
 *   avisAnonymises: number,
 *   avisProfilsAnonymises: number,
 *   annoncesAnonymisees: number,
 *   annoncesAnnulees: number,
 *   fichesReclameesLiberees: number,
 *   fichesSupprimees: number,
 *   depotsConserves: number,
 *   abonnementsConserves: number,
 * }>}
 * @throws {ApiError} 404 compte introuvable, 409 compte administrateur
 */
export async function anonymiserOuSupprimerCompte(userId) {
  const idValide = mongoose.Types.ObjectId.isValid(String(userId));
  if (!idValide) throw new ApiError(404, 'Compte introuvable.');

  const user = await User.findById(userId).select('+motDePasseHash');
  if (!user) throw new ApiError(404, 'Compte introuvable.');

  if (user.estAdmin) {
    throw new ApiError(
      409,
      'Un compte administrateur ne peut pas être supprimé : retirez d’abord le rôle administrateur depuis le back-office.'
    );
  }

  const id = user._id;
  const maintenant = new Date();
  const telephoneAnonyme = `${PREFIXE_TELEPHONE_SUPPRIME}${maintenant.getTime()}_${String(id).slice(-6)}`;

  // Idempotence : une seconde demande (double clic, script rejoué) ne doit pas
  // regénérer un numéro technique ni fausser les compteurs du rapport.
  if (user.supprimeAt) {
    return {
      dejaSupprime: true,
      userId: String(id),
      telephoneAnonyme: user.telephone,
      nomAffiche: NOM_COMPTE_SUPPRIME,
      supprimeAt: user.supprimeAt,
      avisAnonymises: 0,
      avisProfilsAnonymises: 0,
      annoncesAnonymisees: 0,
      annoncesAnnulees: 0,
      fichesReclameesLiberees: 0,
      fichesSupprimees: 0,
      depotsConserves: await Depot.countDocuments({ userId: id }),
      abonnementsConserves: await Subscription.countDocuments({ userId: id }),
    };
  }

  // ── 1) Avis laissés sur des ÉTABLISSEMENTS ─────────────────────────────────
  // Le commentaire et la note restent (ils notent un commerce, pas une
  // personne), mais plus rien n'identifie leur auteur : ni nom, ni photo, ni
  // lien vers le compte. `arrayFilters` cible UNIQUEMENT les avis concernés :
  // ceux des autres utilisateurs ne sont pas touchés.
  const avis = await Establishment.updateMany(
    { 'avis.auteurId': id },
    {
      $set: {
        'avis.$[a].auteurNom': NOM_COMPTE_SUPPRIME,
        'avis.$[a].auteurPhoto': '',
        'avis.$[a].auteurId': null,
      },
    },
    { arrayFilters: [{ 'a.auteurId': id }] }
  );

  // Avis laissés sur la FICHE ARTISAN d'autres comptes (User.avis) : même
  // traitement, sinon le nom resterait visible dans l'annuaire.
  const avisProfils = await User.updateMany(
    { 'avis.auteurId': id },
    {
      $set: {
        'avis.$[a].auteurNom': NOM_COMPTE_SUPPRIME,
        'avis.$[a].auteurId': null,
      },
    },
    { arrayFilters: [{ 'a.auteurId': id }] }
  );

  // ── 2) Annonces de main-d'œuvre ────────────────────────────────────────────
  // Le poste reste visible (les personnes qui ont PAYÉ un déblocage gardent leur
  // preuve d'achat), mais le nom du posteur et son numéro de contact sont
  // effacés. Une annonce ouverte est en plus ANNULÉE : sans contact joignable,
  // elle ne doit plus recevoir de candidatures ni de paiements.
  const annonces = await Job.updateMany(
    { posteParUserId: id },
    { $set: { nomPosteur: NOM_COMPTE_SUPPRIME, telephoneContact: telephoneAnonyme } }
  );
  const annoncesAnnulees = await Job.updateMany(
    { posteParUserId: id, statut: 'ouvert' },
    { $set: { statut: 'annule' } }
  );

  // ── 3) Fiches d'établissement ──────────────────────────────────────────────
  // a) Fiches CRÉÉES par la personne (jamais importées) : elles lui
  //    appartiennent, on les supprime réellement.
  const fichesCreees = await Establishment.find({ createdByUserId: id, estImporte: false })
    .select('_id')
    .lean();
  const idsFichesSupprimees = fichesCreees.map((f) => f._id);
  if (idsFichesSupprimees.length) {
    await Establishment.deleteMany({ _id: { $in: idsFichesSupprimees } });
    // Nettoyage des références laissées chez les AUTRES comptes (favoris et
    // carnet de visites pointaient vers une fiche qui n'existe plus).
    await User.updateMany(
      {},
      { $pull: { favoris: { $in: idsFichesSupprimees }, visites: { $in: idsFichesSupprimees } } }
    );
  }

  // b) Fiches IMPORTÉES « réclamées » : la fiche appartient à la base publique,
  //    elle survit donc à la suppression du compte. On retire le lien de
  //    propriété et les données personnelles que le gérant y avait ajoutées.
  //    `telephone`/`whatsapp` peuvent être vidés : sur une fiche importée ces
  //    champs sont facultatifs (voir Establishment.js, telephoneObligatoireHorsImport).
  const fichesReclamees = await Establishment.updateMany(
    { createdByUserId: id, estImporte: true },
    {
      $set: {
        createdByUserId: null,
        reclame: false,
        telephone: '',
        whatsapp: '',
        photoVendeur: '',
        'reclamation.statut': '',
        'reclamation.demandeurUserId': null,
        'reclamation.nomDeclare': '',
        'reclamation.distanceMetres': null,
        'reclamation.demandeeLe': null,
        'reclamation.traiteeLe': null,
        'reclamation.traiteeParUserId': null,
      },
    }
  );

  // c) Demandes de réclamation encore en attente (ou refusées) déposées par ce
  //    compte : le nom déclaré et le lien vers le demandeur sont effacés.
  await Establishment.updateMany(
    { 'reclamation.demandeurUserId': id },
    {
      $set: {
        'reclamation.statut': '',
        'reclamation.demandeurUserId': null,
        'reclamation.nomDeclare': '',
        'reclamation.distanceMetres': null,
        'reclamation.demandeeLe': null,
        'reclamation.traiteeLe': null,
        'reclamation.traiteeParUserId': null,
      },
    }
  );

  // ── 4) Paiements : CONSERVÉS, mais sans numéro de payeur ───────────────────
  // Les montants, références, opérateurs et dates restent (comptabilité et
  // preuve d'achat). `telephonePayeur` est une donnée personnelle : il part.
  const depotsConserves = await Depot.countDocuments({ userId: id });
  await Depot.updateMany({ userId: id }, { $set: { telephonePayeur: '' } });
  // Les abonnements ne portent aucune donnée personnelle en dehors du lien
  // `userId` (qui reste, vers le compte désormais pseudonymisé).
  const abonnementsConserves = await Subscription.countDocuments({ userId: id });

  // ── 5) Le compte lui-même ─────────────────────────────────────────────────
  user.telephone = telephoneAnonyme;
  user.nom = NOM_COMPTE_SUPPRIME;
  user.prenom = '';
  user.photoProfil = '';
  user.metier = '';
  user.bio = '';
  user.quartier = '';
  user.commune = '';
  user.localisation = { lat: null, lng: null };
  user.estArtisan = false;
  user.chercheTravail = false;
  user.segment = '';
  user.favoris = [];
  user.visites = [];
  user.historiqueInteractions = [];
  user.avis = [];
  user.noteMoyenne = 0;
  user.nombreAvis = 0;
  user.solde = 0;
  user.etablissementId = null;
  user.dernierLoginAt = null;
  user.motifSuspension = '';
  user.suspenduAt = null;
  user.supprimeAt = maintenant;
  // Mot de passe aléatoire : le hash est remplacé, personne ne connaît la valeur
  // en clair. La connexion reste donc impossible même si l'ancien mot de passe
  // était connu (le numéro, lui, n'existe plus).
  user.motDePasseHash = await User.hashMotDePasse(randomBytes(32).toString('hex'));
  await user.save();

  // Journal d'exploitation : identifiant technique seulement, aucune donnée
  // personnelle (le numéro d'origine n'est jamais écrit).
  console.log(
    `[suppression] compte ${String(id)} anonymisé (${avis.modifiedCount} fiche(s) d'avis, ` +
      `${annonces.modifiedCount} annonce(s), ${idsFichesSupprimees.length} fiche(s) supprimée(s))`
  );

  return {
    dejaSupprime: false,
    userId: String(id),
    telephoneAnonyme,
    nomAffiche: NOM_COMPTE_SUPPRIME,
    supprimeAt: maintenant,
    avisAnonymises: avis.modifiedCount,
    avisProfilsAnonymises: avisProfils.modifiedCount,
    annoncesAnonymisees: annonces.modifiedCount,
    annoncesAnnulees: annoncesAnnulees.modifiedCount,
    fichesReclameesLiberees: fichesReclamees.modifiedCount,
    fichesSupprimees: idsFichesSupprimees.length,
    depotsConserves,
    abonnementsConserves,
  };
}

export default { anonymiserOuSupprimerCompte, NOM_COMPTE_SUPPRIME, PREFIXE_TELEPHONE_SUPPRIME };
