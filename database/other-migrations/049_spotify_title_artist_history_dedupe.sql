-- Re-key historical Spotify tracks with the duration-independent identity used by
-- the collector: normalized title + sorted credited Spotify artist IDs. Migration
-- 048 can only collapse rows whose aliases already share a canonical ID; this
-- follow-up also catches single/album variants that were previously split solely
-- because their durations differ.

DROP TABLE IF EXISTS sh_spotify_history_dedupe_map;
DROP TABLE IF EXISTS sh_spotify_history_dedupe_affected;

CREATE TABLE sh_spotify_history_dedupe_map (
  source_track_id TEXT PRIMARY KEY,
  canonical_track_id TEXT NOT NULL,
  song_key TEXT NOT NULL
);

CREATE TABLE sh_spotify_history_dedupe_affected (
  snapshot_date TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  PRIMARY KEY (snapshot_date,artist_key)
);

WITH track_identity AS (
  SELECT
    track.track_id,
    'song:v1:' ||
      lower(trim(track.name)) ||
      char(31) ||
      COALESCE((
        SELECT group_concat(artist_id, ',')
        FROM (
          SELECT DISTINCT trim(COALESCE(
            json_extract(
              CASE WHEN artist.type='object' THEN artist.value ELSE '{}' END,
              '$.id'
            ),
            ''
          )) AS artist_id
          FROM json_each(
            CASE
              WHEN json_valid(track.artists_json) THEN track.artists_json
              ELSE '[]'
            END
          ) AS artist
          WHERE trim(COALESCE(
            json_extract(
              CASE WHEN artist.type='object' THEN artist.value ELSE '{}' END,
              '$.id'
            ),
            ''
          ))<>''
          ORDER BY artist_id
        )
      ), '') AS song_key
  FROM sh_spotify_tracks AS track
  WHERE trim(track.name)<>''
    AND json_valid(track.artists_json)
    AND EXISTS (
      SELECT 1
      FROM json_each(
        CASE
          WHEN json_valid(track.artists_json) THEN track.artists_json
          ELSE '[]'
        END
      ) AS artist
      WHERE trim(COALESCE(
        json_extract(
          CASE WHEN artist.type='object' THEN artist.value ELSE '{}' END,
          '$.id'
        ),
        ''
      ))<>''
    )
),
duplicate_groups AS (
  SELECT song_key,MIN(track_id) AS canonical_track_id
  FROM track_identity
  GROUP BY song_key
  HAVING COUNT(*)>1
)
INSERT INTO sh_spotify_history_dedupe_map (
  source_track_id,canonical_track_id,song_key
)
SELECT identity.track_id,groups.canonical_track_id,identity.song_key
FROM track_identity AS identity
INNER JOIN duplicate_groups AS groups ON groups.song_key=identity.song_key;

-- Publish the new duration-independent identity before touching facts so future
-- collector runs keep using the same canonical track selected by this cleanup.
INSERT INTO sh_spotify_song_identities (
  song_key,canonical_track_id,created_at,updated_at
)
SELECT
  map.song_key,
  map.canonical_track_id,
  MIN(track.updated_at),
  MAX(track.updated_at)
FROM sh_spotify_history_dedupe_map AS map
INNER JOIN sh_spotify_tracks AS track ON track.track_id=map.source_track_id
GROUP BY map.song_key,map.canonical_track_id
ON CONFLICT(song_key) DO UPDATE SET
  canonical_track_id=excluded.canonical_track_id,
  updated_at=MAX(sh_spotify_song_identities.updated_at,excluded.updated_at);

INSERT INTO sh_spotify_track_aliases (
  source_track_id,song_key,canonical_track_id,first_seen_at,last_seen_at
)
SELECT
  map.source_track_id,
  map.song_key,
  map.canonical_track_id,
  COALESCE(alias.first_seen_at,track.updated_at),
  MAX(COALESCE(alias.last_seen_at,0),track.updated_at)
FROM sh_spotify_history_dedupe_map AS map
INNER JOIN sh_spotify_tracks AS track ON track.track_id=map.source_track_id
LEFT JOIN sh_spotify_track_aliases AS alias ON alias.source_track_id=map.source_track_id
WHERE 1=1
ON CONFLICT(source_track_id) DO UPDATE SET
  song_key=excluded.song_key,
  canonical_track_id=excluded.canonical_track_id,
  first_seen_at=MIN(sh_spotify_track_aliases.first_seen_at,excluded.first_seen_at),
  last_seen_at=MAX(sh_spotify_track_aliases.last_seen_at,excluded.last_seen_at);

INSERT OR IGNORE INTO sh_spotify_track_targets (track_id,artist_key)
SELECT DISTINCT map.canonical_track_id,target.artist_key
FROM sh_spotify_history_dedupe_map AS map
INNER JOIN sh_spotify_track_targets AS target ON target.track_id=map.source_track_id;

DELETE FROM sh_spotify_track_targets
WHERE track_id IN (
  SELECT source_track_id
  FROM sh_spotify_history_dedupe_map
  WHERE source_track_id<>canonical_track_id
);

-- Keep the maximum published cumulative count for each song/day, then recalculate
-- deltas from the physically consolidated history.
INSERT INTO sh_spotify_playcount_daily (
  snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
)
SELECT
  daily.snapshot_date,
  map.canonical_track_id,
  MAX(daily.playcount),
  NULL,
  MAX(daily.collected_at),
  MIN(daily.is_carried_forward)
