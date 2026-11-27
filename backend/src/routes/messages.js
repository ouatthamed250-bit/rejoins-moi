// messages.js — MESSAGERIE INTERNE (chat privé) de Rejoins'Moi.
//
// Remplace le renvoi systématique vers WhatsApp (prompt B). Deux cas d'usage :
//   1. une personne a masqué son numéro  -> la discussion se fait ICI, sans
//      jamais révéler le numéro (c'est le serveur qui garde le secret, pas l'UI) ;
//   2. une personne a publié son numéro  -> elle peut tout de même être écrite
//      dans l'app (le canal interne ne dépend pas du bon vouloir de WhatsApp).
//
// Endpoints (tous PROTÉGÉS : un visiteur ne peut ni chercher, ni lire, ni écrire) :
//   GET  /api/messages/search?q=…        -> comptes (nom, métier) + établissements (nom)
//   POST /api/messages/start             -> { destinataireId } : crée ou retrouve la conversation
//   GET  /api/messages/conversations     -> mes conversations, la plus récente en haut
//   GET  /api/messages/conversations/:id -> messages + marquage « lu »
//   POST /api/messages/conversations/:id -> { contenu } : envoi d'un message
//
// Règles de confidentialité appliquées ici, et pas seulement dans l'interface :
//   • aucun numéro de téléphone ne sort de ces routes (même pour un artisan qui a
//     coché « contact public » : ce choix concerne l'annuaire, pas le chat) ;
//   • un non-participant reçoit 403 sur une conversation, jamais son contenu ;
//   • les comptes administrateur et les comptes anonymisés (droit à l'effacement)
//     sont invisibles de la recherche et refusés comme destinataires.
//
// Le back-office peut EXTRAIRE une conversation (réquisition légale) mais ne
// participe jamais à la discussion : voir routes/admin.js.

import express from 'express';
import mongoose from 'mongoose';

import Conversation from '../models/Conversation.js';
import Message, { LONGUEUR_MAX_MESSAGE } from '../models/Message.js';
import User from '../models/User.js';
import Establishment from '../models/Establishment.js';
import { envoyerNotification } from '../services/notifications.js';
import { protect } from '../middleware/auth.js';
import { requireDb } from '../config/db.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { escapeRegex } from '../utils/validators.js';

const router = express.Router();

// Toute la messagerie suppose une base disponible (même règle que les autres
// routeurs : sans Mongo, 503 + message explicite plutôt qu'une erreur 500).
router.use(requireDb);

/** Champs d'un interlocuteur utiles à l'affichage — et RIEN de plus. */
const CHAMPS_INTERLOCUTEUR = 'nom prenom photoProfil estArtisan metier supprimeAt';

/** Un identifiant exploitable par Mongo ? (sinon on répond 400, pas 500). */
function identifiantValide(valeur) {
  return Boolean(valeur) && mongoose.isValidObjectId(String(valeur));
}

/**
 * Limiteur d'envoi anti-spam, PAR COMPTE (et non par IP : plusieurs personnes
 * partagent un même téléphone en cybercafé, et une seule ne doit pas bloquer les
 * autres). Fenêtre glissante en mémoire, bornée, sans dépendance externe —
 * cohérent avec middleware/rateLimit.js (qui gère, lui, l'authentification).
 */
const FENETRE_ENVOI_MS = 60_000;
const MAX_ENVOIS = Number(process.env.MESSAGES_RATE_MAX) || 30;
const envoisParCompte = new Map();

function limiteurEnvoi(req, res, next) {
  const cle = String(req.user?._id || 'anonyme');
  const maintenant = Date.now();
  const historique = (envoisParCompte.get(cle) || []).filter((t) => maintenant - t < FENETRE_ENVOI_MS);

  if (historique.length >= MAX_ENVOIS) {
    const retryAfterSecondes = Math.max(
      1,
      Math.ceil((FENETRE_ENVOI_MS - (maintenant - historique[0])) / 1000)
    );
    res.set('Retry-After', String(retryAfterSecondes));
    return res.status(429).json({
      error: `Vous envoyez trop de messages d’un coup. Patientez ${retryAfterSecondes} seconde(s) avant de réessayer.`,
      retryAfterSeconds: retryAfterSecondes,
    });
  }

  historique.push(maintenant);
  envoisParCompte.set(cle, historique);
  if (envoisParCompte.size > 5000) {
    // Garde-fou mémoire : on élague d'abord les fenêtres totalement écoulées.
    for (const [compte, temps] of envoisParCompte) {
      const recents = temps.filter((t) => maintenant - t < FENETRE_ENVOI_MS);
      if (recents.length) envoisParCompte.set(compte, recents);
      else envoisParCompte.delete(compte);
    }
  }
  return next();
}

