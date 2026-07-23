PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS octopus_daily_totals (
  account_number TEXT NOT NULL,
  supply_point TEXT NOT NULL,
  day TEXT NOT NULL,
  energy_kwh REAL NOT NULL CHECK(energy_kwh >= 0),
  slot_count INTEGER NOT NULL CHECK(slot_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_number, supply_point, day)
);

CREATE INDEX IF NOT EXISTS idx_octopus_daily_totals_account_day
  ON octopus_daily_totals(account_number, day, supply_point);

INSERT INTO octopus_daily_totals(
  account_number, supply_point, day, energy_kwh, slot_count, updated_at
)
SELECT account_number,
       supply_point,
       strftime('%Y-%m-%d', observed_at / 1000, 'unixepoch', '+9 hours') AS day,
       SUM(energy_kwh),
       COUNT(*),
       MAX(updated_at)
  FROM octopus_readings
 GROUP BY account_number, supply_point, day
ON CONFLICT(account_number, supply_point, day) DO UPDATE SET
  energy_kwh=excluded.energy_kwh,
  slot_count=excluded.slot_count,
  updated_at=excluded.updated_at;

CREATE TABLE IF NOT EXISTS video_liveness_bounds (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  max_video_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO video_liveness_bounds(id, max_video_id, updated_at)
VALUES(1, COALESCE((SELECT MAX(id) FROM videos), 0), CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  max_video_id=MAX(video_liveness_bounds.max_video_id, excluded.max_video_id),
  updated_at=excluded.updated_at;

CREATE TRIGGER IF NOT EXISTS video_liveness_bound_on_insert
AFTER INSERT ON videos
BEGIN
  UPDATE video_liveness_bounds
     SET max_video_id=MAX(max_video_id, NEW.id),
         updated_at=CURRENT_TIMESTAMP
   WHERE id=1;
END;

CREATE TRIGGER IF NOT EXISTS video_liveness_bound_on_status_active
AFTER UPDATE OF status ON videos
WHEN NEW.status='active'
BEGIN
  UPDATE video_liveness_bounds
     SET max_video_id=MAX(max_video_id, NEW.id),
         updated_at=CURRENT_TIMESTAMP
   WHERE id=1;
END;

DROP TRIGGER IF EXISTS status_counts_dirty_on_block_delete;

CREATE TRIGGER IF NOT EXISTS status_counts_delta_on_block_delete
AFTER DELETE ON video_blocklist
BEGIN
  UPDATE status_counts
     SET active_videos = active_videos + EXISTS (
           SELECT 1 FROM videos AS video
            WHERE video.id=OLD.video_id AND video.status='active'
         ),
         active_mp4_videos = active_mp4_videos + EXISTS (
           SELECT 1 FROM videos AS video
            WHERE video.id=OLD.video_id AND video.status='active' AND video.media_type='mp4'
         ),
         feed_videos = feed_videos + EXISTS (
           SELECT 1 FROM ranking_entries AS ranking
           INNER JOIN videos AS video ON video.id=ranking.video_id
            WHERE ranking.period='24h' AND ranking.video_id=OLD.video_id AND video.status='active'
         ),
         feed_mp4_videos = feed_mp4_videos + EXISTS (
           SELECT 1 FROM ranking_entries AS ranking
           INNER JOIN videos AS video ON video.id=ranking.video_id
            WHERE ranking.period='24h' AND ranking.video_id=OLD.video_id
              AND video.status='active' AND video.media_type='mp4'
         ),
         blocked_videos=MAX(0, blocked_videos-1),
         updated_at=CURRENT_TIMESTAMP,
         dirty=0
   WHERE id=1;
END;

UPDATE status_counts
   SET active_videos=(SELECT COUNT(*) FROM videos WHERE status='active'),
       active_mp4_videos=(SELECT COUNT(*) FROM videos WHERE status='active' AND media_type='mp4'),
       feed_videos=(SELECT COUNT(*) FROM ranking_entries WHERE period='24h'),
       feed_mp4_videos=(
         SELECT COUNT(*) FROM ranking_entries AS ranking
         INNER JOIN videos AS video ON video.id=ranking.video_id
         WHERE ranking.period='24h' AND video.media_type='mp4'
       ),
       blocked_videos=(SELECT COUNT(*) FROM video_blocklist),
       death_videos=(SELECT COUNT(*) FROM video_death_list),
       updated_at=CURRENT_TIMESTAMP,
       dirty=0
 WHERE id=1;

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260723-d1-read-hotspots');
