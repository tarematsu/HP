// Normalize upstream payloads into the common channel view contract.

export function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function trackTitle(row) {
  return String(row?.title || row?.display_title || row?.spotify_id || row?.isrc || '曲名不明').trim();
}

export function trackArtist(row) {
  return String(row?.artist || row?.artist_name || row?.album_artist || '').trim();
}

export function currentHistory(rows = []) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      observed_at: finite(row?.observed_at ?? row?.bucket_at),
      online_member_count: finite(row?.online_member_count ?? row?.listener_count),
      stream_count: finite(row?.stream_count ?? row?.current_stream_count ?? row?.reported_current_stream_count),
      stream_delta_5m: finite(row?.stream_delta_5m ?? row?.stream_delta),
    }))
    .filter((row) => row.observed_at != null)
    .sort((a, b) => a.observed_at - b.observed_at);
  return sorted.map((row, index) => {
    if (row.stream_delta_5m != null) return row;
    const previous = sorted[index - 1];
    if (!previous || previous.stream_count == null || row.stream_count == null) return row;
    const elapsed = row.observed_at - previous.observed_at;
    const delta = row.stream_count - previous.stream_count;
    return {
      ...row,
      stream_delta_5m: elapsed > 0 && elapsed <= 20 * 60_000 && delta >= 0
        ? delta * 5 * 60_000 / elapsed
        : null,
    };
  });
}

export function previousDayHistory(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      observed_at: finite(row?.observed_at ?? row?.bucket_at),
      online_member_count: finite(row?.online_member_count ?? row?.listener_count),
    }))
    .filter((row) => row.observed_at != null && row.online_member_count != null)
    .sort((a, b) => a.observed_at - b.observed_at);
}

export function normalizeCurrent(payload) {
  const latest = payload?.latest || {};
  const history = payload?.history_24h || payload?.history || [];
  const directStreamHistory = new Map(
    (Array.isArray(payload?.stream_5m_history) ? payload.stream_5m_history : [])
      .map((row) => [finite(row?.observed_at ?? row?.bucket_at), finite(row?.stream_delta_5m ?? row?.stream_delta)])
      .filter(([time, delta]) => time != null && delta != null),
  );
  const normalizedHistory = currentHistory(history).map((row) => ({
    ...row,
    stream_delta_5m: directStreamHistory.get(row.observed_at) ?? row.stream_delta_5m,
  }));
  return {
    latest: {
      ...latest,
      total_stream_count: finite(latest.total_stream_count ?? latest.current_stream_count ?? latest.reported_current_stream_count),
    },
    history_24h: normalizedHistory,
    previous_day_history: previousDayHistory(payload?.previous_day_history),
    queue: Array.isArray(payload?.queue) ? payload.queue : [],
    queue_status: payload?.queue_status || null,
  };
}

export function normalizedDaily(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      period_key: String(row?.period_key || ''),
      period_start: finite(row?.period_start ?? row?.start_at),
      period_end: finite(row?.period_end ?? row?.end_at),
      listener_avg: finite(row?.listener_avg),
      listener_min: finite(row?.listener_min),
      listener_max: finite(row?.listener_max),
      stream_start: finite(row?.stream_start),
      stream_end: finite(row?.stream_end),
      stream_growth: finite(row?.stream_growth),
      member_start: finite(row?.member_start),
      member_end: finite(row?.member_end),
      member_growth: finite(row?.member_growth),
    }))
    .filter((row) => row.period_key)
    .sort((a, b) => a.period_key.localeCompare(b.period_key));
}

export function historyMode(value) {
  return value === 'weekly' ? 'weekly' : 'daily';
}

export function normalizePlayedRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    track_id: finite(row?.track_id),
    spotify_id: row?.spotify_id || null,
    isrc: row?.isrc || null,
    title: trackTitle(row),
    artist: trackArtist(row),
    thumbnail_url: row?.thumbnail_url || null,
    play_count: finite(row?.play_count ?? row?.count) || 0,
  }));
}

export function normalizeLikes(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    track_id: finite(row?.track_id),
    spotify_id: row?.spotify_id || null,
    title: trackTitle(row),
    artist: trackArtist(row),
    thumbnail_url: row?.thumbnail_url || null,
    like_count: finite(row?.like_count ?? row?.latest_like_count),
    observed_at: finite(row?.observed_at ?? row?.latest_observed_at),
  })).filter((row) => row.like_count != null);
}

export function normalizeBroadcasts(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : payload?.row ? [payload.row] : [];
  return {
    rows,
    series: Array.isArray(payload?.series) ? payload.series : [],
    collection_active: Boolean(payload?.collection_active),
  };
}
