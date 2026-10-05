import { loadDashboardJson } from './dashboard-data-client.js?v=20261005.2';
import { safeInteger as integer } from './dashboard-ui-common.js?v=20261004.1';

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

function stationheadMissingPeriod(period) {
  return STATIONHEAD_MISSING_RANGES.some(({ from, to }) => period >= from && period <= to);
}

function stationheadRankStatus(period, rank, row) {
  if (rank != null) return '';
  if (stationheadMissingPeriod(period)) return '欠測';
  if (row?.synthetic || row?.is_out_of_rank) return '圏外';
  return '—';
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
  }));
  return {
    source: 'stationhead',
    updated_at: timestamp(payload?.materialized_at),
    cadence: 'データ受信時',
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

function stationheadModel() {
  return {
    source: 'stationhead',
    async load({ force = false } = {}) {
      const to = new Date().toISOString().slice(0, 10);
      const payload = await loadDashboardJson(`/api/history?mode=ranking&from=2024-06-01&to=${to}&scope=featured&limit=5000`, { force });
      return normalizeStationheadLeaderboard(payload);
    },
  };
}

const model = stationheadModel();
export function leaderboardReadModel() {
  return model;
}
