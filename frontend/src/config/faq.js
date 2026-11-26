// faq.js — Base de connaissances de l'assistant virtuel (FAQ interactive).
//
// Décisions :
//  - TOUT EST EN DUR, ICI. L'assistant ne pose AUCUNE question à un service
//    extérieur : pas d'IA, pas de modèle de langage, pas de requête réseau. C'est
//    une garantie de coût (un smartphone d'entrée de gamme en 3G n'attend rien),
//    une garantie de disponibilité (les réponses restent lisibles hors ligne) et
//    une garantie de confidentialité : ce que la personne cherche n'est jamais
//    envoyé à un tiers.
//  - Chaque réponse a été vérifiée contre l'application elle-même (libellés des
//    boutons, noms des écrans, étapes réelles). Une réponse fausse use la
//    confiance plus vite qu'une absence de réponse : si un écran change de nom,
//    la question correspondante doit changer ici le même jour.
//  - `lien` est TOUJOURS un chemin interne de l'application (il commence par
//    « / », sans domaine). Un lien externe n'aurait rien à faire dans une
//    réponse : le composant (components/AssistantBot.jsx) ne rend d'ailleurs
//    qu'un <Link> de react-router, jamais une balise HTML brute.
//  - Aucune donnée personnelle, aucun prix écrit en dur : les montants et les
//    formules vivent dans config/abonnement.js et config/paiement.js, seules
//    sources de vérité. Une réponse qui donnerait un tarif « de mémoire »
//    deviendrait fausse au premier changement de tarif.
//
// Ajouter une question : un objet { q, r, lien?, texteLien? } dans `questions`.
//   q          la question, telle que la personne la poserait vraiment ;
//   r          la réponse, en 1 à 3 phrases, avec les mots exacts des boutons ;
//   lien       (facultatif) chemin interne vers l'écran qui agit ;
//   texteLien  (facultatif) libellé du bouton, à l'impératif (« Créer ma fiche »).

