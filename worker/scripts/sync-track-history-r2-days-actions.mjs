import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
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

function loadJson(key) {
  const directory = mkdtempSync(join(workerRoot, '.track-history-r2-read-'));
  try {
    const path = join(directory, 'payload.json');
    try {
      wrangler([
        'r2', 'object', 'get', `${responseBucket}/${key}`,
        '--remote', '--file', path,
      ]);
    } catch {
      return null;
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function validDay(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function normalizedDates(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(String)
    .filter(validDay))].sort();
}

function normalizedCounts(value, dates) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowed = new Set(dates);
  const result = {};
  for (const [day, raw] of Object.entries(source)) {
    const count = Number(raw);
    if (allowed.has(day) && Number.isFinite(count) && count >= 0) result[day] = Math.trunc(count);
  }
  return result;
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

async function loadDayRows(db, day) {
  const result = await db.prepare(`SELECT row_json,updated_at
    FROM sh_pages_track_history_read_model
    WHERE play_date=?
    ORDER BY COALESCE(first_played_at,-1) ASC,row_key ASC`).bind(day).all();
  return result.results || [];
}

function dayPayload(day, rows, now, sourceUpdatedAt = 0) {
  const sourceRowCount = rows.reduce(
    (sum, row) => sum + Math.max(0, Number(row?.play_count || 0)),
    0,
  );
  return {
    version: 1,
    day,
    updated_at: Math.max(Number(now) || Date.now(), Number(sourceUpdatedAt) || 0),
    rows,
    source_row_count: sourceRowCount,
    excluded_dates: [],
  };
}

export async function publishTrackHistoryR2DayRows({
  day,
  rows,
  now = Date.now(),
  upload = uploadJson,
  load = loadJson,
} = {}) {
  if (!validDay(day)) throw new Error(`invalid Track History R2 day: ${day}`);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const payload = dayPayload(day, normalizedRows, now);
  const existingIndex = await Promise.resolve(load(TRACK_HISTORY_DAY_INDEX_KEY));
  const dates = new Set(normalizedDates(existingIndex?.dates));
  const counts = normalizedCounts(existingIndex?.play_counts, [...dates]);
  if (normalizedRows.length) {
    dates.add(day);
    counts[day] = payload.source_row_count;
  } else {
    dates.delete(day);
    delete counts[day];
  }
  const normalized = [...dates].sort();
  const index = {
    version: 1,
    updated_at: Math.max(
      Number(existingIndex?.updated_at) || 0,
      Number(payload.updated_at) || Number(now) || Date.now(),
    ),
    dates: normalized,
    latest_date: normalized.at(-1) || null,
    play_counts: normalizedCounts(counts, normalized),
  };
  upload(trackHistoryDayObjectKey(day), payload);
  upload(TRACK_HISTORY_DAY_INDEX_KEY, index);
  return {
    ok: true,
    day,
    rows: payload.rows.length,
    plays: payload.source_row_count,
    latest_date: index.latest_date,
    updated_at: index.updated_at,
  };
}

export async function syncTrackHistoryR2Day({
  db = remoteMinuteDatabase(),
  day,
  now = Date.now(),
  upload = uploadJson,
  load = loadJson,
} = {}) {
  if (!db?.prepare) throw new Error('MINUTE_DB adapter is missing');
  if (!validDay(day)) throw new Error(`invalid Track History R2 sync day: ${day}`);
  const source = await loadDayRows(db, day);
  const rows = await canonicalizeTrackRows(db, source.map((row) => parseRowJson(row, day)));
  return publishTrackHistoryR2DayRows({ day, rows, now, upload, load });
}

async function legacySourceAvailable(db) {
  try {
    const row = await db.prepare(`SELECT 1 AS present FROM sqlite_schema
      WHERE type='table' AND name='sh_pages_track_history_read_model' LIMIT 1`).first();
    return Boolean(row?.present);
  } catch {
    return false;
  }
}

export async function syncTrackHistoryR2Days({ db, now = Date.now(), upload = uploadJson } = {}) {
  if (!db?.prepare) throw new Error('MINUTE_DB adapter is missing');
  if (!(await legacySourceAvailable(db))) {
    return { ok: true, skipped: true, reason: 'legacy-d1-source-retired' };
  }
  const dayResult = await db.prepare(`SELECT play_date,MAX(updated_at) AS updated_at
    FROM sh_pages_track_history_read_model
    GROUP BY play_date
    ORDER BY play_date ASC`).all();
  const dayRows = dayResult.results || [];
  const dates = [];
  const playCounts = {};
  let rowCount = 0;
  let playCount = 0;

  for (const dayRow of dayRows) {
    const day = String(dayRow?.play_date || '');
    if (!validDay(day)) continue;
    const source = await loadDayRows(db, day);
    if (!source.length) continue;
    const rows = await canonicalizeTrackRows(db, source.map((row) => parseRowJson(row, day)));
    const payload = dayPayload(day, rows, now, dayRow?.updated_at);
    upload(trackHistoryDayObjectKey(day), payload);
    dates.push(day);
    playCounts[day] = payload.source_row_count;
    rowCount += payload.rows.length;
    playCount += payload.source_row_count;
  }

  const timestamp = Number(now) || Date.now();
  upload(TRACK_HISTORY_DAY_INDEX_KEY, {
    version: 1,
    updated_at: timestamp,
    dates,
    latest_date: dates.at(-1) || null,
    play_counts: playCounts,
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
