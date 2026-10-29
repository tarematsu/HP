import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import {
  jstDateKey,
  previousDateKey,
  resultsOf,
} from '../src/spotify-playcount-common.js';
import { spotifyDailyFinalizeR2Statement } from '../src/spotify-playcount-daily-write.js';
import { spotifyArtistDailyRefreshStatements } from '../src/spotify-playcount-summary.js';
import { SPOTIFY_TREND_START_DATE } from '../../packages/sh-shared/spotify-read-model.mjs';

export const SPOTIFY_DAILY_DELTA_OUTLIER_THRESHOLD = 5_000_000;

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new TypeError('date must be YYYY-MM-DD');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function spotifyDeltaHistoryRepairDates(outlierDates, startDate, today) {
  const dates = new Set();
  for (const raw of outlierDates || []) {
    const date = String(raw || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDate || date >= today) continue;
    for (const candidate of [shiftDate(date, -1), date, shiftDate(date, 1)]) {
      if (candidate >= startDate && candidate <= today) dates.add(candidate);
    }
  }
  return [...dates].sort();
}

export async function repairSpotifyHistoricalDate(db, snapshotDate, now = Date.now()) {
  const dailyResult = await db.prepare(`SELECT
      daily.track_id,daily.playcount,daily.collected_at,track.album_id
    FROM sh_spotify_playcount_daily daily
    LEFT JOIN sh_spotify_tracks track ON track.track_id=daily.track_id
    WHERE daily.snapshot_date=?
    ORDER BY daily.track_id`)
    .bind(snapshotDate)
    .all();
  const rows = resultsOf(dailyResult);
  if (!rows.length) {
    return { snapshot_date: snapshotDate, input_rows: 0, daily_rows_changed: 0, summary_rows_changed: 0 };
  }

  // Re-run the production finalizer against the already stored observations.
  // Its conditional upserts only write rows whose normalized values actually differ.
  const statements = [
    spotifyDailyFinalizeR2Statement(
      db,
      { snapshot_date: snapshotDate, run_token: `history-repair:${snapshotDate}` },
      previousDateKey(snapshotDate),
      rows,
    ),
    ...spotifyArtistDailyRefreshStatements(db, snapshotDate, now),
  ];
  if (typeof db.script === 'function') {
    // The remote D1 CLI has a command-size limit for batch(). Execute the same
    // write-only statements from a SQL file instead of splitting them into
    // extra remote calls or changing the repair scope.
    await db.script(statements);
    return {
      snapshot_date: snapshotDate,
      input_rows: rows.length,
      daily_rows_changed: null,
      summary_rows_deleted: null,
      summary_rows_changed: null,
      write_mode: 'script',
      write_statements: statements.length,
    };
  }
  const results = await db.batch(statements);
  return {
    snapshot_date: snapshotDate,
    input_rows: rows.length,
    daily_rows_changed: Number(results?.[0]?.meta?.changes || 0),
    summary_rows_deleted: Number(results?.[1]?.meta?.changes || 0),
    summary_rows_changed: Number(results?.[2]?.meta?.changes || 0),
    write_mode: 'batch',
    write_statements: statements.length,
  };
}

export async function runSpotifyDeltaHistoryRepair({
  db,
  today = jstDateKey(Date.now()),
  now = Date.now(),
  threshold = SPOTIFY_DAILY_DELTA_OUTLIER_THRESHOLD,
  logger = (value) => console.log(value),
} = {}) {
  if (!db?.prepare || (typeof db.script !== 'function' && typeof db.batch !== 'function')) {
    throw new Error('Remote Spotify D1 database is required');
  }
  const throughDate = previousDateKey(today);
  const before = resultsOf(await db.prepare(`SELECT snapshot_date,artist_key,total_delta
    FROM sh_spotify_artist_daily
    WHERE snapshot_date>=? AND snapshot_date<=?
      AND total_delta IS NOT NULL AND ABS(total_delta)>=?
    ORDER BY snapshot_date,artist_key`)
    .bind(SPOTIFY_TREND_START_DATE, throughDate, threshold)
    .all());

  if (!before.length) {
    const report = {
      event: 'spotify_delta_history_repair',
      status: 'no-op',
      from_date: SPOTIFY_TREND_START_DATE,
      through_date: throughDate,
      threshold,
      outliers_before: [],
      repair_dates: [],
      repairs: [],
      outliers_after: [],
    };
    logger(JSON.stringify(report));
    return report;
  }

  const repairDates = spotifyDeltaHistoryRepairDates(
    before.map((row) => row.snapshot_date),
    SPOTIFY_TREND_START_DATE,
    today,
  );
  const repairs = [];
  for (const date of repairDates) repairs.push(await repairSpotifyHistoricalDate(db, date, now));

  const after = resultsOf(await db.prepare(`SELECT snapshot_date,artist_key,total_delta
    FROM sh_spotify_artist_daily
    WHERE snapshot_date>=? AND snapshot_date<=?
      AND total_delta IS NOT NULL AND ABS(total_delta)>=?
    ORDER BY snapshot_date,artist_key`)
    .bind(SPOTIFY_TREND_START_DATE, today, threshold)
    .all());
  const writeMode = repairs.some((row) => row.write_mode === 'script') ? 'script' : 'batch';
  // Wrangler's SQL-file execution does not expose per-statement change counts.
  // The post-write outlier query remains the success criterion for that path.
  const changedRows = writeMode === 'script' ? null : repairs.reduce((sum, row) => sum
    + row.daily_rows_changed + row.summary_rows_deleted + row.summary_rows_changed, 0);
  const report = {
    event: 'spotify_delta_history_repair',
    status: after.length ? 'remaining-outliers' : 'repaired',
    from_date: SPOTIFY_TREND_START_DATE,
    through_date: today,
    threshold,
    outliers_before: before,
    repair_dates: repairDates,
    repairs,
    write_mode: writeMode,
    changed_rows: changedRows,
    outliers_after: after,
  };
  logger(JSON.stringify(report));
  if (after.length) {
    throw new Error(`Spotify daily-delta outliers remain after historical re-finalization: ${JSON.stringify(after)}`);
  }
  if (changedRows === 0) {
    throw new Error('Outlier summaries were found but no stored values changed; refusing to report a successful repair');
  }
  return report;
}

async function main() {
  const workerRoot = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(workerRoot, 'wrangler.spotify-playcount.jsonc'), 'utf8'));
  const database = config.d1_databases.find((row) => row.binding === 'OTHER_DB')?.database_name;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token || !database) throw new Error('Spotify historical repair configuration is missing');

  const db = createWranglerRemoteD1({
    database,
    cwd: workerRoot,
    wranglerScript: join(workerRoot, 'node_modules/wrangler/bin/wrangler.js'),
    tempPrefix: '.spotify-delta-history-repair-',
  });
  const report = await runSpotifyDeltaHistoryRepair({ db });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `repaired=${report.status === 'repaired' ? 'true' : 'false'}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
