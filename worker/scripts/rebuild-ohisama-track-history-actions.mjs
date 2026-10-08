import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTrackHistoryDayIndex } from '../src/pages-track-history-day-index.js';
import {
  loadTrackHistoryDayReadModel,
  saveTrackHistoryDayReadModel,
} from '../src/pages-track-history-r2-shards.js';
import { OHISAMA_PLAYBACK_HOT_STATE_KEY } from '../src/ohisama-playback.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';

const DAY_MS = 24 * 60 * 60_000;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const config = JSON.parse(readFileSync(join(workerRoot, 'wrangler.ohisama-collector.jsonc'), 'utf8'));
const database = process.env.OHISAMA_DATABASE_NAME
  || config.d1_databases.find((row) => row.binding === 'OHISAMA_DB')?.database_name
  || 'stationhead-ohisama';
const bucketName = process.env.PAGES_RESPONSE_BUCKET
  || config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name
  || 'sh-pages-responses';
const startDay = process.env.OHISAMA_TRACK_HISTORY_REBUILD_START || '2026-10-01';

function validDay(value) {
  const text = String(value || '');
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function dayRange(day) {
  const fromTs = Date.parse(`${day}T00:00:00Z`);
  return { fromTs, toTs: fromTs + DAY_MS };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function rowsFromTracks(day, tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .map((track) => ({
      play_date: day,
      track_id: Number.isFinite(Number(track?.track_id)) ? Math.trunc(Number(track.track_id)) : null,
      spotify_id: String(track?.spotify_id || '').trim() || null,
      title: String(track?.title || '').trim() || null,
      artist: String(track?.artist || '').trim() || null,
      play_count: nonNegativeInteger(track?.count ?? track?.play_count),
    }))
    .filter((track) => track.track_id != null && track.play_count > 0);
}

function tracksFromHotDaily(daily) {
  return Object.values(daily?.tracks || {});
}

function parseTracksJson(value, day) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch (error) {
    throw new Error(`invalid Ohisama daily tracks_json for ${day}: ${error.message}`);
  }
}

function assertTotal(day, rows, expected) {
  const total = rows.reduce((sum, row) => sum + nonNegativeInteger(row.play_count), 0);
  if (total !== nonNegativeInteger(expected)) {
    throw new Error(`Ohisama playback total mismatch for ${day}: rows=${total}, summary=${expected}`);
  }
  return total;
}

async function publishDay(r2, day, tracks, totalPlays, updatedAt) {
  const rows = rowsFromTracks(day, tracks);
  const total = assertTotal(day, rows, totalPlays);
  const result = await saveTrackHistoryDayReadModel(r2, dayRange(day), rows, {
    source: 'ohisama',
    updated_at: Number(updatedAt) || Date.now(),
    source_row_count: total,
  });
  return { ...result, total };
}

export async function rebuildOhisamaTrackHistory({
  db = createWranglerRemoteD1({
    database,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.ohisama-track-history-rebuild-',
  }),
  r2 = createWranglerRemoteR2({
    bucket: bucketName,
    cwd: workerRoot,
    wranglerScript,
  }),
  fromDay = startDay,
} = {}) {
  if (!validDay(fromDay)) throw new Error(`invalid Ohisama rebuild start day: ${fromDay}`);
  const result = await db.prepare(`SELECT period_key,total_plays,unique_tracks,tracks_json,updated_at
    FROM sh_track_daily_summary
    WHERE period_key>=?
    ORDER BY period_key ASC`).bind(fromDay).all();
  const summaries = Array.isArray(result?.results) ? result.results : [];
  const published = [];

  for (const summary of summaries) {
    const day = String(summary?.period_key || '');
    if (!validDay(day)) continue;
    published.push(await publishDay(
      r2,
      day,
      parseTracksJson(summary.tracks_json, day),
      summary.total_plays,
      summary.updated_at,
    ));
  }

  const hotObject = await r2.get(OHISAMA_PLAYBACK_HOT_STATE_KEY);
  const hot = hotObject ? await hotObject.json() : null;
  const daily = hot?.daily;
  if (validDay(daily?.period_key) && daily.period_key >= fromDay) {
    const alreadyPublished = published.some((row) => row.day === daily.period_key);
    if (!alreadyPublished || nonNegativeInteger(daily.total_plays) > published.find((row) => row.day === daily.period_key)?.total) {
      const current = await publishDay(
        r2,
        daily.period_key,
        tracksFromHotDaily(daily),
        daily.total_plays,
        hot.updated_at,
      );
      const index = published.findIndex((row) => row.day === daily.period_key);
      if (index >= 0) published[index] = current;
      else published.push(current);
    }
  }

  published.sort((left, right) => left.day.localeCompare(right.day));
  const index = await loadTrackHistoryDayIndex(r2, 'ohisama');
  for (const row of published) {
    const model = await loadTrackHistoryDayReadModel(r2, row.day, 'ohisama');
    if (!model) throw new Error(`rebuilt Ohisama Track History day missing: ${row.day}`);
    const actual = nonNegativeInteger(model.payload?.source_row_count);
    if (actual !== row.total) {
      throw new Error(`rebuilt Ohisama Track History count mismatch for ${row.day}: ${actual} != ${row.total}`);
    }
  }

  return {
    ok: true,
    source: 'ohisama',
    from: fromDay,
    days: published.length,
    plays: published.reduce((sum, row) => sum + row.total, 0),
    dates: published.map((row) => row.day),
    play_counts: Object.fromEntries(published.map((row) => [row.day, row.total])),
    index_latest_date: index?.latest_date || null,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await rebuildOhisamaTrackHistory();
  console.log(JSON.stringify(result, null, 2));
}
