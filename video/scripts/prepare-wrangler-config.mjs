import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DUMMY_ID = '00000000-0000-0000-0000-000000000000';
const OUTPUT = 'wrangler.production.jsonc';
const REDIRECT = '.wrangler/deploy/config.json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_DATABASE_ID_KEYS = [
  'PRODUCTION_D1_DATABASE_ID',
  'D1_DATABASE_ID',
  'DATABASE_ID',
  'CLOUDFLARE_D1_DATABASE_ID'
];

function cleanId(value) {
  return String(value || '').trim();
}

function isUuid(value) {
  return UUID_PATTERN.test(value);
}

function assertUuid(value) {
  if (!isUuid(value)) {
    throw new Error('D1 database id must be a UUID');
  }
  return value;
}

function firstConfiguredDatabaseId() {
  for (const key of ENV_DATABASE_ID_KEYS) {
    const value = cleanId(process.env[key]);
    if (!value) continue;
    if (isUuid(value)) return value;
    console.warn(`Ignoring ${key}: expected a D1 database UUID, got ${value.length} characters`);
  }
  return '';
}

function normalizeDatabaseList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.databases)) return value.databases;
  return [];
}

function databaseName(entry) {
  return entry?.database_name || entry?.name || entry?.databaseName || '';
}

function databaseId(entry) {
  return cleanId(entry?.database_id || entry?.uuid || entry?.id);
}

async function resolveDatabaseIdFromWrangler(database) {
  try {
    const { stdout } = await execFileAsync('npx', ['wrangler', 'd1', 'list', '--json'], {
      windowsHide: true
    });
    const databases = normalizeDatabaseList(JSON.parse(stdout));
    const match = databases.find((entry) => databaseName(entry) === database.database_name)
      || databases.find((entry) => databaseId(entry) === cleanId(database.database_id));
    const id = databaseId(match);
    if (id && !isUuid(id)) {
      console.warn(`Ignoring wrangler d1 list result for ${database.database_name}: expected a D1 database UUID`);
      return '';
    }
    return id;
  } catch (error) {
    console.warn('Could not resolve D1 database id from wrangler d1 list:', error?.message || error);
    return '';
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const database = config.d1_databases?.find((entry) => entry.binding === 'DB') || config.d1_databases?.[0];
if (!database) throw new Error('Missing D1 binding');

const configuredId = firstConfiguredDatabaseId();
const currentId = cleanId(database.database_id);
const discoveredId = await resolveDatabaseIdFromWrangler(database);
const nextId = configuredId || discoveredId || currentId;
if (!nextId || nextId === DUMMY_ID) {
  throw new Error(`D1 database id is required. Set one of: ${ENV_DATABASE_ID_KEYS.join(', ')}`);
}

database.database_id = assertUuid(nextId);

await writeJson(OUTPUT, config);
await writeJson(REDIRECT, { configPath: '../../wrangler.production.jsonc' });
console.log(`Prepared ${OUTPUT}`);
