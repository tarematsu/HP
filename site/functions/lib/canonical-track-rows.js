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

async function dictionarySpotifyIdentityMappings(db, spotifyIds, chunkSize) {
  const dictionaryRows = await queryChunked(
    db,
    spotifyIds,
    (chunk) => `SELECT isrc,spotify_id AS alias_value
      FROM sh_track_dictionary WHERE spotify_id IN (${placeholders(chunk.length)})`,
    chunkSize,
  );
  const isrcs = [...new Set(dictionaryRows
    .map((row) => normalizedIsrc(row?.isrc))
    .filter(Boolean))];
  if (!isrcs.length) return [];

  const aliasRows = await queryChunked(
    db,
    isrcs,
    (chunk) => `SELECT track_id,alias_value AS isrc
      FROM sh_track_aliases
      WHERE alias_type='isrc' AND alias_value IN (${placeholders(chunk.length)})`,
    chunkSize,
  );
  const trackByIsrc = new Map(aliasRows
    .map((row) => [normalizedIsrc(row?.isrc), positiveInteger(row?.track_id)])
    .filter(([isrc, trackId]) => isrc && trackId != null));

  const unresolvedIsrcs = isrcs.filter((isrc) => !trackByIsrc.has(isrc));
  if (unresolvedIsrcs.length) {
    const directRows = await queryChunked(
      db,
      unresolvedIsrcs,
      (chunk) => `SELECT id AS track_id,isrc
        FROM sh_tracks WHERE isrc IN (${placeholders(chunk.length)})`,
      chunkSize,
    );
    for (const row of directRows) {
      const isrc = normalizedIsrc(row?.isrc);
      const trackId = positiveInteger(row?.track_id);
      if (isrc && trackId != null) trackByIsrc.set(isrc, trackId);
    }
  }

  return dictionaryRows.flatMap((row) => {
    const aliasValue = text(row?.alias_value);
    const trackId = trackByIsrc.get(normalizedIsrc(row?.isrc));
    return aliasValue && trackId != null ? [{ track_id: trackId, alias_value: aliasValue }] : [];
  });
}

async function spotifyIdentityMappings(db, spotifyIds, chunkSize) {
  const direct = await queryChunked(
    db,
    spotifyIds,
    (chunk) => `SELECT id AS track_id,spotify_id AS alias_value
      FROM sh_tracks WHERE spotify_id IN (${placeholders(chunk.length)})`,
    chunkSize,
  );
  const directValues = new Set(direct.map((row) => text(row?.alias_value)).filter(Boolean));
  const unresolvedAliases = spotifyIds.filter((spotifyId) => !directValues.has(spotifyId));
  if (!unresolvedAliases.length) return direct;

  const aliases = await queryChunked(
    db,
    unresolvedAliases,
    (chunk) => `SELECT track_id,alias_value
      FROM sh_track_aliases
      WHERE alias_type='spotify_id' AND alias_value IN (${placeholders(chunk.length)})`,
    chunkSize,
  );
  const resolvedValues = new Set([
    ...directValues,
    ...aliases.map((row) => text(row?.alias_value)).filter(Boolean),
  ]);
  const unresolvedDictionary = spotifyIds.filter((spotifyId) => !resolvedValues.has(spotifyId));
  if (!unresolvedDictionary.length) return [...direct, ...aliases];

  const dictionary = await dictionarySpotifyIdentityMappings(db, unresolvedDictionary, chunkSize);
  return [...direct, ...aliases, ...dictionary];
}

function applySpotifyIdentityMappings(indexes, mappings) {
  for (const mapping of mappings) {
    const aliasValue = text(mapping?.alias_value);
    const trackId = positiveInteger(mapping?.track_id);
    if (!aliasValue || trackId == null) continue;
    const canonical = indexes.byTrackId.get(trackId);
    if (canonical) indexes.bySpotify.set(aliasValue, canonical);
  }
}

