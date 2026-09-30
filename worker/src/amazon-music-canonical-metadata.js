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
    const rows = await db.prepare(`SELECT track_id,title,artist
      FROM sh_track_canonical_metadata
      WHERE track_id IN (${placeholders})`)
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
