function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedText(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function displayTrackTitle(row) {
  return String(
    row?.title || row?.display_title || row?.raw_title || row?.isrc || row?.spotify_id || '曲名不明',
  ).trim() || '曲名不明';
}

export function displayTrackArtist(row) {
  return String(row?.artist || row?.raw_artist || '').trim() || '—';
}

export function trackIdentity(row) {
  const direct = [
    row?.track_key,
    row?.isrc && `isrc:${String(row.isrc).toUpperCase()}`,
    row?.spotify_id && `spotify:${row.spotify_id}`,
    row?.stationhead_track_id && `stationhead:${row.stationhead_track_id}`,
    row?.queue_track_id && `queue:${row.queue_track_id}`,
  ].find(Boolean);
  if (direct) return String(direct);
  return `name:${normalizedText(displayTrackTitle(row))}|artist:${normalizedText(displayTrackArtist(row))}`;
}

export function normalizeTrackRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (row?.title) return row;
    return { ...row, title: displayTrackTitle(row) };
  });
}

export function completeTrackRows(rows) {
  return normalizeTrackRows(rows).filter((row) => (
    row?.period_complete !== false && row?.play_count_excluded !== true
  ));
}

export function aggregateCompleteTrackRows(rows) {
  const aggregate = new Map();
  for (const row of completeTrackRows(rows)) {
    const identity = trackIdentity(row);
    const count = Math.max(0, finite(row?.play_count) || 0);
    const likes = Math.max(0, finite(row?.like_count) || 0);
    const firstPlayedAt = finite(row?.first_played_at);
    const lastPlayedAt = finite(row?.last_played_at);
    const current = aggregate.get(identity) || {
      identity,
      title: displayTrackTitle(row),
      artist: displayTrackArtist(row),
      play_count: 0,
      like_count: 0,
      first_played_at: null,
      last_played_at: null,
      play_dates: new Set(),
    };
    current.play_count += count;
    current.like_count = Math.max(current.like_count, likes);
    if (row?.play_date) current.play_dates.add(String(row.play_date));
    if (firstPlayedAt != null) {
      current.first_played_at = current.first_played_at == null
        ? firstPlayedAt
        : Math.min(current.first_played_at, firstPlayedAt);
    }
    if (lastPlayedAt != null) {
      current.last_played_at = current.last_played_at == null
        ? lastPlayedAt
        : Math.max(current.last_played_at, lastPlayedAt);
    }
    aggregate.set(identity, current);
  }

  return [...aggregate.values()]
    .sort((left, right) => right.play_count - left.play_count
      || right.like_count - left.like_count
      || left.title.localeCompare(right.title, 'ja'))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      day_count: row.play_dates.size,
      play_dates: [...row.play_dates].sort(),
    }));
}

export function summarizeCompleteTrackRows(rows) {
  const validRows = completeTrackRows(rows);
  const days = new Set(validRows.map((row) => row?.play_date).filter(Boolean));
  const aggregate = aggregateCompleteTrackRows(validRows);
  return {
    days: days.size,
    tracks: aggregate.length,
    total: aggregate.reduce((sum, row) => sum + row.play_count, 0),
    maximum: aggregate.reduce((maximum, row) => Math.max(maximum, row.play_count), 0),
  };
}
