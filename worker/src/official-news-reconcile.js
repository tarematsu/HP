import { promoteJapaneseHourAnnouncements } from './official-news-japanese-time.js';

export const RECONCILE_SUPERSEDED_ANNOUNCEMENTS_SQL = `UPDATE sh_official_news_announcements AS stale
SET status='superseded',updated_at=?
WHERE stale.status='scheduled'
  AND stale.scheduled_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM sh_official_news_monitor_state AS monitor
    WHERE monitor.id='official-news'
      AND monitor.last_success_at IS NOT NULL
      AND monitor.last_success_at=monitor.last_check_at
      AND monitor.last_check_at>=?
  )
  AND EXISTS (
    SELECT 1
    FROM sh_official_news_announcements AS current
    WHERE current.news_id=stale.news_id
      AND current.id<>stale.id
      AND current.status<>'superseded'
      AND current.updated_at>stale.updated_at
  )`;

export const ENDED_READ_MODEL_CANDIDATES_SQL = `SELECT
    a.id,a.event_name,a.scheduled_at,a.first_broadcast_at,a.last_broadcast_at,a.updated_at
  FROM sh_official_news_announcements AS a
  LEFT JOIN sh_official_broadcast_series AS series
    ON series.host_handle='sakurazaka46jp' AND series.event_name=a.event_name
  LEFT JOIN sh_official_broadcast_summary AS summary
    ON summary.host_handle='sakurazaka46jp' AND summary.event_name=a.event_name
  WHERE a.status='ended'
    AND COALESCE(a.first_broadcast_at,a.scheduled_at) IS NOT NULL
    AND a.last_broadcast_at IS NOT NULL
    AND (
      series.event_name IS NULL OR series.refreshed_at<a.updated_at
      OR summary.event_name IS NULL OR summary.ended_at IS NULL OR summary.refreshed_at<a.updated_at
    )
  ORDER BY a.updated_at ASC,a.id ASC
  LIMIT 5`;

export const UPSERT_ENDED_SUMMARY_SQL = `INSERT INTO sh_official_broadcast_summary(
    host_handle,event_name,started_at,ended_at,started_jst,ended_jst,
    sample_count,listener_avg,listener_min,listener_max,likes_max,distinct_tracks,
    comment_count,session_id,refreshed_at
  )
  SELECT 'sakurazaka46jp',?,?,?,?,?,
    COUNT(p.listener_count),AVG(p.listener_count),MIN(p.listener_count),MAX(p.listener_count),NULL,NULL,
    (
      SELECT s.comment_count
      FROM sh_host_broadcast_sessions AS s
      WHERE s.handle='sakurazaka46jp' AND ABS(s.started_at-?)<=900000
      ORDER BY ABS(s.started_at-?),s.id DESC
      LIMIT 1
    ),
    (
      SELECT s.id
      FROM sh_host_broadcast_sessions AS s
      WHERE s.handle='sakurazaka46jp' AND ABS(s.started_at-?)<=900000
      ORDER BY ABS(s.started_at-?),s.id DESC
      LIMIT 1
    ),
    ?
  FROM sh_official_news_station_probes AS p
  WHERE p.announcement_id=?
    AND p.is_broadcasting=1
    AND p.listener_count IS NOT NULL
    AND p.observed_at>=? AND p.observed_at<=?
  ON CONFLICT(host_handle,event_name) DO UPDATE SET
    started_at=excluded.started_at,
    ended_at=excluded.ended_at,
    started_jst=excluded.started_jst,
    ended_jst=excluded.ended_jst,
    sample_count=excluded.sample_count,
    listener_avg=excluded.listener_avg,
    listener_min=excluded.listener_min,
    listener_max=excluded.listener_max,
    likes_max=COALESCE(sh_official_broadcast_summary.likes_max,excluded.likes_max),
    distinct_tracks=COALESCE(sh_official_broadcast_summary.distinct_tracks,excluded.distinct_tracks),
    comment_count=COALESCE(excluded.comment_count,sh_official_broadcast_summary.comment_count),
    session_id=COALESCE(excluded.session_id,sh_official_broadcast_summary.session_id),
    refreshed_at=excluded.refreshed_at`;

