// AssistantBot.jsx — Assistant virtuel (FAQ interactive), monté sur toutes les pages.
//
// Décisions :
//  - AUCUN appel réseau, aucune IA : les réponses viennent de config/faq.js, en
//    dur dans le bundle. Rien de ce que la personne cherche ne sort du téléphone,
//    l'assistant s'ouvre même sans réseau, et il ne peut pas « inventer » une
//    réponse. C'est un choix de produit (support de proximité) autant que de
//    sécurité.
//  - Trois niveaux, jamais plus : catégories → questions → réponse. Chaque niveau
//    a son bouton de retour, et le panneau se ferme d'un geste (croix, Échap,
//    toucher à côté). Un parcours à trois temps se comprend sans mode d'emploi.
//  - Position : le bouton flottant se pose AU-DESSUS du bloc fixe du bas, en
//    lisant --hauteur-bloc-bas (hauteur RÉELLE mesurée par
//    hooks/useMesureBlocBas.js, navigation + barre d'action). Aucune valeur en
//    dur : sur un Android à barre système haute, ou avec une barre d'action
//    posée sur la navigation (inscription), le bouton ne recouvre rien.
//  - Le panneau est un dialogue posé juste au-dessus du bloc fixe du bas ; il
//    remplace le bouton pendant qu'il est ouvert (le bouton n'est monté que
//    panneau fermé). Il reste sous le menu hamburger (z-50) : aucun élément
//    flottant ne doit passer au-dessus d'un tiroir ouvert.
//  - Styles : uniquement des utilitaires Tailwind + les classes existantes
//    (entete-degrade, bouton-principal, btn-ghost, animate-fade-up). Les deux
//    règles qui manquent (entrée du panneau, respect de « réduire les
//    animations ») vivent dans une balise <style> locale : la feuille theme.css
//    n'est pas touchée par cette fonctionnalité.
//  - Le panneau se referme dès qu'un lien d'action change de page : il masquerait
//    l'écran qu'on vient d'ouvrir.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Icon } from './Icons.jsx';
import { FAQ_DATA, NOMBRE_QUESTIONS } from '../config/faq.js';

// Le bouton se pose sur le haut RÉEL du bloc du bas, +16 px de respiration.
const BAS_BOUTON = 'calc(var(--hauteur-bloc-bas, var(--hauteur-nav, 0px)) + 16px)';
// Le panneau s'ouvre à la place du bouton (il est démonté tant qu'il est
// ouvert) : il prend donc la même assise, +18 px.
const BAS_PANNEAU = 'calc(var(--hauteur-bloc-bas, var(--hauteur-nav, 0px)) + 18px)';

const CSS = `
@keyframes assistant-entree {
  0% { opacity: 0; transform: translateY(16px) scale(0.985); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.assistant-panneau {
  animation: assistant-entree 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.assistant-corps {
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  overscroll-behavior: contain;
}
.assistant-bouton:focus-visible {
  outline: 3px solid rgba(255, 122, 24, 0.45);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .assistant-panneau { animation: none !important; }
  .assistant-corps { scroll-behavior: auto !important; }
}
`;

