-- Pages uses sh_tracks.id as the only canonical song identity. Provider IDs
-- remain aliases/source metadata and must not become independent Pages keys.

DROP VIEW IF EXISTS sh_queue_items;
DROP VIEW IF EXISTS sh_track_like_observations;
DROP VIEW IF EXISTS sh_track_like_current;

CREATE VIEW sh_queue_items AS
WITH ranked_revisions AS (
  SELECT r.*,
    ROW_NUMBER() OVER (
      PARTITION BY r.channel_id,COALESCE(r.station_id,-1),r.queue_start_time
      ORDER BY r.effective_at DESC,r.id DESC
    ) AS revision_rank
  FROM sh_queue_revisions r
  WHERE r.status='complete'
    AND r.queue_start_time IS NOT NULL
)
SELECT CAST(r.id*1000000+i.position AS INTEGER) AS id,
  r.effective_at AS observed_at,
  r.station_id,
  r.queue_id,
  r.queue_start_time AS start_time,
  i.position,
  i.track_id,
  i.queue_track_id,
  i.stationhead_track_id,
  i.spotify_id,
  i.deezer_id,
  i.isrc,
  i.duration_ms,
  NULL AS preview_url,
  COALESCE((
    SELECT cc.count_value
    FROM sh_track_counter_changes cc
    WHERE cc.occurrence_key='revision:'||CAST(r.id AS TEXT)||':'||CAST(i.position AS TEXT)
    ORDER BY cc.observed_at DESC,cc.id DESC
    LIMIT 1
  ),i.bite_count) AS bite_count,
  NULL AS raw_json
FROM ranked_revisions r
JOIN sh_queue_revision_items i ON i.revision_id=r.id
WHERE r.revision_rank=1;

CREATE VIEW sh_track_like_observations AS
SELECT c.id AS source_id,c.id,c.observed_at,c.station_id,c.queue_id,
  c.queue_start_time AS start_time,c.queue_position AS position,c.track_id,c.queue_track_id,
  c.stationhead_track_id,c.spotify_id,c.isrc,
  c.track_key,c.count_value AS like_count,c.source,NULL AS raw_json
FROM sh_track_counter_changes c;

CREATE VIEW sh_track_like_current AS
WITH ranked AS (
  SELECT c.*,
    ROW_NUMBER() OVER(PARTITION BY c.station_id,c.track_key
      ORDER BY c.observed_at DESC,c.change_id DESC) AS row_rank
  FROM sh_track_counter_current c
)
SELECT station_id,track_key,track_id,queue_id,queue_start_time AS start_time,queue_position AS position,
  queue_track_id,stationhead_track_id,spotify_id,isrc,
  count_value AS like_count,observed_at
FROM ranked WHERE row_rank=1;

-- The first-week comparison is a release-window read model, but releases are
-- songs too. Store their sh_tracks.id so every Pages song-bearing payload has
-- the same canonical identity.
ALTER TABLE sh_first_week_comparison_read_model ADD COLUMN track_id INTEGER;

INSERT OR IGNORE INTO sh_first_week_comparison_read_model(
  release_date_jst,start_at,end_at,point_count,points_json,updated_at,track_id
) VALUES
  ('2026-02-12',unixepoch('2026-02-11 15:00:00')*1000,unixepoch('2026-02-18 15:00:00')*1000,0,'[]',unixepoch()*1000,NULL),
  ('2026-04-19',unixepoch('2026-04-18 15:00:00')*1000,unixepoch('2026-04-25 15:00:00')*1000,0,'[]',unixepoch()*1000,NULL),
  ('2026-05-19',unixepoch('2026-05-18 15:00:00')*1000,unixepoch('2026-05-25 15:00:00')*1000,0,'[]',unixepoch()*1000,NULL);

UPDATE sh_first_week_comparison_read_model AS releases
SET track_id=(
  SELECT metadata.track_id
  FROM sh_track_canonical_metadata AS metadata
  WHERE metadata.track_id IS NOT NULL
    AND metadata.artist LIKE '櫻坂%'
    AND metadata.title=CASE releases.release_date_jst
      WHEN '2024-09-25' THEN 'I want tomorrow to come'
      WHEN '2025-01-28' THEN 'UDAGAWA GENERATION'
      WHEN '2025-05-30' THEN 'Make or Break'
      WHEN '2025-10-16' THEN 'Unhappy birthday構文'
      WHEN '2026-02-12' THEN 'The growing up train'
      WHEN '2026-04-19' THEN 'What''s “KAZOKU”?'
      WHEN '2026-05-19' THEN 'Lonesome rabbit'
      WHEN '2026-09-17' THEN '愛MUST BE'
      ELSE NULL
    END
  ORDER BY metadata.track_id
  LIMIT 1
)
WHERE releases.release_date_jst IN (
  '2024-09-25','2025-01-28','2025-05-30','2025-10-16',
  '2026-02-12','2026-04-19','2026-05-19','2026-09-17'
);

PRAGMA optimize;