export const UPSERT_ENDED_SERIES_SQL = `INSERT INTO sh_official_broadcast_series(
    host_handle,event_name,started_at,points_json,source_ref,refreshed_at
  ) VALUES(
    'sakurazaka46jp',?,?,
    COALESCE((
      SELECT json_group_array(json_array(elapsed_minute,listener_count,source_samples))
      FROM (
        SELECT CAST((p.observed_at-?)/60000 AS INTEGER) AS elapsed_minute,
          ROUND(AVG(p.listener_count),1) AS listener_count,
          COUNT(*) AS source_samples
        FROM sh_official_news_station_probes AS p
        WHERE p.announcement_id=?
          AND p.is_broadcasting=1
          AND p.listener_count IS NOT NULL
          AND p.observed_at>=? AND p.observed_at<=?
        GROUP BY elapsed_minute
        ORDER BY elapsed_minute ASC
      )
    ),'[]'),
    'stationhead-finalized',?
  )
  ON CONFLICT(host_handle,event_name) DO UPDATE SET
    started_at=excluded.started_at,
    points_json=excluded.points_json,
    source_ref=excluded.source_ref,
    refreshed_at=excluded.refreshed_at`;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function jstDateTime(value) {
  const timestamp = finite(value);
  if (timestamp == null) return null;
  return new Date(timestamp + 9 * 60 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

export async function materializeEndedOfficialReadModels(env, completedAt = Date.now()) {
  if (!env?.OTHER_DB?.prepare) return { materialized: 0, skipped: true };
  try {
    const result = await env.OTHER_DB.prepare(ENDED_READ_MODEL_CANDIDATES_SQL).all();
    const candidates = result.results || [];
    let materialized = 0;
    for (const announcement of candidates) {
      const start = finite(announcement.first_broadcast_at) || finite(announcement.scheduled_at);
      const end = finite(announcement.last_broadcast_at);
      if (start == null || end == null || end < start) continue;
      const refreshedAt = Math.max(Number(completedAt) || Date.now(), Number(announcement.updated_at) || 0);
      await env.OTHER_DB.batch([
        env.OTHER_DB.prepare(UPSERT_ENDED_SUMMARY_SQL).bind(
          announcement.event_name,
          start,
          end,
          jstDateTime(start),
          jstDateTime(end),
          start,
          start,
          start,
          start,
          refreshedAt,
          announcement.id,
          start,
          end,
        ),
        env.OTHER_DB.prepare(UPSERT_ENDED_SERIES_SQL).bind(
          announcement.event_name,
          start,
          start,
          announcement.id,
          start,
          end,
          refreshedAt,
        ),
      ]);
      materialized += 1;
    }
    return { materialized, skipped: false };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return { materialized: 0, skipped: true };
    }
    throw error;
  }
}

export async function reconcileSupersededAnnouncements(
  env,
  runStartedAt = Date.now(),
  completedAt = Date.now(),
) {
  if (!env?.OTHER_DB) return { changes: 0, skipped: true };
  try {
    const result = await env.OTHER_DB.prepare(RECONCILE_SUPERSEDED_ANNOUNCEMENTS_SQL)
      .bind(completedAt, runStartedAt)
      .run();
    return {
      changes: Number(result?.meta?.changes || 0),
      skipped: false,
    };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return { changes: 0, skipped: true };
    }
    throw error;
  }
}

export async function reconcileOfficialAnnouncements(
  env,
  runStartedAt = Date.now(),
  completedAt = Date.now(),
) {
  if (!env?.OTHER_DB) return {
    promoted: 0,
    changes: 0,
    read_models: 0,
    skipped: true,
  };
  try {
    const promotion = await promoteJapaneseHourAnnouncements(env, runStartedAt, completedAt);
    const reconciliation = await reconcileSupersededAnnouncements(env, runStartedAt, completedAt);
    const readModels = await materializeEndedOfficialReadModels(env, completedAt);
    return {
      promoted: Number(promotion.promoted || 0),
      changes: Number(reconciliation.changes || 0),
      read_models: Number(readModels.materialized || 0),
      skipped: Boolean(promotion.skipped && reconciliation.skipped && readModels.skipped),
    };
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return { promoted: 0, changes: 0, read_models: 0, skipped: true };
    }
    throw error;
  }
}