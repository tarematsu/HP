import { trackDisplayTitleParts } from './track-metadata-quality.js';

export function stationheadQueueNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stationheadQueueText(value, maximum = null) {
  if (value === undefined || value === null) return null;
  const parsed = String(value).trim();
  if (!parsed) return null;
  return maximum == null ? parsed : parsed.slice(0, maximum);
}

export function stationheadQueueBoolean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? (value === 0 ? 0 : 1) : null;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 1;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return 0;
  return null;
}

export function normalizeStationheadQueueTrack(
  item,
  position,
  { includeAppleMusic = false } = {},
) {
  const track = item?.track || item || {};
  const artist = track?.artist || track?.artists?.[0] || {};
  const album = track?.album || {};
  const directTitle = stationheadQueueText(track?.title ?? track?.name, 500);
  const displayTitle = stationheadQueueText(track?.display_title ?? track?.displayTitle, 500);
  const display = trackDisplayTitleParts(displayTitle, directTitle);
  return {
    position,
    queue_track_id: stationheadQueueNumber(item?.id),
    stationhead_track_id: stationheadQueueNumber(track?.id),
    spotify_id: stationheadQueueText(track?.spotify_id),
    ...(includeAppleMusic ? { apple_music_id: stationheadQueueText(track?.apple_music_id) } : {}),
    deezer_id: stationheadQueueText(track?.deezer_id),
    isrc: stationheadQueueText(track?.isrc),
    duration_ms: stationheadQueueNumber(track?.duration),
    preview_url: stationheadQueueText(track?.preview),
    bite_count: stationheadQueueNumber(
      track?.bite_count ?? track?.biteCount ?? track?.likes ?? track?.like_count,
    ),
    title: directTitle || display.title,
    artist: stationheadQueueText(
      typeof artist === 'string' ? artist : (artist?.name ?? track?.artist_name),
      500,
    ) || display.artist,
    album_name: stationheadQueueText(album?.name ?? track?.album_name, 500),
    thumbnail_url: stationheadQueueText(
      track?.thumbnail_url ?? track?.image_url ?? track?.artwork_url ?? track?.album_art_url
        ?? album?.thumbnail_url ?? album?.image_url ?? album?.artwork_url
        ?? album?.images?.[0]?.url
        ?? item?.thumbnail_url ?? item?.image_url ?? item?.artwork_url ?? item?.album_art_url,
      2_048,
    ),
    ...(displayTitle ? { display_title: displayTitle } : {}),
  };
}

export function normalizeStationheadQueue(
  queue,
  stationId,
  observedAt,
  { includeAppleMusic = false, includeCurrent = false } = {},
) {
  if (!queue) return null;
  const items = Array.isArray(queue?.queue_tracks)
    ? queue.queue_tracks
    : Array.isArray(queue?.tracks)
      ? queue.tracks
      : [];
  const tracks = items.map((item, position) => normalizeStationheadQueueTrack(
    item,
    position,
    { includeAppleMusic },
  ));
  const startTime = stationheadQueueNumber(queue?.start_time);
  const normalized = {
    station_id: stationheadQueueNumber(queue?.station_id ?? stationId),
    queue_id: stationheadQueueNumber(queue?.id ?? queue?.queue_id),
    start_time: startTime,
    is_paused: queue?.is_paused ?? null,
    tracks,
  };
  if (!includeCurrent) return normalized;

  let currentTrack = null;
  if (startTime != null && tracks.length && Number.isFinite(Number(observedAt))) {
    let elapsed = Math.max(0, Number(observedAt) - startTime);
    for (const track of tracks) {
      const duration = stationheadQueueNumber(track.duration_ms);
      if (!duration || elapsed < duration) {
        currentTrack = track;
        break;
      }
      elapsed -= duration;
    }
    if (!currentTrack) currentTrack = tracks.at(-1);
  }
  return {
    ...normalized,
    current_track_id: currentTrack?.stationhead_track_id ?? null,
    current_spotify_id: currentTrack?.spotify_id ?? null,
  };
}

export function stationheadQueueStructuralPayload(queue) {
  if (!queue) return null;
  return {
    station_id: stationheadQueueNumber(queue.station_id),
    queue_id: stationheadQueueNumber(queue.queue_id),
    start_time: stationheadQueueNumber(queue.start_time),
    is_paused: stationheadQueueBoolean(queue.is_paused),
    tracks: (Array.isArray(queue.tracks) ? queue.tracks : []).map((track) => ({
      position: stationheadQueueNumber(track.position),
      queue_track_id: stationheadQueueNumber(track.queue_track_id),
      stationhead_track_id: stationheadQueueNumber(track.stationhead_track_id),
      spotify_id: stationheadQueueText(track.spotify_id),
      deezer_id: stationheadQueueText(track.deezer_id),
      isrc: stationheadQueueText(track.isrc),
      duration_ms: stationheadQueueNumber(track.duration_ms),
      preview_url: stationheadQueueText(track.preview_url),
    })),
  };
}
