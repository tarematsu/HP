PRAGMA foreign_keys = ON;

-- Repair legacy rows so the base liveness cursor can use the active-video index
-- without scanning entries that are already excluded by block/death lists.
UPDATE videos
   SET status = 'hidden'
 WHERE status = 'active'
   AND EXISTS (
         SELECT 1
           FROM video_blocklist AS blocked
          WHERE blocked.canonical_key = videos.canonical_key
       )
   AND NOT EXISTS (
         SELECT 1
           FROM video_death_list AS death
          WHERE death.canonical_key = videos.canonical_key
       );

UPDATE videos
   SET status = 'dead'
 WHERE status <> 'dead'
   AND EXISTS (
         SELECT 1
           FROM video_death_list AS death
          WHERE death.canonical_key = videos.canonical_key
       );

DROP TRIGGER IF EXISTS video_status_hidden_on_block_insert;
DROP TRIGGER IF EXISTS video_status_restore_on_block_delete;
DROP TRIGGER IF EXISTS video_status_dead_on_death_insert;
DROP TRIGGER IF EXISTS video_status_restore_on_death_delete;

CREATE TRIGGER video_status_hidden_on_block_insert
AFTER INSERT ON video_blocklist
BEGIN
  UPDATE videos
     SET status = 'hidden'
   WHERE canonical_key = NEW.canonical_key
     AND status = 'active';
END;

CREATE TRIGGER video_status_restore_on_block_delete
AFTER DELETE ON video_blocklist
BEGIN
  UPDATE videos
     SET status = 'active'
   WHERE canonical_key = OLD.canonical_key
     AND status = 'hidden'
     AND NOT EXISTS (
           SELECT 1
             FROM video_death_list AS death
            WHERE death.canonical_key = OLD.canonical_key
         );
END;

CREATE TRIGGER video_status_dead_on_death_insert
AFTER INSERT ON video_death_list
BEGIN
  UPDATE videos
     SET status = 'dead'
   WHERE canonical_key = NEW.canonical_key
     AND status <> 'dead';
END;

CREATE TRIGGER video_status_restore_on_death_delete
AFTER DELETE ON video_death_list
BEGIN
  UPDATE videos
     SET status = CASE
       WHEN EXISTS (
         SELECT 1
           FROM video_blocklist AS blocked
          WHERE blocked.canonical_key = OLD.canonical_key
       ) THEN 'hidden'
       ELSE 'active'
     END
   WHERE canonical_key = OLD.canonical_key
     AND status = 'dead';
END;

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260723-video-liveness-eligibility');
