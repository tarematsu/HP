// Shared policy for observation-only writes; new identity/metadata fills are immediate.
export const TRACK_SEEN_CHECKPOINT_MS = 24 * 60 * 60_000;

export function checkpointTrackStatement(db, descriptor, observedAt) {
  const conditions = [];
  for (const column of ['isrc', 'spotify_id', 'stationhead_track_id', 'title', 'artist']) {
    if (descriptor[column] != null) conditions.push(`${column} IS NULL`);
  }
  conditions.push('last_seen_at<=?');
  return db.prepare(`UPDATE sh_tracks SET
      isrc=COALESCE(isrc,?),spotify_id=COALESCE(spotify_id,?),
      stationhead_track_id=COALESCE(stationhead_track_id,?),
      title=COALESCE(title,?),artist=COALESCE(artist,?),last_seen_at=MAX(last_seen_at,?)
    WHERE id=? AND (
      ${conditions.join('\n      OR ')}
    )`).bind(
      descriptor.isrc, descriptor.spotify_id, descriptor.stationhead_track_id,
      descriptor.title, descriptor.artist, observedAt, descriptor.trackId,
      observedAt - TRACK_SEEN_CHECKPOINT_MS,
    );
}
