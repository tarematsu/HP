export const TRACK_RANKING_SQL = `SELECT
  current.track_identity,current.track_id,
  current.title AS current_title,current.artist AS current_artist,
  current.isrc AS stored_isrc,current.spotify_id AS stored_spotify_id,
  current.title,current.artist,current.isrc,current.spotify_id,
  NULL AS thumbnail_url,
  current.latest_like_count,current.latest_observed_at,current.latest_occurrence_key
FROM sh_track_ranking_current current
WHERE current.latest_like_count>0
ORDER BY current.latest_like_count DESC,current.latest_observed_at DESC,current.track_identity
LIMIT ?`;

export const TRACK_RANKING_SUMMARY_SQL = `SELECT
  COUNT(*) AS track_count,
  COALESCE(MAX(latest_like_count),0) AS max_like_count,
  COALESCE(SUM(latest_like_count),0) AS total_like_count,
  MAX(latest_observed_at) AS latest_observed_at
FROM sh_track_ranking_current
WHERE latest_like_count>0`;

const CANONICAL_CHUNK_SIZE = 80;

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function positiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function placeholder(value, type) {
  const source = text(value);
  if (!source) return true;
  const normalized = source.normalize('NFKC').toLowerCase();
  if (type === 'title' && ['曲名不明', '曲名…', '曲名...', 'unknown', 'unknown title', '_', '-', '—'].includes(normalized)) return true;
  if (type === 'artist' && ['アーティスト不明', 'unknown', 'unknown artist', '_', '-', '—'].includes(normalized)) return true;
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(source)
    || /^[A-Za-z0-9]{22}$/.test(source)
    || /^spotify[_:-]?[a-z0-9]{8,}$/i.test(source);
}

function usable(value, type) {
  const source = text(value);
  return source && !placeholder(source, type) ? source : null;
}

function identityValue(row, prefix) {
  const identity = text(row?.track_identity);
  if (!identity) return null;
  for (const marker of [`${prefix}:`, `key:${prefix}:`]) {
    if (identity.startsWith(marker)) return text(identity.slice(marker.length));
  }
  return null;
}

function rowSpotifyId(row) {
  return text(row?.spotify_id) || identityValue(row, 'spotify');
}

function rowIsrc(row) {
  return normalizedIsrc(row?.isrc) || normalizedIsrc(identityValue(row, 'isrc')) || null;
}

async function safeRun(db, sql, bindings) {
  try {
    return await db.prepare(sql).bind(...bindings).run();
  } catch (error) {
    if (/no such table|no such column|no such index/i.test(String(error?.message || error))) return null;
    throw error;
  }
}

async function queryRows(db, sql, bindings) {
  const statement = db.prepare(sql).bind(...bindings);
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function queryChunked(db, values, sqlForChunk) {
  const rows = [];
  for (let offset = 0; offset < values.length; offset += CANONICAL_CHUNK_SIZE) {
    const chunk = values.slice(offset, offset + CANONICAL_CHUNK_SIZE);
    rows.push(...await queryRows(db, sqlForChunk(chunk), chunk));
  }
  return rows;
}

function canonicalRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const trackId = positiveInteger(raw.track_id);
  const isrc = normalizedIsrc(raw.isrc) || null;
  const spotifyId = text(raw.spotify_id);
  if (trackId == null && !isrc && !spotifyId) return null;
  return {
    track_id: trackId,
    isrc,
    spotify_id: spotifyId,
    title: text(raw.title),
    artist: text(raw.artist),
    thumbnail_url: text(raw.thumbnail_url),
  };
}

function canonicalIndexes(rows) {
  const byTrackId = new Map();
  const byIsrc = new Map();
  const bySpotify = new Map();
  for (const raw of rows) {
    const row = canonicalRow(raw);
    if (!row) continue;
    if (row.track_id != null) byTrackId.set(row.track_id, row);
    if (row.isrc) byIsrc.set(row.isrc, row);
    if (row.spotify_id) bySpotify.set(row.spotify_id, row);
  }
  return { byTrackId, byIsrc, bySpotify };
}

function preferredCanonical(row, indexes) {
  const trackId = positiveInteger(row?.track_id);
  if (trackId != null && indexes.byTrackId.has(trackId)) return indexes.byTrackId.get(trackId);
  const isrc = rowIsrc(row);
  if (isrc && indexes.byIsrc.has(isrc)) return indexes.byIsrc.get(isrc);
  const spotifyId = rowSpotifyId(row);
  return spotifyId ? indexes.bySpotify.get(spotifyId) || null : null;
}

function unresolvedRows(rows, indexes) {
  return rows.filter((row) => !preferredCanonical(row, indexes));
}

function applyCanonical(row, canonical) {
  if (!canonical) return row;
  return {
    ...row,
    track_id: positiveInteger(row.track_id) ?? canonical.track_id,
    title: canonical.title || row.title || null,
    artist: canonical.artist || row.artist || null,
    thumbnail_url: canonical.thumbnail_url || row.thumbnail_url || null,
    isrc: canonical.isrc || rowIsrc(row),
    spotify_id: canonical.spotify_id || rowSpotifyId(row),
  };
}

