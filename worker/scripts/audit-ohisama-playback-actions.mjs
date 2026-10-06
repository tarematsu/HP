import { resolve } from 'node:path';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = process.env.OHISAMA_DATABASE_NAME || 'stationhead-ohisama';
const startDay = process.env.OHISAMA_PLAYBACK_AUDIT_START || '2026-10-01';

function remoteDb() {
  return createWranglerRemoteD1({
    database: databaseName,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.ohisama-playback-audit-',
  });
}

function parseEventKey(value) {
  const source = String(value || '');
  const parts = source.split(':');
  if (parts.length < 5) return null;
  const queueId = Number(parts[0]);
  const startTime = Number(parts[1]);
  const position = Number(parts[2]);
  const queueTrackId = Number(parts[3]);
  if (!Number.isInteger(position)) return null;
  return {
    queue_id: Number.isFinite(queueId) ? queueId : null,
    start_time: Number.isFinite(startTime) ? startTime : null,
    position,
    queue_track_id: Number.isFinite(queueTrackId) ? queueTrackId : null,
  };
}

function dayKey(timestamp) {
  return new Date(Math.floor(Number(timestamp) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

const db = remoteDb();
const from = Date.parse(`${startDay}T00:00:00Z`);
if (!Number.isFinite(from)) throw new Error(`invalid audit start day: ${startDay}`);

const [playsResult, summariesResult, factsResult] = await Promise.all([
  db.prepare(`SELECT event_key,played_at,period_key,station_id,track_id,track_key
    FROM sh_track_plays
    WHERE played_at>=?
    ORDER BY played_at ASC,event_key ASC`).bind(from).all(),
  db.prepare(`SELECT period_key,total_plays,unique_tracks,updated_at
    FROM sh_track_daily_summary
    WHERE period_key>=?
    ORDER BY period_key ASC`).bind(startDay).all(),
  db.prepare(`SELECT
      substr(datetime(minute_at/1000,'unixepoch'),1,10) AS day,
      COUNT(*) AS samples,
      MIN(minute_at) AS first_minute_at,
      MAX(minute_at) AS last_minute_at
    FROM sh_minute_facts
    WHERE minute_at>=?
    GROUP BY day
    ORDER BY day ASC`).bind(from).all(),
]);

const plays = Array.isArray(playsResult?.results) ? playsResult.results : [];
const summaries = new Map((summariesResult?.results || []).map((row) => [String(row.period_key), row]));
const facts = new Map((factsResult?.results || []).map((row) => [String(row.day), row]));
const days = new Map();
let previous = null;
let generationBreaks = 0;
let invalidEventKeys = 0;

for (const row of plays) {
  const playedAt = Number(row.played_at);
  const key = String(row.period_key || dayKey(playedAt));
  if (!days.has(key)) days.set(key, {
    day: key,
    observed_plays: 0,
    inferred_gap_plays: 0,
    generation_breaks: 0,
    invalid_event_keys: 0,
    first_played_at: null,
    last_played_at: null,
  });
  const day = days.get(key);
  day.observed_plays += 1;
  day.first_played_at = day.first_played_at == null ? playedAt : Math.min(day.first_played_at, playedAt);
  day.last_played_at = day.last_played_at == null ? playedAt : Math.max(day.last_played_at, playedAt);

  const parsed = parseEventKey(row.event_key);
  if (!parsed) {
    invalidEventKeys += 1;
    day.invalid_event_keys += 1;
    previous = null;
    continue;
  }

  if (previous?.parsed) {
    const sameGeneration = previous.parsed.queue_id === parsed.queue_id
      && previous.parsed.start_time === parsed.start_time
      && previous.row.station_id === row.station_id;
    if (sameGeneration) {
      const jump = parsed.position - previous.parsed.position;
      if (jump > 1) day.inferred_gap_plays += jump - 1;
    } else {
      generationBreaks += 1;
      day.generation_breaks += 1;
    }
  }
  previous = { row, parsed };
}

const output = [...days.values()].map((day) => {
  const summary = summaries.get(day.day) || {};
  const fact = facts.get(day.day) || {};
  return {
    ...day,
    inferred_minimum_plays: day.observed_plays + day.inferred_gap_plays,
    stored_summary_total_plays: Number(summary.total_plays || 0),
    stored_summary_unique_tracks: Number(summary.unique_tracks || 0),
    five_minute_samples: Number(fact.samples || 0),
  };
});

console.log(JSON.stringify({
  ok: true,
  database: databaseName,
  start_day: startDay,
  rows: plays.length,
  generation_breaks: generationBreaks,
  invalid_event_keys: invalidEventKeys,
  days: output,
}, null, 2));
