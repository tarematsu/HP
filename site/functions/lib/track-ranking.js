import { canonicalizeTrackRows } from './canonical-track-rows.js';

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

const LOOKUP_CHUNK_SIZE = 80;

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

async function safeRows(db, sql, bindings) {
  try {
    const result = await db.prepare(sql).bind(...bindings).all();
    return result?.results || [];
  } catch (error) {
    if (/no such table|no such column|no such index/i.test(String(error?.message || error))) return [];
    throw error;
  }
}

function needsDictionaryFallback(row) {
  return !usable(row?.title, 'title') || !usable(row?.artist, 'artist');
}

function mergeDictionaryPresentation(row, metadata) {
  if (!metadata) return row;
  return {
    ...row,
    title: usable(metadata.title, 'title') || row.title,
    artist: usable(metadata.artist, 'artist') || row.artist,
    thumbnail_url: text(row.thumbnail_url) || text(metadata.thumbnail_url),
    spotify_id: rowSpotifyId(row) || text(metadata.spotify_id),
    isrc: rowIsrc(row) || normalizedIsrc(metadata.isrc) || null,
  };
}

async function hydrateDictionaryOnlyRows(db, rows) {
  const targets = rows.filter(needsDictionaryFallback);
  if (!targets.length) return rows;

  const byIsrc = new Map();
  const isrcs = [...new Set(targets.map(rowIsrc).filter(Boolean))];
  for (let offset = 0; offset < isrcs.length; offset += LOOKUP_CHUNK_SIZE) {
    const part = isrcs.slice(offset, offset + LOOKUP_CHUNK_SIZE);
    const found = await safeRows(db, `SELECT isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_dictionary WHERE isrc IN (${placeholders(part.length)})`, part);
    for (const row of found) {
      const isrc = normalizedIsrc(row?.isrc);
      if (isrc) byIsrc.set(isrc, row);
    }
  }

  const unresolvedSpotify = [...new Set(targets
    .filter((row) => !byIsrc.has(rowIsrc(row)))
    .map(rowSpotifyId)
    .filter(Boolean))];
  const bySpotify = new Map();
  for (let offset = 0; offset < unresolvedSpotify.length; offset += LOOKUP_CHUNK_SIZE) {
    const part = unresolvedSpotify.slice(offset, offset + LOOKUP_CHUNK_SIZE);
    const found = await safeRows(db, `SELECT isrc,spotify_id,title,artist,thumbnail_url
      FROM sh_track_dictionary
      WHERE spotify_id IN (${placeholders(part.length)})`, part);
    for (const row of found) {
      const spotifyId = text(row?.spotify_id);
      if (spotifyId) bySpotify.set(spotifyId, row);
    }
  }

  return rows.map((row) => mergeDictionaryPresentation(
    row,
    byIsrc.get(rowIsrc(row)) || bySpotify.get(rowSpotifyId(row)) || null,
  ));
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
  const identityRows = baseRows.map((row) => ({
    ...row,
    isrc: rowIsrc(row),
    spotify_id: rowSpotifyId(row),
  }));
  // Resolve normal rows through indexed sh_tracks + dictionary. Legacy provider
  // identities that have no sh_tracks owner get one bounded dictionary lookup.
  const canonicalRows = await canonicalizeTrackRows(db, identityRows);
  const hydratedRows = await hydrateDictionaryOnlyRows(db, canonicalRows);
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
