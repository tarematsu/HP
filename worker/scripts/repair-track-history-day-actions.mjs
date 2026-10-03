import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import { mergeTrackRows } from '../../site/functions/lib/track-history-merge.js';
import { applyTrackPeriodCompleteness } from '../../site/functions/lib/period-completeness.js';
import { attachCompactTrackLikes } from '../../site/functions/lib/track-likes.js';
import { PLAYBACK_EVENT_HISTORY_SQL } from '../src/pages-track-history-r2-shards.js';
import { loadDirectRevisionTrackHistoryData } from '../src/track-history-direct-revision-sql.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { publishTrackHistoryR2DayRows } from './sync-track-history-r2-days-actions.mjs';

const DAY_MS = 86_400_000;
const TRACK_HISTORY_LIMIT = 40_000;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';

function validDay(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

export function defaultRepairDay(now = Date.now()) {
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) throw new Error('invalid Track History refresh time');
  const currentDayStart = Math.floor(timestamp / DAY_MS) * DAY_MS;
  return new Date(currentDayStart - DAY_MS).toISOString().slice(0, 10);
}

function remoteDatabase(database, tempPrefix) {
  return createWranglerRemoteD1({
    database,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix,
  });
}

function remoteMinuteDatabase() {
  return remoteDatabase(factsDatabase, '.track-history-day-repair-minute-');
}

function remoteBuddiesDatabase() {
  return remoteDatabase(buddiesDatabase, '.track-history-day-repair-buddies-');
}

async function loadPlaybackEventRows(db, targetDay, fromTs, toTs) {
  if (!db?.prepare) return [];
  try {
    const result = await db.prepare(PLAYBACK_EVENT_HISTORY_SQL)
      .bind(targetDay, fromTs, toTs, TRACK_HISTORY_LIMIT)
      .all();
    return Array.isArray(result?.results) ? result.results : [];
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) return [];
    throw error;
  }
}

async function repairedRows(sourceDb, db, targetDay, generation) {
  const fromTs = Date.parse(`${targetDay}T00:00:00Z`);
  const toTs = fromTs + DAY_MS;
  const [{ result, likeRows }, eventRows] = await Promise.all([
    loadDirectRevisionTrackHistoryData(
      db,
      fromTs,
      toTs,
      TRACK_HISTORY_LIMIT,
      true,
    ),
    loadPlaybackEventRows(sourceDb, targetDay, fromTs, toTs),
  ]);
  const legacyGroupedRows = result.results || [];
  const groupedRows = eventRows.length ? eventRows : legacyGroupedRows;
  if (groupedRows.length > TRACK_HISTORY_LIMIT) {
    throw new Error(`track-history repair exceeded ${TRACK_HISTORY_LIMIT} grouped rows`);
  }
  const combinedRows = [...groupedRows, ...(likeRows || [])];
  const canonicalRows = await canonicalizeTrackRows(db, combinedRows);
  const canonicalGroupedRows = canonicalRows.slice(0, groupedRows.length);
  const canonicalLikeRows = canonicalRows.slice(groupedRows.length);
  const mergedRows = mergeTrackRows(canonicalGroupedRows);
  const likedRows = attachCompactTrackLikes(mergedRows, canonicalLikeRows);
  const completed = applyTrackPeriodCompleteness(
    likedRows,
    eventRows.length ? legacyGroupedRows : canonicalGroupedRows,
    generation,
  );
  const rows = completed.rows.filter((row) => String(row?.play_date || '') === targetDay);
  const totalPlays = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.play_count || 0)), 0);
  if (!rows.length || totalPlays <= 0) {
    throw new Error(`track-history repair produced no playable rows for ${targetDay}`);
  }
  return {
    groupedRows: canonicalGroupedRows,
    completed,
    rows,
    totalPlays,
    source: eventRows.length ? 'playback-events' : 'legacy-reconstruction',
  };
}

export async function repairTrackHistoryDay({
  sourceDb = null,
  db,
  day,
  now = Date.now(),
  publish = publishTrackHistoryR2DayRows,
} = {}) {
  const targetDay = day || defaultRepairDay(now);
  if (!validDay(targetDay)) throw new Error(`invalid track-history repair day: ${targetDay}`);
  if (!db?.prepare) throw new Error('MINUTE_DB adapter is missing');
  const generation = Number(now);
  if (!Number.isFinite(generation) || generation <= 0) throw new Error('invalid repair generation');

  const repaired = await repairedRows(sourceDb, db, targetDay, generation);
  const r2 = await publish({ day: targetDay, rows: repaired.rows, now: generation });
  return {
    ok: true,
    day: targetDay,
    generation,
    source: repaired.source,
    grouped_rows: repaired.groupedRows.length,
    rows: repaired.rows.length,
    total_plays: repaired.totalPlays,
    stored_rows: Number(r2?.rows || repaired.rows.length),
    stored_total_plays: Number(r2?.plays || repaired.totalPlays),
    excluded_dates: repaired.completed.excludedDates,
    storage: 'r2-day',
    r2,
  };
}

export async function refreshTrackHistoryDay({
  sourceDb = remoteBuddiesDatabase(),
  db = remoteMinuteDatabase(),
  day,
  now = Date.now(),
  publish = publishTrackHistoryR2DayRows,
} = {}) {
  const targetDay = day || defaultRepairDay(now);
  const repaired = await repairTrackHistoryDay({
    sourceDb,
    db,
    day: targetDay,
    now,
    publish,
  });
  return {
    ok: true,
    day: targetDay,
    repair: { ...repaired, r2: undefined },
    r2: repaired.r2,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const day = String(process.env.TRACK_HISTORY_REPAIR_DAY || '').trim() || undefined;
  const result = await refreshTrackHistoryDay({ day });
  console.log(JSON.stringify(result));
}
