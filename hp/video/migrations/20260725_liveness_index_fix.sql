CREATE INDEX IF NOT EXISTS idx_videos_status_id
  ON videos(status, id);

CREATE INDEX IF NOT EXISTS idx_ranking_video_period
  ON ranking_entries(video_id, period);
