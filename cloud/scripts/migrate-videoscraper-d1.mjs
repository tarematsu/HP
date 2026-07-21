import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cloudRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerCli = join(cloudRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const targetConfig = join(cloudRoot, '.wrangler', 'generated', 'homepanel-existing.jsonc');
const postImportSql = join(cloudRoot, 'scripts', 'video-post-import.sql');
const sourceDatabase = process.env.VIDEO_SOURCE_D1_NAME?.trim() || 'twivideo-swiper-db';
const targetDatabase = process.env.HOMEPANEL_D1_DATABASE_NAME?.trim() || 'homepanel-data';
const exportDirectory = process.env.VIDEO_D1_EXPORT_DIR?.trim()
  || join(cloudRoot, '.wrangler', 'video-d1-export');

const importOrder = Object.freeze([
  'videos',
  'ranking_entries',
  'collection_runs',
  'reports',
  'worker_locks',
  'collection_capture_snapshots',
  'collection_capture_network_events',
  'd1_maintenance_state',
  'playback_feed_state',
  'collection_run_timings',
  'video_blocklist',
  'video_death_list',
  'video_liveness_state',
  'manual_import_jobs',
  'manual_import_job_chunks',
  'video_orientations',
  'status_counts'
]);
const expectedTables = new Set(importOrder);
const singletonTables = new Set([
  'd1_maintenance_state',
  'playback_feed_state',
  'video_liveness_state',
  'status_counts'
]);

function cloudflareEnvironment() {
  const env = { ...process.env, CI: 'true' };
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
    || process.env.CLOUDFLARE_BUILDS_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
    || process.env.CLOUDFLARE_BUILDS_ACCOUNT_ID?.trim();
  if (token) env.CLOUDFLARE_API_TOKEN = token;
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  return env;
}

function wrangler(args, capture = false) {
  return execFileSync(process.execPath, [wranglerCli, ...args], {
    cwd: cloudRoot,
    env: cloudflareEnvironment(),
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
  });
}

function parseJsonOutput(text) {
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0);
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < start) throw new Error('Wrangler did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function resultRows(payload) {
  const entries = Array.isArray(payload) ? payload : [payload];
  const rows = [];
  for (const entry of entries) {
    if (Array.isArray(entry?.results)) rows.push(...entry.results);
    else if (Array.isArray(entry?.result?.results)) rows.push(...entry.result.results);
  }
  return rows;
}

function query(database, sql, target = false) {
  const args = ['d1', 'execute', database, '--remote', '--command', sql, '--json'];
  if (target) args.push('--config', targetConfig);
  return resultRows(parseJsonOutput(wrangler(args, true)));
}

function executeTargetCommand(sql) {
  wrangler([
    'd1', 'execute', targetDatabase, '--remote', '--command', sql,
    '--config', targetConfig
  ]);
}

function executeTargetFile(path) {
  wrangler([
    'd1', 'execute', targetDatabase, '--remote', '--file', path,
    '--config', targetConfig
  ]);
}

function tableNames(database, target = false) {
  const rows = query(database, `
    SELECT name
      FROM sqlite_schema
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%'
       AND name <> 'd1_migrations'
     ORDER BY name;
  `, target);
  return rows.map((row) => String(row.name));
}

function countSql() {
  return importOrder
    .map((table) => `SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM "${table}"`)
    .join('\nUNION ALL\n') + ';';
}

function tableCounts(database, target = false) {
  const rows = query(database, countSql(), target);
  return Object.fromEntries(rows.map((row) => [String(row.table_name), Number(row.row_count)]));
}

