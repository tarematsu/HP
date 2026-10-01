const CANONICAL_METADATA_CHUNK_SIZE = 80;

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

export async function loadAmazonMusicCanonicalMetadata(db, trackIdByAmazonId) {
  if (!db?.prepare || !(trackIdByAmazonId instanceof Map) || !trackIdByAmazonId.size) return new Map();
  const trackIds = [...new Set([...trackIdByAmazonId.values()]
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  const metadata = new Map();
  for (let offset = 0; offset < trackIds.length; offset += CANONICAL_METADATA_CHUNK_SIZE) {
    const part = trackIds.slice(offset, offset + CANONICAL_METADATA_CHUNK_SIZE);
    const placeholders = part.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT
        t.id AS track_id,
        COALESCE(NULLIF(TRIM(d.title),''),
          CASE WHEN t.title IS NULL OR TRIM(t.title)='' OR TRIM(t.title)=TRIM(t.spotify_id)
            THEN NULL ELSE TRIM(t.title) END) AS title,
        COALESCE(NULLIF(TRIM(d.artist),''),
          CASE WHEN t.artist IS NULL OR TRIM(t.artist)='' OR TRIM(t.artist)=TRIM(t.spotify_id)
              OR TRIM(t.artist) GLOB 'JP[A-Z0-9]*'
            THEN NULL ELSE TRIM(t.artist) END) AS artist
      FROM sh_tracks t
      LEFT JOIN sh_track_dictionary d
        ON d.isrc=UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))
      WHERE t.id IN (${placeholders})`)
      .bind(...part).all();
    for (const row of rows?.results || []) {
      const trackId = Number(row?.track_id);
      if (!Number.isSafeInteger(trackId) || trackId <= 0) continue;
      metadata.set(trackId, {
        title: text(row?.title),
        artist: text(row?.artist),
      });
    }
  }
  return metadata;
}
