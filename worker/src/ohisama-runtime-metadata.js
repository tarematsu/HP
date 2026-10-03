import { environmentView } from '../../packages/sh-shared/environment-view.mjs';
import { ingest } from './collector-ingest.js';
import { resolveOhisamaPlaybackWindow } from './ohisama-playback.js';
import { enrichTracks } from './track-metadata.js';

const DEFAULT_METADATA_LIMIT = 2;
const MAX_METADATA_LIMIT = 6;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function boundedLimit(value, fallback = DEFAULT_METADATA_LIMIT) {
  const parsed = positiveInteger(value) || fallback;
  return Math.max(1, Math.min(MAX_METADATA_LIMIT, parsed));
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function ohisamaPlaybackMetadataCandidates(channel, stationId, observedAt) {
  const normalizedStationId = positiveInteger(stationId);
  if (normalizedStationId == null) return [];
  const playback = resolveOhisamaPlaybackWindow(channel, normalizedStationId, observedAt);
  const unique = new Map();
  for (const track of playback?.queue || []) {
    const spotifyId = text(track?.spotify_id);
    if (!spotifyId || unique.has(spotifyId)) continue;
    unique.set(spotifyId, {
      ...track,
      spotify_id: spotifyId,
      isrc: text(track?.isrc)?.toUpperCase() || null,
    });
  }
  return [...unique.values()];
}

export async function enrichOhisamaPlaybackMetadata(
  env,
  channel,
  collection,
  observedAt = Date.now(),
  dependencies = {},
) {
  const db = env?.MINUTE_DB;
  if (!db?.prepare) return { attempted: 0, saved: 0, skipped: true, reason: 'minute-db-binding-missing' };

  const stationId = positiveInteger(collection?.station_id ?? collection?.stationId);
  if (stationId == null) return { attempted: 0, saved: 0, skipped: true, reason: 'station-id-missing' };

  const tracks = ohisamaPlaybackMetadataCandidates(channel, stationId, observedAt);
  if (!tracks.length) return { attempted: 0, saved: 0, skipped: true, reason: 'spotify-id-missing' };

  const limit = Math.min(
    tracks.length,
    boundedLimit(env?.OHISAMA_METADATA_LIMIT ?? dependencies.metadataLimit),
  );
  const requestTimeoutMs = Math.max(
    1_000,
    Math.min(15_000, Number(env?.REQUEST_TIMEOUT_MS) || DEFAULT_REQUEST_TIMEOUT_MS),
  );
  const sourceEnv = environmentView(env, { DB: db });
  const enrich = dependencies.enrichTracks || enrichTracks;
  const ingestFn = dependencies.ingest || ingest;
  const result = await enrich(
    sourceEnv,
    ingestFn,
    { tracks },
    observedAt,
    {
      collectionSignal: null,
      requestTimeoutMs,
      metadataLimit: limit,
      // Ohisama already has canonical ids. Avoid the queue-history ISRC repair
      // scan here; direct Spotify presentation lookup is bounded and cheaper.
      metadataRepairLimit: 0,
      returnDetails: true,
    },
  );
  const saved = Number(result?.saved ?? result ?? 0);
  return {
    attempted: limit,
    saved: Number.isFinite(saved) ? saved : 0,
    candidates: tracks.length,
    skipped: false,
  };
}
