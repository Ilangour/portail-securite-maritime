// ============================================================
//  Proxy Airtable — relaie les appels du client vers Airtable
//  en gardant le token (AIRTABLE_PAT) uniquement côté serveur.
//
//  Le client appelle /api/airtable?id=<recordId>&... au lieu
//  d'appeler https://api.airtable.com/v0/<base>/<table>
//  directement — la base, la table et le token sont résolus ici,
//  à partir des variables d'environnement Vercel (différentes en
//  Production vs Preview/Development). Une seule table est gérée
//  par ce proxy (fixée côté serveur, jamais transmise par le client).
// ============================================================

import { verifyAuth } from './_auth.js';
import Sentry from './_sentry.js';

const TABLE = 'Exercices_Realises';
const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];

export default async function handler(req, res) {
  if (!ALLOWED_METHODS.includes(req.method)) {
    return res.status(405).json({ error: { message: `Méthode ${req.method} non autorisée` } });
  }

  const auth = await verifyAuth(req);
  if (!auth.ok) {
    return res.status(401).json({ error: { message: auth.message } });
  }

  const { id, ...query } = req.query;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const pat    = process.env.AIRTABLE_PAT;
  if (!baseId || !pat) {
    return res.status(500).json({ error: { message: 'Configuration serveur manquante (AIRTABLE_BASE_ID / AIRTABLE_PAT)' } });
  }

  const path = id ? `${TABLE}/${id}` : TABLE;
  const url  = new URL(`https://api.airtable.com/v0/${baseId}/${path}`);
  Object.entries(query).forEach(([key, value]) => {
    (Array.isArray(value) ? value : [value]).forEach(v => url.searchParams.append(key, v));
  });

  try {
    const airtableRes = await fetch(url.toString(), {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });
    const data = await airtableRes.json();
    res.status(airtableRes.status).json(data);
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    res.status(502).json({ error: { message: `Erreur de relais vers Airtable : ${e.message}` } });
  }
}
