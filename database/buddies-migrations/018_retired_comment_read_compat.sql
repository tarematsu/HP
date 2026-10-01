-- Comment collection and persistence remain retired. Some historical repair
-- readers still query the former minute-count table while reconstructing old
-- minute facts. Keep an empty compatibility table so those reads degrade to
-- missing comment metrics instead of aborting maintenance.
CREATE TABLE IF NOT EXISTS sh_comment_minute_counts (
  station_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  comment_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, bucket_start)
);

-- Deliberately no collection triggers or writers are restored.
