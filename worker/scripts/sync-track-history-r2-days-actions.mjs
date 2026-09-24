import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TRACK_HISTORY_DAY_INDEX_KEY,
} from '../src/pages-track-history-day-index.js';
import { trackHistoryDayObjectKey } from '../src/pages-track-history-r2-shards.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function remoteMinuteDatabase() {
  return createWranglerRemoteD1({
    database: factsDatabase,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.track-history-r2-sync-',
  });
}

function uploadJson(key, payload) {
  const directory = mkdtempSync(join(workerRoot, '.track-history-r2-object-'));
  try {
    const path = join(directory, 'payload.json');
    writeFileSync(path, JSON.stringify(payload), 'utf8');
    wrangler([
      'r2', 'object', 'put', `${responseBucket}/${key}`,
      '--remote', '--file', path,
      '--content-type', 'application/json; charset=utf-8',
    ], { capture: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function parseRowJson(row, day) {
  try {
    const parsed = JSON.parse(String(row?.row_json || 'null'));
    if (!parsed || typeof parsed !== 'object') throw new Error('row is not an object');
    return parsed;
  } catch (error) {
    throw new Error(`invalid Track History JSON for ${day}: ${error.message}`);
  }
}

export async function syncTrackHistoryR2Days({ db, now = Date.now(), upload = uploadJson } = {}) {
  if (!db?.prepare) throw new Error('MINUTE_DB adapter is missing');
  const dayResult = await db.prepare(`SELECT play_date,MAX(updated_at) AS updated_at
    FROM sh_pages_track_history_read_model
    GROUP BY play_date
    ORDER BY play_date ASC`).all();
  const dayRows = dayResult.results || [];
  const dates = [];
  let rowCount = 0;
  let playCount = 0;

  for (const dayRow of dayRows) {
    const day = String(dayRow?.play_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const result = await db.prepare(`SELECT row_json,updated_at
      FROM sh_pages_track_history_read_model
      WHERE play_date=?
      ORDER BY COALESCE(first_played_at,-1) ASC,row_key ASC`).bind(day).all();
    const source = result.results || [];
    if (!source.length) continue;
    const rows = source.map((row) => parseRowJson(row, day));
    const sourceRowCount = rows.reduce(
      (sum, row) => sum + Math.max(0, Number(row?.play_count || 0)),
      0,
    );
    const updatedAt = Math.max(
      Number(dayRow?.updated_at) || 0,
      ...source.map((row) => Number(row?.updated_at) || 0),
    );
    upload(trackHistoryDayObjectKey(day), {
      version: 1,
      day,
      updated_at: updatedAt || Number(now) || Date.now(),
      rows,
      source_row_count: sourceRowCount,
      excluded_dates: [],
    });
    dates.push(day);
    rowCount += rows.length;
    playCount += sourceRowCount;
  }

  const timestamp = Number(now) || Date.now();
  upload(TRACK_HISTORY_DAY_INDEX_KEY, {
    version: 1,
    updated_at: timestamp,
    dates,
    latest_date: dates.at(-1) || null,
  });

  return {
    ok: true,
    days: dates.length,
    rows: rowCount,
    plays: playCount,
    latest_date: dates.at(-1) || null,
    updated_at: timestamp,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await syncTrackHistoryR2Days({ db: remoteMinuteDatabase() });
  console.log(JSON.stringify(result));
}