export default function AssistantBot() {
  const [ouvert, setOuvert] = useState(false);
  const [categorieId, setCategorieId] = useState(null);
  const [indexQuestion, setIndexQuestion] = useState(null);

  const { pathname } = useLocation();
  const boutonRef = useRef(null);
  const fermerRef = useRef(null);
  const corpsRef = useRef(null);

  // Niveau DÉDUIT de l'état (jamais stocké à part) : impossible d'avoir un
  // panneau qui affiche une réponse sans catégorie, ou un « retour » sans cible.
  const categorie = FAQ_DATA.find((c) => c.id === categorieId) || null;
  const item = categorie && indexQuestion !== null ? categorie.questions[indexQuestion] || null : null;
  const niveau = item ? 'reponse' : categorie ? 'questions' : 'categories';

  const fermer = useCallback((rendreFocus = true) => {
    setOuvert(false);
    setCategorieId(null);
    setIndexQuestion(null);
    // Le focus revient sur le bouton (remonté au rendu suivant) : au clavier, on
    // ne se retrouve pas nulle part. `preventScroll` évite qu'un focus sur un
    // élément fixe fasse sauter la position de lecture de la page. Les liens
    // d'action passent `false` : on ne vole pas le focus à l'écran qu'ils ouvrent.
    if (rendreFocus && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        boutonRef.current?.focus?.({ preventScroll: true });
      });
    }
  }, []);

  const ouvrir = useCallback(() => {
    setCategorieId(null);
    setIndexQuestion(null);
    setOuvert(true);
  }, []);

  // Un lien d'action a navigué : le panneau n'a plus de raison d'être là.
  // On ne reprend PAS le focus (la personne regarde un nouvel écran).
  useEffect(() => {
    setOuvert(false);
    setCategorieId(null);
    setIndexQuestion(null);
  }, [pathname]);

  // Échap ferme ; à l'ouverture le focus part sur la croix du panneau.
  useEffect(() => {
    if (!ouvert) return undefined;
    function surTouche(evt) {
      if (evt.key === 'Escape') {
        evt.stopPropagation();
        fermer();
      }
    }
    document.addEventListener('keydown', surTouche);
    const minuteur = window.setTimeout(() => fermerRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      document.removeEventListener('keydown', surTouche);
      window.clearTimeout(minuteur);
    };
  }, [ouvert, fermer]);

  // Changement de niveau : on repart du haut du panneau (sinon une longue
  // réponse laisse la liste suivante à moitié défilée).
  useEffect(() => {
    if (corpsRef.current) corpsRef.current.scrollTop = 0;
  }, [niveau, categorieId, indexQuestion]);

  function remonter() {
    if (niveau === 'reponse') {
      setIndexQuestion(null);
      return;
    }
    setCategorieId(null);
    setIndexQuestion(null);
  }

  const titre = niveau === 'categories' ? 'Assistant Rejoins’Moi' : categorie?.titre || 'Assistant Rejoins’Moi';
  let sousTitre = 'Réponse';
  if (niveau === 'categories') sousTitre = `${NOMBRE_QUESTIONS} réponses · sans réseau`;
  else if (niveau === 'questions') {
    const total = categorie.questions.length;
    sousTitre = `${total} question${total > 1 ? 's' : ''}`;
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {ouvert && (
        <div
          className="fixed inset-0 z-[45] bg-black/40 animate-pop-in"
          role="presentation"
          onClick={fermer}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Assistant Rejoins’Moi"
            className="assistant-panneau absolute left-3 right-3 ml-auto flex max-w-[420px] flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card"
            style={{ bottom: BAS_PANNEAU, maxHeight: 'min(68vh, 520px)' }}
            onClick={(evt) => evt.stopPropagation()}
          >
            <header className="entete-degrade flex shrink-0 items-center gap-2 border-b border-line/70 px-3 py-2.5">
              {niveau === 'categories' ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon name="robot" size={18} />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={remonter}
                  aria-label="Retour"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/70 text-ink transition hover:bg-primary/10 active:scale-90"
                >
                  <Icon name="chevronLeft" size={18} />
                </button>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold leading-tight text-ink">{titre}</p>
                <p className="truncate text-[10px] font-semibold text-ink-muted">{sousTitre}</p>
              </div>

              <button
                ref={fermerRef}
                type="button"
                onClick={fermer}
                aria-label="Fermer l’assistant"
                className="shrink-0 rounded-full p-1.5 text-ink transition hover:bg-primary/10 active:scale-90"
              >
                <Icon name="close" size={18} />
              </button>
            </header>

            <div ref={corpsRef} className="assistant-corps flex-1 overflow-y-auto px-3 py-3">
              {/* `key` : chaque niveau est une nouvelle « bulle », l'animation
                  de montée rejoue donc à chaque étape (et pas seulement à
                  l'ouverture du panneau). */}
              <div key={`${niveau}-${categorieId || ''}-${indexQuestion ?? ''}`} className="animate-fade-up">
                {niveau === 'categories' && (
                  <ListeCategories onChoisir={(id) => setCategorieId(id)} />
                )}

                {niveau === 'questions' && (
                  <ListeQuestions
                    categorie={categorie}
                    onChoisir={(index) => setIndexQuestion(index)}
                  />
                )}

                {niveau === 'reponse' && (
                  <Reponse item={item} onRetour={remonter} onFermer={() => fermer(false)} />
                )}
              </div>
            </div>

            <footer className="shrink-0 border-t border-line px-3 py-2">
              <p className="text-[10px] leading-snug text-ink-muted">
                Réponses écrites par l’équipe, sans service extérieur.
              </p>
            </footer>
          </section>
        </div>
      )}

      {/* Bouton flottant : monté seulement quand le panneau est fermé — il laisse
          alors sa place au panneau, et reste SOUS le menu hamburger (z-50) pour ne
          jamais flotter au-dessus d'un tiroir ouvert. */}
      {!ouvert && (
        <button
          ref={boutonRef}
          type="button"
          onClick={ouvrir}
          aria-label="Ouvrir l’assistant Rejoins’Moi"
          aria-haspopup="dialog"
          className="assistant-bouton fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-fab transition hover:bg-primary-dark active:scale-95"
          style={{ bottom: BAS_BOUTON }}
        >
          <Icon name="robot" size={24} />
        </button>
      )}
    </>
  );
}

