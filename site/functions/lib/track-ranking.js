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
  const spotifyIds = [...new Set(rows.map((row) => text(row.spotify_id)).filter(Boolean))];
  const isrcs = [...new Set(rows.map((row) => normalizedIsrc(row.isrc)).filter(Boolean))];
  const metadata = [];
  for (const part of chunks(spotifyIds)) {
    const marks = part.map(() => '?').join(',');
    metadata.push(...await safeRows(db, `SELECT spotify_id,title,artist,display_title,thumbnail_url,fetched_at
      FROM sh_track_metadata WHERE spotify_id IN (${marks}) ORDER BY fetched_at DESC`, part));
  }
  for (const part of chunks(isrcs)) {
    const marks = part.map(() => '?').join(',');
    metadata.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,NULL AS display_title,thumbnail_url,metadata_fetched_at AS fetched_at
      FROM sh_track_dictionary WHERE isrc IN (${marks}) ORDER BY metadata_fetched_at DESC`, part));
  }
  return metadata;
}

function enrichRanking(rows, metadata) {
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const row of metadata) {
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    if (spotifyId && !bySpotify.has(spotifyId)) bySpotify.set(spotifyId, row);
    if (isrc && !byIsrc.has(isrc)) byIsrc.set(isrc, row);
  }
  return rows.map((row) => {
    const metadataRow = bySpotify.get(text(row.spotify_id)) || byIsrc.get(normalizedIsrc(row.isrc));
    if (!metadataRow) return { ...row, thumbnail_url: null };
    const metadataTitle = text(metadataRow.title);
    const metadataArtist = text(metadataRow.artist);
    return {
      ...row,
      title: placeholder(row.title, 'title') && metadataTitle ? metadataTitle : row.title,
      artist: placeholder(row.artist, 'artist') && metadataArtist ? metadataArtist : row.artist,
      display_title: text(metadataRow.display_title),
      thumbnail_url: text(metadataRow.thumbnail_url),
      spotify_id: text(row.spotify_id) || text(metadataRow.spotify_id),
      isrc: normalizedIsrc(row.isrc) || normalizedIsrc(metadataRow.isrc) || null,
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
