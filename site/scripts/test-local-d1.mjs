import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BUDDIES_ALL_TABLES } from '../../worker/scripts/buddies-db-tables.mjs';
import {
  OTHER_REQUIRED_TABLES,
  OTHER_RETIRED_MIGRATIONS,
  OTHER_RETIRED_OBJECTS,
} from '../../worker/scripts/other-db-tables.mjs';

const siteRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(siteRoot, '..');
const stateDirectory = path.resolve(siteRoot, '.wrangler-pages-test-state');
const wranglerScript = path.resolve(siteRoot, 'node_modules/wrangler/bin/wrangler.js');
const configPath = path.resolve(siteRoot, 'wrangler.jsonc');

function migrationFiles(directory, retired = []) {
  const retiredSet = new Set(retired);
  return readdirSync(path.resolve(repositoryRoot, directory))
    .filter((name) => name.endsWith('.sql') && !retiredSet.has(name))
    .sort()
    .map((name) => path.join(directory, name));
}

const databases = [
  {
    binding: 'DB',
    files: migrationFiles('database/buddies-migrations'),
    requiredTables: BUDDIES_ALL_TABLES,
    retiredObjects: [],
  },
  {
    binding: 'OTHER_DB',
    files: migrationFiles('database/other-migrations', OTHER_RETIRED_MIGRATIONS),
    requiredTables: OTHER_REQUIRED_TABLES,
    retiredObjects: OTHER_RETIRED_OBJECTS,
  },
];

function run(args) {
  const result = spawnSync(process.execPath, [wranglerScript, ...args, '--config', configPath], {
    cwd: siteRoot,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${output}\nwrangler ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(Math.min(...starts)));
}

function rowsFromJsonOutput(output) {
  const payload = parseJsonOutput(output);
  return (Array.isArray(payload) ? payload : [payload])
    .flatMap((container) => container?.results || container?.result?.[0]?.results || []);
}

function sqlList(values) {
  return values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(',');
}

function schemaObjects(binding, names) {
  if (!names.length) return [];
  return rowsFromJsonOutput(run([
    'd1', 'execute', binding,
    '--local', '--persist-to', stateDirectory, '--json',
    '--command', `SELECT name,type FROM sqlite_schema
      WHERE name IN (${sqlList(names)}) ORDER BY name`,
  ]));
}

function executeFile(binding, filename) {
  console.log(`Applying current ${binding} schema: ${filename}`);
  run([
    'd1', 'execute', binding,
    '--local', '--persist-to', stateDirectory,
    '--file', path.resolve(repositoryRoot, filename),
  ]);
}

function verifyDatabase(database) {
  const installed = new Map(schemaObjects(database.binding, database.requiredTables)
    .map((row) => [String(row.name), String(row.type)]));
  const missing = database.requiredTables.filter((table) => installed.get(table) !== 'table');
  if (missing.length) {
    throw new Error(`${database.binding} is missing required tables: ${missing.join(', ')}`);
  }

  const retired = schemaObjects(database.binding, database.retiredObjects)
    .map((row) => String(row.name));
  if (retired.length) {
    throw new Error(`${database.binding} still contains retired objects: ${retired.join(', ')}`);
  }
}

rmSync(stateDirectory, { recursive: true, force: true });

try {
  for (const database of databases) {
    for (const filename of database.files) executeFile(database.binding, filename);
    verifyDatabase(database);
  }
  console.log('Current D1 schema smoke test passed.');
} finally {
  rmSync(stateDirectory, { recursive: true, force: true });
}
