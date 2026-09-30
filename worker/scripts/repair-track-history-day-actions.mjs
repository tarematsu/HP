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
import { publishTrackHistoryR2DayRows } from './sync-track-history-r2-days-actions.mjs';

const DAY_MS = 86_400_000;
const TRACK_HISTORY_LIMIT = 40_000;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';

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

async function repairedRows(db, targetDay, generation) {
  const fromTs = Date.parse(`${targetDay}T00:00:00Z`);
  const toTs = fromTs + DAY_MS;
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
  const rows = completed.rows.filter((row) => String(row?.play_date || '') === targetDay);
  const totalPlays = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.play_count || 0)), 0);
  if (!rows.length || totalPlays <= 0) {
    throw new Error(`track-history repair produced no playable rows for ${targetDay}`);
  }
  return { groupedRows, completed, rows, totalPlays };
}

export async function repairTrackHistoryDay({
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

  const repaired = await repairedRows(db, targetDay, generation);
  const r2 = await publish({ day: targetDay, rows: repaired.rows, now: generation });
  return {
    ok: true,
    day: targetDay,
    generation,
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
  db = remoteMinuteDatabase(),
  day,
  now = Date.now(),
  publish = publishTrackHistoryR2DayRows,
} = {}) {
  const targetDay = day || defaultRepairDay(now);
  const repaired = await repairTrackHistoryDay({ db, day: targetDay, now, publish });
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
