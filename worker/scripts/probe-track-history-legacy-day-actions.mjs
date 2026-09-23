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

async function probeMinuteTrackContext(db, fromTs, toTs) {
  const summary = await db.prepare(`SELECT
      COUNT(*) AS fact_rows,
      SUM(CASE WHEN c.fact_id IS NOT NULL THEN 1 ELSE 0 END) AS context_rows,
      SUM(CASE WHEN c.queue_revision_id IS NOT NULL THEN 1 ELSE 0 END) AS revision_rows,
      SUM(CASE WHEN c.queue_position IS NOT NULL THEN 1 ELSE 0 END) AS position_rows,
      COUNT(DISTINCT c.queue_revision_id) AS distinct_revisions,
      SUM(CASE WHEN f.track_detection_code<>0 THEN 1 ELSE 0 END) AS detected_rows,
      SUM(CASE WHEN f.schedule_valid<>0 THEN 1 ELSE 0 END) AS schedule_valid_rows
    FROM sh_minute_facts f
    LEFT JOIN sh_minute_fact_context c ON c.fact_id=f.id
    WHERE f.observed_at>=? AND f.observed_at<?`).bind(fromTs, toTs).first();

  const distributions = await db.prepare(`SELECT
      f.source_code,f.track_detection_code,f.schedule_valid,COUNT(*) AS rows
    FROM sh_minute_facts f
    WHERE f.observed_at>=? AND f.observed_at<?
    GROUP BY f.source_code,f.track_detection_code,f.schedule_valid
    ORDER BY rows DESC`).bind(fromTs, toTs).all();

  const resolved = await db.prepare(`SELECT
      COUNT(*) AS resolved_rows,
      COUNT(DISTINCT COALESCE(i.track_id,0)) AS distinct_track_ids,
      SUM(CASE WHEN t.title IS NOT NULL OR t.artist IS NOT NULL THEN 1 ELSE 0 END) AS named_rows
    FROM sh_minute_facts f
    JOIN sh_minute_fact_context c ON c.fact_id=f.id
    JOIN sh_queue_revision_items i
      ON i.revision_id=c.queue_revision_id AND i.position=c.queue_position
    LEFT JOIN sh_tracks t ON t.id=i.track_id
    WHERE f.observed_at>=? AND f.observed_at<?`).bind(fromTs, toTs).first();

  const tracks = await db.prepare(`SELECT
      i.track_id,t.title,t.artist,i.spotify_id,i.isrc,
      COUNT(*) AS minute_rows,
      MIN(f.minute_at) AS first_minute,
      MAX(f.minute_at) AS last_minute
    FROM sh_minute_facts f
    JOIN sh_minute_fact_context c ON c.fact_id=f.id
    JOIN sh_queue_revision_items i
      ON i.revision_id=c.queue_revision_id AND i.position=c.queue_position
    LEFT JOIN sh_tracks t ON t.id=i.track_id
    WHERE f.observed_at>=? AND f.observed_at<?
    GROUP BY i.track_id,t.title,t.artist,i.spotify_id,i.isrc
    ORDER BY minute_rows DESC,t.title
    LIMIT 100`).bind(fromTs, toTs).all();

  const transitions = await db.prepare(`WITH resolved AS (
      SELECT f.minute_at,c.queue_revision_id,c.queue_position,i.track_id,
        LAG(c.queue_revision_id) OVER (ORDER BY f.minute_at,f.id) AS prev_revision_id,
        LAG(c.queue_position) OVER (ORDER BY f.minute_at,f.id) AS prev_position,
        LAG(i.track_id) OVER (ORDER BY f.minute_at,f.id) AS prev_track_id
      FROM sh_minute_facts f
      JOIN sh_minute_fact_context c ON c.fact_id=f.id
      JOIN sh_queue_revision_items i
        ON i.revision_id=c.queue_revision_id AND i.position=c.queue_position
      WHERE f.observed_at>=? AND f.observed_at<?
    )
    SELECT COUNT(*) AS resolved_minutes,
      SUM(CASE
        WHEN prev_revision_id IS NULL THEN 1
        WHEN queue_revision_id IS NOT prev_revision_id THEN 1
        WHEN queue_position IS NOT prev_position THEN 1
        WHEN track_id IS NOT prev_track_id THEN 1
        ELSE 0 END) AS inferred_play_segments
    FROM resolved`).bind(fromTs, toTs).first();

  return {
    summary,
    distributions: distributions.results || [],
    resolved,
    transitions,
    tracks: tracks.results || [],
  };
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

  if (database === 'stationhead-minute') {
    try {
      const legacyTrackContext = await probeMinuteTrackContext(db, fromTs, toTs);
      console.log(JSON.stringify({ kind: 'minute-track-context', database, day: TARGET_DAY, ...legacyTrackContext }));
    } catch (error) {
      console.log(JSON.stringify({
        kind: 'minute-track-context', database, day: TARGET_DAY,
        status: 'error', error: String(error?.message || error).slice(0, 1000),
      }));
    }
  }
}
