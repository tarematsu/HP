-- Current counter values are already maintained transactionally by
-- trg_sh_track_counter_current. Read the one-row projection instead of scanning
-- the append-only change log, then retire the now-unused occurrence/time index.

DROP INDEX IF EXISTS idx_sh_counter_changes_occurrence_time;

DROP VIEW IF EXISTS sh_queue_items;
CREATE VIEW sh_queue_items AS
SELECT CAST(r.id*1000000+i.position AS INTEGER) AS id,
  r.effective_at AS observed_at,
  r.station_id,
  r.queue_id,
  r.queue_start_time AS start_time,
  i.position,
  i.queue_track_id,
  i.stationhead_track_id,
  i.spotify_id,
  i.deezer_id,
  i.isrc,
  i.duration_ms,
  NULL AS preview_url,
  COALESCE((
    SELECT cc.count_value
    FROM sh_track_counter_current cc
    WHERE cc.occurrence_key='revision:'||CAST(r.id AS TEXT)||':'||CAST(i.position AS TEXT)
  ),i.bite_count) AS bite_count,
  NULL AS raw_json
FROM sh_queue_revisions r
JOIN sh_queue_revision_items i ON i.revision_id=r.id
WHERE r.status='complete'
  AND r.queue_start_time IS NOT NULL
  AND r.id=(
    SELECT latest.id
    FROM sh_queue_revisions latest
    WHERE latest.status='complete'
      AND latest.queue_start_time=r.queue_start_time
      AND latest.channel_id=r.channel_id
      AND COALESCE(latest.station_id,-1)=COALESCE(r.station_id,-1)
    ORDER BY latest.effective_at DESC,latest.id DESC
    LIMIT 1
  );

DROP VIEW IF EXISTS sh_minute_fact_context;
CREATE VIEW sh_minute_fact_context AS
SELECT v.fact_id,
  COALESCE(v.station_id_override,s.station_id) AS station_id,
  COALESCE(v.host_id_override,s.host_id) AS host_id,
  COALESCE(v.broadcast_start_time_override,s.broadcast_start_time) AS broadcast_start_time,
  v.queue_revision_id,r.queue_id,r.queue_start_time,r.item_count AS queue_track_count,
  v.queue_available,i.track_id,
  COALESCE(f.queue_position_patch,v.queue_position) AS queue_position,
  COALESCE((
    SELECT cc.count_value
    FROM sh_track_counter_current cc
    WHERE cc.occurrence_key='revision:'||CAST(v.queue_revision_id AS TEXT)||':'||
      CAST(COALESCE(f.queue_position_patch,v.queue_position) AS TEXT)
  ),i.bite_count) AS track_bite_count
FROM sh_minute_fact_context_v2 v
LEFT JOIN sh_minute_facts f ON f.id=v.fact_id
LEFT JOIN sh_broadcast_sessions s ON s.id=f.broadcast_session_id
LEFT JOIN sh_queue_revisions r ON r.id=v.queue_revision_id
LEFT JOIN sh_queue_revision_items i
  ON i.revision_id=v.queue_revision_id
  AND i.position=COALESCE(f.queue_position_patch,v.queue_position);

ANALYZE sh_track_counter_current;
PRAGMA optimize;
