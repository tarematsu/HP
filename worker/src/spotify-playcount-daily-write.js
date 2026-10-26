// Resolve only the candidate's aliases, then seek the previous day's primary key.
// Joining the grouped canonical-history view can scan/materialize the complete
// history and repeatedly scan its unindexed canonical track IDs on D1.
function finalizeStatement(db, message, previousDate, payloadRows = null) {
  const source = payloadRows == null
    ? `sh_spotify_playcount_candidates c
      LEFT JOIN sh_spotify_releases r ON r.album_id=c.album_id
      WHERE c.snapshot_date=? AND c.run_token=?`
    : `(SELECT json_extract(value,'$[0]') AS track_id,
        json_extract(value,'$[1]') AS playcount,
        json_extract(value,'$[2]') AS collected_at,
        json_extract(value,'$[3]') AS album_id
      FROM json_each(?)) c
      LEFT JOIN sh_spotify_releases r ON r.album_id=c.album_id
      WHERE 1`;

  return db.prepare(`WITH candidate_values AS (
      SELECT c.track_id,c.playcount,c.collected_at,r.release_date,
        (SELECT MAX(p.playcount) FROM sh_spotify_playcount_daily p
        WHERE p.snapshot_date=? AND p.track_id IN (
          SELECT a.source_track_id FROM sh_spotify_track_aliases a
          WHERE a.canonical_track_id=c.track_id
          UNION ALL
          SELECT c.track_id WHERE NOT EXISTS (
            SELECT 1 FROM sh_spotify_track_aliases a WHERE a.source_track_id=c.track_id
          )
        )) AS previous_playcount
      FROM ${source}
    ), adjusted AS (
      SELECT track_id,
        CASE
          WHEN playcount=0 AND previous_playcount>0 THEN previous_playcount
          ELSE playcount
        END AS playcount,
        CASE
          WHEN playcount=0 AND previous_playcount>0 THEN 0
          WHEN previous_playcount IS NULL
            AND substr(release_date,1,4)=substr(?,1,4) THEN playcount
          WHEN previous_playcount IS NULL THEN NULL
          WHEN previous_playcount=0 AND playcount>0
            AND COALESCE(substr(release_date,1,4),'')<>substr(?,1,4) THEN NULL
          WHEN playcount<previous_playcount
            AND substr(release_date,1,4)=substr(?,1,4) THEN playcount
          ELSE playcount-previous_playcount
        END AS delta,
        collected_at,
        CASE WHEN playcount=0 AND previous_playcount>0 THEN 1 ELSE 0 END AS is_carried_forward
      FROM candidate_values
    )
    INSERT INTO sh_spotify_playcount_daily (
      snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
    )
    SELECT ?,track_id,playcount,delta,collected_at,is_carried_forward
    FROM adjusted
    WHERE 1
    ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
      playcount=excluded.playcount,delta=excluded.delta,
      collected_at=excluded.collected_at,is_carried_forward=excluded.is_carried_forward
    WHERE sh_spotify_playcount_daily.playcount IS NOT excluded.playcount
      OR sh_spotify_playcount_daily.delta IS NOT excluded.delta
      OR sh_spotify_playcount_daily.collected_at IS NOT excluded.collected_at
      OR sh_spotify_playcount_daily.is_carried_forward IS NOT excluded.is_carried_forward`)
    .bind(previousDate,
      ...(payloadRows == null
        ? [message.snapshot_date, message.run_token]
        : [JSON.stringify(payloadRows.map(row => [row.track_id, row.playcount, row.collected_at, row.album_id ?? null]))]),
      message.snapshot_date, message.snapshot_date, message.snapshot_date, message.snapshot_date);
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

// Seek only aliases present in this day's snapshot. Scanning the full alias
// catalog on every finalization is expensive even when there is nothing to delete.
export function spotifyDailyAliasCleanupStatement(db, snapshotDate) {
  return db.prepare(`DELETE FROM sh_spotify_playcount_daily
    WHERE snapshot_date=? AND EXISTS (
      SELECT 1 FROM sh_spotify_track_aliases AS alias
      WHERE alias.source_track_id=sh_spotify_playcount_daily.track_id
        AND alias.source_track_id<>alias.canonical_track_id
    )`).bind(snapshotDate);
}
