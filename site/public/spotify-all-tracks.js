import { safeInteger as integer } from './dashboard-ui-common.js?v=20260930.1';
import { MUSIC_ARTIST_ORDER } from './music-service-runtime-common.js?v=20261004.1';

const ARTIST_KEYS = Object.freeze(MUSIC_ARTIST_ORDER.slice(0, 3));
const ARTIST_NAMES = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
});

function compareTracks(left, right) {
  const leftDelta = integer(left?.delta);
  const rightDelta = integer(right?.delta);
  if (leftDelta == null && rightDelta != null) return 1;
  if (leftDelta != null && rightDelta == null) return -1;
  if (leftDelta != null && rightDelta != null && leftDelta !== rightDelta) return rightDelta - leftDelta;

  const leftPlaycount = Math.max(0, integer(left?.playcount) ?? 0);
  const rightPlaycount = Math.max(0, integer(right?.playcount) ?? 0);
  if (leftPlaycount !== rightPlaycount) return rightPlaycount - leftPlaycount;

  const artistOrder = ARTIST_KEYS.indexOf(left?.artist_key) - ARTIST_KEYS.indexOf(right?.artist_key);
  if (artistOrder !== 0) return artistOrder;
  return String(left?.name || '').localeCompare(String(right?.name || ''), 'ja');
}

function trackIdentity(track) {
  const canonicalId = integer(track?.track_id);
  if (canonicalId != null) return `track:${canonicalId}`;
  const spotifyId = String(track?.spotify_track_id || '').trim();
  if (spotifyId) return `spotify:${spotifyId}`;
  return `${track?.artist_key || ''}:${String(track?.name || '').normalize('NFKC').trim().toLowerCase()}`;
}

export function spotifyAllTracksPayload(model = {}) {
  const tracks = [];
  const snapshotDates = [];
  const carriedForwardArtists = [];

  for (const artistKey of ARTIST_KEYS) {
    const group = model?.groups?.[artistKey];
    if (!group) continue;
    const artistName = String(group?.artist?.name || ARTIST_NAMES[artistKey]);
    const snapshotDate = String(group?.snapshot_date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) snapshotDates.push([artistName, snapshotDate]);
    if (group?.carried_forward) carriedForwardArtists.push(artistName);
    for (const track of Array.isArray(group?.tracks) ? group.tracks : []) {
      tracks.push({ ...track, artist_key: artistKey, artist_name: artistName });
    }
  }

  tracks.sort(compareTracks);
  const seen = new Set();
  const uniqueTracks = [];
  for (const track of tracks) {
    const identity = trackIdentity(track);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueTracks.push({ ...track, rank: uniqueTracks.length + 1 });
  }

  return {
    artist: { key: 'all', name: '坂道3グループ' },
    snapshot_date: snapshotDates.map(([, date]) => date).sort().at(-1) || null,
    snapshot_dates: snapshotDates,
    carried_forward_artists: carriedForwardArtists,
    track_count: uniqueTracks.length,
    tracks: uniqueTracks,
  };
}
