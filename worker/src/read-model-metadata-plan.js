import { trackNeedsHydration } from './track-metadata-quality.js';
import { trackTitleArtistKey } from './track-title-artist-identity.js';

function normalizedIdentity(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function hasStableTrackIdentity(track) {
  const stationheadTrackId = Number(track?.stationhead_track_id);
  return Boolean(
    String(track?.spotify_id || '').trim()
      || normalizedIdentity(track?.isrc)
      || (Number.isFinite(stationheadTrackId) && stationheadTrackId > 0),
  );
}

function hasHydrationLookup(track) {
  return hasStableTrackIdentity(track) || Boolean(trackTitleArtistKey(track));
}

function needsProviderIdentity(track) {
  return Boolean(
    trackTitleArtistKey(track)
      && !String(track?.spotify_id || '').trim()
      && !normalizedIdentity(track?.isrc),
  );
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
    if (!track || typeof track !== 'object' || !hasHydrationLookup(track)) continue;
    if (trackNeedsHydration(track) || needsProviderIdentity(track)) return true;
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
    if (trackNeedsHydration(track) || needsProviderIdentity(track) || !track.album_name) return true;
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
    const hasLookup = hasHydrationLookup(track);
    if (trackNeedsHydration(track) || needsProviderIdentity(track)) {
      if (hasLookup) return 'read-model-hydration';
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
