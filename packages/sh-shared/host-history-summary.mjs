export const HOST_SUMMARY_SQL = `WITH active_session AS (
  SELECT id,handle,station_id,started_at,confirmed_at,ended_at,status,
    peak_listeners,average_listeners,total_listens_start,total_listens_end,
    listener_sample_count,track_count,last_observed_at
  FROM sh_host_broadcast_sessions
  WHERE handle='sakurazaka46jp' AND status IN ('provisional','active')
  ORDER BY started_at DESC
  LIMIT 1
), recent_sessions AS (
  SELECT id,handle,station_id,started_at,confirmed_at,ended_at,status,
    peak_listeners,average_listeners,total_listens_start,total_listens_end,
    listener_sample_count,track_count,last_observed_at
  FROM sh_host_broadcast_sessions
  WHERE handle='sakurazaka46jp'
  ORDER BY started_at DESC
  LIMIT 10
), official_fallback AS (
  SELECT NULL AS id,'sakurazaka46jp' AS handle,NULL AS station_id,
    started_at,started_at AS confirmed_at,ended_at,'completed' AS status,
    listener_max AS peak_listeners,listener_avg AS average_listeners,
    NULL AS total_listens_start,NULL AS total_listens_end,
    sample_count AS listener_sample_count,distinct_tracks AS track_count,
    COALESCE(ended_at,started_at) AS last_observed_at
  FROM sh_official_broadcast_summary
  WHERE host_handle='sakurazaka46jp'
    AND NOT EXISTS (SELECT 1 FROM recent_sessions)
  ORDER BY started_at DESC
  LIMIT 10
)
SELECT 1 AS result_kind,id,handle,station_id,started_at,confirmed_at,ended_at,status,
  peak_listeners,average_listeners,total_listens_start,total_listens_end,
  listener_sample_count,track_count,last_observed_at
FROM active_session
UNION ALL
SELECT 2,id,handle,station_id,started_at,confirmed_at,ended_at,status,
  peak_listeners,average_listeners,total_listens_start,total_listens_end,
  listener_sample_count,track_count,last_observed_at
FROM recent_sessions
UNION ALL
SELECT 2,id,handle,station_id,started_at,confirmed_at,ended_at,status,
  peak_listeners,average_listeners,total_listens_start,total_listens_end,
  listener_sample_count,track_count,last_observed_at
FROM official_fallback
ORDER BY result_kind ASC,started_at DESC`;

function activeSessionFromRow(row) {
  return {
    id: row.id,
    handle: row.handle,
    station_id: row.station_id,
    started_at: row.started_at,
    confirmed_at: row.confirmed_at,
    status: row.status,
    peak_listeners: row.peak_listeners,
    listener_sample_count: row.listener_sample_count,
    track_count: row.track_count,
    last_observed_at: row.last_observed_at,
  };
}

function recentSessionFromRow(row) {
  return {
    id: row.id,
    handle: row.handle,
    station_id: row.station_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
    peak_listeners: row.peak_listeners,
    average_listeners: row.average_listeners,
    total_listens_start: row.total_listens_start,
    total_listens_end: row.total_listens_end,
    track_count: row.track_count,
  };
}

export function parseHostSummaryRows(rows = []) {
  let activeSession = null;
  const recentSessions = [];
  for (const row of rows) {
    const kind = Number(row?.result_kind);
    if (kind === 1 && !activeSession) activeSession = activeSessionFromRow(row);
    else if (kind === 2) recentSessions.push(recentSessionFromRow(row));
  }
  return { activeSession, recentSessions };
}

export async function loadHostSummary(db) {
  const result = await db.prepare(HOST_SUMMARY_SQL).all();
  return parseHostSummaryRows(result?.results || []);
}