/**
 * Résumé d'une conversation pour son participant : l'interlocuteur est extrait du
 * tableau `participants` (déjà peuplé par l'appelant).
 */
function resumerConversation(conversation, moi, nonLus = 0, dernierMessageLu = false) {
  const autre =
    (conversation.participants || []).find((p) => String(p?._id || p) !== String(moi)) || null;
  return conversation.toJSONFor({
    moi,
    interlocuteur: autre,
    nonLus,
    dernierMessageLu,
  });
}

/** Nom affichable d'un compte, sans jamais retomber sur le numéro. */
function nomAffiche(user) {
  if (!user) return '';
  return String(user.nomComplet ?? [user.prenom, user.nom].filter(Boolean).join(' ')).trim();
}

/**
 * GET /api/messages/search?q=… — « à qui veux-tu écrire ? »
 *
 * Cherche dans DEUX collections, comme le demande le produit :
 *   • les comptes (nom, prénom, métier) — c'est là que vivent les artisans ;
 *   • les établissements (nom) — on écrit au COMMERCE, le serveur retrouve le
 *     gérant (voir POST /start). Une fiche importée sans compte est renvoyée avec
 *     `joignable: false` : l'utilisateur voit qu'elle existe et comprend pourquoi
 *     il ne peut pas encore lui écrire, au lieu d'un résultat qui disparaît.
 *
 * Aucune donnée sensible ne sort : ni numéro, ni solde, ni identifiant de
 * propriétaire autre que l'id technique du destinataire.
 */
router.get(
  '/search',
  protect,
  asyncHandler(async (req, res) => {
    const terme = String(req.query.q || '').trim();
    // 2 caractères minimum : une seule lettre renverrait la moitié de l'annuaire
    // et coûterait cher sur une connexion 3G.
    if (terme.length < 2) {
      return res.json({ resultats: [], terme, message: 'Saisissez au moins deux lettres.' });
    }

    const rx = new RegExp(escapeRegex(terme), 'i');
    const limite = Math.min(Math.max(Number(req.query.limit) || 8, 1), 15);

    const [comptes, fiches] = await Promise.all([
      User.find({
        _id: { $ne: req.user._id },
        supprimeAt: null,
        // Un administrateur ne reçoit pas de messages privés : son compte n'est
        // pas un interlocuteur, il est un outil de travail. Inutile de l'exposer.
        estAdmin: { $ne: true },
        test: { $ne: true },
        $or: [{ nom: rx }, { prenom: rx }, { metier: rx }],
      })
        .select(CHAMPS_INTERLOCUTEUR)
        .limit(limite),
      Establishment.find({ nom: rx, test: { $ne: true } })
        .select('nom categorie sousCategorie quartier commune createdByUserId')
        .limit(limite),
    ]);

    const resultatsComptes = comptes.map((compte) => ({
      id: String(compte._id),
      type: compte.estArtisan ? 'artisan' : 'utilisateur',
      nom: nomAffiche(compte),
      photoProfil: compte.photoProfil || '',
      sousTitre: compte.metier || '',
      joignable: true,
      raison: '',
    }));

    const resultatsFiches = fiches.map((fiche) => {
      const proprietaireId = fiche.createdByUserId ? String(fiche.createdByUserId) : '';
      const estMoi = proprietaireId && proprietaireId === String(req.user._id);
      return {
        // L'id renvoyé est CELUI À PASSER À /start : la fiche elle-même quand elle
        // a un gérant (le serveur résout), sinon la fiche aussi — /start répondra
        // alors un refus explicite et actionnable.
        id: String(fiche._id),
        type: 'etablissement',
        nom: fiche.nom || 'Établissement',
        photoProfil: '',
        sousTitre: [fiche.sousCategorie, fiche.commune || fiche.quartier].filter(Boolean).join(' · '),
        joignable: Boolean(proprietaireId) && !estMoi,
        raison: !proprietaireId
          ? 'COMMERCE_SANS_COMPTE'
          : estMoi
            ? 'PROPRIETAIRE_SOI_MEME'
            : '',
      };
    });

    res.json({
      resultats: [...resultatsComptes, ...resultatsFiches],
      terme,
      message: '',
    });
  })
);

