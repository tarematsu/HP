const QUERY_CHUNK_SIZE = 80;
const CACHE_LIMIT = 2048;

let minuteDb = null;
const stationheadTrackBySpotifyId = new Map();

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cacheSet(spotifyId, stationheadTrackId) {
  if (!stationheadTrackBySpotifyId.has(spotifyId)
    && stationheadTrackBySpotifyId.size >= CACHE_LIMIT) {
    const oldest = stationheadTrackBySpotifyId.keys().next().value;
    if (oldest != null) stationheadTrackBySpotifyId.delete(oldest);
  }
  stationheadTrackBySpotifyId.set(spotifyId, stationheadTrackId);
}

export function configureStationheadTrackResolver(db) {
  const next = db?.prepare ? db : null;
  if (minuteDb === next) return;
  minuteDb = next;
  stationheadTrackBySpotifyId.clear();
}

export async function attachStationheadTrackIds(tracks) {
  const rows = Array.isArray(tracks) ? tracks : [];
  if (!rows.length || !minuteDb?.prepare) return rows;

  const unresolvedIds = [...new Set(rows
    .filter((track) => positiveInteger(track?.stationhead_track_id) == null)
    .map((track) => String(track?.track_id || '').trim())
    .filter(Boolean))]
    .filter((spotifyId) => !stationheadTrackBySpotifyId.has(spotifyId));

  for (const group of chunks(unresolvedIds, QUERY_CHUNK_SIZE)) {
    const placeholders = group.map(() => '?').join(',');
    const result = await minuteDb.prepare(`SELECT
        alias.alias_value AS spotify_id,
        alias.track_id AS stationhead_track_id
      FROM sh_track_aliases alias
      INNER JOIN sh_tracks track ON track.id=alias.track_id
      WHERE alias.alias_type='spotify_id'
        AND alias.alias_value IN (${placeholders})
        AND track.isrc IS NOT NULL
        AND TRIM(track.isrc)<>''`)
      .bind(...group)
      .all();

    const found = new Set();
    for (const row of Array.isArray(result?.results) ? result.results : []) {
      const spotifyId = String(row?.spotify_id || '').trim();
      const stationheadTrackId = positiveInteger(row?.stationhead_track_id);
      if (!spotifyId || stationheadTrackId == null) continue;
      cacheSet(spotifyId, stationheadTrackId);
      found.add(spotifyId);
    }
    for (const spotifyId of group) {
      if (!found.has(spotifyId)) cacheSet(spotifyId, null);
    }
  }

  return rows.map((track) => {
    if (positiveInteger(track?.stationhead_track_id) != null) return track;
    const spotifyId = String(track?.track_id || '').trim();
    const stationheadTrackId = stationheadTrackBySpotifyId.get(spotifyId);
    return stationheadTrackId == null
      ? track
      : { ...track, stationhead_track_id: stationheadTrackId };
  });
}
