import { resolve } from 'node:path';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const TARGET_DAY = process.env.TRACK_HISTORY_PROBE_DAY || '2026-01-12';
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const DAY_MS = 86_400_000;

const databases = [
  'stationhead-buddies',
  'stationhead-minute',
  'stationhead-other',
];

const knownProbes = {
  'stationhead-buddies': [
    ['sh_channel_snapshots', 'observed_at', 'ms'],
    ['sh_queue_snapshots', 'observed_at', 'ms'],
    ['sh_queue_items', 'observed_at', 'ms'],
    ['sh_queue_items', 'start_time', 'ms'],
    ['sh_track_like_observations', 'observed_at', 'ms'],
  ],
  'stationhead-minute': [
    ['sh_minute_facts', 'observed_at', 'ms'],
    ['sh_queue_item_observations', 'observed_at', 'ms'],
    ['sh_queue_item_observations', 'start_time', 'ms'],
    ['sh_queue_revisions', 'effective_at', 'ms'],
    ['sh_track_like_observations', 'observed_at', 'ms'],
    ['sh_pages_track_history_read_model', 'play_date', 'day'],
  ],
  'stationhead-other': [],
};

function remoteDb(database) {
  return createWranglerRemoteD1({ database, cwd: workerRoot, wranglerScript });
}

function qid(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function existingObjects(db) {
  const result = await db.prepare(`SELECT name,type,sql FROM sqlite_master
    WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  return result.results || [];
}

async function columns(db, table) {
  const result = await db.prepare(`PRAGMA table_info(${qid(table)})`).all();
  return (result.results || []).map((row) => String(row.name || ''));
}

async function countProbe(db, table, column, kind, fromTs, toTs) {
  const sql = kind === 'day'
    ? `SELECT COUNT(*) AS rows FROM ${qid(table)} WHERE ${qid(column)}=?`
    : `SELECT COUNT(*) AS rows FROM ${qid(table)} WHERE ${qid(column)}>=? AND ${qid(column)}<?`;
  const statement = kind === 'day'
    ? db.prepare(sql).bind(TARGET_DAY)
    : db.prepare(sql).bind(fromTs, toTs);
  const result = await statement.first();
  return Number(result?.rows || 0);
}

for (const database of databases) {
  const db = remoteDb(database);
  const objects = await existingObjects(db);
  const names = new Set(objects.map((row) => String(row.name)));
  const relevant = objects
    .filter((row) => /(queue|track|channel|snapshot|history|archive|legacy|play|stream|station)/i.test(String(row.name)))
    .map((row) => ({ name: row.name, type: row.type }));
  console.log(JSON.stringify({ kind: 'objects', database, relevant }));

  const fromTs = Date.parse(`${TARGET_DAY}T00:00:00Z`);
  const toTs = fromTs + DAY_MS;
  const probes = [];
  for (const [table, column, kind] of knownProbes[database] || []) {
    if (!names.has(table)) {
      probes.push({ table, column, status: 'missing-table' });
      continue;
    }
    const cols = await columns(db, table);
    if (!cols.includes(column)) {
      probes.push({ table, column, status: 'missing-column', columns: cols });
      continue;
    }
    try {
      const rows = await countProbe(db, table, column, kind, fromTs, toTs);
      probes.push({ table, column, rows, status: 'ok' });
    } catch (error) {
      probes.push({ table, column, status: 'error', error: String(error?.message || error).slice(0, 500) });
    }
  }
  console.log(JSON.stringify({ kind: 'counts', database, day: TARGET_DAY, probes }));
}
