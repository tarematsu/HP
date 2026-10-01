import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import { sanitizeMetadataRow, trackNeedsHydration } from './track-metadata-quality.js';

// Canonical identity and display metadata are separate requirements. Resolving
// track_id alone must never suppress the title/artist/artwork lookup. Complete
// previous rows are reusable seeds, so the unchanged queue needs no D1 reads.
export async function hydratePlaybackTrackMetadata(db, tracks = [], previous = []) {
  if (!tracks.length) return tracks;
  const clean = tracks.map(sanitizeMetadataRow);
  const seedRows = [...previous, ...clean]
    .map(sanitizeMetadataRow)
    .filter((track) => Number(track?.track_id) > 0 && !trackNeedsHydration(track));
  return canonicalizeTrackRows(db, clean, { seedRows });
}

export async function hydratePlaybackAggregates(db, daily, likes, queue = []) {
  const dailyEntries = Object.entries(daily?.tracks || {});
  const likeEntries = Object.entries(likes || {});
  const rows = [...dailyEntries, ...likeEntries].map(([, row]) => sanitizeMetadataRow(row));
  const seedRows = [...queue, ...rows].map(sanitizeMetadataRow)
    .filter((row) => Number(row?.track_id) > 0 && row.title && row.artist);
  const hydrated = await canonicalizeTrackRows(db, rows, { seedRows });
  const dailyRows = hydrated.slice(0, dailyEntries.length);
  const likeRows = hydrated.slice(dailyEntries.length);
  return {
    daily: { ...daily, tracks: Object.fromEntries(dailyEntries.map(([key], index) => [key, dailyRows[index]])) },
    likes: Object.fromEntries(likeEntries.map(([key], index) => [key, likeRows[index]])),
  };
}