function assertSourceSchema(names) {
  const actual = new Set(names);
  const missing = importOrder.filter((name) => !actual.has(name));
  const unexpected = names.filter((name) => !expectedTables.has(name));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Source video schema does not match the migration allowlist. `
      + `Missing: ${missing.join(', ') || 'none'}. `
      + `Unexpected: ${unexpected.join(', ') || 'none'}.`
    );
  }
}

function assertTargetSchema(names) {
  const actual = new Set(names);
  const missing = importOrder.filter((name) => !actual.has(name));
  if (missing.length) {
    throw new Error(`Target homepanel D1 is missing video tables: ${missing.join(', ')}`);
  }
}

function assertTargetEmpty(counts) {
  const populated = [];
  for (const table of importOrder) {
    const count = Number(counts[table] || 0);
    const allowed = singletonTables.has(table) ? 1 : 0;
    if (count > allowed) populated.push(`${table}=${count}`);
  }
  if (populated.length) {
    throw new Error(
      'Target homepanel D1 already contains video data; refusing a duplicate import: '
      + populated.join(', ')
    );
  }
}

function assertCountsEqual(source, target) {
  const mismatches = importOrder
    .filter((table) => Number(source[table] || 0) !== Number(target[table] || 0))
    .map((table) => `${table}: source=${source[table] || 0}, target=${target[table] || 0}`);
  if (mismatches.length) throw new Error(`Video D1 row-count verification failed: ${mismatches.join('; ')}`);
}

function exportTable(table) {
  const path = join(exportDirectory, `${table}.sql`);
  wrangler([
    'd1', 'export', sourceDatabase, '--remote', '--table', table,
    '--no-schema', '--output', path, '--skip-confirmation'
  ]);
  return path;
}

function restoreImportGuards() {
  executeTargetFile(postImportSql);
}

if (!readFileSync(postImportSql, 'utf8').trim()) {
  throw new Error(`Post-import SQL is empty: ${postImportSql}`);
}

rmSync(exportDirectory, { recursive: true, force: true });
mkdirSync(exportDirectory, { recursive: true });

const sourceNames = tableNames(sourceDatabase);
assertSourceSchema(sourceNames);
const sourceCountsBefore = tableCounts(sourceDatabase);
const exports = Object.fromEntries(importOrder.map((table) => [table, exportTable(table)]));
const sourceCountsAfter = tableCounts(sourceDatabase);
assertCountsEqual(sourceCountsBefore, sourceCountsAfter);

const targetNames = tableNames(targetDatabase, true);
assertTargetSchema(targetNames);
const targetCountsBefore = tableCounts(targetDatabase, true);
assertTargetEmpty(targetCountsBefore);

let guardsDropped = false;
let importError;
try {
  executeTargetCommand(`
    DROP TRIGGER IF EXISTS video_death_skip_ranking;
    DROP TRIGGER IF EXISTS status_counts_delta_on_block_insert;
    DROP TRIGGER IF EXISTS status_counts_dirty_on_block_delete;
    DROP TRIGGER IF EXISTS manual_import_jobs_max_urls_insert;
    DROP TRIGGER IF EXISTS manual_import_jobs_max_urls_update;
    DELETE FROM status_counts;
    DELETE FROM video_liveness_state;
    DELETE FROM playback_feed_state;
    DELETE FROM d1_maintenance_state;
  `);
  guardsDropped = true;

  for (const table of importOrder) executeTargetFile(exports[table]);
} catch (error) {
  importError = error;
} finally {
  if (guardsDropped) {
    try {
      restoreImportGuards();
    } catch (restoreError) {
      if (!importError) importError = restoreError;
      else console.error('Failed to restore video import guards', restoreError);
    }
  }
}
if (importError) throw importError;

const targetCountsAfter = tableCounts(targetDatabase, true);
assertCountsEqual(sourceCountsBefore, targetCountsAfter);

const foreignKeyFailures = query(targetDatabase, 'PRAGMA foreign_key_check;', true);
if (foreignKeyFailures.length) {
  throw new Error(`Foreign-key verification failed: ${JSON.stringify(foreignKeyFailures)}`);
}
const schemaRows = query(targetDatabase, `
  SELECT COUNT(*) AS object_count
    FROM sqlite_schema
   WHERE type IN ('table', 'index', 'trigger')
     AND name NOT LIKE 'sqlite_%'
     AND name NOT LIKE '_cf_%';
`, true);
const schemaObjectCount = Number(schemaRows[0]?.object_count ?? 0);
if (!Number.isSafeInteger(schemaObjectCount) || schemaObjectCount < importOrder.length) {
  throw new Error(`D1 schema inventory is incomplete: ${JSON.stringify(schemaRows)}`);
}

const manifest = {
  migratedAt: new Date().toISOString(),
  sourceDatabase,
  targetDatabase,
  tables: importOrder,
  sourceCounts: sourceCountsBefore,
  targetCounts: targetCountsAfter,
  foreignKeyCheck: 'ok',
  schemaCheck: 'ok',
  schemaObjectCount
};
writeFileSync(join(exportDirectory, 'migration-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
