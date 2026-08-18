PRAGMA foreign_keys = ON;

ALTER TABLE status_counts
  ADD COLUMN total_videos INTEGER NOT NULL DEFAULT 0;

UPDATE status_counts
   SET total_videos=(SELECT COUNT(*) FROM videos),
       updated_at=CURRENT_TIMESTAMP
 WHERE id=1;

DROP TRIGGER IF EXISTS status_counts_on_video_insert;
DROP TRIGGER IF EXISTS status_counts_on_video_delete;

CREATE TRIGGER status_counts_on_video_insert
AFTER INSERT ON videos
BEGIN
  UPDATE status_counts
     SET total_videos=total_videos+1,
         active_videos=active_videos+(NEW.status='active'),
         active_mp4_videos=active_mp4_videos+
           (NEW.status='active' AND NEW.media_type='mp4'),
         updated_at=CURRENT_TIMESTAMP,
         dirty=0
   WHERE id=1;
END;

CREATE TRIGGER status_counts_on_video_delete
BEFORE DELETE ON videos
BEGIN
  UPDATE status_counts
     SET total_videos=MAX(0,total_videos-1),
         active_videos=MAX(0,active_videos-(OLD.status='active')),
         active_mp4_videos=MAX(0,active_mp4_videos-
           (OLD.status='active' AND OLD.media_type='mp4')),
         feed_videos=MAX(0,feed_videos-
           (OLD.status='active')*EXISTS(
             SELECT 1 FROM ranking_entries
              WHERE period='24h' AND video_id=OLD.id
           )),
         feed_mp4_videos=MAX(0,feed_mp4_videos-
           (OLD.status='active' AND OLD.media_type='mp4')*EXISTS(
             SELECT 1 FROM ranking_entries
              WHERE period='24h' AND video_id=OLD.id
           )),
         updated_at=CURRENT_TIMESTAMP,
         dirty=0
   WHERE id=1;
END;

INSERT OR REPLACE INTO schema_meta(key,value)
VALUES('schema_version','20260818-video-status-registration-summary');
