DROP TRIGGER IF EXISTS status_counts_dirty_on_death_insert;
DROP TRIGGER IF EXISTS status_counts_dirty_on_death_delete;

UPDATE status_counts
   SET dirty = 1
 WHERE id = 1;
