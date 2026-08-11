#!/usr/bin/env node
// ============================================================
//  scripts/seed-postgres.js — Charge un fichier de sauvegarde
//  (backups/AAAA-MM-JJ.json, produit par api/backup.js) dans une base
//  Postgres (voir db/schema.sql).
//
//  Double usage : peupler une base Postgres neuve (préparation de la
//  migration Airtable → Postgres, voir docs/PLAN-LIVRAISON.md) ET
//  restauration après sinistre (remplace l'ancien scripts/restore.js,
//  spécifique à l'API Airtable, retiré — même logique d'insertion par
//  lots idempotente, il n'y a plus besoin de deux scripts distincts
//  une fois la base cible en Postgres).
//
//  Usage :
//    node scripts/seed-postgres.js --backup backups/2026-08-05.json \
//      --database-url postgres://... [--yes] [--force]
//
//    --env-file <chemin>   Charge DATABASE_URL depuis un fichier .env si
//                          --database-url n'est pas fourni.
//    --yes                 Ignore la confirmation interactive.
//    --force               Autorise le chargement même si la table contient
//                          déjà des lignes (sinon refusé, par sécurité).
//
//  Prérequis : la table exercices_realises doit déjà exister (voir
//  db/schema.sql — psql "$DATABASE_URL" -f db/schema.sql).
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { Client } = require('pg');

const BATCH_SIZE = 200; // Postgres n'a pas la limite de 10/requête d'Airtable

