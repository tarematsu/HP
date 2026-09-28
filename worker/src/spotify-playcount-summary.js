export function spotifyArtistDailyRefreshStatements(db, snapshotDate, updatedAt = Date.now()) {
  return [
    db.prepare(`DELETE FROM sh_spotify_artist_daily WHERE snapshot_date=?`)
      .bind(snapshotDate),
    db.prepare(`WITH daily_base AS (
        SELECT
          d.snapshot_date,
          target.artist_key,
          d.track_id,
          d.playcount,
          d.delta
        FROM sh_spotify_playcount_daily d
        INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
        WHERE d.snapshot_date=?
      ),
      release_candidates AS (
        SELECT DISTINCT
          base.track_id AS canonical_track_id,
          release.release_date
        FROM daily_base base
        INNER JOIN sh_spotify_tracks track ON track.track_id=base.track_id
        INNER JOIN sh_spotify_releases release ON release.album_id=track.album_id
        WHERE trim(release.release_date)<>''

        UNION ALL

        SELECT DISTINCT
          base.track_id AS canonical_track_id,
          release.release_date
        FROM daily_base base
        INNER JOIN sh_spotify_track_aliases alias ON alias.canonical_track_id=base.track_id
        INNER JOIN sh_spotify_tracks source_track ON source_track.track_id=alias.source_track_id
        INNER JOIN sh_spotify_releases release ON release.album_id=source_track.album_id
        WHERE trim(release.release_date)<>''
      ),
      canonical_release AS (
        SELECT canonical_track_id,MIN(release_date) AS release_date
        FROM release_candidates
        GROUP BY canonical_track_id
      ),
      totals AS (
        SELECT
          snapshot_date,
          artist_key,
          CASE WHEN COUNT(delta)=0 THEN NULL ELSE SUM(delta) END AS total_delta,
          COUNT(*) AS track_count
        FROM daily_base
        GROUP BY snapshot_date,artist_key
      ),
      ranked_all AS (
        SELECT
          snapshot_date,
          artist_key,
          delta,
          ROW_NUMBER() OVER (
            PARTITION BY snapshot_date,artist_key
            ORDER BY
              CASE WHEN delta IS NULL THEN 1 ELSE 0 END,
              delta DESC,
              playcount DESC,
              track_id ASC
          ) AS delta_rank
        FROM daily_base
      ),
      top10_all AS (
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
        FROM daily_base base
        INNER JOIN canonical_release release ON release.canonical_track_id=base.track_id
        WHERE substr(release.release_date,1,4)=substr(base.snapshot_date,1,4)
      ),
      top10_year AS (
        SELECT
          snapshot_date,
          artist_key,
          CASE WHEN COUNT(delta)=0 THEN NULL ELSE SUM(delta) END AS top10_year_delta
        FROM ranked_year
        WHERE delta_rank<=10
        GROUP BY snapshot_date,artist_key
      )
      INSERT INTO sh_spotify_artist_daily (
        snapshot_date,artist_key,total_delta,track_count,updated_at,
        top10_delta,top10_year_delta
      )
      SELECT
        totals.snapshot_date,
        totals.artist_key,
        totals.total_delta,
        totals.track_count,
        ?,
        top10_all.top10_delta,
        top10_year.top10_year_delta
      FROM totals
      LEFT JOIN top10_all
        ON top10_all.snapshot_date=totals.snapshot_date
       AND top10_all.artist_key=totals.artist_key
      LEFT JOIN top10_year
        ON top10_year.snapshot_date=totals.snapshot_date
       AND top10_year.artist_key=totals.artist_key`)
      .bind(snapshotDate, updatedAt),
  ];
}
