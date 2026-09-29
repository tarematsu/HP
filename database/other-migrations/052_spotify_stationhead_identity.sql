-- Stationhead minute facts already own the canonical ISRC-backed track identity.
-- Keep only its compact integer id beside each Spotify source id; do not duplicate
-- ISRC/title/artist metadata in stationhead-other.
ALTER TABLE sh_spotify_track_aliases
  ADD COLUMN stationhead_track_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_sh_spotify_track_aliases_stationhead
  ON sh_spotify_track_aliases (stationhead_track_id)
  WHERE stationhead_track_id IS NOT NULL;

-- Artist display names are not used by Spotify identity resolution. Keep only
-- sorted Spotify artist IDs in stored track metadata so old rows match the
-- compact representation written by the collector after this migration.
UPDATE sh_spotify_tracks
SET artists_json=COALESCE((
  SELECT json_group_array(artist_id)
  FROM (
    SELECT DISTINCT TRIM(json_extract(artist.value, '$.id')) AS artist_id
    FROM json_each(sh_spotify_tracks.artists_json) AS artist
    WHERE TRIM(COALESCE(json_extract(artist.value, '$.id'), ''))<>''
    ORDER BY artist_id
  )
), '[]')
WHERE json_valid(artists_json)
  AND json_type(artists_json, '$[0]')='object';
