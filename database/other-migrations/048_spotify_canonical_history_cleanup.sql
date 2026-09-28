-- Collapse historical Spotify playcount rows that were collected under alternate
-- track IDs before canonical song identity was introduced. Keep alias metadata so
-- future observations of those source IDs can still resolve to the canonical ID.

INSERT OR IGNORE INTO sh_spotify_track_targets (track_id, artist_key)
SELECT DISTINCT alias.canonical_track_id, target.artist_key
FROM sh_spotify_track_targets AS target
INNER JOIN sh_spotify_track_aliases AS alias
  ON alias.source_track_id=target.track_id
WHERE alias.source_track_id<>alias.canonical_track_id;

DELETE FROM sh_spotify_track_targets
WHERE track_id IN (
  SELECT source_track_id
  FROM sh_spotify_track_aliases
  WHERE source_track_id<>canonical_track_id
);

INSERT INTO sh_spotify_playcount_daily (
    snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
  )
SELECT
  daily.snapshot_date,
  alias.canonical_track_id,
  MAX(daily.playcount),
  NULL,
  MAX(daily.collected_at),
  MIN(daily.is_carried_forward)
FROM sh_spotify_playcount_daily AS daily
INNER JOIN sh_spotify_track_aliases AS alias
  ON alias.source_track_id=daily.track_id
WHERE alias.source_track_id<>alias.canonical_track_id
GROUP BY daily.snapshot_date, alias.canonical_track_id
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
  FROM sh_spotify_track_aliases
  WHERE source_track_id<>canonical_track_id
);

-- Recalculate deltas after physical consolidation so historical totals reflect
-- one song once, using the collector's exact previous-calendar-day semantics.
UPDATE sh_spotify_playcount_daily
SET delta=playcount-(
  SELECT previous.playcount
  FROM sh_spotify_playcount_daily AS previous
  WHERE previous.track_id=sh_spotify_playcount_daily.track_id
    AND previous.snapshot_date=date(sh_spotify_playcount_daily.snapshot_date,'-1 day')
)
WHERE track_id IN (
  SELECT DISTINCT canonical_track_id
  FROM sh_spotify_track_aliases
  WHERE source_track_id<>canonical_track_id
);

DELETE FROM sh_spotify_playcount_current
WHERE track_id IN (
  SELECT source_track_id
  FROM sh_spotify_track_aliases
  WHERE source_track_id<>canonical_track_id
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
    SELECT DISTINCT canonical_track_id
    FROM sh_spotify_track_aliases
    WHERE source_track_id<>canonical_track_id
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

-- 047 materializes artist/day trend totals. Rebuild it after canonical cleanup so
-- historical totals no longer include alternate Track IDs.
DELETE FROM sh_spotify_artist_daily;

INSERT INTO sh_spotify_artist_daily (
  snapshot_date,artist_key,total_delta,track_count,updated_at
)
SELECT
  d.snapshot_date,
  target.artist_key,
  CASE WHEN COUNT(d.delta)=0 THEN NULL ELSE SUM(d.delta) END,
  COUNT(*),
  MAX(d.collected_at)
FROM sh_spotify_playcount_daily d
INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
GROUP BY d.snapshot_date,target.artist_key;
