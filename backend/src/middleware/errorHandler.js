// errorHandler.js — Gestion centralisée des erreurs + helpers de réponse
//
// Objectif : toutes les erreurs sortent au même format JSON
//   { error: "message lisible par l'utilisateur", details?: {...} }
// afin que le frontend (src/api/client.js) puisse afficher un message propre sur
// un écran de smartphone, sans jamais exposer la stack trace.

/** Erreur métier avec code HTTP. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Enveloppe un handler async pour que les rejets aillent dans next(err). */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeMongooseError(err) {
  if (err.name === 'ValidationError') {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    );
    return { status: 400, message: Object.values(details)[0] || 'Données invalides.', details };
  }
  if (err.name === 'CastError') {
    return { status: 400, message: `Identifiant invalide pour le champ « ${err.path} ».` };
  }
  if (err.code === 11000) {
    const champ = Object.keys(err.keyPattern || { champ: 1 })[0];
    return { status: 409, message: `Cette valeur est déjà utilisée (${champ}).` };
  }
  return null;
}

/**
 * Erreurs d'ANALYSE DU CORPS (body-parser, bloc F) : le message brut est en anglais
 * et parle de « request entity too large ». On explique la règle réelle à l'utilisateur.
 */
function normalizeBodyError(err) {
  if (err?.type === 'entity.too.large') {
    return {
      status: 413,
      message:
        'Envoi trop volumineux. Une photo est limitée à environ 300 Ko après compression (deux photos par fiche) : reprenez la photo, l’application la compresse automatiquement.',
      details: { code: 'CORPS_TROP_VOLUMINEUX', limiteRecue: err.limit },
    };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, message: 'Données illisibles (JSON invalide).', details: { code: 'JSON_INVALIDE' } };
  }
  return null;
}

/** Middleware 404 : aucune route ne correspond. */
export function notFound(req, res) {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.originalUrl}` });
}

/** Middleware d'erreur final (doit être monté en dernier). */
export function errorHandler(err, req, res, _next) {
  const normalized = normalizeMongooseError(err) || normalizeBodyError(err);
  const status = err.status || normalized?.status || 500;
  const message = normalized?.message || err.message || 'Erreur interne du serveur.';

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: message,
    ...(normalized?.details || err.details ? { details: normalized?.details || err.details } : {}),
  });
}

export default { ApiError, asyncHandler, notFound, errorHandler };
