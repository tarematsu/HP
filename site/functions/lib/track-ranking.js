export const TRACK_RANKING_SQL = `SELECT
  current.track_identity,current.track_id,
  current.title AS current_title,current.artist AS current_artist,
  current.isrc AS stored_isrc,current.spotify_id AS stored_spotify_id,
  direct.title AS direct_title,direct.artist AS direct_artist,
  by_isrc.title AS isrc_title,by_isrc.artist AS isrc_artist,
  by_spotify.title AS spotify_title,by_spotify.artist AS spotify_artist,
  COALESCE(direct.isrc,by_isrc.isrc,by_spotify.isrc,current.isrc) AS isrc,
  COALESCE(direct.spotify_id,by_isrc.spotify_id,by_spotify.spotify_id,current.spotify_id) AS spotify_id,
  COALESCE(direct.thumbnail_url,by_isrc.thumbnail_url,by_spotify.thumbnail_url) AS thumbnail_url,
  current.latest_like_count,current.latest_observed_at,current.latest_occurrence_key
FROM sh_track_ranking_current current
LEFT JOIN sh_track_canonical_metadata direct
  ON direct.track_id=current.track_id
LEFT JOIN sh_track_canonical_metadata by_isrc
  ON current.track_id IS NULL
 AND by_isrc.isrc=COALESCE(
   NULLIF(UPPER(REPLACE(REPLACE(TRIM(current.isrc),'-',''),' ','')),''),
   CASE
     WHEN current.track_identity LIKE 'isrc:%'
       THEN UPPER(REPLACE(REPLACE(TRIM(SUBSTR(current.track_identity,6)),'-',''),' ',''))
     WHEN current.track_identity LIKE 'key:isrc:%'
       THEN UPPER(REPLACE(REPLACE(TRIM(SUBSTR(current.track_identity,10)),'-',''),' ',''))
   END
 )
LEFT JOIN sh_track_canonical_metadata by_spotify
  ON current.track_id IS NULL AND by_isrc.isrc IS NULL
 AND by_spotify.spotify_id=COALESCE(
   NULLIF(TRIM(current.spotify_id),''),
   CASE
     WHEN current.track_identity LIKE 'spotify:%'
       THEN NULLIF(TRIM(SUBSTR(current.track_identity,9)),'')
     WHEN current.track_identity LIKE 'key:spotify:%'
       THEN NULLIF(TRIM(SUBSTR(current.track_identity,13)),'')
   END
 )
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

function enrichRanking(rows) {
  return rows.map((row) => {
    const {
      current_title: currentTitle,
      current_artist: currentArtist,
      stored_isrc: _storedIsrc,
      stored_spotify_id: _storedSpotifyId,
      direct_title: directTitle,
      direct_artist: directArtist,
      isrc_title: isrcTitle,
      isrc_artist: isrcArtist,
      spotify_title: spotifyTitle,
      spotify_artist: spotifyArtist,
      ...publicRow
    } = row;
    const title = usable(directTitle, 'title')
      || usable(isrcTitle, 'title')
      || usable(spotifyTitle, 'title')
      || usable(currentTitle, 'title')
      || '曲名不明';
    const artist = usable(directArtist, 'artist')
      || usable(isrcArtist, 'artist')
      || usable(spotifyArtist, 'artist')
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
  const rows = enrichRanking(baseRows);
  if (persist) await persistRecoveredIdentity(db, baseRows, rows);
  return {
    rows: rows.map((row, index) => ({ rank: index + 1, ...row })),
    summary: {
      track_count: Number(summary?.track_count || 0),
      max_like_count: Number(summary?.max_like_count || 0),
      latest_observed_at: Number(summary?.latest_observed_at || 0) || null,
    },
  };
}
