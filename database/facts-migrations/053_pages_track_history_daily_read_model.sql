-- Materialize per-day play totals so public Pages requests never need to
-- json_extract and aggregate the track-history row payloads.
CREATE TABLE IF NOT EXISTS sh_pages_track_history_daily_read_model (
  play_date TEXT PRIMARY KEY,
  play_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT INTO sh_pages_track_history_daily_read_model(play_date,play_count,row_count,updated_at)
SELECT
  play_date,
  COALESCE(SUM(CASE
    WHEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)>0
      THEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)
    ELSE 1
  END),0) AS play_count,
  COUNT(*) AS row_count,
  COALESCE(MAX(updated_at),0) AS updated_at
FROM sh_pages_track_history_read_model
GROUP BY play_date
ON CONFLICT(play_date) DO UPDATE SET
  play_count=excluded.play_count,
  row_count=excluded.row_count,
  updated_at=excluded.updated_at;