/**
 * Résout un destinataire à partir de l'identifiant reçu.
 * Accepte un COMPTE (artisan, client, gérant) ou un ÉTABLISSEMENT (on écrit au
 * commerce, le serveur retrouve le propriétaire de la fiche).
 *
 * @returns {Promise<{ destinataire: object, fiche: object|null }>}
 * @throws {ApiError} 404 introuvable / 409 commerce sans compte / 400 soi-même
 */
async function resoudreDestinataire(brut, moi) {
  if (!identifiantValide(brut)) {
    throw new ApiError(404, 'Destinataire introuvable.');
  }
  const id = String(brut);

  const compte = await User.findById(id).select(`${CHAMPS_INTERLOCUTEUR} estAdmin`);
  if (compte) {
    if (compte.supprimeAt) throw new ApiError(404, 'Ce compte n’existe plus.');
    if (compte.estAdmin) throw new ApiError(404, 'Destinataire introuvable.');
    if (String(compte._id) === String(moi)) {
      throw new ApiError(400, 'Vous ne pouvez pas vous écrire à vous-même.', {
        code: 'CONVERSATION_SOI_MEME',
      });
    }
    return { destinataire: compte, fiche: null };
  }

  const fiche = await Establishment.findById(id).select('nom createdByUserId test');
  if (fiche && !fiche.test) {
    const sansCompte = () => {
      const erreur = new ApiError(
        409,
        `« ${fiche.nom} » n’a pas encore de compte Rejoins’Moi : impossible de lui écrire ici. Appelez-le depuis sa fiche.`,
        {
          code: 'COMMERCE_SANS_COMPTE',
          etablissement: { id: String(fiche._id), nom: fiche.nom },
        }
      );
      return erreur;
    };

    if (!fiche.createdByUserId) throw sansCompte();
    const proprietaire = await User.findById(fiche.createdByUserId).select(
      `${CHAMPS_INTERLOCUTEUR} estAdmin`
    );
    // Gérant parti (droit à l'effacement) : la fiche reste, le compte n'existe
    // plus — on ne peut pas écrire dans le vide.
    if (!proprietaire || proprietaire.supprimeAt || proprietaire.estAdmin) throw sansCompte();
    if (String(proprietaire._id) === String(moi)) {
      throw new ApiError(400, 'Cette fiche est la vôtre : vous ne pouvez pas vous écrire à vous-même.', {
        code: 'CONVERSATION_SOI_MEME',
        etablissement: { id: String(fiche._id), nom: fiche.nom },
      });
    }
    return { destinataire: proprietaire, fiche };
  }

  throw new ApiError(404, 'Destinataire introuvable.');
}


/**
 * POST /api/messages/start — body: { destinataireId }
 *
 * Ouvre (ou retrouve) LA conversation entre l'appelant et le destinataire, et
 * renvoie son identifiant : c'est ce que fait la page Messages en arrivant avec
 * `/messages?to=…`, et le bouton « Message » des fiches.
 *
 * `destinataireId` peut être un compte OU un établissement : dans le second cas,
 * le propriétaire de la fiche est retrouvé côté serveur (l'interface n'a donc
 * jamais besoin de connaître l'identifiant du gérant pour lui écrire).
 *
 * Idempotent : deux appels successifs (ou simultanés) renvoient la même
 * conversation. En cas de course entre deux créations, la clé unique
 * `cleParticipants` fait échouer la seconde en 11000 → on relit la gagnante.
 */
