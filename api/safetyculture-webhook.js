// ============================================================
//  Webhook SafetyCulture — appelé par SafetyCulture (jamais par le
//  navigateur) quand une inspection est marquée complète/incomplète.
//  Filtré sur le template "Exercices de sécurité" ; enregistre
//  directement dans Postgres (voir api/db.js, même base que le
//  portail), sans passer par le proxy authentifié Google — ce n'est
//  pas un appel utilisateur.
//
//  Sécurité : SafetyCulture signe chaque livraison (HMAC-SHA256,
//  header x-safetyculture-signature) — vérifiée ici sur les octets
//  bruts de la requête (bodyParser désactivé). Voir README.md pour
//  la procédure de récupération du secret et de création du webhook
//  côté SafetyCulture (étapes manuelles, hors code).
// ============================================================

import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import CONFIG from '../config.js';
import safetycultureMapping from '../lib/safetyculture-mapping.js';
import planningLogic from '../lib/planning-logic.js';
import Sentry from './_sentry.js';

const { mapSiteToNavire, mapExerciceLabel, extractExerciseData, resolveReconciliation } = safetycultureMapping;
const { isoWeek } = planningLogic;

export const config = { api: { bodyParser: false } };

const TARGET_TEMPLATE_ID = process.env.SAFETYCULTURE_TEMPLATE_ID; // id du template "Exercices de sécurité" dans votre compte SafetyCulture
const SIGNATURE_HEADER = 'x-safetyculture-signature';

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: `Méthode ${req.method} non autorisée` } });
  }

  const secret = process.env.SAFETYCULTURE_WEBHOOK_SECRET;
  const scToken = process.env.SAFETYCULTURE_API_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;
  if (!secret || !scToken || !databaseUrl) {
    return res.status(500).json({ error: { message: 'Configuration serveur manquante (SAFETYCULTURE_WEBHOOK_SECRET / SAFETYCULTURE_API_TOKEN / DATABASE_URL)' } });
  }
  const sql = neon(databaseUrl);

  const rawBody = await getRawBody(req);
  if (!verifySignature(rawBody, req.headers[SIGNATURE_HEADER], secret)) {
    return res.status(401).json({ error: { message: 'Signature invalide' } });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: { message: 'JSON invalide' } });
  }

  const eventTypes = payload.event?.event_types || [];
  const auditId = payload.resource?.id;
  if (!eventTypes.includes('TRIGGER_EVENT_INSPECTION_COMPLETED_STATUS') || payload.resource?.type !== 'INSPECTION' || !auditId) {
    return res.status(200).json({ ok: true, skipped: 'événement hors périmètre' });
  }

  // Tout appel réseau (SafetyCulture, Postgres) à partir d'ici peut lever —
  // encadré comme api/db.js pour toujours répondre un JSON structuré plutôt
  // qu'une erreur non gérée. Sans impact fonctionnel en cas d'échec
  // (SafetyCulture retente automatiquement la livraison).
  try {
    const scHeaders = { Authorization: `Bearer ${scToken}` };

    const inspRes = await fetch(`https://api.safetyculture.io/audits/${auditId}`, { headers: scHeaders });
    if (!inspRes.ok) {
      return res.status(502).json({ error: { message: `Échec de récupération de l'inspection SafetyCulture (HTTP ${inspRes.status})` } });
    }
    const inspection = await inspRes.json();

    // Filtre défensif sur le template et l'état de complétion : on ne se fie
    // pas au payload webhook seul (structure non documentée pour cet event),
    // on revérifie sur l'inspection elle-même, source de vérité. Cette version
    // de l'API n'expose pas de booléen "is_marked_as_complete" : la présence
    // de audit_data.date_completed est le signal de complétion (vérifié sur
    // une vraie inspection avant d'écrire cette condition).
    if (inspection.template_id !== TARGET_TEMPLATE_ID || !inspection.audit_data?.date_completed) {
      return res.status(200).json({ ok: true, skipped: 'hors template exercices ou inspection non complète' });
    }

    const { siteName, dateExercice, typeLabels, officier, scenario } = extractExerciseData(inspection);
    const navire = mapSiteToNavire(siteName);
    if (!navire || !dateExercice || typeLabels.length === 0) {
      return res.status(200).json({ ok: true, skipped: 'navire/date/type manquant ou non reconnu', siteName });
    }

    const linkRes = await fetch(`https://api.safetyculture.io/audits/${auditId}/web_report_link`, { headers: scHeaders });
    const lienInspection = linkRes.ok ? (await linkRes.json()).url : null;

    const dateStr = dateExercice.slice(0, 10); // date calendaire UTC — voir note dans README.md
    const dateObj = new Date(dateStr + 'T12:00:00');

    const created = [];
    const completed = [];
    for (const label of typeLabels) {
      const typeExercice = mapExerciceLabel(label);
      const catalogueEntry = CONFIG.CATALOGUE.find(e => e.id === typeExercice);
      const nomExercice = catalogueEntry ? catalogueEntry.nom : label;

      // Rapprochement avec une éventuelle saisie manuelle déjà présente pour
      // ce navire/type/date (voir lib/safetyculture-mapping.js pour le
      // détail) : si un match sûr existe, on la complète au lieu d'insérer
      // une nouvelle ligne (évite un doublon).
      const candidates = await sql`
        SELECT id FROM exercices_realises
        WHERE navire = ${navire} AND type_exercice = ${typeExercice} AND date_realisation = ${dateStr}
          AND safetyculture_audit_id IS NULL AND deleted_at IS NULL
      `;
      const resolution = resolveReconciliation(candidates);

      if (resolution.action === 'update') {
        const [row] = await sql`
          UPDATE exercices_realises
          SET lien_inspection = ${lienInspection || null},
              safetyculture_audit_id = ${auditId},
              source = 'SafetyCulture',
              saisi_par = CASE WHEN saisi_par = '' THEN ${officier} ELSE saisi_par END,
              observations = CASE WHEN observations = '' THEN ${scenario} ELSE observations END
          WHERE id = ${resolution.id}
          RETURNING id
        `;
        if (row) completed.push(String(row.id));
        continue;
      }

      if (resolution.ambiguous) {
        Sentry.captureMessage(
          `Rapprochement SafetyCulture ambigu : plusieurs saisies manuelles correspondent à ${navire}/${typeExercice}/${dateStr} (inspection ${auditId}) — inspection insérée en plus, à fusionner manuellement`,
          'warning'
        );
      }

      // ON CONFLICT DO NOTHING sur l'index unique partiel de db/schema.sql
      // (safetyculture_audit_id, type_exercice) : reproduit l'anti-doublon
      // Airtable, mais en une seule requête atomique — plus sûr que l'ancien
      // check-puis-insert face aux retries SafetyCulture (jusqu'à 4x/100s).
      const [row] = await sql`
        INSERT INTO exercices_realises
          (navire, type_exercice, nom_exercice, date_realisation, semaine, annee, saisi_par, observations, source, lien_inspection, safetyculture_audit_id)
        VALUES (
          ${navire}, ${typeExercice}, ${nomExercice}, ${dateStr}, ${isoWeek(dateObj)}, ${dateObj.getFullYear()},
          ${officier}, ${scenario}, 'SafetyCulture', ${lienInspection || null}, ${auditId}
        )
        ON CONFLICT (safetyculture_audit_id, type_exercice) WHERE safetyculture_audit_id IS NOT NULL
        DO NOTHING
        RETURNING id
      `;
      if (row) created.push(String(row.id));
    }

    res.status(200).json({ ok: true, auditId, navire, created, completed });
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    res.status(502).json({ error: { message: `Échec du traitement du webhook SafetyCulture : ${e.message}` } });
  }
}
