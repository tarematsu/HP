-- Cache grouped results once: the correlated UPDATE must not recompute
-- 90 days of window functions for every artist/day row during deployment.
WITH latest AS (
  SELECT MAX(snapshot_date) AS snapshot_date
  FROM sh_spotify_playcount_daily
),
recent_daily AS (
  SELECT
    daily.snapshot_date,
    target.artist_key,
    daily.track_id,
    daily.playcount,
    daily.delta
  FROM sh_spotify_playcount_daily AS daily
  INNER JOIN sh_spotify_track_targets AS target ON target.track_id=daily.track_id
  WHERE daily.snapshot_date >= date((SELECT snapshot_date FROM latest), '-89 days')
),
release_candidates AS (
  SELECT DISTINCT
    base.track_id AS canonical_track_id,
    release.release_date
  FROM recent_daily AS base
  INNER JOIN sh_spotify_tracks AS track ON track.track_id=base.track_id
  INNER JOIN sh_spotify_releases AS release ON release.album_id=track.album_id
  WHERE trim(release.release_date)<>''

  UNION ALL

  SELECT DISTINCT
    base.track_id AS canonical_track_id,
    release.release_date
  FROM recent_daily AS base
  INNER JOIN sh_spotify_track_aliases AS alias ON alias.canonical_track_id=base.track_id
  INNER JOIN sh_spotify_tracks AS source_track ON source_track.track_id=alias.source_track_id
  INNER JOIN sh_spotify_releases AS release ON release.album_id=source_track.album_id
  WHERE trim(release.release_date)<>''
),
canonical_release AS (
  SELECT canonical_track_id,MIN(release_date) AS release_date
  FROM release_candidates
  GROUP BY canonical_track_id
),
ranked_all AS (
  SELECT
    base.snapshot_date,
    base.artist_key,
    base.delta,
    ROW_NUMBER() OVER (
      PARTITION BY base.snapshot_date,base.artist_key
      ORDER BY
        CASE WHEN base.delta IS NULL THEN 1 ELSE 0 END,
        base.delta DESC,
        base.playcount DESC,
        base.track_id ASC
    ) AS delta_rank
  FROM recent_daily AS base
),
top10_all AS MATERIALIZED (
  SELECT
    snapshot_date,
    artist_key,
    CASE WHEN COUNT(delta)=0 THEN NULL ELSE SUM(delta) END AS top10_delta
  FROM ranked_all
  WHERE delta_rank<=10
  GROUP BY snapshot_date,artist_key
),
ranked_year AS (
  SELECT
    base.snapshot_date,
    base.artist_key,
    base.delta,
    ROW_NUMBER() OVER (
      PARTITION BY base.snapshot_date,base.artist_key
      ORDER BY
        CASE WHEN base.delta IS NULL THEN 1 ELSE 0 END,
        base.delta DESC,
        base.playcount DESC,
        base.track_id ASC
    ) AS delta_rank
  FROM recent_daily AS base
  INNER JOIN canonical_release AS release ON release.canonical_track_id=base.track_id
  WHERE substr(release.release_date,1,4)=substr(base.snapshot_date,1,4)
),
top10_year AS MATERIALIZED (
  SELECT
    snapshot_date,
    artist_key,
    CASE WHEN COUNT(delta)=0 THEN NULL ELSE SUM(delta) END AS top10_year_delta
  FROM ranked_year
  WHERE delta_rank<=10
  GROUP BY snapshot_date,artist_key
)
UPDATE sh_spotify_artist_daily
SET
  top10_delta=(
    SELECT summary.top10_delta
    FROM top10_all AS summary
    WHERE summary.snapshot_date=sh_spotify_artist_daily.snapshot_date
      AND summary.artist_key=sh_spotify_artist_daily.artist_key
  ),
  top10_year_delta=(
    SELECT summary.top10_year_delta
    FROM top10_year AS summary
    WHERE summary.snapshot_date=sh_spotify_artist_daily.snapshot_date
      AND summary.artist_key=sh_spotify_artist_daily.artist_key
  )
WHERE snapshot_date >= date((SELECT snapshot_date FROM latest), '-89 days');
