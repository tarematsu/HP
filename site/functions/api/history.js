import { loadRanking } from '../lib/history-ranking.js';
import {
  SUMMARY_TABLES,
  combineSummaryRows,
  liveSummarySql,
  loadSummaryWithLive,
} from '../lib/history-summary.js';
import { isRealIsoDate } from '../lib/api-utils.js';

export { combineSummaryRows, liveSummarySql, loadSummaryWithLive };

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
  vary: 'accept-encoding',
};
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const HISTORY_CACHE_MAX = 32;
const historyLoadCache = new Map();

const OFFICIAL_BROADCAST_METADATA = new Map([
  ['2024.07.23『YUI KOBAYASHI GRADUATION CONCERT』Stationhead Listening Party', {
    content: '小林由依卒業コンサート DAY2セットリスト', tracks: 20,
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/M01328',
  }],
  ['2024.11.22「4th YEAR ANNIVERSARY LIVE」開催直前！Stationheadリスニングパーティー', {
    content: '3rd YEAR ANNIVERSARY LIVE DAY1・DAY2セットリスト',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/M01519',
  }],
  ['2024.11.25「4th YEAR ANNIVERSARY LIVE」Stationheadリスニングパーティー', {
    content: '4th YEAR ANNIVERSARY LIVE DAY2セットリスト',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/M01523',
  }],
  ['2025.04.30 2nd Album『Addiction』Stationheadリスニングパーティー', {
    content: '2nd Album「Addiction」DISC1全24曲', tracks: 24,
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/M01667',
  }],
  ['2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー', {
    content: '13th Single「Unhappy birthday構文」Special Edition（トラブルで実再生5曲）', tracks: 5,
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/M01853',
  }],
  ['2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』', {
    content: '2025年リリース22曲＋Interlude7曲（全29曲・楽曲尺93分19秒）', tracks: 29,
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00518',
  }],
  ['2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』', {
    content: 'ROCK IN JAPAN FESTIVAL 2026予定セットリスト',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00621',
  }],
]);

function rankingCacheKey(url) {
  const from = url.searchParams.get('from') || '2024-06-01';
  const to = url.searchParams.get('to') || todayUtcString();
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'featured';
  const host = String(url.searchParams.get('host') || '').trim().slice(0, 100).toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5000, 20), 10000);
  return `ranking:v1:${from}:${to}:${scope}:${host}:${limit}`;
}

function promoteCacheEntry(key, entry) {
  historyLoadCache.delete(key);
  historyLoadCache.set(key, entry);
}

export async function cachedHistoryLoad(key, ttlMs, loader, now = Date.now()) {
  const cached = historyLoadCache.get(key);
  if (cached?.expiresAt > now && Object.hasOwn(cached, 'value')) {
    promoteCacheEntry(key, cached);
    return cached.value;
  }
  if (cached?.pending) {
    promoteCacheEntry(key, cached);
    return cached.pending;
  }

  const entry = cached || {};
  entry.pending = Promise.resolve().then(loader).then((value) => {
    entry.value = value;
    entry.expiresAt = Date.now() + ttlMs;
    return value;
  }).catch((error) => {
    historyLoadCache.delete(key);
    throw error;
  }).finally(() => { entry.pending = null; });
  promoteCacheEntry(key, entry);
  while (historyLoadCache.size > HISTORY_CACHE_MAX) historyLoadCache.delete(historyLoadCache.keys().next().value);
  return entry.pending;
}

export function resetHistoryLoadCache() {
  historyLoadCache.clear();
}