/** Niveau 1 — les grands sujets. */
function ListeCategories({ onChoisir }) {
  return (
    <>
      <p className="mb-2 text-[11px] font-semibold text-ink-muted">
        Bonjour 👋 Quel sujet vous amène ?
      </p>
      <ul className="space-y-2">
        {FAQ_DATA.map((cat) => (
          <li key={cat.id}>
            <button
              type="button"
              onClick={() => onChoisir(cat.id)}
              className="flex w-full items-center gap-2.5 rounded-md border border-line bg-white px-2.5 py-2 text-left transition hover:border-primary/40 hover:bg-soft active:scale-[0.99]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soft text-primary">
                <Icon name={cat.icone} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold leading-tight text-ink">{cat.titre}</span>
                <span className="block text-[10px] font-semibold text-ink-muted">
                  {cat.questions.length} question{cat.questions.length > 1 ? 's' : ''}
                </span>
              </span>
              <Icon name="chevronRight" size={16} className="shrink-0 text-ink-muted" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Niveau 2 — les questions d'un sujet, formulées comme la personne les pose. */
function ListeQuestions({ categorie, onChoisir }) {
  return (
    <>
      <p className="mb-2 text-[11px] font-semibold text-ink-muted">Choisissez votre question :</p>
      <ul className="space-y-2">
        {categorie.questions.map((question, index) => (
          <li key={question.q}>
            <button
              type="button"
              onClick={() => onChoisir(index)}
              className="flex w-full items-start gap-2 rounded-md border border-line bg-white px-2.5 py-2.5 text-left transition hover:border-primary/40 hover:bg-soft active:scale-[0.99]"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary-dark">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-ink">
                {question.q}
              </span>
              <Icon name="chevronRight" size={15} className="mt-0.5 shrink-0 text-ink-muted" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Niveau 3 — la réponse, présentée comme une discussion : la question à droite
 * (la personne), la réponse à gauche (l'assistant), puis le bouton d'action
 * quand la réponse en a un. `lien` étant un chemin interne figé dans
 * config/faq.js, un <Link> suffit : aucune URL extérieure n'est rendue.
 */
function Reponse({ item, onRetour, onFermer }) {
  return (
    <>
      <div className="mb-2.5 flex justify-end">
        <p className="max-w-[86%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-[12.5px] font-semibold leading-snug text-white">
          {item.q}
        </p>
      </div>

      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soft text-primary">
          <Icon name="robot" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            aria-live="polite"
            className="rounded-lg rounded-tl-sm border border-line bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-ink"
          >
            {item.r}
          </p>

          {item.lien && (
            <Link
              to={item.lien}
              onClick={onFermer}
              className="bouton-principal mt-2 w-full py-2 text-xs"
            >
              {item.texteLien || 'Ouvrir l’écran'}
              <Icon name="chevronRight" size={15} />
            </Link>
          )}

          <button
            type="button"
            onClick={onRetour}
            className="btn-ghost mt-2 w-full py-2 text-[11px]"
          >
            <Icon name="chevronLeft" size={14} />
            Retour aux questions
          </button>
        </div>
      </div>
    </>
  );
}
