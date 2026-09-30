const DEFAULT_CHUNK_SIZE = 60;

function positiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function missingCanonicalSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

async function queryRows(db, sql, bindings) {
  const statement = db.prepare(sql).bind(...bindings);
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function queryChunked(db, values, sqlForChunk, chunkSize) {
  const rows = [];
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    const chunk = values.slice(offset, offset + chunkSize);
    rows.push(...await queryRows(db, sqlForChunk(chunk), chunk));
  }
  return rows;
}

function canonicalRow(row) {
  if (!row || typeof row !== 'object') return null;
  const trackId = positiveInteger(row.track_id);
  if (trackId == null) return null;
  return {
    track_id: trackId,
    stationhead_track_id: positiveInteger(row.stationhead_track_id),
    isrc: normalizedIsrc(row.isrc),
    spotify_id: text(row.spotify_id),
    title: text(row.title),
    artist: text(row.artist),
    thumbnail_url: text(row.thumbnail_url),
  };
}

function canonicalIndexes(rows) {
  const byTrackId = new Map();
  const byStationhead = new Map();
  const byIsrc = new Map();
  const bySpotify = new Map();
  for (const raw of rows) {
    const row = canonicalRow(raw);
    if (!row) continue;
    byTrackId.set(row.track_id, row);
    if (row.stationhead_track_id != null) byStationhead.set(row.stationhead_track_id, row);
    if (row.isrc) byIsrc.set(row.isrc, row);
    if (row.spotify_id) bySpotify.set(row.spotify_id, row);
  }
  return { byTrackId, byStationhead, byIsrc, bySpotify };
}

function preferredCanonical(row, indexes) {
  const direct = indexes.byTrackId.get(positiveInteger(row?.track_id));
  if (direct) return direct;
  const stationhead = indexes.byStationhead.get(positiveInteger(row?.stationhead_track_id));
  if (stationhead) return stationhead;
  const isrc = normalizedIsrc(row?.isrc);
  if (isrc && indexes.byIsrc.has(isrc)) return indexes.byIsrc.get(isrc);
  const spotifyId = text(row?.spotify_id);
  return spotifyId ? indexes.bySpotify.get(spotifyId) || null : null;
}

function applyCanonical(row, canonical) {
  if (!canonical) return row;
  return {
    ...row,
    track_id: canonical.track_id,
    title: canonical.title || row?.title || null,
    artist: canonical.artist || row?.artist || null,
    thumbnail_url: canonical.thumbnail_url || row?.thumbnail_url || null,
    isrc: canonical.isrc || normalizedIsrc(row?.isrc) || null,
    spotify_id: canonical.spotify_id || text(row?.spotify_id),
  };
}

/**
 * Resolve Pages/read-model song rows to the single canonical identity:
 * sh_tracks.id. Provider IDs remain aliases only and are used as a bounded
 * fallback when a row has not yet been assigned track_id.
 */
export async function canonicalizeTrackRows(db, rows = [], { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  if (!db?.prepare || !Array.isArray(rows) || !rows.length) return rows;
  const boundedChunkSize = Math.max(1, Math.min(80, Math.trunc(Number(chunkSize) || DEFAULT_CHUNK_SIZE)));
  const trackIds = [...new Set(rows.map((row) => positiveInteger(row?.track_id)).filter(Boolean))];
  const stationheadIds = [...new Set(rows.map((row) => positiveInteger(row?.stationhead_track_id)).filter(Boolean))];
  const isrcs = [...new Set(rows.map((row) => normalizedIsrc(row?.isrc)).filter(Boolean))];
  const spotifyIds = [...new Set(rows.map((row) => text(row?.spotify_id)).filter(Boolean))];

  try {
    const [byTrack, byStationhead, byIsrc, bySpotify] = await Promise.all([
      queryChunked(db, trackIds, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
        FROM sh_track_canonical_metadata WHERE track_id IN (${placeholders(chunk.length)})`, boundedChunkSize),
      queryChunked(db, stationheadIds, (chunk) => `SELECT c.track_id,t.stationhead_track_id,c.isrc,c.spotify_id,c.title,c.artist,c.thumbnail_url
        FROM sh_tracks t
        LEFT JOIN sh_track_canonical_metadata c ON c.track_id=t.id
        WHERE t.stationhead_track_id IN (${placeholders(chunk.length)})`, boundedChunkSize),
      queryChunked(db, isrcs, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
        FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND isrc IN (${placeholders(chunk.length)})`, boundedChunkSize),
      queryChunked(db, spotifyIds, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
        FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND spotify_id IN (${placeholders(chunk.length)})`, boundedChunkSize),
    ]);
    const indexes = canonicalIndexes([...byTrack, ...byStationhead, ...byIsrc, ...bySpotify]);
    return rows.map((row) => applyCanonical(row, preferredCanonical(row, indexes)));
  } catch (error) {
    if (missingCanonicalSchema(error)) return rows;
    throw error;
  }
}

export function canonicalTrackKey(row) {
  const trackId = positiveInteger(row?.track_id);
  if (trackId != null) return `track:${trackId}`;
  const isrc = normalizedIsrc(row?.isrc);
  if (isrc) return `isrc:${isrc}`;
  const spotifyId = text(row?.spotify_id);
  if (spotifyId) return `spotify:${spotifyId}`;
  const stationheadId = positiveInteger(row?.stationhead_track_id);
  return stationheadId != null ? `stationhead:${stationheadId}` : null;
}
