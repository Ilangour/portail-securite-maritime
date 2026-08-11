// ============================================================
//  Initialisation Sentry côté serveur — importé par chaque fonction
//  Vercel qui veut remonter ses erreurs. Préfixe `_` : pas une route
//  (même convention que _auth.js).
// ============================================================

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || 'development',
  tracesSampleRate: 0, // pas de tracing de performance pour l'instant, erreurs uniquement
});

export default Sentry;