/**
 * Resolve Pages/read-model song rows to the single canonical identity:
 * sh_tracks.id. Provider IDs remain aliases only and are used as a bounded
 * lookup fallback while materializing rows that have not yet been assigned
 * track_id. Callers may provide trusted canonical seed rows that were already
 * read from sh_track_canonical_metadata in the same operation.
 */
export async function canonicalizeTrackRows(
  db,
  rows = [],
  { chunkSize = DEFAULT_CHUNK_SIZE, seedRows = [] } = {},
) {
  if (!supportsCanonicalQueries(db) || !Array.isArray(rows) || !rows.length) return rows;
  const boundedChunkSize = Math.max(1, Math.min(80, Math.trunc(Number(chunkSize) || DEFAULT_CHUNK_SIZE)));

  try {
    const canonicalRows = Array.isArray(seedRows) ? [...seedRows] : [];
    let indexes = canonicalIndexes(canonicalRows);
    let unresolved = unresolvedRows(rows, indexes);
    const trackIds = [...new Set(unresolved
      .map((row) => positiveInteger(row?.track_id))
      .filter(Boolean))];
    const stationheadIds = [...new Set(unresolved
      .filter((row) => positiveInteger(row?.track_id) == null)
      .map((row) => positiveInteger(row?.stationhead_track_id))
      .filter(Boolean))];

    // Resolve Stationhead aliases through the indexed sh_tracks column first.
    // Alias lookups are staged by identity priority so rows already resolved by
    // a seed/track_id/Stationhead never trigger redundant provider view scans.
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
    ])].filter((trackId) => !indexes.byTrackId.has(trackId));
    const byTrack = await queryChunked(db, canonicalTrackIds, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_canonical_metadata WHERE track_id IN (${placeholders(chunk.length)})`, boundedChunkSize);
    canonicalRows.push(...byTrack.map((row) => ({
      ...row,
      stationhead_track_id: stationheadByTrackId.get(positiveInteger(row?.track_id)) || null,
    })));

    indexes = canonicalIndexes(canonicalRows);
    unresolved = unresolvedRows(rows, indexes);
    const isrcs = [...new Set(unresolved
      .map((row) => normalizedIsrc(row?.isrc))
      .filter(Boolean))];
    if (isrcs.length) {
      canonicalRows.push(...await queryChunked(db, isrcs, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
        FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND isrc IN (${placeholders(chunk.length)})`, boundedChunkSize));
      indexes = canonicalIndexes(canonicalRows);
    }

    unresolved = unresolvedRows(rows, indexes);
    const spotifyIds = [...new Set(unresolved
      .map((row) => text(row?.spotify_id))
      .filter(Boolean))];
    if (spotifyIds.length) {
      // The canonical metadata view derives spotify_id through joins/COALESCE,
      // so filtering the view by spotify_id forces large scans in D1. Resolve
      // identity through indexed identity/dictionary tables first, then read
      // the canonical view only by its track_id key.
      const spotifyMappings = await spotifyIdentityMappings(db, spotifyIds, boundedChunkSize);
      const mappedTrackIds = [...new Set(spotifyMappings
        .map((row) => positiveInteger(row?.track_id))
        .filter(Boolean))]
        .filter((trackId) => !indexes.byTrackId.has(trackId));
      if (mappedTrackIds.length) {
        canonicalRows.push(...await queryChunked(db, mappedTrackIds, (chunk) => `SELECT track_id,NULL AS stationhead_track_id,isrc,spotify_id,title,artist,thumbnail_url
          FROM sh_track_canonical_metadata WHERE track_id IN (${placeholders(chunk.length)})`, boundedChunkSize));
        indexes = canonicalIndexes(canonicalRows);
      }
      applySpotifyIdentityMappings(indexes, spotifyMappings);
    }

    return applyCanonicalIndexes(rows, indexes);
  } catch (error) {
    if (missingCanonicalSchema(error)) return rows;
    throw error;
  }
}

/**
 * Legacy full-catalog helper retained for compatibility with older callers.
 * New publication paths should prefer bounded canonicalizeTrackRows lookups.
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