router.post(
  '/start',
  protect,
  asyncHandler(async (req, res) => {
    const { destinataire } = await resoudreDestinataire(req.body?.destinataireId, req.user._id);

    const cle = Conversation.cleDe(req.user._id, destinataire._id);
    let conversation = await Conversation.findOne({ cleParticipants: cle });
    let creee = false;

    if (!conversation) {
      try {
        conversation = await Conversation.create({
          participants: [req.user._id, destinataire._id],
          dernierMessage: '',
          derniereActivite: new Date(),
        });
        creee = true;
      } catch (err) {
        // 11000 = clé de binôme déjà prise (deux onglets, deux clics rapides).
        if (err?.code === 11000) conversation = await Conversation.findOne({ cleParticipants: cle });
        if (!conversation) throw err;
      }
    }

    await conversation.populate({ path: 'participants', select: CHAMPS_INTERLOCUTEUR });

    res.status(creee ? 201 : 200).json({
      conversation: resumerConversation(conversation, req.user._id, 0),
      creee,
    });
  })
);

/**
 * GET /api/messages/conversations — boîte de réception.
 *
 * Tri par `derniereActivite` (index composé participants + date) : la discussion
 * qui vient de bouger est en haut, comme dans n'importe quelle messagerie.
 * `nonLus` est calculé en UNE agrégation pour toutes les conversations
 * (compter message par message ferait N requêtes pour un écran qui doit
 * s'afficher vite en 3G).
 */
router.get(
  '/conversations',
  protect,
  asyncHandler(async (req, res) => {
    const conversations = await Conversation.find({ participants: req.user._id })
      .sort({ derniereActivite: -1 })
      .limit(50)
      .populate({ path: 'participants', select: CHAMPS_INTERLOCUTEUR });

    const ids = conversations.map((c) => c._id);
    let nonLusParConversation = new Map();
    let dernierMessageLuParConversation = new Map();
    if (ids.length) {
      // nonLus : messages reçus pas encore ouverts par moi.
      const comptes = await Message.aggregate([
        {
          $match: {
            conversationId: { $in: ids },
            expediteurId: { $ne: req.user._id },
            luPar: { $ne: req.user._id },
          },
        },
        { $group: { _id: '$conversationId', total: { $sum: 1 } } },
      ]);
      nonLusParConversation = new Map(comptes.map((c) => [String(c._id), c.total]));

      // Dernier message de chaque conversation : qui l'a envoyé, lu par l'autre ?
      const derniers = await Message.aggregate([
        { $match: { conversationId: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$conversationId',
            expediteurId: { $first: '$expediteurId' },
            luPar: { $first: '$luPar' },
          },
        },
      ]);
      const moi = String(req.user._id);
      for (const d of derniers) {
        const expediteur = String(d.expediteurId);
        const luPar = (d.luPar || []).map(String);
        const luParAutre = luPar.some((id) => id !== expediteur);
        // Témoin "lu" : notre dernier message a été lu par l'interlocuteur.
        dernierMessageLuParConversation.set(
          String(d._id),
          expediteur === moi && luParAutre
        );
      }
    }

    const items = conversations.map((conversation) =>
      resumerConversation(
        conversation,
        req.user._id,
        nonLusParConversation.get(String(conversation._id)) || 0,
        dernierMessageLuParConversation.get(String(conversation._id)) || false
      )
    );

    res.json({
      conversations: items,
      total: items.length,
      totalNonLus: items.reduce((somme, item) => somme + item.nonLus, 0),
    });
  })
);



/**
 * GET /api/messages/conversations/:id — historique d'une conversation.
 *
 * Contrôle d'appartenance AVANT toute lecture : un identifiant deviné ne doit
 * jamais ouvrir la discussion de quelqu'un d'autre (403, sans détail).
 * Les 200 derniers messages suffisent à l'écran ; au-delà, un « charger plus
 * ancien » sera ajouté quand le volume le justifiera (pas de faux bouton).
 */
