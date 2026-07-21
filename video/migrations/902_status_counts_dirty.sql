ALTER TABLE status_counts
  ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER IF NOT EXISTS status_counts_dirty_on_block_insert
AFTER INSERT ON video_blocklist
BEGIN
  UPDATE status_counts SET dirty = 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS status_counts_dirty_on_block_delete
AFTER DELETE ON video_blocklist
BEGIN
  UPDATE status_counts SET dirty = 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS status_counts_dirty_on_death_insert
AFTER INSERT ON video_death_list
BEGIN
  UPDATE status_counts SET dirty = 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS status_counts_dirty_on_death_delete
AFTER DELETE ON video_death_list
BEGIN
  UPDATE status_counts SET dirty = 1 WHERE id = 1;
END;
