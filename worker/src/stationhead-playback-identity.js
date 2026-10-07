import {
  hydratePlaybackAggregates,
  hydratePlaybackTrackMetadata,
} from './playback-track-metadata.js';
import { resolveTracksBulk } from './minute-facts-track-resolution.js';
import {
  emptyPlaybackDaily,
  stationheadPlaybackTrackKey,
} from './stationhead-playback-core.js';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function text(value, limit = 500) {
  const parsed = String(value ?? '').trim();
  return parsed ? parsed.slice(0, limit) : null;
}

function normalizedIdentitySource(track = {}) {
  const key = text(track?.track_key) || stationheadPlaybackTrackKey(track);
  return {
    ...track,
    track_id: integer(track?.track_id ?? track?.trackId),
    track_key: key,
    isrc: text(track?.isrc)?.toUpperCase()
      || (key?.startsWith('isrc:') ? key.slice('isrc:'.length).toUpperCase() : null),
    spotify_id: text(track?.spotify_id)
      || (key?.startsWith('spotify:') ? key.slice('spotify:'.length) : null),
    stationhead_track_id: integer(track?.stationhead_track_id)
      ?? (key?.startsWith('stationhead:') ? integer(key.slice('stationhead:'.length)) : null),
  };
}

function identitySources(tracks, previous) {
  return [
    ...(Array.isArray(tracks) ? tracks : []),
    ...(previous?.queue || []),
    ...Object.values(previous?.daily?.tracks || {}),
    ...Object.values(previous?.likes || {}),
  ].map(normalizedIdentitySource);
}

function canonicalIdMap(sources) {
  const byKey = new Map();
  for (const source of sources) {
    const trackId = integer(source?.track_id);
    const key = text(source?.track_key) || stationheadPlaybackTrackKey(source);
    if (trackId != null && key) byKey.set(key, trackId);
  }
  return byKey;
}

function withCanonicalTrackId(track, byKey) {
  const normalized = normalizedIdentitySource(track);
  const direct = integer(normalized.track_id);
  if (direct != null) return { ...normalized, track_id: direct };
  const resolved = byKey.get(normalized.track_key);
  return resolved == null ? normalized : { ...normalized, track_id: resolved };
}

function canonicalizeDaily(daily, byKey) {
  if (!daily?.period_key) return emptyPlaybackDaily('');
  const tracks = {};
  const unique = new Set();
  let totalPlays = 0;
  for (const source of Object.values(daily.tracks || {})) {
    const track = withCanonicalTrackId(source, byKey);
    const trackId = integer(track.track_id);
    const count = Math.max(0, integer(source?.count) || 0);
    if (trackId == null || count === 0) continue;
    const key = String(trackId);
    const previous = tracks[key] || {};
    tracks[key] = {
      track_id: trackId,
      track_key: track.track_key || previous.track_key || null,
      title: track.title || previous.title || null,
      artist: track.artist || previous.artist || null,
      spotify_id: track.spotify_id || previous.spotify_id || null,
      count: (integer(previous.count) || 0) + count,
    };
    unique.add(key);
    totalPlays += count;
  }
  return {
    period_key: String(daily.period_key),
    total_plays: totalPlays,
    unique_track_ids: [...unique],
    tracks,
  };
}

function canonicalizeLikes(likes, byKey) {
  const result = {};
  for (const source of Object.values(likes || {})) {
    const track = withCanonicalTrackId(source, byKey);
    const trackId = integer(track.track_id);
    if (trackId == null) continue;
    const key = String(trackId);
    const existing = result[key];
    if (existing && (integer(existing.observed_at) || 0) > (integer(track.observed_at) || 0)) continue;
    result[key] = { ...track, track_id: trackId };
  }
  return result;
}

export async function canonicalizeStationheadPlayback(
  catalogDb,
  metadataDb,
  tracks,
  previous,
  observedAt,
  { channelId = 'stationhead' } = {},
) {
  if (!catalogDb?.prepare) throw new Error('MINUTE_DB binding is missing');
  const currentTracks = Array.isArray(tracks) ? tracks : [];
  const sources = identitySources(currentTracks, previous);
  const byKey = canonicalIdMap(sources);
  const unresolvedByKey = new Map();
  for (const source of sources) {
    const key = text(source?.track_key) || stationheadPlaybackTrackKey(source);
    if (!key || byKey.has(key) || unresolvedByKey.has(key)) continue;
    unresolvedByKey.set(key, source);
  }

  const unresolved = [...unresolvedByKey.values()];
  if (unresolved.length) {
    const resolved = await resolveTracksBulk(
      catalogDb,
      metadataDb || null,
      unresolved,
      observedAt,
      {
        channelId,
        minuteAt: Math.floor(observedAt / 60_000) * 60_000,
        queueTracks: currentTracks.length,
        revisionId: null,
      },
    );
    for (const descriptor of resolved) {
      const trackId = integer(descriptor?.trackId);
      const key = text(descriptor?.track_key) || stationheadPlaybackTrackKey(descriptor);
      if (trackId != null && key) byKey.set(key, trackId);
    }
  }

  const hydratedTracks = await hydratePlaybackTrackMetadata(
    catalogDb,
    currentTracks.map((track) => withCanonicalTrackId(track, byKey)),
    previous?.queue || [],
  );
  const aggregates = await hydratePlaybackAggregates(
    catalogDb,
    canonicalizeDaily(previous?.daily, byKey),
    canonicalizeLikes(previous?.likes, byKey),
    hydratedTracks,
  );
  return {
    tracks: hydratedTracks,
    daily: aggregates.daily,
    likes: aggregates.likes,
  };
}


export async function canonicalizeStationheadQueueTracks(
  catalogDb,
  tracks,
  observedAt = Date.now(),
  {
    metadataDb = null,
    previousTracks = [],
    channelId = 'stationhead',
  } = {},
) {
  const canonical = await canonicalizeStationheadPlayback(
    catalogDb,
    metadataDb,
    tracks,
    {
      queue: Array.isArray(previousTracks) ? previousTracks : [],
      daily: emptyPlaybackDaily(''),
      likes: {},
    },
    observedAt,
    { channelId },
  );
  return canonical.tracks;
}
