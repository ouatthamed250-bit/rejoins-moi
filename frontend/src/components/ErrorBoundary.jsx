// ErrorBoundary.jsx — Capture les erreurs React dans l'arbre des composants.
// Aucun composant enfant ne peut faire planter l'application entière : une erreur
// est interceptée, affichée avec un bouton de rechargement, et la navigation reste
// possible. Pas de dépendance ajoutée.
//
// Un jour, Sentry (ou équivalent) pourra être branché ici via console.error.

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // TODO : brancher Sentry ici quand le projet sera en production publique.
    console.error('[ErrorBoundary] Erreur React capturée :', error, errorInfo);
    this.setState({ info: errorInfo.componentStack });
  }

  recharger = () => {
    this.setState({ hasError: false, error: null, info: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="ecran py-12 text-center">
          <h1 className="text-2xl font-bold text-ink mb-4">Une erreur est survenue.</h1>
          <p className="text-ink-muted mb-8">
            Cette page a rencontré un problème et ne peut pas s'afficher.
          </p>
          <button
            type="button"
            onClick={this.recharger}
            className="bouton-principal px-4 py-2 text-sm"
          >
            Recharger la page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}