// Resolve only the candidate's aliases, then seek the previous day's primary key.
// Joining the grouped canonical-history view can scan/materialize the complete
// history and repeatedly scan its unindexed canonical track IDs on D1.
export function spotifyDailyFinalizeStatement(db, message, previousDate) {
  return db.prepare(`INSERT INTO sh_spotify_playcount_daily (
      snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
    )
    SELECT ?,c.track_id,c.playcount,
      c.playcount-(
        SELECT MAX(p.playcount) FROM sh_spotify_playcount_daily p
        WHERE p.snapshot_date=? AND p.track_id IN (
          SELECT a.source_track_id FROM sh_spotify_track_aliases a
          WHERE a.canonical_track_id=c.track_id
          UNION ALL
          SELECT c.track_id WHERE NOT EXISTS (
            SELECT 1 FROM sh_spotify_track_aliases a WHERE a.source_track_id=c.track_id
          )
        )
      ),
      c.collected_at,0
    FROM sh_spotify_playcount_candidates c
    WHERE c.snapshot_date=? AND c.run_token=?
    ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
      playcount=excluded.playcount,delta=excluded.delta,
      collected_at=excluded.collected_at,is_carried_forward=0`)
    .bind(message.snapshot_date, previousDate, message.snapshot_date, message.run_token);
}
