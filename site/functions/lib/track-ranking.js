export const TRACK_RANKING_SQL = `SELECT
  current.track_identity,current.track_id,
  COALESCE(NULLIF(TRIM(direct.title),''),NULLIF(TRIM(by_isrc.title),''),NULLIF(TRIM(by_spotify.title),''),current.title) AS title,
  COALESCE(NULLIF(TRIM(direct.artist),''),NULLIF(TRIM(by_isrc.artist),''),NULLIF(TRIM(by_spotify.artist),''),current.artist) AS artist,
  COALESCE(NULLIF(TRIM(direct.isrc),''),NULLIF(TRIM(by_isrc.isrc),''),NULLIF(TRIM(by_spotify.isrc),''),current.isrc) AS isrc,
  COALESCE(NULLIF(TRIM(direct.spotify_id),''),NULLIF(TRIM(by_isrc.spotify_id),''),NULLIF(TRIM(by_spotify.spotify_id),''),current.spotify_id) AS spotify_id,
  current.latest_like_count,current.latest_observed_at,current.latest_occurrence_key
FROM sh_track_ranking_current current
LEFT JOIN sh_tracks direct ON direct.id=current.track_id
LEFT JOIN sh_tracks by_isrc
  ON current.track_id IS NULL
 AND current.isrc IS NOT NULL AND TRIM(current.isrc)<>''
 AND by_isrc.isrc=UPPER(TRIM(current.isrc))
LEFT JOIN sh_tracks by_spotify
  ON current.track_id IS NULL AND by_isrc.id IS NULL
 AND current.spotify_id IS NOT NULL AND TRIM(current.spotify_id)<>''
 AND by_spotify.spotify_id=TRIM(current.spotify_id)
WHERE current.latest_like_count>0
ORDER BY current.latest_like_count DESC,current.latest_observed_at DESC,current.track_identity
LIMIT ?`;

export const TRACK_RANKING_SUMMARY_SQL = `SELECT
  COUNT(*) AS track_count,
  COALESCE(MAX(latest_like_count),0) AS max_like_count,
  MAX(latest_observed_at) AS latest_observed_at
FROM sh_track_ranking_current
WHERE latest_like_count>0`;

export async function loadTrackRanking(db, { limit = 500 } = {}) {
  const boundedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 500), 20), 500);
  const [result, summary] = await Promise.all([
    db.prepare(TRACK_RANKING_SQL).bind(boundedLimit).all(),
    db.prepare(TRACK_RANKING_SUMMARY_SQL).first(),
  ]);
  const rows = result.results || [];
  return {
    rows: rows.map((row, index) => ({ rank: index + 1, ...row })),
    summary: {
      track_count: Number(summary?.track_count || 0),
      max_like_count: Number(summary?.max_like_count || 0),
      latest_observed_at: Number(summary?.latest_observed_at || 0) || null,
    },
  };
}