async function hydrateRankingCanonicalMetadata(db, rows) {
  if (!rows.length) return rows;

  const canonicalRows = [];
  const trackIds = [...new Set(rows.map((row) => positiveInteger(row.track_id)).filter(Boolean))];
  if (trackIds.length) {
    canonicalRows.push(...await queryChunked(db, trackIds, (chunk) => `SELECT
      track_id,isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_canonical_metadata
      WHERE track_id IN (${placeholders(chunk.length)})`));
  }

  let indexes = canonicalIndexes(canonicalRows);
  const isrcs = [...new Set(unresolvedRows(rows, indexes).map(rowIsrc).filter(Boolean))];
  if (isrcs.length) {
    canonicalRows.push(...await queryChunked(db, isrcs, (chunk) => `SELECT
      track_id,isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_canonical_metadata
      WHERE isrc IN (${placeholders(chunk.length)})`));
    indexes = canonicalIndexes(canonicalRows);
  }

  const spotifyIds = [...new Set(unresolvedRows(rows, indexes).map(rowSpotifyId).filter(Boolean))];
  if (spotifyIds.length) {
    canonicalRows.push(...await queryChunked(db, spotifyIds, (chunk) => `SELECT
      track_id,isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_canonical_metadata
      WHERE spotify_id IN (${placeholders(chunk.length)})`));
    indexes = canonicalIndexes(canonicalRows);
  }

  return rows.map((row) => applyCanonical(row, preferredCanonical(row, indexes)));
}

function enrichRanking(rows) {
  return rows.map((row) => {
    const {
      current_title: currentTitle,
      current_artist: currentArtist,
      stored_isrc: _storedIsrc,
      stored_spotify_id: _storedSpotifyId,
      ...publicRow
    } = row;
    const title = usable(row.title, 'title')
      || usable(currentTitle, 'title')
      || '曲名不明';
    const artist = usable(row.artist, 'artist')
      || usable(currentArtist, 'artist')
      || '—';
    return {
      ...publicRow,
      title,
      artist,
      display_title: title !== '曲名不明' && artist !== '—' ? `${title} — ${artist}` : null,
      thumbnail_url: text(row.thumbnail_url),
      spotify_id: rowSpotifyId(row),
      isrc: rowIsrc(row),
    };
  });
}

async function persistRecoveredIdentity(db, baseRows, enrichedRows) {
  for (let index = 0; index < baseRows.length; index += 1) {
    const base = baseRows[index];
    const enriched = enrichedRows[index];
    const isrc = rowIsrc(enriched);
    const spotifyId = rowSpotifyId(enriched);
    if (!isrc && !spotifyId) continue;

    if ((isrc && !normalizedIsrc(base.stored_isrc)) || (spotifyId && !text(base.stored_spotify_id))) {
      const bindings = [isrc, spotifyId, base.track_identity];
      await safeRun(db, `UPDATE sh_track_ranking_current SET
        isrc=CASE WHEN isrc IS NULL OR TRIM(isrc)='' THEN COALESCE(?,isrc) ELSE isrc END,
        spotify_id=CASE WHEN spotify_id IS NULL OR TRIM(spotify_id)='' THEN COALESCE(?,spotify_id) ELSE spotify_id END
        WHERE track_identity=?`, bindings);
      await safeRun(db, `UPDATE sh_track_ranking_occurrence SET
        isrc=CASE WHEN isrc IS NULL OR TRIM(isrc)='' THEN COALESCE(?,isrc) ELSE isrc END,
        spotify_id=CASE WHEN spotify_id IS NULL OR TRIM(spotify_id)='' THEN COALESCE(?,spotify_id) ELSE spotify_id END
        WHERE track_identity=?`, bindings);
    }

    if (base.track_id != null) {
      await safeRun(db, `UPDATE sh_tracks SET
        isrc=CASE WHEN isrc IS NULL OR TRIM(isrc)='' THEN COALESCE(?,isrc) ELSE isrc END,
        spotify_id=CASE WHEN spotify_id IS NULL OR TRIM(spotify_id)='' THEN COALESCE(?,spotify_id) ELSE spotify_id END
        WHERE id=?`, [isrc, spotifyId, base.track_id]);
    }
  }
}

export async function loadTrackRanking(db, { limit = 500, persist = true } = {}) {
  const boundedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 500), 20), 500);
  const [result, summary] = await Promise.all([
    db.prepare(TRACK_RANKING_SQL).bind(boundedLimit).all(),
    db.prepare(TRACK_RANKING_SUMMARY_SQL).first(),
  ]);
  const baseRows = result.results || [];
  const hydratedRows = await hydrateRankingCanonicalMetadata(db, baseRows);
  const rows = enrichRanking(hydratedRows);
  if (persist) await persistRecoveredIdentity(db, baseRows, rows);
  return {
    rows: rows.map((row, index) => ({ rank: index + 1, ...row })),
    summary: {
      track_count: Number(summary?.track_count || 0),
      max_like_count: Number(summary?.max_like_count || 0),
      total_like_count: Number(summary?.total_like_count || 0),
      latest_observed_at: Number(summary?.latest_observed_at || 0) || null,
    },
  };
}
