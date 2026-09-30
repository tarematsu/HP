import {
  NOGIZAKA_HANDLE,
  reconcileNogizakaOfficialAnnouncements,
} from './nogizaka-official-news.js';

const ANNOUNCEMENTS = 'sh_nogizaka_official_news_announcements';
const PROBES = 'sh_nogizaka_official_news_station_probes';

function jstDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp + 9 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

async function materializeActiveReadModels(env, completedAt) {
  const result = await env.OTHER_DB.prepare(`SELECT
      a.id,a.event_name,a.scheduled_at,a.first_broadcast_at,a.last_broadcast_at,a.updated_at
    FROM ${ANNOUNCEMENTS} AS a
    LEFT JOIN sh_official_broadcast_series AS series
      ON series.host_handle=? AND series.event_name=a.event_name
    LEFT JOIN sh_official_broadcast_summary AS summary
      ON summary.host_handle=? AND summary.event_name=a.event_name
    WHERE a.status='active'
      AND COALESCE(a.first_broadcast_at,a.scheduled_at) IS NOT NULL
      AND a.last_broadcast_at IS NOT NULL
      AND (
        series.event_name IS NULL OR series.refreshed_at<a.updated_at
        OR summary.event_name IS NULL OR summary.refreshed_at<a.updated_at
        OR summary.ended_at IS NOT NULL
      )
    ORDER BY a.updated_at ASC,a.id ASC LIMIT 5`)
    .bind(NOGIZAKA_HANDLE, NOGIZAKA_HANDLE)
    .all();

  let materialized = 0;
  for (const row of result.results || []) {
    const start = Number(row.first_broadcast_at || row.scheduled_at || 0);
    const sampleEnd = Number(row.last_broadcast_at || 0);
    if (!Number.isFinite(start) || !Number.isFinite(sampleEnd) || start <= 0 || sampleEnd < start) continue;
    const refreshedAt = Math.max(Number(completedAt) || Date.now(), Number(row.updated_at) || 0);
    await env.OTHER_DB.batch([
      env.OTHER_DB.prepare(`INSERT INTO sh_official_broadcast_summary(
          host_handle,event_name,started_at,ended_at,started_jst,ended_jst,
          sample_count,listener_avg,listener_min,listener_max,likes_max,distinct_tracks,
          comment_count,session_id,refreshed_at)
        SELECT ?,?,?,NULL,?,NULL,
          COUNT(p.listener_count),AVG(p.listener_count),MIN(p.listener_count),MAX(p.listener_count),NULL,NULL,
          (SELECT s.comment_count FROM sh_host_broadcast_sessions AS s
            WHERE s.handle=? AND ABS(s.started_at-?)<=900000
            ORDER BY ABS(s.started_at-?),s.id DESC LIMIT 1),
          (SELECT s.id FROM sh_host_broadcast_sessions AS s
            WHERE s.handle=? AND ABS(s.started_at-?)<=900000
            ORDER BY ABS(s.started_at-?),s.id DESC LIMIT 1),
          ?
        FROM ${PROBES} AS p
        WHERE p.announcement_id=? AND p.is_broadcasting=1
          AND p.listener_count IS NOT NULL AND p.observed_at>=? AND p.observed_at<=?
        ON CONFLICT(host_handle,event_name) DO UPDATE SET
          started_at=excluded.started_at,ended_at=NULL,
          started_jst=excluded.started_jst,ended_jst=NULL,
          sample_count=excluded.sample_count,listener_avg=excluded.listener_avg,
          listener_min=excluded.listener_min,listener_max=excluded.listener_max,
          comment_count=COALESCE(excluded.comment_count,sh_official_broadcast_summary.comment_count),
          session_id=COALESCE(excluded.session_id,sh_official_broadcast_summary.session_id),
          refreshed_at=excluded.refreshed_at`)
        .bind(
          NOGIZAKA_HANDLE,
          row.event_name,
          start,
          jstDateTime(start),
          NOGIZAKA_HANDLE,
          start,
          start,
          NOGIZAKA_HANDLE,
          start,
          start,
          refreshedAt,
          row.id,
          start,
          sampleEnd,
        ),
      env.OTHER_DB.prepare(`INSERT INTO sh_official_broadcast_series(
          host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
        VALUES (?,?,?,COALESCE((
          SELECT json_group_array(json_array(elapsed_minute,listener_count,source_samples))
          FROM (
            SELECT CAST((p.observed_at-?)/60000 AS INTEGER) AS elapsed_minute,
              ROUND(AVG(p.listener_count),1) AS listener_count,COUNT(*) AS source_samples
            FROM ${PROBES} AS p
            WHERE p.announcement_id=? AND p.is_broadcasting=1
              AND p.listener_count IS NOT NULL AND p.observed_at>=? AND p.observed_at<=?
            GROUP BY elapsed_minute ORDER BY elapsed_minute ASC
          )
        ),'[]'),'stationhead-live:nogizaka46smej',?)
        ON CONFLICT(host_handle,event_name) DO UPDATE SET
          started_at=excluded.started_at,points_json=excluded.points_json,
          source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at`)
        .bind(
          NOGIZAKA_HANDLE,
          row.event_name,
          start,
          start,
          row.id,
          start,
          sampleEnd,
          refreshedAt,
        ),
    ]);
    materialized += 1;
  }
  return materialized;
}

export async function reconcileNogizakaReadModels(env, runStartedAt, completedAt = Date.now()) {
  if (!env?.OTHER_DB?.prepare) return { skipped: true, read_models: 0, live_read_models: 0 };
  try {
    const liveReadModels = await materializeActiveReadModels(env, completedAt);
    const finalized = await reconcileNogizakaOfficialAnnouncements(env, runStartedAt, completedAt);
    return {
      skipped: finalized?.skipped === true && liveReadModels === 0,
      reason: finalized?.reason ?? null,
      read_models: liveReadModels + Number(finalized?.read_models || 0),
      live_read_models: liveReadModels,
      finalized_read_models: Number(finalized?.read_models || 0),
    };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return { skipped: true, read_models: 0, live_read_models: 0, reason: 'schema-pending' };
    }
    throw error;
  }
}
