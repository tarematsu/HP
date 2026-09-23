import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { repairTrackHistoryDay } from './repair-track-history-day-actions.mjs';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const DEFAULT_BACKFILL_START = '2026-06-01';
const DEFAULT_BACKFILL_END = '2026-09-22';
const DEFAULT_DELAY_MS = 750;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';

function validDay(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function dayTimestamp(day) {
  return Date.parse(`${day}T00:00:00Z`);
}

export function backfillDays(start = DEFAULT_BACKFILL_START, end = DEFAULT_BACKFILL_END) {
  if (!validDay(start)) throw new Error(`invalid track-history backfill start: ${start}`);
  if (!validDay(end)) throw new Error(`invalid track-history backfill end: ${end}`);
  const from = dayTimestamp(start);
  const to = dayTimestamp(end);
  if (to < from) throw new Error(`track-history backfill end precedes start: ${start}..${end}`);
  const days = [];
  for (let cursor = from; cursor <= to; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

function remoteMinuteDatabase() {
  return createWranglerRemoteD1({
    database: factsDatabase,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.track-history-range-backfill-',
  });
}

async function storedDaySummary(db, day) {
  return db.prepare(`SELECT COUNT(*) AS row_count,
      COALESCE(SUM(CAST(json_extract(row_json,'$.play_count') AS INTEGER)),0) AS total_plays
    FROM sh_pages_track_history_read_model
    WHERE play_date=?`).bind(day).first();
}

function sleep(milliseconds) {
  if (!(milliseconds > 0)) return Promise.resolve();
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function backfillTrackHistoryRange({
  db,
  start = DEFAULT_BACKFILL_START,
  end = DEFAULT_BACKFILL_END,
  delayMs = DEFAULT_DELAY_MS,
  skipExisting = true,
} = {}) {
  if (!db?.prepare) throw new Error('MINUTE_DB adapter is missing');
  const days = backfillDays(start, end);
  const summary = {
    ok: true,
    start,
    end,
    requested_days: days.length,
    generated_days: 0,
    existing_days: 0,
    no_data_days: 0,
    generated_rows: 0,
    generated_plays: 0,
  };

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    if (skipExisting) {
      const stored = await storedDaySummary(db, day);
      const rowCount = Number(stored?.row_count || 0);
      const totalPlays = Number(stored?.total_plays || 0);
      if (rowCount > 0 && totalPlays > 0) {
        summary.existing_days += 1;
        console.log(JSON.stringify({
          ok: true,
          day,
          status: 'existing',
          stored_rows: rowCount,
          stored_total_plays: totalPlays,
        }));
        if (index + 1 < days.length) await sleep(delayMs);
        continue;
      }
    }

    try {
      const result = await repairTrackHistoryDay({ db, day });
      summary.generated_days += 1;
      summary.generated_rows += Number(result?.stored_rows || result?.rows || 0);
      summary.generated_plays += Number(result?.stored_total_plays || result?.total_plays || 0);
      console.log(JSON.stringify({ ...result, status: 'generated' }));
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes(`track-history repair produced no playable rows for ${day}`)) {
        summary.no_data_days += 1;
        console.log(JSON.stringify({ ok: true, day, status: 'no-data' }));
      } else {
        throw new Error(`track-history backfill failed for ${day}: ${message}`, { cause: error });
      }
    }

    if (index + 1 < days.length) await sleep(delayMs);
  }

  console.log(JSON.stringify({ ...summary, status: 'complete' }));
  return summary;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const start = process.env.TRACK_HISTORY_BACKFILL_START || DEFAULT_BACKFILL_START;
  const end = process.env.TRACK_HISTORY_BACKFILL_END || DEFAULT_BACKFILL_END;
  const delayMs = Math.max(0, Number(process.env.TRACK_HISTORY_BACKFILL_DELAY_MS || DEFAULT_DELAY_MS) || 0);
  await backfillTrackHistoryRange({ db: remoteMinuteDatabase(), start, end, delayMs });
}

export {
  DEFAULT_BACKFILL_START,
  DEFAULT_BACKFILL_END,
};
