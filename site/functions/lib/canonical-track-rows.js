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

function validTrackTitleSql(alias) {
  return `CASE WHEN ${alias}.title IS NULL OR TRIM(${alias}.title)=''
      OR TRIM(${alias}.title)=TRIM(${alias}.spotify_id)
    THEN NULL ELSE TRIM(${alias}.title) END`;
}

function validTrackArtistSql(alias) {
  return `CASE WHEN ${alias}.artist IS NULL OR TRIM(${alias}.artist)=''
      OR TRIM(${alias}.artist)=TRIM(${alias}.spotify_id)
      OR TRIM(${alias}.artist) GLOB 'JP[A-Z0-9]*'
    THEN NULL ELSE TRIM(${alias}.artist) END`;
}

function physicalCanonicalTrackSql(chunk) {
  return `SELECT
      t.id AS track_id,
      t.stationhead_track_id,
      COALESCE(d.isrc,NULLIF(UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ','')),'')) AS isrc,
      COALESCE(NULLIF(TRIM(d.spotify_id),''),NULLIF(TRIM(t.spotify_id),'')) AS spotify_id,
      COALESCE(NULLIF(TRIM(d.title),''),${validTrackTitleSql('t')}) AS title,
      COALESCE(NULLIF(TRIM(d.artist),''),${validTrackArtistSql('t')}) AS artist,
      d.thumbnail_url
    FROM sh_tracks t
    LEFT JOIN sh_track_dictionary d
      ON d.isrc=UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))
    WHERE t.id IN (${placeholders(chunk.length)})`;
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

function mappingValue(row, column) {
  if (column === 'isrc') return normalizedIsrc(row?.isrc);
  if (column === 'spotify_id') return text(row?.spotify_id);
  return positiveInteger(row?.stationhead_track_id);
}

async function trackMappings(db, values, column, chunkSize) {
  if (!values.length) return [];
  const safeColumn = column === 'isrc' ? 'isrc' : column === 'spotify_id' ? 'spotify_id' : 'stationhead_track_id';
  const direct = await queryChunked(db, values, (chunk) => `SELECT id AS track_id,${safeColumn}
    FROM sh_tracks WHERE ${safeColumn} IN (${placeholders(chunk.length)})`, chunkSize);
  if (safeColumn === 'stationhead_track_id') return direct;

  const found = new Set(direct.map((row) => mappingValue(row, safeColumn)).filter(Boolean));
  const missing = values.filter((value) => !found.has(
    safeColumn === 'isrc' ? normalizedIsrc(value) : text(value),
  ));
  if (!missing.length) return direct;

  const aliasType = safeColumn === 'isrc' ? 'isrc' : 'spotify_id';
  const aliases = await queryChunked(db, missing, (chunk) => `SELECT
      track_id,alias_value AS ${safeColumn}
    FROM sh_track_aliases
    WHERE alias_type='${aliasType}'
      AND alias_value IN (${placeholders(chunk.length)})`, chunkSize);
  return [...direct, ...aliases];
}

/**
 * Resolve Pages/read-model song rows to sh_tracks.id using only bounded indexed
 * physical-table lookups. Provider aliases are first mapped through sh_tracks;
 * presentation fields are then joined from sh_track_dictionary by primary key.
 * The UNION canonical view is intentionally excluded from this runtime hot path.
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
    const trackIds = new Set(unresolved
      .map((row) => positiveInteger(row?.track_id))
      .filter(Boolean));

    const stationheadIds = [...new Set(unresolved
      .filter((row) => positiveInteger(row?.track_id) == null)
      .map((row) => positiveInteger(row?.stationhead_track_id))
      .filter(Boolean))];
    for (const mapping of await trackMappings(db, stationheadIds, 'stationhead_track_id', boundedChunkSize)) {
      const trackId = positiveInteger(mapping?.track_id);
      if (trackId != null) trackIds.add(trackId);
    }

    unresolved = unresolvedRows(rows, indexes);
    const isrcs = [...new Set(unresolved
      .filter((row) => positiveInteger(row?.track_id) == null)
      .map((row) => normalizedIsrc(row?.isrc))
      .filter(Boolean))];
    for (const mapping of await trackMappings(db, isrcs, 'isrc', boundedChunkSize)) {
      const trackId = positiveInteger(mapping?.track_id);
      if (trackId != null) trackIds.add(trackId);
    }

    unresolved = unresolvedRows(rows, indexes);
    const spotifyIds = [...new Set(unresolved
      .filter((row) => positiveInteger(row?.track_id) == null)
      .map((row) => text(row?.spotify_id))
      .filter(Boolean))];
    for (const mapping of await trackMappings(db, spotifyIds, 'spotify_id', boundedChunkSize)) {
      const trackId = positiveInteger(mapping?.track_id);
      if (trackId != null) trackIds.add(trackId);
    }

    const neededTrackIds = [...trackIds].filter((trackId) => !indexes.byTrackId.has(trackId));
    if (neededTrackIds.length) {
      canonicalRows.push(...await queryChunked(
        db,
        neededTrackIds,
        physicalCanonicalTrackSql,
        boundedChunkSize,
      ));
      indexes = canonicalIndexes(canonicalRows);
    }

    return applyCanonicalIndexes(rows, indexes);
  } catch (error) {
    if (missingCanonicalSchema(error)) return rows;
    throw error;
  }
}

/**
 * Legacy full-catalog helper retained for offline compatibility. Production
 * publication paths use canonicalizeTrackRows and never call this function.
 */
export async function canonicalizeTrackRowsFromCatalog(db, rows = []) {
  if (!supportsCanonicalQueries(db) || !Array.isArray(rows) || !rows.length) return rows;
  try {
    const tracks = db.prepare(`SELECT id AS track_id,stationhead_track_id,isrc,spotify_id,title,artist
      FROM sh_tracks WHERE id IS NOT NULL`);
    if (typeof tracks?.all !== 'function') return rows;
    const result = await tracks.all();
    const base = result?.results || [];
    const trackIds = base.map((row) => positiveInteger(row?.track_id)).filter(Boolean);
    const canonical = await queryChunked(db, trackIds, physicalCanonicalTrackSql, DEFAULT_CHUNK_SIZE);
    return applyCanonicalIndexes(rows, canonicalIndexes(canonical));
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
