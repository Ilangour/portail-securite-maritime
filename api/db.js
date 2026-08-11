// ============================================================
//  Proxy Postgres — remplace api/airtable.js (voir docs/PLAN-LIVRAISON.md,
//  section "Migration Airtable → Postgres").
//
//  Même contrat que l'ancien proxy Airtable côté client, mais seulement
//  pour les usages réels de portail.js (voir les appels à API_EX) — pas
//  une réimplémentation générale de l'API REST Airtable :
//
//  GET  /api/db?filterByFormula=AND({Navire}='X',{Annee}=Y)
//              &sort[0][field]=Date_Realisation&sort[0][direction]=desc
//              &pageSize=100[&offset=N]
//    -> { records: [{id, createdTime, fields}], offset?: "N" }
//  POST /api/db   body { fields: {...} }
//    -> { id, createdTime, fields }
//  DELETE /api/db?id=<id>
//    -> { id, deleted: true }
//
//  Le tri est toujours par Date_Realisation desc (seule valeur jamais
//  envoyée par portail.js) — pas de paramètre de tri générique.
// ============================================================

import { neon } from '@neondatabase/serverless';
import { verifyAuth } from './_auth.js';
import Sentry from './_sentry.js';

const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];

// Colonnes Postgres (snake_case, voir db/schema.sql) -> champs Airtable
// (PascalCase) tels que portail.js les attend encore dans "fields".
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
  // Omis quand vide, comme le faisait Airtable (voir README.md, section
  // "Intégration SafetyCulture" : absents pour les saisies manuelles).
  if (row.lien_inspection) fields.Lien_Inspection = row.lien_inspection;
  if (row.safetyculture_audit_id) fields.SafetyCulture_Audit_ID = row.safetyculture_audit_id;
  return { id: String(row.id), createdTime: row.created_at, fields };
}

// Analyse la seule forme de filterByFormula réellement envoyée par
// portail.js (voir fetchExercices) : AND({Navire}='X',{Annee}=Y).
function parseFilter(formula) {
  const match = decodeURIComponent(formula || '').match(/^AND\(\{Navire\}='([^']*)',\{Annee\}=(\d+)\)$/);
  if (!match) throw new Error(`filterByFormula non reconnue : ${formula}`);
  return { navire: match[1], annee: parseInt(match[2], 10) };
}

export default async function handler(req, res) {
  if (!ALLOWED_METHODS.includes(req.method)) {
    return res.status(405).json({ error: { message: `Méthode ${req.method} non autorisée` } });
  }

  const auth = await verifyAuth(req);
  if (!auth.ok) {
    return res.status(401).json({ error: { message: auth.message } });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return res.status(500).json({ error: { message: 'Configuration serveur manquante (DATABASE_URL)' } });
  }
  const sql = neon(databaseUrl);

  try {
    if (req.method === 'GET') {
      const { navire, annee } = parseFilter(req.query.filterByFormula);
      const pageSize = parseInt(req.query.pageSize, 10) || 100;
      const offset = parseInt(req.query.offset, 10) || 0;

      // pageSize + 1 pour savoir s'il reste une page suivante, sans COUNT(*) séparé.
      const rows = await sql`
        SELECT id, navire, type_exercice, nom_exercice, date_realisation::text AS date_realisation,
               semaine, annee, saisi_par, observations, source, lien_inspection,
               safetyculture_audit_id, created_at
        FROM exercices_realises
        WHERE navire = ${navire} AND annee = ${annee}
        ORDER BY date_realisation DESC
        LIMIT ${pageSize + 1} OFFSET ${offset}
      `;

      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      const body = { records: page.map(rowToRecord) };
      if (hasMore) body.offset = String(offset + pageSize);
      return res.status(200).json(body);
    }

    if (req.method === 'POST') {
      const fields = req.body?.fields;
      if (!fields) {
        return res.status(400).json({ error: { message: 'Corps de requête invalide : champ "fields" manquant' } });
      }

      const [row] = await sql`
        INSERT INTO exercices_realises
          (navire, type_exercice, nom_exercice, date_realisation, semaine, annee, saisi_par, observations, source, lien_inspection, safetyculture_audit_id)
        VALUES (
          ${fields.Navire ?? ''}, ${fields.Type_Exercice ?? ''}, ${fields.Nom_Exercice ?? ''},
          ${fields.Date_Realisation ?? null}, ${fields.Semaine ?? null}, ${fields.Annee ?? null},
          ${fields.Saisi_Par ?? ''}, ${fields.Observations ?? ''}, ${fields.Source ?? ''},
          ${fields.Lien_Inspection ?? null}, ${fields.SafetyCulture_Audit_ID ?? null}
        )
        RETURNING id, navire, type_exercice, nom_exercice, date_realisation::text AS date_realisation,
                  semaine, annee, saisi_par, observations, source, lien_inspection,
                  safetyculture_audit_id, created_at
      `;
      return res.status(200).json(rowToRecord(row));
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!id) {
        return res.status(400).json({ error: { message: 'id manquant ou invalide' } });
      }
      const result = await sql`DELETE FROM exercices_realises WHERE id = ${id} RETURNING id`;
      if (result.length === 0) {
        return res.status(404).json({ error: { message: 'Enregistrement introuvable' } });
      }
      return res.status(200).json({ id: String(id), deleted: true });
    }
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    return res.status(502).json({ error: { message: `Erreur base de données : ${e.message}` } });
  }
}