export const FAQ_DATA = [
  {
    id: 'inscription',
    titre: 'Inscrire mon commerce',
    icone: 'store',
    questions: [
      {
        q: 'Comment créer une fiche pour mon établissement ?',
        r: 'Allez dans le menu ou cliquez sur le bouton central "+" en bas, puis choisissez "Je souhaite inscrire mon établissement". Suivez les 3 étapes (Photos, Produits, Infos).',
        lien: '/inscription',
        texteLien: 'Créer ma fiche maintenant',
      },
      {
        q: "Est-ce que c'est payant ?",
        r: "Non, l'inscription et la publication de votre fiche sont totalement gratuites.",
      },
      {
        q: 'Puis-je ajouter des photos plus tard ?',
        r: 'Oui, une fois connecté, ouvrez votre fiche et cliquez sur "Gérer" pour ajouter des photos, corriger votre position ou modifier vos horaires.',
      },
    ],
  },
  {
    id: 'recherche',
    titre: 'Trouver un artisan ou un commerce',
    icone: 'search',
    questions: [
      {
        q: 'Comment chercher un maquis ou un coiffeur ?',
        r: 'Utilisez la barre de recherche sur l\'accueil ou l\'onglet "Explorer". Vous pouvez filtrer par catégorie (Restauration, Beauté, etc.) ou chercher par nom.',
        lien: '/recherche',
        texteLien: 'Aller à la recherche',
      },
      {
        q: 'Comment voir les commerces près de moi ?',
        r: "Autorisez la localisation sur votre téléphone. L'application triera automatiquement les résultats du plus proche au plus loin.",
      },
      {
        q: 'Puis-je chercher une pharmacie ou une clinique ?',
        r: 'Oui : la section "Pharmacies & cliniques" liste les pharmacies et les cliniques du quartier. Le badge vert "De garde" signale celles qui se déclarent de garde, et elles apparaissent en premier.',
        lien: '/pharmacies-cliniques',
        texteLien: 'Voir les pharmacies et cliniques',
      },
    ],
  },
  {
    id: 'contact',
    titre: 'Contacter un artisan',
    icone: 'whatsapp',
    questions: [
      {
        q: 'Comment appeler ou envoyer un message ?',
        r: 'Sur la fiche d\'un établissement ou d\'une annonce, cliquez sur le bouton vert "WhatsApp" ou "Appeler". Le contact s\'affiche immédiatement.',
      },
      {
        q: 'Le numéro est masqué, comment faire ?',
        r: "Si un cadenas est affiché, cela signifie que l'auteur a choisi de ne pas publier son numéro. Vous pouvez lui envoyer une demande via l'application.",
      },
      {
        q: 'Le contact ne répond pas, que faire ?',
        r: "Laissez passer un peu de temps et réessayez : beaucoup de commerçants répondent le soir. Si le numéro ne sonne plus du tout, signalez l'annonce ou la fiche pour que nous la vérifiions.",
      },
    ],
  },
  {
    id: 'gestion',
    titre: 'Gérer ma fiche',
    icone: 'settings',
    questions: [
      {
        q: 'Comment corriger la position de ma boutique ?',
        r: 'Allez sur votre fiche, cliquez sur le bouton "Gérer", puis "Corriger ma position exacte" et déplacez le repère sur la carte.',
        lien: '/profil',
        texteLien: 'Aller sur mon profil',
      },
      {
        q: 'Comment dire que je suis fermé temporairement ?',
        r: 'Sur votre fiche, cliquez sur "Gérer" et activez "Fermer temporairement" (ex: pour une rupture de stock). Les clients verront "Fermé".',
      },
      {
        q: 'Comment modifier mes horaires ?',
        r: 'Dans le bouton "Gérer" de votre fiche, descendez à la section "Horaires d\'ouverture" pour ajuster les jours et les heures.',
      },
      {
        q: 'Comment changer la photo ou le nom de ma fiche ?',
        r: 'Tout se fait depuis "Gérer" : la galerie accepte jusqu\'à 8 photos, et les informations (nom, description, produits et services) se modifient dans le même écran. Enregistrez : la fiche est à jour pour tous les visiteurs.',
      },
    ],
  },
  {
    id: 'emploi',
    titre: "Emplois et Main-d'œuvre",
    icone: 'briefcase',
    questions: [
      {
        q: "Comment publier une offre d'emploi ou de stage ?",
        r: 'Allez dans la section "Emplois" via le menu, cliquez sur "Publier une annonce" et remplissez les détails.',
        lien: '/main-doeuvre',
        texteLien: 'Publier une annonce',
      },
      {
        q: 'Puis-je chercher un plombier pour un travail ?',
        r: 'Oui, rendez-vous dans "Emplois", onglet "Demandes", et parcourez les profils des artisans disponibles.',
      },
      {
        q: 'Quelle différence entre une offre et une demande ?',
        r: "Une offre, c'est quelqu'un qui embauche (un poste, un salaire, une durée). Une demande, c'est un particulier ou un commerce qui cherche un artisan ou un journalier pour une mission. Les deux se publient depuis le même bouton \"Publier une annonce\".",
        lien: '/jobs',
        texteLien: 'Voir les annonces',
      },
    ],
  },
  {
    id: 'securite',
    titre: 'Sécurité et Confidentialité',
    icone: 'shield',
    questions: [
      {
        q: 'Qui peut voir mon numéro de téléphone ?',
        r: 'Votre numéro n\'est visible que si vous avez coché la case "J\'accepte que mon numéro soit visible" lors de la création de votre fiche ou annonce. Sinon, il reste masqué.',
      },
      {
        q: 'Comment supprimer mon compte ?',
        r: 'Rendez-vous dans votre Profil, descendez en bas et cliquez sur "Supprimer définitivement mon compte". Toutes vos données personnelles seront effacées.',
        lien: '/mentions-legales',
        texteLien: 'Voir les mentions légales',
      },
      {
        q: 'Que faites-vous de mes données ?',
        r: 'Elles servent uniquement à faire fonctionner l\'application : votre compte, votre fiche ou vos annonces. Vous pouvez demander une correction ou un effacement à tout moment ; la page "Mentions légales" détaille ce qui est enregistré et comment nous écrire.',
        lien: '/mentions-legales',
        texteLien: 'Lire les mentions légales',
      },
      {
        q: 'Puis-je retirer mon numéro après avoir accepté ?',
        r: 'Oui. Décochez la case "J\'accepte que mon numéro de téléphone soit visible" depuis votre profil : le numéro redevient masqué sur vos annonces. Les fiches déjà enregistrées se modifient aussi depuis "Gérer".',
        lien: '/profil',
        texteLien: 'Gérer mes préférences',
      },
    ],
  },
  {
    id: 'visibilite',
    titre: 'Mise en avant et visibilité',
    icone: 'star',
    questions: [
      {
        q: 'Comment être mis en avant dans l\'application ?',
        r: 'Depuis votre profil, dans la carte "Cette semaine", touchez "Je veux être mis en avant". La demande est enregistrée gratuitement, sans aucun paiement : elle rejoint la liste d\'attente des fiches à mettre en avant.',
        lien: '/profil',
        texteLien: 'Demander la mise en avant',
      },
      {
        q: 'La mise en avant est-elle payante ?',
        r: "Aujourd'hui, tout est gratuit : l'inscription, la publication de la fiche, les annonces et la demande de mise en avant. Aucun débit n'est effectué. Si des options payantes arrivent un jour, elles seront annoncées dans l'application avant tout paiement.",
      },
      {
        q: 'Pourquoi ma fiche ne peut-elle pas être mise en avant ?',
        r: 'Les fiches de lieux publics et de lieux de culte ne sont jamais mises en avant : elles restent visibles dans les résultats de recherche, c\'est tout. Aucune demande ne peut être acceptée pour ces catégories.',
      },
    ],
  },
  {
    id: 'signaler',
    titre: 'Signaler un problème',
    icone: 'flag',
    questions: [
      {
        q: 'Comment signaler une annonce douteuse ?',
        r: 'Sous une annonce de la page "Jobs", touchez "Signaler". Aucun compte n\'est nécessaire : notre équipe examine les annonces les plus signalées et retire celles qui ne respectent pas les règles.',
        lien: '/jobs',
        texteLien: 'Aller aux annonces',
      },
      {
        q: 'Une fiche affiche de fausses informations, que faire ?',
        r: 'Signalez-la au support WhatsApp en donnant le nom de la fiche et ce qui est faux (adresse, horaires, numéro). L\'équipe peut corriger la fiche, la fermer ou la retirer.',
      },
      {
        q: 'Comment joindre le support ?',
        r: 'Le support répond sur WhatsApp, du lundi au samedi. Indiquez votre nom, votre numéro de compte et l\'objet de la demande (fiche à corriger, paiement, annonce à retirer) : c\'est ce qui permet de traiter le dossier en un seul échange.',
      },
    ],
  },
];

/** Nombre total de réponses écrites (affiché dans le panneau de l'assistant). */
export const NOMBRE_QUESTIONS = FAQ_DATA.reduce((total, cat) => total + cat.questions.length, 0);
