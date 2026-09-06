-- Preserve the same useful track presentation metadata that the Buddies collector
-- materializes, while keeping sh_sakurazaka46jp_main/raw chat as the canonical raw source.

ALTER TABLE sh_host_queue_items ADD COLUMN title TEXT;
ALTER TABLE sh_host_queue_items ADD COLUMN artist TEXT;
ALTER TABLE sh_host_queue_items ADD COLUMN album_name TEXT;
ALTER TABLE sh_host_queue_items ADD COLUMN thumbnail_url TEXT;

PRAGMA optimize;
