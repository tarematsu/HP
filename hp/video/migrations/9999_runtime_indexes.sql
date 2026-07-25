CREATE TABLE IF NOT EXISTS video_orientations (
  canonical_key TEXT PRIMARY KEY,
  orientation TEXT NOT NULL CHECK (
    orientation IN ('vertical', 'horizontal', 'square', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_video_orientations_orientation_key
  ON video_orientations(orientation, canonical_key);

DROP INDEX IF EXISTS idx_videos_status_last_seen;
DROP INDEX IF EXISTS idx_videos_health_queue;

CREATE INDEX IF NOT EXISTS idx_videos_active_last_seen_id
  ON videos(last_seen_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_videos_active_id
  ON videos(id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_collection_runs_method_id
  ON collection_runs(source_method, id DESC);
CREATE INDEX IF NOT EXISTS idx_collection_runs_method_started
  ON collection_runs(source_method, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_runs_incomplete
  ON collection_runs(source_method, started_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collection_runs_period_id
  ON collection_runs(period, id DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status_media_type
  ON videos(status, media_type);
CREATE INDEX IF NOT EXISTS idx_ranking_period_shuffle_v2
  ON ranking_entries(
    period,
    (((video_id % 2147483647) * 1103515245) % 2147483647),
    video_id
  );
