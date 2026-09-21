-- Final canonical read model for the 2026-09-21 ROCK IN JAPAN FESTIVAL listening party.
-- Live collection ended at 12:16 JST; published history must never depend on the raw
-- collection tables after this migration has materialized the event series.
-- The provisioner replays active OTHER_DB migrations, so the canonical row is only
-- rewritten while the source raw rows still exist. Later raw retention cleanup cannot
-- replace a completed read model with an empty series.

CREATE TABLE IF NOT EXISTS sh_official_broadcast_series (
  host_handle TEXT NOT NULL,
  event_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  points_json TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL,
  PRIMARY KEY(host_handle,event_name)
);
CREATE INDEX IF NOT EXISTS idx_sh_official_series_started
ON sh_official_broadcast_series(host_handle,started_at);

INSERT INTO sh_official_broadcast_series(
  host_handle,event_name,started_at,points_json,source_ref,refreshed_at
)
SELECT
  'sakurazaka46jp',
  '2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』',
  1789958700000,
  COALESCE((
    SELECT json_group_array(json_array(elapsed_minute,listener_count,source_samples))
    FROM (
      SELECT
        CAST((observed_at-1789958700000)/60000 AS INTEGER) AS elapsed_minute,
        ROUND(AVG(listener_count),1) AS listener_count,
        COUNT(*) AS source_samples
      FROM sh_sakurazaka46jp_main
      WHERE observed_at>=1789958700000
        AND observed_at<1789960620000
        AND is_broadcasting=1
        AND listener_count IS NOT NULL
      GROUP BY elapsed_minute
      ORDER BY elapsed_minute ASC
    )
  ),'[]'),
  'stationhead-finalized',
  CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS (
  SELECT 1 FROM sh_sakurazaka46jp_main
  WHERE observed_at>=1789958700000
    AND observed_at<1789960620000
    AND is_broadcasting=1
    AND listener_count IS NOT NULL
)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,
  points_json=excluded.points_json,
  source_ref=excluded.source_ref,
  refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary
SET ended_at=1789960619999,
    ended_jst='2026-09-21 12:16:59',
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

PRAGMA optimize;