function parseArgs(argv) {
  const args = { yes: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--backup') args.backup = argv[++i];
    else if (a === '--database-url') args.databaseUrl = argv[++i];
    else if (a === '--env-file') args.envFile = argv[++i];
    else if (a === '--yes') args.yes = true;
    else if (a === '--force') args.force = true;
    else {
      console.error(`Argument inconnu : ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// Même parseur minimal que scripts/restore.js — pas de dépendance dotenv
// pour un script utilisé ponctuellement.
function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// Champs Airtable (PascalCase) -> colonnes Postgres (snake_case), voir
// db/schema.sql. Valeurs par défaut '' pour rester NOT NULL sur les champs
// texte qui sont toujours présents dans les vraies données (Saisi_Par,
// Observations, Source) — jamais absents, mais défensif quand même.
function toRow(fields) {
  return {
    navire: fields.Navire,
    type_exercice: fields.Type_Exercice,
    nom_exercice: fields.Nom_Exercice,
    date_realisation: fields.Date_Realisation,
    semaine: fields.Semaine,
    annee: fields.Annee,
    saisi_par: fields.Saisi_Par ?? '',
    observations: fields.Observations ?? '',
    source: fields.Source ?? '',
    lien_inspection: fields.Lien_Inspection ?? null,
    safetyculture_audit_id: fields.SafetyCulture_Audit_ID ?? null,
  };
}

async function insertBatch(client, rows) {
  const cols = ['navire', 'type_exercice', 'nom_exercice', 'date_realisation', 'semaine', 'annee', 'saisi_par', 'observations', 'source', 'lien_inspection', 'safetyculture_audit_id'];
  const values = [];
  const placeholders = rows.map((row, i) => {
    const base = i * cols.length;
    cols.forEach(c => values.push(row[c]));
    return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO exercices_realises (${cols.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (safetyculture_audit_id, type_exercice) WHERE safetyculture_audit_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `;
  const result = await client.query(sql, values);
  return result.rows.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1. Charger et valider le fichier de sauvegarde
  if (!args.backup) {
    console.error('Usage : node scripts/seed-postgres.js --backup backups/AAAA-MM-JJ.json --database-url <url> [--yes] [--force]');
    process.exit(1);
  }
  const backupPath = path.resolve(args.backup);
  if (!fs.existsSync(backupPath)) {
    console.error(`Fichier introuvable : ${backupPath}`);
    process.exit(1);
  }
  const records = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (!Array.isArray(records) || records.some(r => !r.fields)) {
    console.error('Format invalide : le fichier de sauvegarde doit être un tableau d\'enregistrements Airtable ({ id, createdTime, fields }).');
    process.exit(1);
  }

  // 2. Résoudre la base cible — jamais de valeur par défaut implicite
  let databaseUrl = args.databaseUrl;
  if (!databaseUrl && args.envFile) {
    const env = loadEnvFile(path.resolve(args.envFile));
    // DATABASE_URL est marqué "Sensitive" par l'intégration Neon sur
    // Preview/Production (voir scripts/apply-schema.js). Preview utilise un
    // préfixe (RECETTE_, base Neon distincte connectée avec un préfixe
    // imposé par Vercel — voir README.md, section Postgres).
    //
    // Pas d'alias PROD_* ici volontairement : ces variables ont existé sur
    // Vercel mais pointaient vers un projet Neon orphelin jamais branché au
    // code déployé (incident du 10/08/2026, voir README.md) — supprimées de
    // Vercel pour de bon. Pour cibler Production, passer --database-url avec
    // la chaîne DATABASE_URL récupérée manuellement via la console Neon
    // (projet neon-gray-ferry, base exercices_production).
    const candidates = [
      'DATABASE_URL', 'POSTGRES_URL_NON_POOLING',
      'RECETTE_DATABASE_URL', 'RECETTE_POSTGRES_URL_NON_POOLING',
    ];
    for (const key of candidates) {
      if (env[key] && !env[key].includes('SENSITIVE')) {
        databaseUrl = env[key];
        if (key !== 'DATABASE_URL') console.log(`DATABASE_URL illisible ou absent — utilisation de ${key} à la place.`);
        break;
      }
    }
  }
  if (!databaseUrl || databaseUrl.includes('SENSITIVE')) {
    console.error('Base cible manquante ou illisible : fournir --database-url, ou --env-file pointant vers un fichier qui contient une variable de connexion en clair.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // 3. Vérifier l'état actuel de la table cible
    console.log('Vérification de la table exercices_realises…');
    let existingCount;
    try {
      const res = await client.query('SELECT COUNT(*)::int AS count FROM exercices_realises');
      existingCount = res.rows[0].count;
    } catch (e) {
      if (e.code === '42P01') { // undefined_table
        console.error('La table exercices_realises n\'existe pas encore. Créer le schéma d\'abord : psql "$DATABASE_URL" -f db/schema.sql');
        process.exit(1);
      }
      throw e;
    }
    if (existingCount > 0 && !args.force) {
      console.error(`La table cible contient déjà ${existingCount} ligne(s) — chargement refusé pour éviter une duplication (utiliser --force pour passer outre, en connaissance de cause).`);
      process.exit(1);
    }

    // 4. Aperçu et confirmation
    console.log(`Fichier de sauvegarde : ${backupPath}`);
    console.log(`${records.length} enregistrement(s) à charger.`);
    if (!args.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question('Confirmer le chargement ? (taper "oui" pour continuer) ');
      rl.close();
      if (answer.trim().toLowerCase() !== 'oui') {
        console.log('Annulé.');
        return;
      }
    }

    // 5. Insérer par lots
    let inserted = 0;
    let skipped = 0;
    const failedBatches = [];
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE).map(r => toRow(r.fields));
      try {
        const count = await insertBatch(client, batch);
        inserted += count;
        skipped += batch.length - count;
        console.log(`  ✓ Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${count}/${batch.length} inséré(s) (${batch.length - count} ignoré(s), déjà présent(s))`);
      } catch (e) {
        console.error(`  ✗ Lot ${Math.floor(i / BATCH_SIZE) + 1} (enregistrements ${i}-${i + batch.length - 1}) : ${e.message}`);
        failedBatches.push({ start: i, end: i + batch.length - 1, error: e.message });
      }
    }

    // 6. Rapport final
    console.log('\n--- Rapport de chargement ---');
    console.log(`Insérés  : ${inserted}/${records.length}`);
    console.log(`Ignorés  : ${skipped} (déjà présents, anti-doublon SafetyCulture)`);
    console.log(`Échecs   : ${failedBatches.length} lot(s)`);
    if (failedBatches.length > 0) {
      failedBatches.forEach(f => console.log(`  - enregistrements ${f.start}-${f.end} : ${f.error}`));
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch(e => {
  // pg peut remonter une AggregateError (ex: base injoignable) dont le
  // .message est vide — le vrai détail est dans .errors[]. Sans ce
  // dépliage, l'échec de connexion le plus courant (mauvaise URL,
  // base éteinte) s'affiche comme "Erreur inattendue : " sans indice.
  const detail = Array.isArray(e.errors) && e.errors.length > 0
    ? e.errors.map(sub => sub.message || sub.code).join(', ')
    : (e.message || e.code || String(e));
  console.error(`Erreur inattendue : ${detail}`);
  console.error('Vérifier que --database-url (ou DATABASE_URL) pointe vers une base Postgres accessible.');
  process.exit(1);
});
