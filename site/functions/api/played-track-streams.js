import {
  TRACK_HISTORY_GRACE_MS,
  TRACK_HISTORY_SQL,
} from '../lib/track-history-restored-handler.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=21600',
};
const EARLIEST_DATE = '2026-09-10';
const DAY_MS = 86_400_000;
const QUEUE_LOOKBACK_MS = 2 * DAY_MS;
const MAX_RANGE_DAYS = 35;
const MAX_GROUPED_ROWS = 5_000;

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: status >= 400 ? { ...HEADERS, 'cache-control': 'no-store' } : HEADERS,
});

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`played-track-stream SQL rewrite missing ${label}`);
  return source.replace(search, replacement);
}

const QUEUE_STARTS_SQL = `WITH RECURSIVE queue_starts AS (
      SELECT DISTINCT station_id,start_time
      FROM sh_queue_items
      WHERE start_time IS NOT NULL AND start_time < ?
    )`;
const BOUNDED_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_starts AS (
      SELECT DISTINCT station_id,start_time
      FROM sh_queue_items
      WHERE start_time IS NOT NULL AND start_time>=? AND start_time<?
    )`;
const PLAYS_SELECT_SQL = `      SELECT
        strftime('%Y-%m-%d', p.played_at / 1000, 'unixepoch') AS play_date,
        p.played_at,p.position,p.queue_track_id,p.stationhead_track_id,
        p.spotify_id,p.isrc,p.bite_count AS queue_like_count,`;
const PLAYS_SELECT_WITH_LISTENER_KEYS_SQL = `      SELECT
        strftime('%Y-%m-%d', p.played_at / 1000, 'unixepoch') AS play_date,
        p.id AS play_id,p.station_id,p.normalized_duration_ms,
        p.played_at,p.position,p.queue_track_id,p.stationhead_track_id,
        p.spotify_id,p.isrc,p.bite_count AS queue_like_count,`;
const PLAY_DAYS_SQL = `    ), play_days AS (`;
const PLAY_LISTENER_SQL = `    ), play_listener_stats AS (
      SELECT plays.play_id,
        AVG(snapshots.listener_count) AS play_listener_avg,
        COUNT(snapshots.listener_count) AS listener_sample_count
      FROM plays
      LEFT JOIN sh_channel_snapshots snapshots
        ON snapshots.station_id=plays.station_id
       AND snapshots.observed_at>=plays.played_at
       AND snapshots.observed_at<plays.played_at+COALESCE(plays.normalized_duration_ms,0)
       AND snapshots.listener_count IS NOT NULL
      GROUP BY plays.play_id
    ), play_days AS (`;
const COVERAGE_FIELDS_SQL = `      MAX(coverage.period_first_observed_at) AS period_first_observed_at,
      MAX(coverage.period_last_observed_at) AS period_last_observed_at`;
const LISTENER_FIELDS_SQL = `      AVG(play_listener_stats.play_listener_avg) AS listener_avg,
      SUM(COALESCE(play_listener_stats.listener_sample_count,0)) AS listener_sample_count,
      AVG(play_listener_stats.play_listener_avg) * COUNT(*) AS listener_weight,
      MAX(coverage.period_first_observed_at) AS period_first_observed_at,
      MAX(coverage.period_last_observed_at) AS period_last_observed_at`;
const COVERAGE_JOIN_SQL = `    FROM plays
    LEFT JOIN coverage ON coverage.play_date=plays.play_date`;
const LISTENER_JOIN_SQL = `    FROM plays
    LEFT JOIN play_listener_stats ON play_listener_stats.play_id=plays.play_id
    LEFT JOIN coverage ON coverage.play_date=plays.play_date`;

let PLAYED_TRACK_STREAMS_SQL = TRACK_HISTORY_SQL;
PLAYED_TRACK_STREAMS_SQL = replaceRequired(
  PLAYED_TRACK_STREAMS_SQL,
  QUEUE_STARTS_SQL,
  BOUNDED_QUEUE_STARTS_SQL,
  'bounded queue starts',
);
PLAYED_TRACK_STREAMS_SQL = replaceRequired(
  PLAYED_TRACK_STREAMS_SQL,
  PLAYS_SELECT_SQL,
  PLAYS_SELECT_WITH_LISTENER_KEYS_SQL,
  'play listener keys',
);
PLAYED_TRACK_STREAMS_SQL = replaceRequired(
  PLAYED_TRACK_STREAMS_SQL,
  PLAY_DAYS_SQL,
  PLAY_LISTENER_SQL,
  'play listener CTE',
);
PLAYED_TRACK_STREAMS_SQL = replaceRequired(
  PLAYED_TRACK_STREAMS_SQL,
  COVERAGE_FIELDS_SQL,
  LISTENER_FIELDS_SQL,
  'listener result fields',
);
PLAYED_TRACK_STREAMS_SQL = replaceRequired(
  PLAYED_TRACK_STREAMS_SQL,
  COVERAGE_JOIN_SQL,
  LISTENER_JOIN_SQL,
  'listener result join',
);

function playedTrackStreamsStatement(db, fromTs, toTs) {
  return db.prepare(PLAYED_TRACK_STREAMS_SQL).bind(
    Math.max(0, fromTs - QUEUE_LOOKBACK_MS),
    toTs,
    fromTs - TRACK_HISTORY_GRACE_MS, toTs,
    fromTs - TRACK_HISTORY_GRACE_MS, toTs,
    fromTs - TRACK_HISTORY_GRACE_MS, toTs,
    toTs,
    TRACK_HISTORY_GRACE_MS,
    fromTs, toTs,
    fromTs, toTs,
    MAX_GROUPED_ROWS + 1,
  );
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function onRequestGet({ request, env }) {
  if (!env?.DB) return json({ ok: false, error: 'DB binding missing' }, 500);
  const url = new URL(request.url);
  const requestedFrom = url.searchParams.get('from') || EARLIEST_DATE;
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  if (!validDate(requestedFrom) || !validDate(to)) {
    return json({ ok: false, error: 'invalid date range' }, 400);
  }
  const from = requestedFrom < EARLIEST_DATE ? EARLIEST_DATE : requestedFrom;
  const fromTs = Date.parse(`${from}T00:00:00Z`);
  const toTs = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  if (toTs <= fromTs) return json({ ok: false, error: 'invalid date range' }, 400);
  if (toTs - fromTs > MAX_RANGE_DAYS * DAY_MS) {
    return json({ ok: false, error: `date range must be ${MAX_RANGE_DAYS} days or less` }, 400);
  }

  try {
    const result = await playedTrackStreamsStatement(env.DB, fromTs, toTs).all();
    const rawRows = result.results || [];
    const truncated = rawRows.length > MAX_GROUPED_ROWS;
    const rows = rawRows.slice(0, MAX_GROUPED_ROWS).map((row) => ({
      play_date: row.play_date,
      play_count: Math.max(0, Number(row.play_count) || 0),
      stationhead_track_id: row.stationhead_track_id ?? null,
      spotify_id: row.spotify_id || null,
      isrc: row.isrc || null,
      title: row.title || row.display_title || row.raw_title || null,
      artist: row.artist || row.raw_artist || null,
      listener_avg: numberOrNull(row.listener_avg),
      listener_sample_count: Math.max(0, Number(row.listener_sample_count) || 0),
      listener_weight: numberOrNull(row.listener_weight),
    }));
    return json({
      ok: true,
      from,
      to,
      timezone: 'UTC',
      rows,
      truncated,
      method: 'queue-playback-average-listener-weight',
    });
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ''))) {
      return json({ ok: true, from, to, timezone: 'UTC', rows: [], setup_required: true });
    }
    return json({ ok: false, error: error?.message || 'played track streams error' }, 500);
  }
}

export { PLAYED_TRACK_STREAMS_SQL };
