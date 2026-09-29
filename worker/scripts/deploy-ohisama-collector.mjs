import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import { runWrangler } from './cloudflare-queues.mjs';

const DATABASE_NAME = 'stationhead-ohisama';
const BUDDIES_DATABASE_NAME = 'stationhead-buddies';
const CONFIG_NAME = 'wrangler.ohisama-collector.jsonc';
const GENERATED_CONFIG_NAME = '.wrangler.ohisama-collector.generated.jsonc';
const SCHEMA_PATH = '../database/ohisama-migrations/001_initial_schema.sql';
const generatedConfigUrl = new URL(`../${GENERATED_CONFIG_NAME}`, import.meta.url);

function parseJsonOutput(value) {
  const source = String(value || '').trim();
  const starts = [source.indexOf('['), source.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${source.slice(0, 300)}`);
  return JSON.parse(source.slice(Math.min(...starts)));
}

function wranglerJson(args, { allowFailure = false } = {}) {
  const result = runWrangler(args, { capture: true, allowFailure });
  if (result.status !== 0) return null;
  return parseJsonOutput(result.stdout);
}

function listDatabases() {
  const value = wranglerJson(['d1', 'list', '--json']);
  return Array.isArray(value) ? value : value?.result || [];
}

function databaseId(database) {
  return database?.uuid || database?.id || database?.database_id || null;
}

function resultRows(value) {
  const containers = Array.isArray(value) ? value : [value];
  return containers.flatMap((container) => container?.results || container?.result?.results || []);
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function ensureDatabase() {
  let database = listDatabases().find((item) => item.name === DATABASE_NAME);
  if (!database) {
    runWrangler(['d1', 'create', DATABASE_NAME], { capture: true });
    database = listDatabases().find((item) => item.name === DATABASE_NAME);
  }
  const id = databaseId(database);
  if (!database || !id) throw new Error(`Could not resolve D1 database ${DATABASE_NAME}`);
  return { database, id };
}

function applySchema() {
  runWrangler([
    'd1', 'execute', DATABASE_NAME,
    '--remote', '--yes',
    '--file', SCHEMA_PATH,
  ]);
}

function seedBuddiesAuth() {
  const source = wranglerJson([
    'd1', 'execute', BUDDIES_DATABASE_NAME,
    '--remote', '--yes', '--json',
    '--command', `SELECT auth_token,device_uid,token_expires_at
      FROM sh_worker_collector_state WHERE id='stationhead' LIMIT 1`,
  ], { allowFailure: true });
  const row = resultRows(source)[0];
  const authToken = String(row?.auth_token || '').trim();
  const deviceUid = String(row?.device_uid || '').trim();
  if (!authToken || !deviceUid) return false;

  const expiry = Number(row?.token_expires_at || 0);
  const now = Date.now();
  const expirySql = Number.isFinite(expiry) && expiry > 0 ? String(Math.trunc(expiry)) : 'NULL';
  const command = `INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,updated_at
    ) VALUES('stationhead',${sqlText(authToken)},${sqlText(deviceUid)},${expirySql},${now})
    ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,
      device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,
      updated_at=excluded.updated_at`;
  const seeded = runWrangler([
    'd1', 'execute', DATABASE_NAME,
    '--remote', '--yes',
    '--command', command,
  ], { capture: true, allowFailure: true });
  return seeded.status === 0;
}

const { id } = ensureDatabase();
applySchema();
const authSeeded = seedBuddiesAuth();

const config = JSON.parse(readFileSync(new URL(`../${CONFIG_NAME}`, import.meta.url), 'utf8'));
const binding = config.d1_databases?.find((item) => item.binding === 'OHISAMA_DB');
if (!binding) throw new Error('OHISAMA_DB binding is missing from Wrangler config');
binding.database_name = DATABASE_NAME;
binding.database_id = id;
writeFileSync(generatedConfigUrl, `${JSON.stringify(config, null, 2)}\n`);

try {
  runWrangler(['deploy', '--config', GENERATED_CONFIG_NAME], { capture: true, mirror: true });
} finally {
  try { unlinkSync(generatedConfigUrl); } catch {}
}

console.log(JSON.stringify({
  event: 'ohisama_collector_worker_deployed',
  script: config.name,
  database_name: DATABASE_NAME,
  auth_seeded_from_buddies: authSeeded,
}));
