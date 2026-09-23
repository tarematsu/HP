import { trackNeedsHydration } from './track-metadata-quality.js';
import { trackTitleArtistKey } from './track-title-artist-identity.js';

function normalizedIdentity(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function providerIdentity(track) {
  return Boolean(
    String(track?.spotify_id || '').trim()
      || normalizedIdentity(track?.isrc),
  );
}

function stationheadIdentity(track) {
  const stationheadTrackId = Number(track?.stationhead_track_id);
  return Number.isFinite(stationheadTrackId) && stationheadTrackId > 0;
}

function identityState(track) {
  const hasProviderIdentity = providerIdentity(track);
  if (hasProviderIdentity) {
    return {
      hasProviderIdentity: true,
      hasLookup: true,
      needsProviderIdentity: false,
    };
  }
  const hasTitleArtist = Boolean(trackTitleArtistKey(track));
  return {
    hasProviderIdentity: false,
    hasLookup: stationheadIdentity(track) || hasTitleArtist,
    needsProviderIdentity: hasTitleArtist,
  };
}

function tracksFromQueue(queue) {
  return Array.isArray(queue?.tracks) ? queue.tracks : null;
}

export function queueNeedsHydration(queue) {
  const tracks = tracksFromQueue(queue);
  if (!tracks) return false;
  const trackCount = tracks.length;
  for (let index = 0; index < trackCount; index += 1) {
    const track = tracks[index];
    if (!track || typeof track !== 'object') continue;
    const metadataIncomplete = trackNeedsHydration(track);
    const identity = identityState(track);
    if (!identity.hasLookup) continue;
    if (metadataIncomplete || identity.needsProviderIdentity) return true;
  }
  return false;
}

export function queueNeedsPreservation(queue) {
  const tracks = tracksFromQueue(queue);
  if (!tracks) return false;
  const trackCount = tracks.length;
  for (let index = 0; index < trackCount; index += 1) {
    const track = tracks[index];
    if (!track || typeof track !== 'object') continue;
    const metadataIncomplete = trackNeedsHydration(track);
    const identity = identityState(track);
    if (metadataIncomplete || identity.needsProviderIdentity || !track.album_name) return true;
  }
  return false;
}

export function readModelMetadataTask(readModel) {
  const tracks = tracksFromQueue(readModel?.queue?.value);
  if (!tracks) return null;
  let preserve = false;
  const trackCount = tracks.length;
  for (let index = 0; index < trackCount; index += 1) {
    const track = tracks[index];
    if (!track || typeof track !== 'object') continue;
    const metadataIncomplete = trackNeedsHydration(track);
    const identity = identityState(track);
    if (metadataIncomplete || identity.needsProviderIdentity) {
      if (identity.hasLookup) return 'read-model-hydration';
      preserve = true;
      continue;
    }
    if (!track.album_name) preserve = true;
  }
  return preserve ? 'read-model-preserve' : null;
}

export function readModelNeedsHydration(readModel) {
  return queueNeedsHydration(readModel?.queue?.value);
}

export function readModelNeedsPreservation(readModel) {
  return queueNeedsPreservation(readModel?.queue?.value);
}
