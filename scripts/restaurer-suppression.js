#!/usr/bin/env node
// ============================================================
//  scripts/restaurer-suppression.js — Annule une suppression logique
//  (voir db/schema.sql, colonnes deleted_at/deleted_by, et README.md,
//  section "Quelques défis techniques" — exercice d'intrusion simulée)
//  sans attendre la sauvegarde quotidienne du lendemain.
//
//  Usage :
//    node scripts/restaurer-suppression.js --id 220 --database-url postgres://... [--yes]
//    node scripts/restaurer-suppression.js --id 220 --env-file .env.local
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { Client } = require('pg');

function parseArgs(argv) {
  const args = { yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') args.id = parseInt(argv[++i], 10);
    else if (a === '--database-url') args.databaseUrl = argv[++i];
    else if (a === '--env-file') args.envFile = argv[++i];
    else if (a === '--yes') args.yes = true;
    else {
      console.error(`Argument inconnu : ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// Même parseur minimal que scripts/apply-schema.js et scripts/seed-postgres.js.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id) {
    console.error('Usage : node scripts/restaurer-suppression.js --id <n> --database-url <url> (ou --env-file <chemin>) [--yes]');
    process.exit(1);
  }

  let databaseUrl = args.databaseUrl;
  if (!databaseUrl && args.envFile) {
    const env = loadEnvFile(path.resolve(args.envFile));
    const candidates = ['DATABASE_URL', 'POSTGRES_URL_NON_POOLING'];
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
    const { rows } = await client.query(
      'SELECT id, navire, type_exercice, nom_exercice, date_realisation, deleted_at, deleted_by FROM exercices_realises WHERE id = $1',
      [args.id]
    );
    if (rows.length === 0) {
      console.error(`Aucun enregistrement avec l'id ${args.id}.`);
      process.exit(1);
    }
    const row = rows[0];
    if (!row.deleted_at) {
      console.error(`L'enregistrement ${args.id} n'est pas supprimé — rien à restaurer.`);
      process.exit(1);
    }

    console.log(`Enregistrement ${args.id} : ${row.navire} — ${row.type_exercice} — ${row.nom_exercice} (${row.date_realisation.toISOString().slice(0, 10)})`);
    console.log(`Supprimé le ${row.deleted_at.toISOString()} par ${row.deleted_by || '(jeton de test / inconnu)'}.`);

    if (!args.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question('Confirmer la restauration ? (taper "oui" pour continuer) ');
      rl.close();
      if (answer.trim().toLowerCase() !== 'oui') {
        console.log('Annulé.');
        return;
      }
    }

    await client.query(
      'UPDATE exercices_realises SET deleted_at = NULL, deleted_by = NULL WHERE id = $1',
      [args.id]
    );
    console.log(`✓ Enregistrement ${args.id} restauré.`);
  } finally {
    await client.end();
  }
}

main().catch(e => {
  const detail = Array.isArray(e.errors) && e.errors.length > 0
    ? e.errors.map(sub => sub.message || sub.code).join(', ')
    : (e.message || e.code || String(e));
  console.error(`Erreur inattendue : ${detail}`);
  process.exit(1);
});
