// Resolve only the candidate's aliases, then seek the previous day's primary key.
// Joining the grouped canonical-history view can scan/materialize the complete
// history and repeatedly scan its unindexed canonical track IDs on D1.
function finalizeStatement(db, message, previousDate, payloadRows = null) {
  const source = payloadRows == null
    ? 'sh_spotify_playcount_candidates c WHERE c.snapshot_date=? AND c.run_token=?'
    : `(SELECT json_extract(value,'$[0]') AS track_id,
        json_extract(value,'$[1]') AS playcount,
        json_extract(value,'$[2]') AS collected_at
      FROM json_each(?)) c WHERE 1`;

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
    FROM ${source}
    ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
      playcount=excluded.playcount,delta=excluded.delta,
      collected_at=excluded.collected_at,is_carried_forward=0
    WHERE sh_spotify_playcount_daily.playcount IS NOT excluded.playcount
      OR sh_spotify_playcount_daily.delta IS NOT excluded.delta
      OR sh_spotify_playcount_daily.collected_at IS NOT excluded.collected_at
      OR sh_spotify_playcount_daily.is_carried_forward IS NOT 0`)
    .bind(message.snapshot_date, previousDate,
      ...(payloadRows == null
        ? [message.snapshot_date, message.run_token]
        : [JSON.stringify(payloadRows.map(row => [row.track_id, row.playcount, row.collected_at]))]));
}

// Only R2-accepted candidate rows are eligible for finalization. All row
// arithmetic and latest-date writes still execute atomically inside SQLite.
export function spotifyDailyFinalizeR2Statement(db, message, previousDate, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Spotify R2 finalization has no rows');
  return finalizeStatement(db, message, previousDate, rows);
}

export function spotifyDailyFinalizeStatement(db, message, previousDate) {
  return finalizeStatement(db, message, previousDate);
}
