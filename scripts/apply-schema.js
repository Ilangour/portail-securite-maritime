#!/usr/bin/env node
// ============================================================
//  scripts/apply-schema.js — Applique db/schema.sql à une base Postgres
//  cible. Remplace `psql "$DATABASE_URL" -f db/schema.sql` (psql n'est
//  pas garanti disponible partout) — utilise `pg`, déjà une dépendance
//  du projet (voir scripts/seed-postgres.js). Idempotent (CREATE TABLE
//  IF NOT EXISTS / CREATE INDEX IF NOT EXISTS dans db/schema.sql),
//  donc sans danger de le relancer sur une base déjà à jour.
//
//  Usage :
//    node scripts/apply-schema.js --database-url postgres://...
//    node scripts/apply-schema.js --env-file .env.preview.local
// ============================================================

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--database-url') args.databaseUrl = argv[++i];
    else if (a === '--env-file') args.envFile = argv[++i];
    else {
      console.error(`Argument inconnu : ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// Même parseur minimal que scripts/seed-postgres.js.
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

  let databaseUrl = args.databaseUrl;
  if (!databaseUrl && args.envFile) {
    const env = loadEnvFile(path.resolve(args.envFile));
    // DATABASE_URL est marqué "Sensitive" par l'intégration Neon sur
    // Preview/Production : `vercel env pull` ne le récupère jamais en clair
    // (vaut littéralement "[SENSITIVE]"), même en exécution locale directe.
    // Preview utilise un préfixe (RECETTE_, base Neon distincte connectée
    // avec un préfixe imposé par Vercel — voir README.md, section Postgres).
    // On essaie les alias dans l'ordre jusqu'à trouver une valeur exploitable.
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
  if (!databaseUrl) {
    console.error('Usage : node scripts/apply-schema.js --database-url <url> (ou --env-file <chemin>)');
    process.exit(1);
  }
  if (databaseUrl.includes('SENSITIVE')) {
    console.error('Valeur --database-url illisible (marquée Sensitive) — fournir une vraie chaîne de connexion.');
    process.exit(1);
  }

  const schemaPath = path.resolve(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    console.log(`Application de ${schemaPath}…`);
    await client.query(sql);
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM exercices_realises');
    console.log(`OK — table exercices_realises prête (${rows[0].n} ligne(s) actuellement).`);
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
});
