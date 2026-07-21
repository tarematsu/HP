DROP TRIGGER IF EXISTS status_counts_dirty_on_block_insert;

CREATE TRIGGER IF NOT EXISTS status_counts_delta_on_block_insert
AFTER INSERT ON video_blocklist
BEGIN
  UPDATE status_counts
     SET active_videos = MAX(0, active_videos - EXISTS (
           SELECT 1 FROM videos AS video
            WHERE video.id = NEW.video_id
              AND video.status = 'active'
         )),
         active_mp4_videos = MAX(0, active_mp4_videos - EXISTS (
           SELECT 1 FROM videos AS video
            WHERE video.id = NEW.video_id
              AND video.status = 'active'
              AND video.media_type = 'mp4'
         )),
         feed_videos = MAX(0, feed_videos - EXISTS (
           SELECT 1 FROM ranking_entries AS ranking
            WHERE ranking.period = '24h'
              AND ranking.video_id = NEW.video_id
         )),
         feed_mp4_videos = MAX(0, feed_mp4_videos - EXISTS (
           SELECT 1
             FROM ranking_entries AS ranking
             INNER JOIN videos AS video ON video.id = ranking.video_id
            WHERE ranking.period = '24h'
              AND ranking.video_id = NEW.video_id
              AND video.media_type = 'mp4'
         )),
         blocked_videos = blocked_videos + 1,
         updated_at = NEW.blocked_at
   WHERE id = 1;
END;

UPDATE status_counts
   SET dirty = 1
 WHERE id = 1;