FROM sh_spotify_playcount_daily AS daily
INNER JOIN sh_spotify_history_dedupe_map AS map ON map.source_track_id=daily.track_id
GROUP BY daily.snapshot_date,map.canonical_track_id
ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
  playcount=MAX(sh_spotify_playcount_daily.playcount,excluded.playcount),
  delta=NULL,
  collected_at=MAX(sh_spotify_playcount_daily.collected_at,excluded.collected_at),
  is_carried_forward=MIN(
    sh_spotify_playcount_daily.is_carried_forward,
    excluded.is_carried_forward
  );

DELETE FROM sh_spotify_playcount_daily
WHERE track_id IN (
  SELECT source_track_id
  FROM sh_spotify_history_dedupe_map
  WHERE source_track_id<>canonical_track_id
);

UPDATE sh_spotify_playcount_daily
SET delta=playcount-(
  SELECT previous.playcount
  FROM sh_spotify_playcount_daily AS previous
  WHERE previous.track_id=sh_spotify_playcount_daily.track_id
    AND previous.snapshot_date=date(sh_spotify_playcount_daily.snapshot_date,'-1 day')
)
WHERE track_id IN (
  SELECT DISTINCT canonical_track_id FROM sh_spotify_history_dedupe_map
);

-- Preserve an in-flight active collection by moving any duplicate candidate to
-- the same canonical ID instead of letting finalization see the old source ID.
INSERT INTO sh_spotify_playcount_candidates (
  snapshot_date,run_token,track_id,album_id,playcount,collected_at
)
SELECT
  candidate.snapshot_date,
  candidate.run_token,
  map.canonical_track_id,
  candidate.album_id,
  candidate.playcount,
  candidate.collected_at
FROM sh_spotify_playcount_candidates AS candidate
INNER JOIN sh_spotify_history_dedupe_map AS map ON map.source_track_id=candidate.track_id
INNER JOIN sh_spotify_collection_runs AS run
  ON run.snapshot_date=candidate.snapshot_date
 AND run.run_token=candidate.run_token
WHERE map.source_track_id<>map.canonical_track_id
ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
  run_token=excluded.run_token,
  album_id=CASE
    WHEN excluded.playcount>=sh_spotify_playcount_candidates.playcount
    THEN excluded.album_id ELSE sh_spotify_playcount_candidates.album_id END,
  playcount=MAX(sh_spotify_playcount_candidates.playcount,excluded.playcount),
  collected_at=MAX(sh_spotify_playcount_candidates.collected_at,excluded.collected_at);

DELETE FROM sh_spotify_playcount_candidates
WHERE track_id IN (
  SELECT source_track_id
  FROM sh_spotify_history_dedupe_map
  WHERE source_track_id<>canonical_track_id
);

DELETE FROM sh_spotify_playcount_current
WHERE track_id IN (
  SELECT source_track_id FROM sh_spotify_history_dedupe_map
)
OR track_id IN (
  SELECT canonical_track_id FROM sh_spotify_history_dedupe_map
);

INSERT INTO sh_spotify_playcount_current (
  track_id,playcount,snapshot_date,collected_at
)
SELECT
  daily.track_id,
  daily.playcount,
  daily.snapshot_date,
  daily.collected_at
FROM sh_spotify_playcount_daily AS daily
INNER JOIN (
  SELECT track_id,MAX(snapshot_date) AS snapshot_date
  FROM sh_spotify_playcount_daily
  WHERE track_id IN (
    SELECT DISTINCT canonical_track_id FROM sh_spotify_history_dedupe_map
  )
  GROUP BY track_id
) AS latest
  ON latest.track_id=daily.track_id
 AND latest.snapshot_date=daily.snapshot_date
WHERE 1=1
ON CONFLICT(track_id) DO UPDATE SET
  playcount=excluded.playcount,
  snapshot_date=excluded.snapshot_date,
  collected_at=excluded.collected_at;

-- Only artist/day summaries touched by a re-keyed song need rebuilding. This
-- avoids a second full-history summary rewrite after migration 048.
INSERT OR IGNORE INTO sh_spotify_history_dedupe_affected (snapshot_date,artist_key)
SELECT DISTINCT daily.snapshot_date,target.artist_key
FROM sh_spotify_playcount_daily AS daily
INNER JOIN sh_spotify_track_targets AS target ON target.track_id=daily.track_id
WHERE daily.track_id IN (
  SELECT DISTINCT canonical_track_id FROM sh_spotify_history_dedupe_map
);

DELETE FROM sh_spotify_artist_daily
WHERE EXISTS (
  SELECT 1
  FROM sh_spotify_history_dedupe_affected AS affected
  WHERE affected.snapshot_date=sh_spotify_artist_daily.snapshot_date
    AND affected.artist_key=sh_spotify_artist_daily.artist_key
);

INSERT INTO sh_spotify_artist_daily (
  snapshot_date,artist_key,total_delta,track_count,updated_at
)
SELECT
  daily.snapshot_date,
  target.artist_key,
  CASE WHEN COUNT(daily.delta)=0 THEN NULL ELSE SUM(daily.delta) END,
  COUNT(*),
  MAX(daily.collected_at)
FROM sh_spotify_playcount_daily AS daily
INNER JOIN sh_spotify_track_targets AS target ON target.track_id=daily.track_id
INNER JOIN sh_spotify_history_dedupe_affected AS affected
  ON affected.snapshot_date=daily.snapshot_date
 AND affected.artist_key=target.artist_key
GROUP BY daily.snapshot_date,target.artist_key;

DROP TABLE sh_spotify_history_dedupe_affected;
DROP TABLE sh_spotify_history_dedupe_map;