router.get(
  '/conversations/:id',
  protect,
  asyncHandler(async (req, res) => {
    if (!identifiantValide(req.params.id)) throw new ApiError(404, 'Conversation introuvable.');

    const conversation = await Conversation.findById(req.params.id).populate({
      path: 'participants',
      select: CHAMPS_INTERLOCUTEUR,
    });
    if (!conversation) throw new ApiError(404, 'Conversation introuvable.');

    const participant = (conversation.participants || []).some(
      (p) => String(p?._id || p) === String(req.user._id)
    );
    if (!participant) {
      throw new ApiError(403, 'Vous ne participez pas à cette conversation.', {
        code: 'NON_PARTICIPANT',
      });
    }

    // Marquage « lu » : les messages reçus et pas encore ouverts. Une seule
    // écriture, uniquement les lignes concernées.
    const marquage = await Message.updateMany(
      {
        conversationId: conversation._id,
        expediteurId: { $ne: req.user._id },
        luPar: { $ne: req.user._id },
      },
      { $addToSet: { luPar: req.user._id } }
    );

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(200);

    const items = messages.reverse().map((message) => message.toJSONFor({ moi: req.user._id }));

    res.json({
      conversation: resumerConversation(conversation, req.user._id, 0),
      messages: items,
      marquesCommeLus: marquage.modifiedCount || 0,
    });
  })
);

/**
 * POST /api/messages/conversations/:id — body: { contenu }
 *
 * Envoi d'un message. Le contenu est borné (1000 caractères, comme le schéma) et
 * l'expéditeur est TOUJOURS `req.user` : le corps de requête ne peut pas désigner
 * quelqu'un d'autre (usurpation impossible).
 *
 * La conversation est mise à jour dans la même opération logique : aperçu du
 * dernier message + date d'activité, qui commandent la boîte de réception.
 */
router.post(
  '/conversations/:id',
  protect,
  limiteurEnvoi,
  asyncHandler(async (req, res) => {
    if (!identifiantValide(req.params.id)) throw new ApiError(404, 'Conversation introuvable.');

    const contenu = String(req.body?.contenu ?? '').trim();
    if (!contenu) throw new ApiError(400, 'Écrivez un message avant d’envoyer.');
    if (contenu.length > LONGUEUR_MAX_MESSAGE) {
      throw new ApiError(400, `Le message ne peut pas dépasser ${LONGUEUR_MAX_MESSAGE} caractères.`);
    }

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) throw new ApiError(404, 'Conversation introuvable.');

    const moi = String(req.user._id);
    if (!conversation.participants.map(String).includes(moi)) {
      throw new ApiError(403, 'Vous ne participez pas à cette conversation.', {
        code: 'NON_PARTICIPANT',
      });
    }

    // Destinataire parti (compte anonymisé) : on refuse plutôt que d'écrire dans
    // une conversation que personne ne lira jamais.
    const autreId = conversation.participants.map(String).find((id) => id !== moi);
    const autre = await User.findById(autreId).select('supprimeAt');
    if (!autre || autre.supprimeAt) {
      throw new ApiError(409, 'Ce compte n’existe plus : impossible de poursuivre la discussion.', {
        code: 'DESTINATAIRE_SUPPRIME',
      });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      expediteurId: req.user._id,
      contenu,
      // L'expéditeur a évidemment lu son propre message.
      luPar: [req.user._id],
    });

    conversation.dernierMessage = contenu.replace(/\s+/g, ' ').slice(0, 140);
    conversation.derniereActivite = message.createdAt || new Date();
    await conversation.save();

    // Notification push au destinataire (ne retarde pas la réponse HTTP en cas
    // d'échec : une notification non livrée ne doit pas bloquer l'affichage du
    // message déjà envoyé).
    envoyerNotification(
      autreId,
      'Nouveau message',
      `Vous avez reçu un nouveau message de ${req.user.nomComplet || req.user.telephone}`,
      '/messages'
    ).catch(() => null);

    res.status(201).json({
      message: message.toJSONFor({ moi: req.user._id }),
      conversation: {
        id: conversation._id,
        dernierMessage: conversation.dernierMessage,
        derniereActivite: conversation.derniereActivite,
      },
    });
  })
);

export default router;

