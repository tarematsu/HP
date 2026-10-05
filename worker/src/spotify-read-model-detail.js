import { SPOTIFY_DETAIL_ARTISTS } from 'sh-shared/spotify-read-model.mjs';

const DEFAULT_ARTIST_KEYS = Object.freeze(SPOTIFY_DETAIL_ARTISTS.map((artist) => artist.key));
const ALLOWED_ARTIST_KEYS = new Set(DEFAULT_ARTIST_KEYS);

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function normalizedArtistKeys(values) {
  const source = Array.isArray(values) && values.length ? values : DEFAULT_ARTIST_KEYS;
  return [...new Set(source
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => ALLOWED_ARTIST_KEYS.has(value)))];
}

export function spotifyLatestSnapshotDatesSql(artistCount = DEFAULT_ARTIST_KEYS.length) {
  const count = Math.max(1, Math.trunc(Number(artistCount) || DEFAULT_ARTIST_KEYS.length));
  return `SELECT artist_key,MAX(snapshot_date) AS snapshot_date
    FROM sh_spotify_artist_daily
    WHERE artist_key IN (${placeholders(count)})
    GROUP BY artist_key`;
}

export function spotifyLatestDetailSql() {
  return `SELECT
    target.artist_key,
    d.snapshot_date,
    ref.track_id,
    d.track_id AS spotify_track_id,
    track.name,
    d.playcount,
    d.delta,
    d.collected_at,
    COALESCE(d.is_carried_forward,0) AS is_carried_forward
  FROM sh_spotify_track_targets AS target INDEXED BY idx_sh_spotify_track_targets_artist
  INNER JOIN sh_spotify_playcount_daily AS d
    ON d.track_id=target.track_id AND d.snapshot_date=?
  INNER JOIN sh_spotify_tracks AS track ON track.track_id=d.track_id
  LEFT JOIN music_service_track_refs AS ref
    ON ref.service='spotify' AND ref.source_track_id=d.track_id
  WHERE target.artist_key=?
  ORDER BY
    CASE WHEN d.delta IS NULL THEN 1 ELSE 0 END,
    d.delta DESC,
    d.playcount DESC,
    track.name COLLATE NOCASE ASC,
    d.track_id ASC`;
}

async function all(db, sql, bindings = []) {
  const statement = db.prepare(sql);
  const prepared = bindings.length && typeof statement?.bind === 'function'
    ? statement.bind(...bindings)
    : statement;
  if (typeof prepared?.all !== 'function') return { results: [] };
  return prepared.all();
}

export async function loadSpotifyLatestDetailRows(db, artistKeys = DEFAULT_ARTIST_KEYS) {
  if (!db?.prepare) return [];
  const keys = normalizedArtistKeys(artistKeys);
  if (!keys.length) return [];

  const latestResult = await all(db, spotifyLatestSnapshotDatesSql(keys.length), keys);
  const latestByArtist = new Map(rows(latestResult)
    .map((row) => [
      String(row?.artist_key || '').trim().toLowerCase(),
      String(row?.snapshot_date || '').trim(),
    ])
    .filter(([artistKey, snapshotDate]) => (
      ALLOWED_ARTIST_KEYS.has(artistKey)
      && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)
    )));

  const detailSql = spotifyLatestDetailSql();
  const detailResults = await Promise.all(keys.map(async (artistKey) => {
    const snapshotDate = latestByArtist.get(artistKey);
    if (!snapshotDate) return [];
    const result = await all(db, detailSql, [snapshotDate, artistKey]);
    return rows(result);
  }));
  return detailResults.flat();
}
