const DAY_MS = 86_400_000;

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
    content: '2025年にリリースした曲', tracks: 29,
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00518',
  }],
  ['2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』', {
    content: 'ROCK IN JAPAN FESTIVAL 2026予定セットリスト',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00621',
  }],
]);

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

export const BROADCAST_READ_MODEL_SQL = `SELECT
  event_name,started_at,ended_at,sample_count,
  listener_avg,listener_min,listener_max,likes_max,distinct_tracks,
  host_handle,session_id,1 AS has_data
FROM sh_official_broadcast_summary
WHERE host_handle='sakurazaka46jp' AND started_at>=?1 AND started_at<?2
UNION ALL
SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
  EXISTS(SELECT 1 FROM sh_official_broadcast_summary
    WHERE host_handle='sakurazaka46jp') AS has_data
WHERE NOT EXISTS (
  SELECT 1 FROM sh_official_broadcast_summary
  WHERE host_handle='sakurazaka46jp' AND started_at>=?1 AND started_at<?2
)
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
    const average = row.listener_avg == null || row.listener_avg === '' ? null : Number(row.listener_avg);
    const tracks = row.distinct_tracks == null || row.distinct_tracks === '' ? null : Number(row.distinct_tracks);
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
    return { result, storageSource: 'other.official_broadcast_summary', complete: true };
  } catch (error) {
    if (!/no such table|no such view|no such column/i.test(String(error?.message || ''))) throw error;
    const result = await env.OTHER_DB.prepare(BROADCAST_SUMMARY_SQL)
      .bind(fromTs, toTs, fromTs, toTs).all();
    return { result, storageSource: 'other.official_broadcast_summary', complete: false };
  }
}

export async function loadBroadcastPayload(env, from, to) {
  const fromTs = parseDateStart(from, '2024-06-01');
  const toTs = parseDateStart(to, todayUtcString()) + DAY_MS;
  let loaded;
  try {
    loaded = await queryBroadcastRows(env, fromTs, toTs);
  } catch (error) {
    if (!/no such table|no such view|no such column/i.test(String(error?.message || ''))) throw error;
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
    read_model: loaded.complete ? 'official-listening-parties:v2' : 'official-broadcast-summary:fallback',
    storage_source: loaded.storageSource,
    diagnostic: {
      imported_rows: null,
      imported_events: null,
      first_observed_at: null,
      last_observed_at: null,
    },
  };
}
