CREATE TABLE IF NOT EXISTS status_counts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_videos INTEGER NOT NULL DEFAULT 0,
  active_mp4_videos INTEGER NOT NULL DEFAULT 0,
  feed_videos INTEGER NOT NULL DEFAULT 0,
  feed_mp4_videos INTEGER NOT NULL DEFAULT 0,
  blocked_videos INTEGER NOT NULL DEFAULT 0,
  death_videos INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO status_counts (
  id, active_videos, active_mp4_videos, feed_videos, feed_mp4_videos,
  blocked_videos, death_videos, updated_at
) VALUES (1, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP);
