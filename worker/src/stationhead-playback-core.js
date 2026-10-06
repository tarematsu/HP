const DAY_MS = 24 * 60 * 60_000;

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

export function stationheadPlaybackPeriodKey(timestamp) {
  return new Date(Math.floor(Number(timestamp) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

export function stationheadPlaybackTrackKey(track) {
  const isrc = text(track?.isrc)?.toUpperCase();
  if (isrc) return `isrc:${isrc}`;
  const spotifyId = text(track?.spotify_id);
  if (spotifyId) return `spotify:${spotifyId}`;
  const stationheadId = integer(track?.stationhead_track_id);
  if (stationheadId != null) return `stationhead:${stationheadId}`;
  const title = text(track?.title || track?.display_title);
  const artist = text(track?.artist);
  return title ? `title:${title}\u0000${artist || ''}` : null;
}

export function emptyPlaybackDaily(periodKey) {
  return {
    period_key: periodKey,
    total_plays: 0,
    unique_track_ids: [],
    tracks: {},
  };
}

export function playbackDailyPublic(daily) {
  const tracks = Object.values(daily?.tracks || {})
    .map((entry) => ({
      ...entry,
      track_id: integer(entry?.track_id),
      count: integer(entry?.count) || 0,
    }))
    .filter((entry) => entry.track_id != null)
    .sort((left, right) => right.count - left.count
      || String(left.title || '').localeCompare(String(right.title || ''), 'ja'));
  return {
    period_key: String(daily?.period_key || ''),
    total_plays: integer(daily?.total_plays) || tracks.reduce((sum, entry) => sum + entry.count, 0),
    unique_tracks: Array.isArray(daily?.unique_track_ids) ? daily.unique_track_ids.length : tracks.length,
    tracks,
  };
}

export function recordPlaybackDailyTrack(daily, track, playedAt) {
  const trackId = integer(track?.track_id);
  if (trackId == null) return daily;
  const key = String(trackId);
  const targetKey = stationheadPlaybackPeriodKey(playedAt);
  const active = daily?.period_key === targetKey ? daily : emptyPlaybackDaily(targetKey);
  const unique = new Set(Array.isArray(active.unique_track_ids)
    ? active.unique_track_ids.map(String)
    : []);
  unique.add(key);
  const tracks = { ...(active.tracks || {}) };
  const previous = tracks[key] || {};
  tracks[key] = {
    track_id: trackId,
    track_key: track?.track_key || previous.track_key || null,
    title: track?.title || previous.title || null,
    artist: track?.artist || previous.artist || null,
    spotify_id: track?.spotify_id || previous.spotify_id || null,
    count: (integer(previous.count) || 0) + 1,
  };
  return {
    period_key: targetKey,
    total_plays: (integer(active.total_plays) || 0) + 1,
    unique_track_ids: [...unique],
    tracks,
  };
}

function sameOccurrence(left, right) {
  if (!left || !right) return false;
  if (left.event_key && left.event_key === right.event_key) return true;
  const leftKey = left.track_key || stationheadPlaybackTrackKey(left);
  const rightKey = right.track_key || stationheadPlaybackTrackKey(right);
  if (!leftKey || leftKey !== rightKey) return false;
  const leftAt = integer(left.expected_start_at);
  const rightAt = integer(right.expected_start_at);
  return leftAt != null && rightAt != null && Math.abs(leftAt - rightAt) <= 30_000;
}

function dueIntermediateTracks(previous, previousObservedAt, observedAt) {
  if (previousObservedAt == null || observedAt == null || observedAt < previousObservedAt) return [];
  return previous.slice(1).filter((track) => {
    const expectedAt = integer(track?.expected_start_at);
    return expectedAt != null && expectedAt > previousObservedAt && expectedAt <= observedAt;
  });
}

export function transitionedStationheadTracks(
  previousQueue = [],
  currentQueue = [],
  {
    previousObservedAt = null,
    observedAt = null,
    previousPaused = false,
    currentPaused = false,
  } = {},
) {
  const current = currentQueue[0] || null;
  if (!current?.event_key) return [];
  const previous = Array.isArray(previousQueue) ? previousQueue : [];
  if (!previous.length) return [current];
  if (previous[0]?.event_key === current.event_key) return [];

  const overlapIndex = previous.findIndex((track) => track?.event_key === current.event_key);
  if (overlapIndex > 0) return previous.slice(1, overlapIndex + 1);

  if (!previousPaused && !currentPaused) {
    const due = dueIntermediateTracks(
      previous,
      integer(previousObservedAt),
      integer(observedAt),
    );
    if (due.length) {
      return sameOccurrence(due.at(-1), current) ? due : [...due, current];
    }
  }
  return [current];
}
