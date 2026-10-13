-- The album collector repeatedly loads four alias attributes by source_track_id.
-- A normal TEXT PRIMARY KEY table first probes its PK index and then fetches
-- the row body. A covering seek avoids that second lookup for each album track.
-- The canonical_track_id index remains necessary for reverse alias lookups.
CREATE INDEX IF NOT EXISTS idx_sh_spotify_track_aliases_source_cover
  ON sh_spotify_track_aliases (
    source_track_id,
    song_key,
    canonical_track_id,
    last_seen_at
  );
