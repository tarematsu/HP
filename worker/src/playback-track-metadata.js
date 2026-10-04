import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import { fetchTrackMetadata } from './track-metadata.js';
import { sanitizeMetadataRow, trackNeedsHydration } from './track-metadata-quality.js';

const VISIBLE_TRACK_LIMIT = 6;
const EXTERNAL_LOOKUP_LIMIT = 2;
const FAILURE_RETRY_MS = 15 * 60_000;
const FAILURE_CACHE_MAX = 256;
const CANONICAL_PRESENTATION_VERSION = 1;
const failedUntil = new Map();

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function missingPresentation(track) {
  return Boolean(text(track?.spotify_id) && (!text(track?.title) || !text(track?.artist)));
}

function authoritativeSpotifyRow(row) {
  return ['spotify_oembed', 'isrc_peer'].includes(text(row?.source));
}

function trustedCanonicalSeed(track) {
  return Number(track?.track_id) > 0
    && !trackNeedsHydration(track)
    && Number(track?.presentation_version) === CANONICAL_PRESENTATION_VERSION;
}

function trustedAggregateSeed(track) {
  return Number(track?.track_id) > 0
    && text(track?.title)
    && text(track?.artist)
    && Number(track?.presentation_version) === CANONICAL_PRESENTATION_VERSION;
}

function markCanonicalPresentation(rows) {
  return (rows || []).map((row) => Number(row?.track_id) > 0 && !trackNeedsHydration(row)
    ? { ...row, presentation_version: CANONICAL_PRESENTATION_VERSION }
    : row);
}

function pruneFailureCache(now) {
  for (const [spotifyId, retryAt] of failedUntil) {
    if (retryAt <= now) failedUntil.delete(spotifyId);
  }
  while (failedUntil.size > FAILURE_CACHE_MAX) {
    failedUntil.delete(failedUntil.keys().next().value);
  }
}

function mergePresentation(tracks, rows) {
  if (!rows?.length) return tracks;
  const bySpotify = new Map(rows.map((row) => [text(row?.spotify_id), row]).filter(([id]) => id));
  let changed = false;
  const merged = tracks.map((track) => {
    const row = bySpotify.get(text(track?.spotify_id));
    if (!row) return track;
    const authoritative = authoritativeSpotifyRow(row);
    const title = authoritative
      ? text(row?.title) || text(track?.title)
      : text(track?.title) || text(row?.title);
    const artist = authoritative
      ? text(row?.artist) || text(track?.artist)
      : text(track?.artist) || text(row?.artist);
    const thumbnailUrl = authoritative
      ? text(row?.thumbnail_url) || text(track?.thumbnail_url)
      : text(track?.thumbnail_url) || text(row?.thumbnail_url);
    const isrc = text(track?.isrc) || text(row?.isrc);
    if (title === text(track?.title)
        && artist === text(track?.artist)
        && thumbnailUrl === text(track?.thumbnail_url)
        && isrc === text(track?.isrc)) return track;
    changed = true;
    return {
      ...track,
      title,
      artist,
      thumbnail_url: thumbnailUrl,
      isrc,
    };
  });
  return changed ? merged : tracks;
}

async function loadStoredPresentation(db, spotifyIds) {
  if (!spotifyIds.length) return [];
  const placeholders = spotifyIds.map(() => '?').join(',');
  const result = await db.prepare(`SELECT spotify_id,isrc,title,artist,thumbnail_url,source,fetched_at
    FROM sh_track_metadata WHERE spotify_id IN (${placeholders})`)
    .bind(...spotifyIds)
    .all();
  return result.results || [];
}

function metadataStatement(db, row) {
  return db.prepare(`INSERT INTO sh_track_metadata(
      spotify_id,isrc,title,artist,display_title,thumbnail_url,spotify_url,source,fetched_at,raw_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(spotify_id) DO UPDATE SET
      isrc=COALESCE(sh_track_metadata.isrc,excluded.isrc),
      title=CASE WHEN excluded.title IS NOT NULL AND (
          sh_track_metadata.title IS NULL OR TRIM(sh_track_metadata.title)=''
          OR sh_track_metadata.title=sh_track_metadata.spotify_id
          OR (excluded.source IN ('spotify_oembed','isrc_peer')
            AND excluded.fetched_at>=sh_track_metadata.fetched_at)
        ) THEN excluded.title ELSE sh_track_metadata.title END,
      artist=CASE WHEN excluded.artist IS NOT NULL AND (
          sh_track_metadata.artist IS NULL OR TRIM(sh_track_metadata.artist)=''
          OR sh_track_metadata.artist=sh_track_metadata.spotify_id
          OR sh_track_metadata.artist GLOB 'JP[A-Z0-9]*'
          OR (excluded.source IN ('spotify_oembed','isrc_peer')
            AND excluded.fetched_at>=sh_track_metadata.fetched_at)
        ) THEN excluded.artist ELSE sh_track_metadata.artist END,
      display_title=CASE WHEN excluded.display_title IS NOT NULL
          AND (sh_track_metadata.display_title IS NULL OR TRIM(sh_track_metadata.display_title)=''
            OR (excluded.source IN ('spotify_oembed','isrc_peer')
              AND excluded.fetched_at>=sh_track_metadata.fetched_at))
        THEN excluded.display_title ELSE sh_track_metadata.display_title END,
      thumbnail_url=CASE WHEN excluded.thumbnail_url IS NOT NULL
          AND (sh_track_metadata.thumbnail_url IS NULL OR TRIM(sh_track_metadata.thumbnail_url)=''
            OR (excluded.source IN ('spotify_oembed','isrc_peer')
              AND excluded.fetched_at>=sh_track_metadata.fetched_at))
        THEN excluded.thumbnail_url ELSE sh_track_metadata.thumbnail_url END,
      spotify_url=COALESCE(sh_track_metadata.spotify_url,excluded.spotify_url),
      source=excluded.source,
      fetched_at=MAX(sh_track_metadata.fetched_at,excluded.fetched_at),
      raw_json=excluded.raw_json`)
    .bind(
      row.spotify_id,
      row.isrc || null,
      row.title,
      row.artist,
      row.display_title || null,
      row.thumbnail_url || null,
      row.spotify_url || null,
      row.source || 'spotify_oembed',
      Number(row.fetched_at) || Date.now(),
      JSON.stringify(row.raw || {}),
    );
}

