export const TRACK_RANKING_SQL = `SELECT
  current.track_identity,current.track_id,
  current.title AS current_title,current.artist AS current_artist,
  direct.title AS direct_title,direct.artist AS direct_artist,
  by_isrc.title AS isrc_title,by_isrc.artist AS isrc_artist,
  by_spotify.title AS spotify_title,by_spotify.artist AS spotify_artist,
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

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
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
  const marker = `${prefix}:`;
  if (!identity?.startsWith(marker)) return null;
  return text(identity.slice(marker.length));
}

function rowSpotifyId(row) {
  return text(row?.spotify_id) || identityValue(row, 'spotify');
}

function rowIsrc(row) {
  return normalizedIsrc(row?.isrc) || normalizedIsrc(identityValue(row, 'isrc')) || null;
}

function chunks(values, size = 70) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function safeRows(db, sql, bindings) {
  try {
    return (await db.prepare(sql).bind(...bindings).all()).results || [];
  } catch (error) {
    if (/no such table|no such column|no such index/i.test(String(error?.message || error))) return [];
    throw error;
  }
}

async function metadataRows(db, rows) {
  const spotifyIds = [...new Set(rows.map(rowSpotifyId).filter(Boolean))];
  const isrcs = [...new Set(rows.map(rowIsrc).filter(Boolean))];
  const metadata = [];

  for (const part of chunks(spotifyIds)) {
    const marks = part.map(() => '?').join(',');
    let found = await safeRows(db, `SELECT spotify_id,isrc,title,artist,display_title,thumbnail_url,fetched_at
      FROM sh_track_metadata WHERE spotify_id IN (${marks}) ORDER BY fetched_at DESC`, part);
    if (!found.length) {
      found = await safeRows(db, `SELECT spotify_id,title,artist,display_title,thumbnail_url,fetched_at
        FROM sh_track_metadata WHERE spotify_id IN (${marks}) ORDER BY fetched_at DESC`, part);
    }
    metadata.push(...found);
  }

  for (const part of chunks(isrcs)) {
    const marks = part.map(() => '?').join(',');
    metadata.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,display_title,thumbnail_url,fetched_at
      FROM sh_track_metadata
      WHERE isrc IS NOT NULL AND TRIM(isrc)<>'' AND UPPER(REPLACE(REPLACE(isrc,'-',''),' ','')) IN (${marks})
      ORDER BY fetched_at DESC`, part));
    metadata.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,NULL AS display_title,thumbnail_url,metadata_fetched_at AS fetched_at
      FROM sh_track_dictionary WHERE isrc IN (${marks}) ORDER BY metadata_fetched_at DESC`, part));
  }
  return metadata;
}

function mergeMetadata(current, candidate) {
  if (!current) return {
    ...candidate,
    title: usable(candidate?.title, 'title'),
    artist: usable(candidate?.artist, 'artist'),
    isrc: normalizedIsrc(candidate?.isrc) || null,
  };
  return {
    ...candidate,
    ...current,
    title: usable(current.title, 'title') || usable(candidate?.title, 'title'),
    artist: usable(current.artist, 'artist') || usable(candidate?.artist, 'artist'),
    display_title: text(current.display_title) || text(candidate?.display_title),
    thumbnail_url: text(current.thumbnail_url) || text(candidate?.thumbnail_url),
    spotify_id: text(current.spotify_id) || text(candidate?.spotify_id),
    isrc: normalizedIsrc(current.isrc) || normalizedIsrc(candidate?.isrc) || null,
    fetched_at: Math.max(Number(current.fetched_at || 0), Number(candidate?.fetched_at || 0)) || null,
  };
}

function metadataMaps(metadata) {
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const row of metadata) {
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    if (spotifyId) bySpotify.set(spotifyId, mergeMetadata(bySpotify.get(spotifyId), row));
    if (isrc) byIsrc.set(isrc, mergeMetadata(byIsrc.get(isrc), row));
  }
  return { bySpotify, byIsrc };
}

function enrichRanking(rows, metadata) {
  const { bySpotify, byIsrc } = metadataMaps(metadata);
  return rows.map((row) => {
    const spotifyId = rowSpotifyId(row);
    const isrc = rowIsrc(row);
    const metadataRow = bySpotify.get(spotifyId) || byIsrc.get(isrc) || null;
    const {
      current_title: currentTitle,
      current_artist: currentArtist,
      direct_title: directTitle,
      direct_artist: directArtist,
      isrc_title: isrcTitle,
      isrc_artist: isrcArtist,
      spotify_title: spotifyTitle,
      spotify_artist: spotifyArtist,
      ...publicRow
    } = row;
    const title = usable(metadataRow?.title, 'title')
      || usable(directTitle, 'title')
      || usable(isrcTitle, 'title')
      || usable(spotifyTitle, 'title')
      || usable(currentTitle, 'title')
      || '曲名不明';
    const artist = usable(metadataRow?.artist, 'artist')
      || usable(directArtist, 'artist')
      || usable(isrcArtist, 'artist')
      || usable(spotifyArtist, 'artist')
      || usable(currentArtist, 'artist')
      || '—';
    return {
      ...publicRow,
      title,
      artist,
      display_title: text(metadataRow?.display_title),
      thumbnail_url: text(metadataRow?.thumbnail_url),
      spotify_id: spotifyId || text(metadataRow?.spotify_id),
      isrc: isrc || normalizedIsrc(metadataRow?.isrc) || null,
    };
  });
}

export async function loadTrackRanking(db, { limit = 500 } = {}) {
  const boundedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 500), 20), 500);
  const [result, summary] = await Promise.all([
    db.prepare(TRACK_RANKING_SQL).bind(boundedLimit).all(),
    db.prepare(TRACK_RANKING_SUMMARY_SQL).first(),
  ]);
  const baseRows = result.results || [];
  const metadata = await metadataRows(db, baseRows);
  const rows = enrichRanking(baseRows, metadata);
  return {
    rows: rows.map((row, index) => ({ rank: index + 1, ...row })),
    summary: {
      track_count: Number(summary?.track_count || 0),
      max_like_count: Number(summary?.max_like_count || 0),
      latest_observed_at: Number(summary?.latest_observed_at || 0) || null,
    },
  };
}
