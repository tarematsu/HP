export function spotifyArtistDailyRefreshStatements(db, snapshotDate, updatedAt = Date.now()) {
  return [
    db.prepare(`DELETE FROM sh_spotify_artist_daily WHERE snapshot_date=?`)
      .bind(snapshotDate),
    db.prepare(`INSERT INTO sh_spotify_artist_daily (
        snapshot_date,artist_key,total_delta,track_count,updated_at
      )
      SELECT
        d.snapshot_date,
        target.artist_key,
        CASE WHEN COUNT(d.delta)=0 THEN NULL ELSE SUM(d.delta) END,
        COUNT(*),
        ?
      FROM sh_spotify_playcount_daily d
      INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
      WHERE d.snapshot_date=?
      GROUP BY d.snapshot_date,target.artist_key`)
      .bind(updatedAt, snapshotDate),
  ];
}
