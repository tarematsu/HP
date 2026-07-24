PRAGMA foreign_keys = ON;

-- D1's production planner did not consistently select the partial
-- idx_videos_active_id index for the bounded liveness cursor. A normal
-- status/id index makes the equality + range access path unambiguous; the
-- runtime query names this index explicitly so production and tests agree.
CREATE INDEX IF NOT EXISTS idx_videos_status_id
  ON videos(status, id);

-- Dead-video removal is keyed by video_id while ranking_entries' primary key
-- starts with period. Keep that maintenance path from scanning the full feed.
CREATE INDEX IF NOT EXISTS idx_ranking_video_period
  ON ranking_entries(video_id, period);

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260725-liveness-index-fix');
