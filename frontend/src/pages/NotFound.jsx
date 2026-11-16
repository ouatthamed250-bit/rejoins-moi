// NotFound.jsx — Page 404 : route inconnue.
// Affichée quand aucune route ne correspond à l'URL demandée.

import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="ecran py-16 text-center">
      <h1 className="text-2xl font-bold text-ink mb-4">Page introuvable</h1>
      <p className="text-ink-muted mb-8">
        La page que vous cherchez n'existe pas (ou a été déplacée).
      </p>
      <Link to="/" className="bouton-principal px-4 py-2 text-sm">
        Retour à l'accueil
      </Link>
    </div>
  );
}