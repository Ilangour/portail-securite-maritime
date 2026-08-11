// ============================================================
//  Sauvegarde automatique — déclenchée par un Cron Job Vercel
//  (voir vercel.json), une fois par jour, uniquement en Production.
//
//  Récupère tous les enregistrements réels de Postgres (voir api/db.js)
//  et les commit dans backups/AAAA-MM-JJ.json sur le dépôt GitHub —
//  même format qu'à l'époque Airtable ({id, createdTime, fields}),
//  pour rester compatible avec scripts/restore.js et scripts/seed-postgres.js.
// ============================================================

import { neon } from '@neondatabase/serverless';
import Sentry from './_sentry.js';

const GITHUB_REPO = process.env.GITHUB_REPO; // ex: "votre-compte/votre-depot"

// Même mapping que rowToRecord dans api/db.js — dupliqué plutôt que partagé
// via un import, pour rester un script autonome facile à auditer isolément
// (comme le reste de api/, voir README.md).
function rowToRecord(row) {
  const fields = {
    Navire: row.navire,
    Type_Exercice: row.type_exercice,
    Nom_Exercice: row.nom_exercice,
    Date_Realisation: row.date_realisation,
    Semaine: row.semaine,
    Annee: row.annee,
    Saisi_Par: row.saisi_par,
    Observations: row.observations,
    Source: row.source,
  };
  if (row.lien_inspection) fields.Lien_Inspection = row.lien_inspection;
  if (row.safetyculture_audit_id) fields.SafetyCulture_Audit_ID = row.safetyculture_audit_id;
  return { id: String(row.id), createdTime: row.created_at, fields };
}

export default async function handler(req, res) {
  // N'accepte que les appels du Cron Job Vercel (jamais depuis le navigateur)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: { message: 'Non autorisé' } });
  }

  const databaseUrl = process.env.DATABASE_URL;
  const ghToken = process.env.GITHUB_BACKUP_TOKEN;
  if (!databaseUrl || !ghToken || !GITHUB_REPO) {
    return res.status(500).json({ error: { message: 'Configuration serveur manquante pour la sauvegarde' } });
  }
  const sql = neon(databaseUrl);

  try {
    // Healthcheck Sentry Crons : "check-in" avant/après le travail réel.
    // Contrairement à captureException (qui suppose qu'une erreur a été
    // levée), ceci détecte aussi le cas où le Cron Job Vercel ne se
    // déclenche plus du tout (rien à capturer, juste une absence de
    // check-in) — alerte si aucun check-in "ok" n'arrive dans la marge
    // définie autour de l'horaire attendu (voir vercel.json : 3h UTC).
    const { path, count } = await Sentry.withMonitor(
      'sauvegarde-quotidienne',
      async () => {
        // 1. Récupérer tous les enregistrements Postgres (pas de pagination
        //    nécessaire : un SELECT complet, à la différence de l'API REST
        //    Airtable qui limitait à 100/page)
        const rows = await sql`
          SELECT id, navire, type_exercice, nom_exercice, date_realisation::text AS date_realisation,
                 semaine, annee, saisi_par, observations, source, lien_inspection,
                 safetyculture_audit_id, created_at
          FROM exercices_realises
          ORDER BY id
        `;
        const records = rows.map(rowToRecord);

        // 2. Committer un fichier daté dans backups/ via l'API GitHub
        //    (l'API exige le SHA existant pour mettre à jour un fichier déjà présent —
        //    utile si la sauvegarde est relancée plusieurs fois le même jour)
        const date = new Date().toISOString().split('T')[0];
        const path = `backups/${date}.json`;
        const content = Buffer.from(JSON.stringify(records, null, 2)).toString('base64');
        const ghHeaders = {
          'Authorization': `Bearer ${ghToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        };

        const existing = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, { headers: ghHeaders });
        const sha = existing.ok ? (await existing.json()).sha : undefined;

        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
          method: 'PUT',
          headers: ghHeaders,
          body: JSON.stringify({
            message: `Sauvegarde automatique — ${date} (${records.length} enregistrements)`,
            content,
            ...(sha ? { sha } : {}),
          }),
        });

        if (!ghRes.ok) {
          const err = await ghRes.json().catch(() => ({}));
          throw new Error(`GitHub HTTP ${ghRes.status} : ${err.message || 'erreur inconnue'}`);
        }

        return { path, count: records.length };
      },
      { schedule: { type: 'crontab', value: '0 3 * * *' }, timezone: 'UTC', checkinMargin: 15, maxRuntime: 5 }
    );

    res.status(200).json({ ok: true, path, count });
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    res.status(502).json({ error: { message: `Échec de la sauvegarde : ${e.message}` } });
  }
}
