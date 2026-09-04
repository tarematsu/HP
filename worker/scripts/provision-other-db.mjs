import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OTHER_REQUIRED_TABLES,
  OTHER_RETIRED_MIGRATIONS,
  OTHER_RETIRED_OBJECTS,
} from './other-db-tables.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const migrationsDir = resolve(repositoryRoot, 'database/other-migrations');
const metadataPath = resolve(repositoryRoot, 'database/other-db.json');
const metadataConsolidationScript = resolve(workerRoot, 'scripts/consolidate-track-metadata.mjs');
const databaseName = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const BINDING = 'OTHER_DB';
const APPLE_MUSIC_COMPATIBILITY_TABLE = 'sh_host_queue_items';
const LEGACY_TRACK_METADATA_TABLE = 'sh_track_metadata';

// Runtime writes the operational tables and Pages reads the public projections.
// Provisioning updates only those two explicit owners.
const configPaths = [
  resolve(workerRoot, 'wrangler.runtime.jsonc'),
  resolve(repositoryRoot, 'site/wrangler.jsonc'),
];

if (!process.env.CLOUDFLARE_API_TOKEN) {
  throw new Error('CLOUDFLARE_API_TOKEN is required');
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.warn('CLOUDFLARE_ACCOUNT_ID is not set; Wrangler will infer the account from the API token.');
}

function wrangler(args) {
  try {
    return execFileSync(process.execPath, [wranglerScript, ...args], {
      cwd: workerRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

function parseJsonOutput(output) {
  const trimmed = String(output || '').trim();
  const starts = [trimmed.indexOf('['), trimmed.indexOf('{')].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start < 0) throw new Error(`Wrangler did not return JSON: ${trimmed.slice(0, 300)}`);
  return JSON.parse(trimmed.slice(start));
}

function rowsFromJsonOutput(output) {
  const parsed = parseJsonOutput(output);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .flatMap((container) => container?.results || []);
}

function listDatabases() {
  return parseJsonOutput(wrangler(['d1', 'list', '--json']));
}

function remoteRows(command) {
  return rowsFromJsonOutput(wrangler([
    'd1', 'execute', databaseName,
    '--remote', '--yes', '--json',
    '--command', command,
  ]));
}

function sqlList(values) {
  return values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(',');
}

function schemaObjects(names) {
  if (!names.length) return [];
  return remoteRows(`SELECT name,type FROM sqlite_schema
    WHERE name IN (${sqlList(names)}) ORDER BY name`);
}

function hasSchemaObject(name, type = null) {
  return schemaObjects([name]).some((row) => (
    String(row?.name || '') === name
    && (type == null || String(row?.type || '') === type)
  ));
}

function removeAppleMusicCompatibilityColumn() {
  const columns = new Set(remoteRows(`PRAGMA table_info(${APPLE_MUSIC_COMPATIBILITY_TABLE})`)
    .map((row) => String(row?.name || '')));
  if (!columns.has('apple_music_id')) return;
  wrangler([
    'd1', 'execute', databaseName,
    '--remote', '--yes',
    '--command', `ALTER TABLE ${APPLE_MUSIC_COMPATIBILITY_TABLE} DROP COLUMN apple_music_id`,
  ]);
}

function consolidateLegacyTrackMetadata() {
  if (!hasSchemaObject(LEGACY_TRACK_METADATA_TABLE, 'table')) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      operation: 'track-metadata-consolidation',
      reason: 'source-table-retired',
    }));
    return;
  }
  execFileSync(process.execPath, [metadataConsolidationScript], {
    cwd: workerRoot,
    env: {
      ...process.env,
      OTHER_DATABASE_NAME: databaseName,
      TRACK_METADATA_APPLY: 'true',
      TRACK_METADATA_DROP_SOURCE: 'true',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function verifySchema() {
  const installed = new Map(schemaObjects(OTHER_REQUIRED_TABLES)
    .map((row) => [String(row.name), String(row.type)]));
  const missing = OTHER_REQUIRED_TABLES.filter((table) => installed.get(table) !== 'table');
  if (missing.length) {
    throw new Error(`OTHER_DB schema verification failed; missing tables: ${missing.join(', ')}`);
  }

  const retired = schemaObjects(OTHER_RETIRED_OBJECTS).map((row) => String(row.name));
  if (retired.length) {
    const metadataHint = retired.includes(LEGACY_TRACK_METADATA_TABLE)
      ? ' Track metadata consolidation did not remove the legacy OTHER_DB table.'
      : '';
    throw new Error(`OTHER_DB schema verification failed; retired objects remain: ${retired.join(', ')}.${metadataHint}`);
  }
}

let database = listDatabases().find((item) => item.name === databaseName);
if (!database) {
  wrangler(['d1', 'create', databaseName]);
  database = listDatabases().find((item) => item.name === databaseName);
}
if (!database) throw new Error(`Wrangler did not create or list ${databaseName}`);

const databaseId = database.uuid || database.id || database.database_id;
if (!databaseId) throw new Error(`Could not determine database id for ${databaseName}`);

for (const configPath of configPaths) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const bindings = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const nextBinding = { binding: BINDING, database_name: databaseName, database_id: databaseId };
  const index = bindings.findIndex((item) => item.binding === BINDING);
  if (index >= 0) bindings[index] = nextBinding;
  else bindings.push(nextBinding);
  config.d1_databases = bindings;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

const retiredMigrationFiles = new Set(OTHER_RETIRED_MIGRATIONS);
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const activeMigrationFiles = migrationFiles.filter((name) => !retiredMigrationFiles.has(name));
for (const migrationFile of activeMigrationFiles) {
  wrangler([
    'd1', 'execute', databaseName,
    '--remote', '--yes',
    '--file', resolve(migrationsDir, migrationFile),
  ]);
}
removeAppleMusicCompatibilityColumn();
consolidateLegacyTrackMetadata();
verifySchema();

writeFileSync(metadataPath, `${JSON.stringify({
  binding: BINDING,
  database_name: databaseName,
  database_id: databaseId,
  schema: `database/other-migrations/${activeMigrationFiles.at(-1)}`,
}, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  database_name: databaseName,
  database_id: databaseId,
  tables: OTHER_REQUIRED_TABLES.length,
}));
