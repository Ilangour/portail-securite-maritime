// ============================================================
//  Rattrapage SafetyCulture — déclenché par un Cron Job Vercel (voir
//  vercel.json), une fois par jour, uniquement en Production.
//
//  Filet de sécurité pour api/safetyculture-webhook.js : SafetyCulture ne
//  réessaie une livraison de webhook en échec que jusqu'à 4 fois sur 100
//  secondes (voir README.md) — au-delà, l'événement est perdu
//  définitivement, sans autre signal qu'un manque silencieux dans l'outil
//  (incident constaté sur Sirius le 03/08/2026, découvert seulement parce que
//  le capitaine a remarqué l'absence).
//
//  Repasse sur les inspections SafetyCulture récentes (toutes navires) et
//  crée directement les enregistrements manquants — même logique
//  d'extraction et même anti-doublon que le webhook (ON CONFLICT sur
//  safetyculture_audit_id + type_exercice), donc sans risque à rejouer
//  chaque jour même si rien ne manque.
// ============================================================

import { neon } from '@neondatabase/serverless';
import CONFIG from '../config.js';
import safetycultureMapping from '../lib/safetyculture-mapping.js';
import planningLogic from '../lib/planning-logic.js';
import Sentry from './_sentry.js';

const { mapSiteToNavire, mapExerciceLabel, extractExerciseData } = safetycultureMapping;
const { isoWeek } = planningLogic;

const TARGET_TEMPLATE_ID = process.env.SAFETYCULTURE_TEMPLATE_ID; // id du template "Exercices de sécurité" dans votre compte SafetyCulture
const LOOKBACK_DAYS = 3; // marge de sécurité (week-ends, retries tardifs) au-delà de la fréquence quotidienne du Cron

async function fetchRecentAuditIds(scHeaders, since) {
  const ids = [];
  let modifiedAfter = since;
  while (true) {
    const res = await fetch(
      `https://api.safetyculture.io/audits/search?template=${TARGET_TEMPLATE_ID}&archived=false&completed=true&modified_after=${encodeURIComponent(modifiedAfter)}&limit=100`,
      { headers: scHeaders }
    );
    if (!res.ok) throw new Error(`Recherche SafetyCulture HTTP ${res.status}`);
    const body = await res.json();
    const newOnes = body.audits.filter(a => !ids.includes(a.audit_id));
    if (newOnes.length === 0) break;
    ids.push(...newOnes.map(a => a.audit_id));
    const last = body.audits[body.audits.length - 1].modified_at;
    if (last === modifiedAfter || body.audits.length < 100) break;
    modifiedAfter = last;
  }
  return ids;
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: { message: 'Non autorisé' } });
  }

  const databaseUrl = process.env.DATABASE_URL;
  const scToken = process.env.SAFETYCULTURE_API_TOKEN;
  if (!databaseUrl || !scToken) {
    return res.status(500).json({ error: { message: 'Configuration serveur manquante (DATABASE_URL / SAFETYCULTURE_API_TOKEN)' } });
  }
  const sql = neon(databaseUrl);
  const scHeaders = { Authorization: `Bearer ${scToken}` };

  try {
    const result = await Sentry.withMonitor(
      'rattrapage-safetyculture',
      async () => {
        const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
        const auditIds = await fetchRecentAuditIds(scHeaders, since);

        const created = [];
        for (const auditId of auditIds) {
          const inspRes = await fetch(`https://api.safetyculture.io/audits/${auditId}`, { headers: scHeaders });
          if (!inspRes.ok) continue;
          const inspection = await inspRes.json();
          if (inspection.template_id !== TARGET_TEMPLATE_ID || !inspection.audit_data?.date_completed) continue;

          const { siteName, dateExercice, typeLabels, officier, scenario } = extractExerciseData(inspection);
          const navire = mapSiteToNavire(siteName);
          if (!navire || !dateExercice || typeLabels.length === 0) continue;

          // Court-circuit avant d'appeler web_report_link (1 appel API en
          // moins) si tous les types de cette inspection sont déjà présents.
          const existing = await sql`
            SELECT type_exercice FROM exercices_realises WHERE safetyculture_audit_id = ${auditId}
          `;
          const existingTypes = new Set(existing.map(r => r.type_exercice));
          const missingLabels = typeLabels.filter(label => !existingTypes.has(mapExerciceLabel(label)));
          if (missingLabels.length === 0) continue;

          const linkRes = await fetch(`https://api.safetyculture.io/audits/${auditId}/web_report_link`, { headers: scHeaders });
          const lienInspection = linkRes.ok ? (await linkRes.json()).url : null;

          const dateStr = dateExercice.slice(0, 10);
          const dateObj = new Date(dateStr + 'T12:00:00');

          for (const label of missingLabels) {
            const typeExercice = mapExerciceLabel(label);
            const catalogueEntry = CONFIG.CATALOGUE.find(e => e.id === typeExercice);
            const nomExercice = catalogueEntry ? catalogueEntry.nom : label;

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
            if (row) created.push({ id: row.id, navire, typeExercice, dateStr, auditId });
          }
        }

        // Visibilité même quand tout va bien : si le webhook a raté quelque
        // chose et que ce filet de sécurité l'a rattrapé, ce n'est pas une
        // erreur applicative (les données sont maintenant correctes) mais ça
        // mérite d'être su, pour comprendre pourquoi le webhook a raté.
        if (created.length > 0) {
          Sentry.captureMessage(
            `Rattrapage SafetyCulture : ${created.length} exercice(s) manquant(s) créé(s) (webhook probablement en échec) — ${created.map(c => `${c.navire}/${c.typeExercice}/${c.dateStr}`).join(', ')}`,
            'warning'
          );
        }

        return { checked: auditIds.length, created: created.length, details: created };
      },
      { schedule: { type: 'crontab', value: '0 4 * * *' }, timezone: 'UTC', checkinMargin: 30, maxRuntime: 10 }
    );

    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    res.status(502).json({ error: { message: `Échec du rattrapage SafetyCulture : ${e.message}` } });
  }
}