async function snapshotResponse(response) {
  return {
    body: await response.text(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
  };
}

function restoreResponse(snapshot) {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

export async function cachedLegacyHistoryResponse(key, ttlMs, loader) {
  try {
    const snapshot = await cachedHistoryLoad(key, ttlMs, async () => {
      const response = await loader();
      const value = await snapshotResponse(response);
      if (!response.ok) {
        const error = new Error(`history response ${response.status}`);
        error.responseSnapshot = value;
        throw error;
      }
      return value;
    });
    return restoreResponse(snapshot);
  } catch (error) {
    if (error?.responseSnapshot) return restoreResponse(error.responseSnapshot);
    throw error;
  }
}

function parseDateStart(value, fallback) {
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : fallback;
  return Date.parse(`${text}T00:00:00Z`);
}

const todayUtcString = () => new Date().toISOString().slice(0, 10);

export const BROADCAST_SUMMARY_SQL = `SELECT
  event_name,started_at,ended_at,sample_count,
  listener_avg,listener_max,likes_max,distinct_tracks,host_handle,1 AS has_data
FROM sh_official_broadcast_summary
WHERE host_handle='sakurazaka46jp' AND started_at>=? AND started_at<?
UNION ALL
SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
  EXISTS(SELECT 1 FROM sh_official_broadcast_summary
    WHERE host_handle='sakurazaka46jp') AS has_data
WHERE NOT EXISTS (
  SELECT 1 FROM sh_official_broadcast_summary
  WHERE host_handle='sakurazaka46jp' AND started_at>=? AND started_at<?
)
ORDER BY started_at ASC`;

export const BROADCAST_READ_MODEL_SQL = `WITH summaries AS (
  SELECT event_name,started_at,ended_at,sample_count,
    listener_avg,listener_max,likes_max,distinct_tracks,host_handle
  FROM sh_official_broadcast_summary
  WHERE host_handle='sakurazaka46jp' AND started_at>=?1 AND started_at<?2
), canonical_metrics AS (
  SELECT series.event_name,
    MIN(CAST(json_extract(point.value,'$[1]') AS REAL)) AS canonical_listener_min,
    AVG(CAST(json_extract(point.value,'$[1]') AS REAL)) AS canonical_listener_avg,
    MAX(CAST(json_extract(point.value,'$[1]') AS REAL)) AS canonical_listener_max
  FROM sh_official_broadcast_series series
  JOIN json_each(series.points_json) point
  WHERE series.host_handle='sakurazaka46jp'
    AND series.started_at>=?1 AND series.started_at<?2
    AND json_extract(point.value,'$[1]') IS NOT NULL
  GROUP BY series.event_name
), session_candidates AS (
  SELECT summaries.event_name,
    sessions.id AS session_id,
    sessions.started_at AS session_started_at,
    sessions.ended_at AS session_ended_at,
    sessions.average_listeners,
    sessions.peak_listeners,
    sessions.track_count,
    sessions.comment_count,
    ROW_NUMBER() OVER (
      PARTITION BY summaries.event_name
      ORDER BY CASE WHEN sessions.id IS NULL THEN 1 ELSE 0 END,
        ABS(COALESCE(sessions.started_at,summaries.started_at)-summaries.started_at),
        sessions.id DESC
    ) AS candidate_rank
  FROM summaries
  LEFT JOIN sh_host_broadcast_sessions sessions
    ON sessions.handle='sakurazaka46jp'
   AND ABS(sessions.started_at-summaries.started_at)<=900000
), selected_sessions AS (
  SELECT * FROM session_candidates WHERE candidate_rank=1
), snapshot_metrics AS (
  SELECT snapshots.session_id,
    MIN(snapshots.listener_count) AS listener_min,
    AVG(snapshots.listener_count) AS snapshot_listener_avg,
    MAX(snapshots.listener_count) AS snapshot_listener_max
  FROM sh_host_station_snapshots snapshots
  JOIN selected_sessions selected ON selected.session_id=snapshots.session_id
  WHERE snapshots.listener_count IS NOT NULL
  GROUP BY snapshots.session_id
)
SELECT summaries.event_name,
  summaries.started_at,
  COALESCE(summaries.ended_at,selected.session_ended_at) AS ended_at,
  summaries.sample_count,
  COALESCE(summaries.listener_avg,selected.average_listeners,canonical.canonical_listener_avg,metrics.snapshot_listener_avg) AS listener_avg,
  COALESCE(canonical.canonical_listener_min,metrics.listener_min) AS listener_min,
  COALESCE(summaries.listener_max,selected.peak_listeners,canonical.canonical_listener_max,metrics.snapshot_listener_max) AS listener_max,
  summaries.likes_max,
  CASE
    WHEN COALESCE(summaries.distinct_tracks,0)>0 THEN summaries.distinct_tracks
    ELSE NULLIF(selected.track_count,0)
  END AS distinct_tracks,
  CASE WHEN selected.session_id IS NULL THEN NULL ELSE selected.comment_count END AS comment_count,
  summaries.host_handle,
  selected.session_id,
  1 AS has_data
FROM summaries
LEFT JOIN canonical_metrics canonical ON canonical.event_name=summaries.event_name
LEFT JOIN selected_sessions selected ON selected.event_name=summaries.event_name
LEFT JOIN snapshot_metrics metrics ON metrics.session_id=selected.session_id
UNION ALL
SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
  EXISTS(SELECT 1 FROM sh_official_broadcast_summary
    WHERE host_handle='sakurazaka46jp') AS has_data
WHERE NOT EXISTS (SELECT 1 FROM summaries)
ORDER BY started_at ASC`;

export function parseBroadcastSummaryRows(resultRows) {
  const rows = [];
  let hasData = false;
  for (const source of resultRows || []) {
    if (Number(source?.has_data) === 1) hasData = true;
    if (source?.event_name == null) continue;
    const { has_data: ignored, ...row } = source;
    const metadata = OFFICIAL_BROADCAST_METADATA.get(String(row.event_name || '').trim());
    if (metadata?.content) row.broadcast_content = metadata.content;
    if (Number.isFinite(metadata?.tracks)) row.distinct_tracks = metadata.tracks;
    row.source_url = metadata?.source_url || null;
    const average = Number(row.listener_avg);
    const tracks = Number(row.distinct_tracks);
    row.estimated_streams = Number.isFinite(average) && Number.isFinite(tracks)
      ? Math.round(average * tracks)
      : null;
    rows.push(row);
  }
  return { rows, setupRequired: rows.length === 0 && !hasData };
}

async function queryBroadcastRows(env, fromTs, toTs) {
  try {
    const result = await env.OTHER_DB.prepare(BROADCAST_READ_MODEL_SQL)
      .bind(fromTs, toTs).all();
    return { result, storageSource: 'other.official_broadcast_read_model', complete: true };
  } catch (error) {
    if (!/no such table|no such view/i.test(String(error?.message || ''))) throw error;
    const result = await env.OTHER_DB.prepare(BROADCAST_SUMMARY_SQL)
      .bind(fromTs, toTs, fromTs, toTs).all();
    return { result, storageSource: 'other.official_broadcast_summary', complete: false };
  }
}

async function loadBroadcastPayload(env, from, to) {
  const fromTs = parseDateStart(from, '2024-06-01');
  const toTs = parseDateStart(to, todayUtcString()) + 86400000;
  let loaded;
  try {
    loaded = await queryBroadcastRows(env, fromTs, toTs);
  } catch (error) {
    if (!/no such table|no such view/i.test(String(error?.message || ''))) throw error;
    return {
      ok: true,
      mode: 'broadcasts',
      from,
      to,
      timezone: 'UTC',
      rows: [],
      setup_required: true,
      read_model_complete: false,
      storage_source: 'summary-only',
      diagnostic: { imported_rows: 0, imported_events: 0, first_observed_at: null, last_observed_at: null },
    };
  }
  const parsed = parseBroadcastSummaryRows(loaded.result.results || []);
  return {
    ok: true,
    mode: 'broadcasts',
    from,
    to,
    timezone: 'UTC',
    rows: parsed.rows,
    setup_required: parsed.setupRequired,
    read_model_complete: loaded.complete,
    read_model: loaded.complete ? 'official-listening-parties:v1' : 'official-broadcast-summary:fallback',
    storage_source: loaded.storageSource,
    diagnostic: {
      imported_rows: null,
      imported_events: null,
      first_observed_at: null,
      last_observed_at: null,
    },
  };
}

async function loadBroadcasts(env, from, to) {
  const payload = await cachedHistoryLoad(
    `broadcasts:v9:${from}:${to}`,
    30000,
    () => loadBroadcastPayload(env, from, to),
  );
  return json(payload, 200, {
    'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'DB binding missing' }, 500, { 'cache-control': 'no-store' });
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'weekly';
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const from = fromParam || '2024-06-01';
  const to = toParam || todayUtcString();
  try {
    if ((fromParam && !isRealIsoDate(fromParam)) || (toParam && !isRealIsoDate(toParam))) {
      return json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, 400, {
        'cache-control': 'no-store',
      });
    }
    if (from > to) {
      return json({ ok: false, error: 'from must not be after to' }, 400, {
        'cache-control': 'no-store',
      });
    }
    if (Object.hasOwn(SUMMARY_TABLES, mode)) {
      const summary = await cachedHistoryLoad(
        `summary:v5:${mode}:${from}:${to}`,
        30000,
        () => loadSummaryWithLive(env, mode, from, to),
      );
      return json({ ok: true, mode, from, to, timezone: 'UTC', ...summary }, 200, {
        'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
      });
    }
    if (mode === 'ranking') {
      if (!env.OTHER_DB) return json({ ok: false, error: 'OTHER_DB binding missing' }, 500, { 'cache-control': 'no-store' });
      return cachedLegacyHistoryResponse(
        rankingCacheKey(url),
        30000,
        () => loadRanking(url, env, loadSummaryWithLive),
      );
    }
    if (mode === 'broadcasts') return loadBroadcasts(env, from, to);
    return json({ ok: false, error: `unsupported history mode: ${mode}` }, 400, { 'cache-control': 'no-store' });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'history error' }, 500, { 'cache-control': 'no-store' });
  }
}