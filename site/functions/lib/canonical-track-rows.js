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
  if (typeof statement?.all !== 'function') return [];
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
  const nextTrackId = canonical.track_id;
  const nextTitle = canonical.title || row?.title || null;
  const nextArtist = canonical.artist || row?.artist || null;
  const nextThumbnailUrl = canonical.thumbnail_url || row?.thumbnail_url || null;
  const nextIsrc = canonical.isrc || normalizedIsrc(row?.isrc) || null;
  const nextSpotifyId = canonical.spotify_id || text(row?.spotify_id);
  if (positiveInteger(row?.track_id) === nextTrackId
      && (row?.title || null) === nextTitle
      && (row?.artist || null) === nextArtist
      && (row?.thumbnail_url || null) === nextThumbnailUrl
      && normalizedIsrc(row?.isrc) === nextIsrc
      && text(row?.spotify_id) === nextSpotifyId) return row;
  return {
    ...row,
    track_id: nextTrackId,
    title: nextTitle,
    artist: nextArtist,
    thumbnail_url: nextThumbnailUrl,
    isrc: nextIsrc,
    spotify_id: nextSpotifyId,
  };
}

function applyCanonicalIndexes(rows, indexes) {
  let changed = false;
  const resolved = rows.map((row) => {
    const next = applyCanonical(row, preferredCanonical(row, indexes));
    if (next !== row) changed = true;
    return next;
  });
  return changed ? resolved : rows;
}

function supportsCanonicalQueries(db) {
  return Boolean(db?.prepare && typeof db.batch === 'function');
}

function unresolvedRows(rows, indexes) {
  return rows.filter((row) => !preferredCanonical(row, indexes));
}

/**
 * Resolve Pages/read-model song rows to the single canonical identity:
 * sh_tracks.id. Provider IDs remain aliases only and are used as a bounded
 * lookup fallback while materializing rows that have not yet been assigned
 * track_id.
 */
export async function canonicalizeTrackRows(db, rows = [], { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  if (!supportsCanonicalQueries(db) || !Array.isArray(rows) || !rows.length) return rows;
  const boundedChunkSize = Math.max(1, Math.min(80, Math.trunc(Number(chunkSize) || DEFAULT_CHUNK_SIZE)));
  const trackIds = [...new Set(rows.map((row) => positiveInteger(row?.track_id)).filter(Boolean))];
  const stationheadIds = [...new Set(rows
    .filter((row) => positiveInteger(row?.track_id) == null)
    .map((row) => positiveInteger(row?.stationhead_track_id))
    .filter(Boolean))];

  try {
    // Resolve Stationhead aliases through the indexed sh_tracks column first.
    // Alias lookups are staged by identity priority so rows already resolved by
    // track_id/Stationhead never trigger redundant ISRC or Spotify view scans.
    const stationheadMappings = await queryChunked(
      db,
      stationheadIds,
      (chunk) => `SELECT id AS track_id,stationhead_track_id
        FROM sh_tracks WHERE stationhead_track_id IN (${placeholders(chunk.length)})`,
      boundedChunkSize,
    );

    const stationheadByTrackId = new Map();
    for (const mapping of stationheadMappings) {
      const mappedTrackId = positiveInteger(mapping?.track_id);
      const stationheadTrackId = positiveInteger(mapping?.stationhead_track_id);
      if (mappedTrackId != null && stationheadTrackId != null) {
        stationheadByTrackId.set(mappedTrackId, stationheadTrackId);
      }
    }

    const canonicalTrackIds = [...new Set([
      ...trackIds,
      ...stationheadByTrackId.keys(),
    ])];
    const byTrack = await queryChunked(db, canonicalTrackIds, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_canonical_metadata WHERE track_id IN (${placeholders(chunk.length)})`, boundedChunkSize);
    const canonicalRows = byTrack.map((row) => ({
      ...row,
      stationhead_track_id: stationheadByTrackId.get(positiveInteger(row?.track_id)) || null,
    }));

    let indexes = canonicalIndexes(canonicalRows);
    const isrcs = [...new Set(unresolvedRows(rows, indexes)
      .map((row) => normalizedIsrc(row?.isrc))
      .filter(Boolean))];
    if (isrcs.length) {
      canonicalRows.push(...await queryChunked(db, isrcs, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
        FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND isrc IN (${placeholders(chunk.length)})`, boundedChunkSize));
      indexes = canonicalIndexes(canonicalRows);
    }

    const spotifyIds = [...new Set(unresolvedRows(rows, indexes)
      .map((row) => text(row?.spotify_id))
      .filter(Boolean))];
    if (spotifyIds.length) {
      canonicalRows.push(...await queryChunked(db, spotifyIds, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
        FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND spotify_id IN (${placeholders(chunk.length)})`, boundedChunkSize));
      indexes = canonicalIndexes(canonicalRows);
    }

    return applyCanonicalIndexes(rows, indexes);
  } catch (error) {
    if (missingCanonicalSchema(error)) return rows;
    throw error;
  }
}

/**
 * Full Pages publications can span years of already-materialized rows. Loading
 * the compact canonical catalog once is cheaper than issuing per-day alias
 * lookups, and keeps old R2 day models canonical at publication time without a
 * request-time D1 join.
 */
export async function canonicalizeTrackRowsFromCatalog(db, rows = []) {
  if (!supportsCanonicalQueries(db) || !Array.isArray(rows) || !rows.length) return rows;
  try {
    const canonicalStatement = db.prepare(`SELECT track_id,NULL AS stationhead_track_id,
        isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_canonical_metadata
      WHERE track_id IS NOT NULL`);
    const stationheadStatement = db.prepare(`SELECT id AS track_id,stationhead_track_id
      FROM sh_tracks
      WHERE stationhead_track_id IS NOT NULL`);
    if (typeof canonicalStatement?.all !== 'function' || typeof stationheadStatement?.all !== 'function') return rows;
    const [canonicalResult, stationheadResult] = await Promise.all([
      canonicalStatement.all(),
      stationheadStatement.all(),
    ]);
    const stationheadByTrackId = new Map((stationheadResult?.results || [])
      .map((row) => [positiveInteger(row?.track_id), positiveInteger(row?.stationhead_track_id)])
      .filter(([trackId, stationheadTrackId]) => trackId != null && stationheadTrackId != null));
    const catalog = (canonicalResult?.results || []).map((row) => ({
      ...row,
      stationhead_track_id: stationheadByTrackId.get(positiveInteger(row?.track_id)) || null,
    }));
    return applyCanonicalIndexes(rows, canonicalIndexes(catalog));
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
  return spotifyId ? `spotify:${spotifyId}` : null;
}
