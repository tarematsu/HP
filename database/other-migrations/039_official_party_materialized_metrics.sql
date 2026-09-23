ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL;
ALTER TABLE sh_official_broadcast_summary ADD COLUMN comment_count INTEGER;
ALTER TABLE sh_official_broadcast_summary ADD COLUMN session_id INTEGER;

-- Materialize the canonical minimum once from the stored official-party time series.
UPDATE sh_official_broadcast_summary AS summary
SET listener_min = (
  SELECT MIN(CAST(json_extract(point.value,'$[1]') AS REAL))
  FROM sh_official_broadcast_series AS series
  JOIN json_each(series.points_json) AS point
  WHERE series.host_handle=summary.host_handle
    AND series.event_name=summary.event_name
    AND json_extract(point.value,'$[1]') IS NOT NULL
)
WHERE summary.host_handle='sakurazaka46jp';

-- Resolve the nearest captured Stationhead session once so Pages does not need
-- to scan session/snapshot tables on every official-party request.
UPDATE sh_official_broadcast_summary AS summary
SET session_id = (
  SELECT sessions.id
  FROM sh_host_broadcast_sessions AS sessions
  WHERE sessions.handle=summary.host_handle
    AND summary.started_at IS NOT NULL
    AND ABS(sessions.started_at-summary.started_at)<=900000
  ORDER BY ABS(sessions.started_at-summary.started_at),sessions.id DESC
  LIMIT 1
)
WHERE summary.host_handle='sakurazaka46jp';

UPDATE sh_official_broadcast_summary AS summary
SET
  ended_at=COALESCE(
    summary.ended_at,
    (SELECT sessions.ended_at FROM sh_host_broadcast_sessions AS sessions WHERE sessions.id=summary.session_id)
  ),
  listener_avg=COALESCE(
    summary.listener_avg,
    (SELECT sessions.average_listeners FROM sh_host_broadcast_sessions AS sessions WHERE sessions.id=summary.session_id)
  ),
  listener_min=COALESCE(
    summary.listener_min,
    (SELECT MIN(snapshots.listener_count)
     FROM sh_host_station_snapshots AS snapshots
     WHERE snapshots.session_id=summary.session_id AND snapshots.listener_count IS NOT NULL)
  ),
  listener_max=COALESCE(
    summary.listener_max,
    (SELECT sessions.peak_listeners FROM sh_host_broadcast_sessions AS sessions WHERE sessions.id=summary.session_id),
    (SELECT MAX(snapshots.listener_count)
     FROM sh_host_station_snapshots AS snapshots
     WHERE snapshots.session_id=summary.session_id AND snapshots.listener_count IS NOT NULL)
  ),
  distinct_tracks=COALESCE(
    NULLIF(summary.distinct_tracks,0),
    NULLIF((SELECT sessions.track_count FROM sh_host_broadcast_sessions AS sessions WHERE sessions.id=summary.session_id),0)
  ),
  comment_count=COALESCE(
    summary.comment_count,
    (SELECT sessions.comment_count FROM sh_host_broadcast_sessions AS sessions WHERE sessions.id=summary.session_id)
  )
WHERE summary.host_handle='sakurazaka46jp';