export async function resolveMissingSpotifyPresentation(
  db,
  tracks = [],
  { skipStoredLookup = false, requestTimeoutMs = 8_000 } = {},
) {
  if (!db?.prepare || !tracks.length) return tracks;
  let resolved = tracks.map(sanitizeMetadataRow);
  const visible = resolved.slice(0, VISIBLE_TRACK_LIMIT);
  const candidateIds = [...new Set(visible
    .filter(missingPresentation)
    .map((track) => text(track.spotify_id))
    .filter(Boolean))];
  if (!candidateIds.length) return resolved;

  try {
    if (!skipStoredLookup) {
      resolved = mergePresentation(resolved, await loadStoredPresentation(db, candidateIds));
    }

    const now = Date.now();
    pruneFailureCache(now);
    const retryable = [...new Set(resolved
      .slice(0, VISIBLE_TRACK_LIMIT)
      .filter(missingPresentation)
      .map((track) => text(track.spotify_id))
      .filter((spotifyId) => spotifyId && (failedUntil.get(spotifyId) || 0) <= now))]
      .slice(0, EXTERNAL_LOOKUP_LIMIT);
    if (!retryable.length) return resolved;

    const sourceById = new Map(resolved.map((track) => [text(track?.spotify_id), track]).filter(([id]) => id));
    const fetched = [];
    for (const spotifyId of retryable) {
      const source = sourceById.get(spotifyId) || { spotify_id: spotifyId };
      const metadata = await fetchTrackMetadata(source, {
        collectionSignal: null,
        requestTimeoutMs: Math.max(1_000, Math.min(15_000, Number(requestTimeoutMs) || 8_000)),
      });
      if (!metadata?.title || !metadata?.artist) {
        failedUntil.set(spotifyId, now + FAILURE_RETRY_MS);
        continue;
      }
      failedUntil.delete(spotifyId);
      fetched.push(metadata);
    }

    if (!fetched.length) return resolved;
    if (typeof db.batch === 'function') {
      await db.batch(fetched.map((row) => metadataStatement(db, row)));
    } else {
      for (const row of fetched) await metadataStatement(db, row).run();
    }
    return mergePresentation(resolved, fetched);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'playback_spotify_metadata_repair_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return resolved;
  }
}

// Stationhead title/artist values are provisional even when non-empty. Only a
// row that was canonicalized by this version may skip the next D1 lookup. That
// gives new/changed Spotify tracks one bounded canonical verification, while an
// unchanged queue keeps the previous no-read fast path.
export async function hydratePlaybackTrackMetadata(db, tracks = [], previous = []) {
  if (!tracks.length) return tracks;
  const clean = tracks.map(sanitizeMetadataRow);
  const seedRows = previous
    .map(sanitizeMetadataRow)
    .filter(trustedCanonicalSeed);
  const canonical = markCanonicalPresentation(await canonicalizeTrackRows(db, clean, { seedRows }));
  // canonicalizeTrackRows already checked the central presentation view. Only
  // unresolved visible Spotify ids reach the network path, so no second D1 read.
  return resolveMissingSpotifyPresentation(db, canonical, { skipStoredLookup: true });
}

export async function hydratePlaybackAggregates(db, daily, likes, queue = []) {
  const dailyEntries = Object.entries(daily?.tracks || {});
  const likeEntries = Object.entries(likes || {});
  const rows = [...dailyEntries, ...likeEntries].map(([, row]) => sanitizeMetadataRow(row));
  const seedRows = [...queue, ...rows].map(sanitizeMetadataRow)
    .filter(trustedAggregateSeed);
  const hydrated = markCanonicalPresentation(await canonicalizeTrackRows(db, rows, { seedRows }));
  const dailyRows = hydrated.slice(0, dailyEntries.length);
  const likeRows = hydrated.slice(dailyEntries.length);
  return {
    daily: { ...daily, tracks: Object.fromEntries(dailyEntries.map(([key], index) => [key, dailyRows[index]])) },
    likes: Object.fromEntries(likeEntries.map(([key], index) => [key, likeRows[index]])),
  };
}
