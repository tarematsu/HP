const DAY_MS = 86_400_000;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchJson(url, { signal = null, force = false } = {}) {
  const response = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
    cache: force ? 'reload' : 'default',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${url} HTTP ${response.status}`);
  return payload;
}

function trackTitle(row) {
  return String(row?.title || row?.display_title || row?.spotify_id || row?.isrc || '曲名不明').trim();
}

function trackArtist(row) {
  return String(row?.artist || row?.artist_name || row?.album_artist || '').trim();
}

function currentHistory(rows = []) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      observed_at: finite(row?.observed_at ?? row?.bucket_at),
      online_member_count: finite(row?.online_member_count ?? row?.listener_count),
      stream_count: finite(row?.stream_count ?? row?.current_stream_count ?? row?.reported_current_stream_count),
      stream_delta_5m: finite(row?.stream_delta_5m),
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

function normalizeCurrent(payload, details = null) {
  const latest = payload?.latest || {};
  return {
    latest: {
      ...latest,
      total_stream_count: finite(latest.total_stream_count ?? latest.current_stream_count ?? latest.reported_current_stream_count),
    },
    history_24h: currentHistory(details?.history || payload?.history_24h || payload?.history || []),
    queue: Array.isArray(payload?.queue) ? payload.queue : [],
    queue_status: payload?.queue_status || null,
  };
}

function normalizedDaily(rows = []) {
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

function normalizePlayedRows(rows = []) {
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

function normalizeLikes(rows = []) {
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

function normalizeBroadcasts(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : payload?.row ? [payload.row] : [];
  return {
    rows,
    series: Array.isArray(payload?.series) ? payload.series : [],
    collection_active: Boolean(payload?.collection_active),
  };
}

function cached(loader) {
  let value = null;
  let pending = null;
  return async (options = {}) => {
    if (value && !options.force) return value;
    if (pending && !options.force) return pending;
    pending = Promise.resolve(loader(options)).then((next) => {
      value = next;
      return next;
    }).finally(() => { pending = null; });
    return pending;
  };
}

function buddiesModel() {
  const current = cached(async ({ signal, force }) => {
    const payload = await fetchJson('/api/dashboard?history=0', { signal, force });
    const channelId = finite(payload?.latest?.channel_id);
    const details = channelId == null
      ? null
      : await fetchJson(`/api/dashboard-details?channel_id=${encodeURIComponent(channelId)}`, { signal, force }).catch(() => null);
    return normalizeCurrent(payload, details);
  });
  return {
    source: 'buddies',
    meta: { station_url: 'https://stationhead.com/c/buddies', artist_filter: '櫻坂46' },
    capabilities: ['current', 'history', 'played-tracks', 'likes', 'broadcasts'],
    loadCurrent: current,
    loadHistory: cached(async ({ signal, force }) => {
      const payload = await fetchJson(`/api/history?mode=daily&from=2024-06-01&to=${todayUtc()}`, { signal, force });
      return { daily: normalizedDaily(payload.rows) };
    }),
    loadPlayedIndex: cached(async ({ signal, force }) => {
      const payload = await fetchJson('/api/track-history?dates_only=1', { signal, force });
      return (Array.isArray(payload?.dates) ? payload.dates : []).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))).sort();
    }),
    async loadPlayedPeriod(from, to, { signal, force } = {}) {
      const payload = await fetchJson(`/api/track-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=10000&ranking=0`, { signal, force });
      return normalizePlayedRows(payload.rows);
    },
    loadLikes: cached(async ({ signal, force }) => {
      const payload = await fetchJson('/api/track-history?ranking_only=1&ranking_limit=500', { signal, force });
      return normalizeLikes(payload.ranking).filter((row) => !row.artist || row.artist.normalize('NFKC').includes('櫻坂46'));
    }),
    loadBroadcasts: cached(async ({ signal, force }) => {
      const summary = await fetchJson(`/api/history?mode=broadcasts&from=2024-06-01&to=${todayUtc()}`, { signal, force });
      return normalizeBroadcasts(summary);
    }),
  };
}

function ohisamaModel() {
  const all = cached(({ signal, force }) => fetchJson('/api/hinata', { signal, force }));
  return {
    source: 'ohisama',
    meta: { station_url: 'https://stationhead.com/c/ohisama', artist_filter: '日向坂46' },
    capabilities: ['current', 'history', 'played-tracks', 'likes'],
    async loadCurrent(options) { return normalizeCurrent(await all(options)); },
    async loadHistory(options) { return { daily: normalizedDaily((await all(options)).daily) }; },
    async loadPlayedIndex(options) {
      const payload = await all(options);
      return (Array.isArray(payload?.played_history) ? payload.played_history : [])
        .map((row) => String(row?.period_key || ''))
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .sort();
    },
    async loadPlayedPeriod(from, to, options) {
      const payload = await all(options);
      const rows = Array.isArray(payload?.played_history) ? payload.played_history : [];
      return rows
        .filter((row) => String(row?.period_key || '') >= from && String(row?.period_key || '') <= to)
        .flatMap((row) => normalizePlayedRows(row?.tracks));
    },
    async loadLikes(options) {
      const payload = await all(options);
      return normalizeLikes(payload.likes).filter((row) => !row.artist || row.artist.normalize('NFKC').includes('日向坂46'));
    },
    async loadBroadcasts() { return { rows: [], series: [], collection_active: false }; },
  };
}

function nogizakaModel() {
  const broadcasts = cached(({ signal, force }) => fetchJson('/api/nogizaka-listening-party', { signal, force }));
  return {
    source: 'nogizaka',
    meta: { station_url: 'https://stationhead.com/c/nogizaka46smej', artist_filter: '乃木坂46' },
    capabilities: ['broadcasts'],
    async loadCurrent() { return { latest: {}, history_24h: [], queue: [], queue_status: null }; },
    async loadHistory() { return { daily: [] }; },
    async loadPlayedIndex() { return []; },
    async loadPlayedPeriod() { return []; },
    async loadLikes() { return []; },
    async loadBroadcasts(options) { return normalizeBroadcasts(await broadcasts(options)); },
  };
}

const FACTORIES = { buddies: buddiesModel, ohisama: ohisamaModel, nogizaka: nogizakaModel };
const instances = new Map();

export function stationheadChannelReadModel(source = 'buddies') {
  const key = Object.hasOwn(FACTORIES, source) ? source : 'buddies';
  if (!instances.has(key)) instances.set(key, FACTORIES[key]());
  return instances.get(key);
}

export { DAY_MS };
