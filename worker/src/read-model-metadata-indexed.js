function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

async function runRows(db, sql, bindings) {
  if (!db?.prepare || !bindings.length) return [];
  const statement = db.prepare(sql).bind(...bindings);
  if (typeof statement?.all !== 'function') return [];
  const result = await statement.all();
  return result?.results || [];
}

function missingSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

function missingIndex(error) {
  return /no such index/i.test(String(error?.message || error));
}

function complete(row) {
  return Boolean(row?.title && row?.artist && row?.thumbnail_url);
}

function uniqueRows(rows) {
  const byIdentity = new Map();
  for (const row of rows || []) {
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    const key = `${spotifyId || ''}|${isrc || ''}`;
    if (!spotifyId && !isrc) continue;
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, { ...row, isrc: isrc || row?.isrc || null });
      continue;
    }
    byIdentity.set(key, {
      ...row,
      ...current,
      title: current.title || row.title || null,
      artist: current.artist || row.artist || null,
      thumbnail_url: current.thumbnail_url || row.thumbnail_url || null,
      fetched_at: Math.max(Number(current.fetched_at || 0), Number(row.fetched_at || 0)) || null,
    });
  }
  return [...byIdentity.values()];
}

async function dictionaryRows(db, isrcs) {
  if (!isrcs.length) return [];
  return runRows(db, `SELECT spotify_id,isrc,title,artist,thumbnail_url,
      metadata_fetched_at AS fetched_at
    FROM sh_track_dictionary
    WHERE isrc IN (${placeholders(isrcs.length)})`, isrcs);
}

async function metadataRowsBySpotify(db, spotifyIds) {
  if (!spotifyIds.length) return [];
  return runRows(db, `SELECT spotify_id,isrc,title,artist,thumbnail_url,fetched_at
    FROM sh_track_metadata
    WHERE spotify_id IN (${placeholders(spotifyIds.length)})
    ORDER BY fetched_at DESC`, spotifyIds);
}

async function metadataRowsByIsrc(db, isrcs) {
  if (!isrcs.length) return [];
  // idx_sh_track_metadata_isrc is a partial index. INDEXED BY becomes a hard
  // query-planner contract, so repeat its predicate verbatim; otherwise SQLite
  // returns "no query solution" instead of choosing another access path.
  const where = `WHERE isrc IS NOT NULL AND TRIM(isrc)<>''
      AND isrc IN (${placeholders(isrcs.length)})
    ORDER BY fetched_at DESC`;
  try {
    return await runRows(db, `SELECT spotify_id,isrc,title,artist,thumbnail_url,fetched_at
      FROM sh_track_metadata INDEXED BY idx_sh_track_metadata_isrc
      ${where}`, isrcs);
  } catch (error) {
    if (!missingIndex(error)) throw error;
    return runRows(db, `SELECT spotify_id,isrc,title,artist,thumbnail_url,fetched_at
      FROM sh_track_metadata
      ${where}`, isrcs);
  }
}

async function indexedRows(db, spotifyIds, isrcs, { dictionary = false } = {}) {
  if (!db?.prepare) return [];
  let preferred = [];
  if (dictionary && isrcs.length) {
    try {
      preferred = await dictionaryRows(db, isrcs);
    } catch (error) {
      if (!missingSchema(error)) throw error;
    }
  }

  const completeIsrcs = new Set(
    preferred.filter(complete).map((row) => normalizedIsrc(row?.isrc)).filter(Boolean),
  );
  const completeSpotifyIds = new Set(
    preferred.filter(complete).map((row) => text(row?.spotify_id)).filter(Boolean),
  );
  const metadataIsrcs = isrcs.filter((value) => !completeIsrcs.has(value));
  const metadataSpotifyIds = spotifyIds.filter((value) => !completeSpotifyIds.has(value));

  let byIsrc = [];
  try {
    byIsrc = await metadataRowsByIsrc(db, metadataIsrcs);
  } catch (error) {
    if (!missingSchema(error)) throw error;
  }
  const bySpotify = await metadataRowsBySpotify(db, metadataSpotifyIds);
  return uniqueRows([...preferred, ...byIsrc, ...bySpotify]);
}

function mergeSources(primaryRows, fallbackRows) {
  const fallbackBySpotify = new Map();
  const fallbackByIsrc = new Map();
  for (const row of fallbackRows) {
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    if (spotifyId && !fallbackBySpotify.has(spotifyId)) fallbackBySpotify.set(spotifyId, row);
    if (isrc && !fallbackByIsrc.has(isrc)) fallbackByIsrc.set(isrc, row);
  }
  const merged = primaryRows.map((row) => {
    const fallback = fallbackByIsrc.get(normalizedIsrc(row?.isrc))
      || fallbackBySpotify.get(text(row?.spotify_id));
    if (!fallback) return row;
    return {
      ...fallback,
      ...row,
      title: row.title || fallback.title || null,
      artist: row.artist || fallback.artist || null,
      thumbnail_url: row.thumbnail_url || fallback.thumbnail_url || null,
      fetched_at: Math.max(Number(row.fetched_at || 0), Number(fallback.fetched_at || 0)) || null,
    };
  });
  const primarySpotify = new Set(primaryRows.map((row) => text(row?.spotify_id)).filter(Boolean));
  const primaryIsrc = new Set(primaryRows.map((row) => normalizedIsrc(row?.isrc)).filter(Boolean));
  merged.push(...fallbackRows.filter((row) => (
    !primarySpotify.has(text(row?.spotify_id)) && !primaryIsrc.has(normalizedIsrc(row?.isrc))
  )));
  return uniqueRows(merged);
}

export async function loadReadModelTrackMetadata(env, spotifyIds, isrcs) {
  const requestedSpotifyIds = [...new Set(
    (spotifyIds || []).map(text).filter(Boolean),
  )].slice(0, 80);
  const requestedIsrcs = [...new Set(
    (isrcs || []).map(normalizedIsrc).filter(Boolean),
  )].slice(0, 80);
  if (!requestedSpotifyIds.length && !requestedIsrcs.length) return [];

  const primary = await indexedRows(env?.MINUTE_DB, requestedSpotifyIds, requestedIsrcs, {
    dictionary: true,
  });
  const completeSpotify = new Set(primary.filter(complete).map((row) => text(row?.spotify_id)).filter(Boolean));
  const completeIsrc = new Set(primary.filter(complete).map((row) => normalizedIsrc(row?.isrc)).filter(Boolean));
  const missingSpotify = requestedSpotifyIds.filter((value) => !completeSpotify.has(value));
  const missingIsrc = requestedIsrcs.filter((value) => !completeIsrc.has(value));
  const fallback = env?.BUDDIES_DB;
  if ((!missingSpotify.length && !missingIsrc.length) || !fallback || fallback === env?.MINUTE_DB) {
    return primary;
  }

  const fallbackRows = await indexedRows(fallback, missingSpotify, missingIsrc);
  return mergeSources(primary, fallbackRows);
}
