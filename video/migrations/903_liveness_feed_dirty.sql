ALTER TABLE video_liveness_state
  ADD COLUMN feed_dirty INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS liveness_feed_dirty_on_death_insert
AFTER INSERT ON video_death_list
BEGIN
  UPDATE video_liveness_state SET feed_dirty = 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS liveness_feed_dirty_on_death_delete
AFTER DELETE ON video_death_list
BEGIN
  UPDATE video_liveness_state SET feed_dirty = 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS liveness_preserve_progress_on_error
AFTER UPDATE OF last_error ON video_liveness_state
WHEN NEW.id = 1 AND NEW.last_error IS NOT NULL
BEGIN
  UPDATE video_liveness_state
     SET phase = OLD.phase,
         base_cursor_id = OLD.base_cursor_id,
         base_upper_id = OLD.base_upper_id,
         death_cursor_key = OLD.death_cursor_key,
         death_upper_key = OLD.death_upper_key,
         cycle = OLD.cycle
   WHERE id = NEW.id;
END;
