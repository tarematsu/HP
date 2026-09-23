import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import {
  loadTrackHistoryData,
  TRACK_HISTORY_SQL,
} from '../../site/functions/lib/track-history-restored-handler.js';
import { mergeTrackRows } from '../../site/functions/lib/track-history-merge.js';
import { applyTrackPeriodCompleteness } from '../../site/functions/lib/period-completeness.js';
import { attachCompactTrackLikes } from '../../site/functions/lib/track-likes.js';
import { materializedTrackHistorySql } from '../src/pages-track-history-r2-shards.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const TRACK_HISTORY_LIMIT = 40_000;
const DEFAULT_REPAIR_DAY = '2026-09-22';
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';

function validDay(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function remoteMinuteDatabase() {
  return createWranglerRemoteD1({
    database: factsDatabase,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.track-history-day-repair-',
  });
}

function boundedDatabase(db) {
  const boundedSql = materializedTrackHistorySql();
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => target.prepare(sql === TRACK_HISTORY_SQL ? boundedSql : sql);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function trackRowKey(row) {
  return [
    row.play_date || '',
    row.stationhead_track_id ?? '',
    row.isrc || '',
    row.spotify_id || '',
    row.queue_track_id ?? '',
    row.position ?? '',
    row.first_played_at ?? row.played_at ?? '',
  ].join('|');
}

async function ensureReadModelSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS sh_pages_track_history_read_model (
    row_key TEXT PRIMARY KEY,
    play_date TEXT NOT NULL,
    first_played_at INTEGER,
    row_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_pages_track_history_date
    ON sh_pages_track_history_read_model(play_date,first_played_at,row_key)`).run();
}

async function persistDay(db, day, rows, generation) {
  await ensureReadModelSchema(db);
  const statements = rows.map((row) => db.prepare(`INSERT INTO sh_pages_track_history_read_model(
      row_key,play_date,first_played_at,row_json,updated_at
    ) VALUES(?,?,?,?,?) ON CONFLICT(row_key) DO UPDATE SET
      play_date=excluded.play_date,
      first_played_at=excluded.first_played_at,
      row_json=excluded.row_json,
      updated_at=excluded.updated_at`)
    .bind(
      trackRowKey(row),
      row.play_date,
      Number(row.first_played_at || row.played_at || 0) || null,
      JSON.stringify(row),
      generation,
    ));

  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }

  await db.prepare(`DELETE FROM sh_pages_track_history_read_model
    WHERE play_date=? AND updated_at<>?`).bind(day, generation).run();
}

export async function repairTrackHistoryDay({
  db,
  day = DEFAULT_REPAIR_DAY,
  now = Date.now(),
} = {}) {
  if (!validDay(day)) throw new Error(`invalid track-history repair day: ${day}`);
  if (!db?.prepare) throw new Error('MINUTE_DB adapter is missing');

  const fromTs = Date.parse(`${day}T00:00:00Z`);
  const toTs = fromTs + DAY_MS;
  const generation = Number(now);
  if (!Number.isFinite(generation) || generation <= 0) throw new Error('invalid repair generation');

  const { result, likeRows } = await loadTrackHistoryData(
    boundedDatabase(db),
    fromTs,
    toTs,
    TRACK_HISTORY_LIMIT,
    true,
  );
  const groupedRows = result.results || [];
  if (groupedRows.length > TRACK_HISTORY_LIMIT) {
    throw new Error(`track-history repair exceeded ${TRACK_HISTORY_LIMIT} grouped rows`);
  }

  const mergedRows = mergeTrackRows(groupedRows);
  const likedRows = attachCompactTrackLikes(mergedRows, likeRows);
  const completed = applyTrackPeriodCompleteness(likedRows, groupedRows, generation);
  const rows = completed.rows.filter((row) => String(row?.play_date || '') === day);
  const totalPlays = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.play_count || 0)), 0);
  if (!rows.length || totalPlays <= 0) {
    throw new Error(`track-history repair produced no playable rows for ${day}`);
  }

  await persistDay(db, day, rows, generation);
  const stored = await db.prepare(`SELECT COUNT(*) AS row_count,
      COALESCE(SUM(CAST(json_extract(row_json,'$.play_count') AS INTEGER)),0) AS total_plays
    FROM sh_pages_track_history_read_model
    WHERE play_date=?`).bind(day).first();

  return {
    ok: true,
    day,
    generation,
    grouped_rows: groupedRows.length,
    rows: rows.length,
    total_plays: totalPlays,
    stored_rows: Number(stored?.row_count || 0),
    stored_total_plays: Number(stored?.total_plays || 0),
    excluded_dates: completed.excludedDates,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const day = process.env.TRACK_HISTORY_REPAIR_DAY || DEFAULT_REPAIR_DAY;
  const result = await repairTrackHistoryDay({ db: remoteMinuteDatabase(), day });
  console.log(JSON.stringify(result));
}

export { DEFAULT_REPAIR_DAY };
