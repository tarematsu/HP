import { loadDashboardJson } from './dashboard-data-client.js?v=20261005.2';
import { safeInteger as integer } from './dashboard-ui-common.js?v=20261004.1';
import {
  MUSIC_ARTIST_LABELS,
  loadMusicServiceReadModel,
} from './music-service-runtime-common.js?v=20261004.2';

const STATIONHEAD_FEATURED = Object.freeze([
  'sakuramankai',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const STATIONHEAD_COLORS = Object.freeze({
  sakuramankai: '#111111',
  sakurazaka46jp: '#d93f79',
  nogizaka46smej: '#812990',
});
const STATIONHEAD_MISSING_RANGES = Object.freeze([
  Object.freeze({ from: '2026-01-26', to: '2026-09-14', label: '欠測' }),
]);
const STREAMING_SERVICES = Object.freeze([
  ['spotify', 'Spotify'],
  ['apple-music', 'Apple Music'],
  ['amazon-music', 'Amazon Music'],
  ['youtube_music', 'YouTube Music'],
  ['kkbox', 'KKBOX'],
  ['qq_music', 'QQ音乐'],
  ['kugou_music', '酷狗音乐'],
]);
const STREAMING_SERVICE_LABEL = new Map(STREAMING_SERVICES);
const REGIONAL_STREAMING_SERVICES = new Set(['youtube_music', 'kkbox', 'qq_music', 'kugou_music']);
const cache = new Map();

function dateKey(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function positiveRank(value) {
  const rank = integer(value);
  return rank != null && rank > 0 ? rank : null;
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function latestTimestamp(values) {
  return Math.max(0, ...values.map(timestamp).filter((value) => value != null));
}

function stationheadMissingPeriod(period) {
  return STATIONHEAD_MISSING_RANGES.some(({ from, to }) => period >= from && period <= to);
}

function stationheadRankStatus(period, rank, row) {
  if (rank != null) return '';
  if (stationheadMissingPeriod(period)) return '欠測';
  if (row?.synthetic || row?.is_out_of_rank) return '圏外';
  return '—';
}

function fetchJson(url, options) {
  return loadDashboardJson(url, options);
}

function cached(key, loader, { force = false } = {}) {
  if (force) cache.delete(key);
  if (!cache.has(key)) {
    const promise = Promise.resolve(loader()).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

function relationLabel(row) {
  const artist = String(row?.artist_name || '').trim();
  if (!artist) return '-';
  return row?.fandom_type === 'official' ? '公式' : 'ファンダム';
}

export function normalizeStationheadLeaderboard(payload = {}) {
  const timelineRows = (Array.isArray(payload?.rows) ? payload.rows : [])
    .map((row) => {
      const period = dateKey(row?.ranking_date);
      const rank = positiveRank(row?.rank);
      return {
        period,
        rank,
        rank_status: stationheadRankStatus(period, rank, row),
        host: String(row?.host_name || '').trim(),
        channel: String(row?.stationhead_channel_name || '').trim() || '-',
        artist: String(row?.artist_name || '').trim() || '-',
        relation: relationLabel(row),
      };
    })
    .filter((row) => row.period && row.host)
    .sort((a, b) => b.period.localeCompare(a.period)
      || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
      || a.host.localeCompare(b.host));
  const rows = timelineRows.filter((row) => row.rank_status !== '欠測' && row.rank_status !== '圏外');

  const chartHosts = (Array.isArray(payload?.chart_hosts) && payload.chart_hosts.length
    ? payload.chart_hosts
    : STATIONHEAD_FEATURED)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const allowed = new Set(chartHosts.map((value) => value.toLowerCase()));
  const pointsByHost = new Map(chartHosts.map((host) => [host.toLowerCase(), []]));
  for (const row of timelineRows) {
    const key = row.host.toLowerCase();
    if (!allowed.has(key)) continue;
    pointsByHost.get(key)?.push({ date: row.period, rank: row.rank });
  }
  const series = chartHosts.map((host) => ({
    id: host.toLowerCase(),
    label: host,
    color: STATIONHEAD_COLORS[host.toLowerCase()] || '',
    points: (pointsByHost.get(host.toLowerCase()) || []).sort((a, b) => a.date.localeCompare(b.date)),
  })).filter((item) => item.points.some((point) => point.rank != null));

  return {
    source: 'stationhead',
    updated_at: timestamp(payload?.materialized_at),
    cadence: '毎週月曜日夜',
    chart_title: series.length === 1 ? `${series[0].label} 順位推移` : '週間リーダーボード順位',
    chart_foot: '順位は上ほど高順位です。灰色は欠測期間です。空白週は圏外です。',
    table_title: '週間リーダーボード',
    columns: [
      { key: 'period', label: '週' },
      { key: 'rank', label: '順位', numeric: true, format: 'rank' },
      { key: 'host', label: 'ホスト' },
      { key: 'channel', label: 'チャンネル' },
      { key: 'artist', label: 'アーティスト名' },
      { key: 'relation', label: '種別' },
    ],
    rows,
    series,
    missing_ranges: STATIONHEAD_MISSING_RANGES,
    notice: rows.length ? '' : 'リーダーボードデータはまだありません。',
  };
}

function artistLabel(value) {
  const key = String(value || '').trim();
  return MUSIC_ARTIST_LABELS[key] || key || '-';
}

function streamingRow(service, rank, artist, title, snapshot, kind = '楽曲') {
  const parsedRank = positiveRank(rank);
  if (parsedRank == null) return null;
  return {
    service: STREAMING_SERVICE_LABEL.get(service) || service,
    rank: parsedRank,
    artist: artistLabel(artist),
    title: String(title || '').trim() || '-',
    snapshot: dateKey(snapshot) || '-',
    kind,
  };
}

function regionalRows(service, payload) {
  return (Array.isArray(payload?.tracks) ? payload.tracks : [])
    .map((track) => streamingRow(
      service,
      track?.popularity_rank,
      track?.canonical_artist,
      track?.title,
      track?.snapshot_date || track?.observed_at,
    ))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 20);
}

function amazonRows(payload) {
  return (Array.isArray(payload?.tracks) ? payload.tracks : [])
    .map((track) => streamingRow(
      'amazon-music',
      track?.amazon_rank,
      track?.group_name,
      track?.display_title || track?.title,
      payload?.snapshot_date || payload?.observed_at,
    ))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 20);
}

function appleArtistModels(payload) {
  const artists = Array.isArray(payload?.artists) ? payload.artists.filter((artist) => artist) : [];
  if (artists.length) return artists;
  return [{
    artist_name: payload?.artist_name,
    snapshot_date: payload?.snapshot_date,
    observed_at: payload?.observed_at,
    regions: payload?.regions,
  }];
}

function appleRows(payload) {
  const output = [];
  for (const artist of appleArtistModels(payload)) {
    const japan = (Array.isArray(artist?.regions) ? artist.regions : [])
      .find((region) => String(region?.code || '').toLowerCase() === 'jp');
    for (const [index, track] of (Array.isArray(japan?.tracks) ? japan.tracks : []).slice(0, 20).entries()) {
      const row = streamingRow(
        'apple-music',
        track?.rank ?? index + 1,
        artist?.artist_name,
        track?.title,
        artist?.snapshot_date || artist?.observed_at,
      );
      if (row) output.push(row);
    }
  }
  return output;
}

function spotifyRows(payload) {
  const output = [];
  for (const points of Object.values(payload?.trend || {})) {
    const rows = Array.isArray(points) ? [...points] : [];
    const latest = rows.sort((a, b) => String(a?.snapshot_date || '').localeCompare(String(b?.snapshot_date || ''))).at(-1);
    const row = streamingRow(
      'spotify',
      latest?.current_rank,
      latest?.artist_name,
      'Daily Top Artist（日本）',
      latest?.snapshot_date,
      'アーティスト',
    );
    if (row) output.push(row);
  }
  return output;
}

async function loadStreamingSource(service, options) {
  if (REGIONAL_STREAMING_SERVICES.has(service)) {
    const payload = await loadMusicServiceReadModel(service);
    return { service, payload, rows: regionalRows(service, payload) };
  }
  if (service === 'amazon-music') {
    const payload = await fetchJson('/api/amazon-music', options);
    return { service, payload, rows: amazonRows(payload) };
  }
  if (service === 'apple-music') {
    const payload = await fetchJson('/api/apple-music', options);
    return { service, payload, rows: appleRows(payload) };
  }
  if (service === 'spotify') {
    const payload = await fetchJson('/api/spotify-monthly-listeners', options);
    return { service, payload, rows: spotifyRows(payload) };
  }
  throw new Error(`unsupported streaming leaderboard service: ${service}`);
}

export async function loadStreamingLeaderboard(options = {}) {
  const settled = await Promise.allSettled(STREAMING_SERVICES.map(([service]) =>
    loadStreamingSource(service, options)));
  const successful = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (!successful.length) throw new Error('music streaming leaderboard read models unavailable');
  const failed = settled.length - successful.length;
  const rows = successful.flatMap((result) => result.rows)
    .sort((a, b) => a.service.localeCompare(b.service, 'ja')
      || a.rank - b.rank
      || a.artist.localeCompare(b.artist, 'ja')
      || a.title.localeCompare(b.title, 'ja'));
  const updatedAt = latestTimestamp(successful.flatMap(({ payload }) => [
    payload?.updated_at,
    payload?.source_updated_at,
    payload?.observed_at,
    ...(Array.isArray(payload?.artists) ? payload.artists.map((artist) => artist?.observed_at) : []),
  ]));
  return {
    source: 'music-streaming',
    updated_at: updatedAt || null,
    cadence: 'サービスごとの更新周期',
    chart_title: '音楽ストリーミングサービス順位推移',
    chart_foot: '',
    table_title: '音楽ストリーミングサービス リーダーボード',
    columns: [
      { key: 'service', label: 'サービス' },
      { key: 'rank', label: '順位', numeric: true, format: 'rank' },
      { key: 'artist', label: 'アーティスト' },
      { key: 'title', label: '対象' },
      { key: 'snapshot', label: '更新日' },
    ],
    rows,
    series: [],
    notice: failed ? `${failed}サービスのリードモデルを取得できませんでした。取得できたサービスのみ表示しています。` : '',
  };
}

function stationheadModel() {
  return {
    source: 'stationhead',
    async load(options = {}) {
      return cached('leaderboard:stationhead', async () => {
        const to = new Date().toISOString().slice(0, 10);
        const payload = await fetchJson(`/api/history?mode=ranking&from=2024-06-01&to=${to}&scope=featured&limit=5000`, options);
        return normalizeStationheadLeaderboard(payload);
      }, options);
    },
  };
}

function streamingModel() {
  return {
    source: 'music-streaming',
    load(options = {}) {
      return cached('leaderboard:music-streaming', () => loadStreamingLeaderboard(options), options);
    },
  };
}

const MODELS = Object.freeze({
  stationhead: stationheadModel,
  'music-streaming': streamingModel,
});
const instances = new Map();

export function leaderboardReadModel(source = 'stationhead') {
  const key = Object.hasOwn(MODELS, source) ? source : 'stationhead';
  if (!instances.has(key)) instances.set(key, MODELS[key]());
  return instances.get(key);
}
