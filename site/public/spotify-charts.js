import { japanChartSeries, SPOTIFY_CHART_ARTIST_ORDER } from './spotify-chart-series.js';
import { spotifyChartYearsForRange } from './spotify-charts-range.js';
import { renderMusicServicePager } from './music-service-pager.js';
import { loadDashboardJson, loadSpotifyReadModel } from './dashboard-data-client.js?v=20261005.2';
import { byId, appendEmptyTableRow, integerFormat, setNotice, setText } from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow, renderResponsiveTable } from './dashboard-table-dom.js';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261003.1';
import { ensureChartRangeControls, filterDatesByRange } from './dashboard-chart-range.js';
import { createRegionalFilters, regionalProviderDateText } from './music-service-regional-ui.js';
import { MUSIC_ARTIST_LABELS, SAKAMICHI_GROUP_COLORS, musicDateTimeText } from './music-service-runtime-common.js?v=20261004.2';
import { monthlyListenerTrend, renderTrendChart } from './spotify-trend-chart.js';
import { observeDashboardChartResize } from './dashboard-chart-runtime.js?v=20261001.1';

const root = byId('spotifyChartsView');
const labels = { ...MUSIC_ARTIST_LABELS, 'sakamichi-selection': '坂道選抜' };
const colors = { ...SAKAMICHI_GROUP_COLORS, 'sakamichi-selection': '#667287' };
let artist = 'all';
let group = 'listeners';
let range = '1y';
const periods = { artist: 'daily', regional: 'daily', album: 'weekly', 'viral-hits': 'daily' };
let index = null;
let monthlyRows = [];
let requestId = 0;
const loaded = new Map();
const tablePages = new Map();
const PAGE_SIZE = 80;

const filters = createRegionalFilters([
  { attribute: 'spotify-chart-artist', get: () => artist, set: value => { artist = value; } },
  ...Object.keys(periods).map(type => ({ attribute: `spotify-chart-period-${type}`, get: () => periods[type], set: value => { periods[type] = value; } })),
], () => { tablePages.clear(); void loadActive(); });
function renderListenersTable() {
  const body = byId('spotifyChartsListenersBody');
  if (!body) return;
  body.replaceChildren();
  const rows = monthlyRows.filter(row => artist === 'all' || row.artist_key === artist)
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date) || SPOTIFY_CHART_ARTIST_ORDER.indexOf(a.artist_key) - SPOTIFY_CHART_ARTIST_ORDER.indexOf(b.artist_key));
  const page = renderMusicServicePager(byId('spotifyChartsListenersPager'), {
    total: rows.length, page: tablePages.get('listeners') || 1, pageSize: PAGE_SIZE,
    onChange: next => { tablePages.set('listeners', next); renderListenersTable(); },
  });
  tablePages.set('listeners', page);
  for (const row of rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
    appendTableRow(body, [regionalProviderDateText(row.snapshot_date), labels[row.artist_key] || row.artist_name, integerFormat.format(row.monthly_listeners)]);
  }
  if (!rows.length) appendEmptyTableRow(body, '月間リスナー履歴はありません。', 3);
}
function renderListeners() {
  renderTrendChart(monthlyListenerTrend(monthlyRows), { containerId: 'spotifyChartsListeners', metricKey: 'monthly_listeners',
    artistFilter: artist, latestFormatter: value => value == null ? '-' : integerFormat.format(value), ariaLabel: '坂道グループの月間リスナー推移' });
  renderListenersTable();
}
function renderChartTable(type, rows, dates) {
  const body = byId(`spotifyChartBody-${type}`);
  if (!body) return;
  const visible = new Set(dates);
  const matches = [];
  for (const period of [...rows].reverse()) {
    if (!visible.has(period.chart_date)) continue;
    for (const entry of period.entries || []) {
      if (artist !== 'all' && !entry.artists.includes(artist)) continue;
      matches.push({ date: period.chart_date, entry });
    }
  }
  const chart = `${type}-jp-${periods[type]}`;
  const page = renderMusicServicePager(byId(`spotifyChartPager-${type}`), {
    total: matches.length, page: tablePages.get(chart) || 1, pageSize: PAGE_SIZE,
    onChange: next => { tablePages.set(chart, next); renderChartTable(type, rows, dates); },
  });
  tablePages.set(chart, page);
  const columns = [
    { key: 'date', label: '日付' }, { key: 'artist', label: 'グループ' },
    { key: 'rank', label: type === 'viral-hits' ? '掲載位置' : '順位', numeric: true },
    { key: 'title', label: type === 'artist' ? 'アーティスト' : type === 'album' ? 'アルバム' : '曲名' },
    ...(type === 'regional' ? [{ key: 'streams', label: '再生数', numeric: true }] : []),
  ];
  renderResponsiveTable({
    head: body.closest('table')?.querySelector('thead'), body,
    cards: byId(`spotifyChartCards-${type}`), columns,
    rows: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    valuesForRow: ({ date, entry }) => [
      regionalProviderDateText(date), entry.artists.map(key => labels[key] || key).join(' / '),
      type === 'viral-hits' ? `${entry.rank}番目` : `${entry.rank}位`, entry.title,
      ...(type === 'regional' ? [entry.streams == null ? '-' : integerFormat.format(entry.streams)] : []),
    ],
    emptyMessage: '取得済み期間にランクイン履歴はありません。',
  });
}
function renderChart(type, data, state) {
  const plot = byId(`spotifyChartPlot-${type}`);
  const limit = type === 'viral-hits' ? 100 : 200;
  const rows = data.flatMap(model => model.periods || []).sort((a, b) => a.chart_date.localeCompare(b.chart_date));
  const sourceDates = rows.map(row => row.chart_date);
  // Include missing source dates so a line cannot bridge an uncollected day.
  const allDates = [];
  if (sourceDates.length) {
    const step = periods[type] === 'weekly' ? 7 : 1;
    for (let t = Date.parse(sourceDates[0]); t <= Date.parse(sourceDates.at(-1)); t += step * 86400000) allDates.push(new Date(t).toISOString().slice(0, 10));
  }
  const dates = filterDatesByRange(allDates, range);
  const series = japanChartSeries(rows, dates, artist, colors).map(item => ({ ...item, points: item.points.map(point => ({ ...point, rank: point.rank === 201 ? limit + 1 : point.rank })) }));
  ensureChartRangeControls(plot, { owner: `spotify-${type}`, value: range, onChange: value => { range = value; tablePages.clear(); void loadActive(); } });
  renderRankHistoryChart({ container: plot, legendContainer: byId(`spotifyChartLegend-${type}`), series, dates,
    height: 320, yMax: limit + 1, rankTicks: limit === 100 ? [1, 25, 50, 75, 100, 101] : [1, 50, 100, 150, 201],
    rankLabel: rank => rank === limit + 1 ? (type === 'viral-hits' ? '掲載なし' : '圏外') : type === 'viral-hits' ? `${rank}番目` : `${rank}位`, dateLabel: regionalProviderDateText,
    ariaLabel: type === 'viral-hits' ? 'Viral Hits Japanプレイリスト掲載位置の推移。公式バイラル順位ではありません。' : 'Spotify日本チャート順位推移。取得済みの圏外と未取得の欠測を区別。',
    emptyText: type === 'viral-hits' ? '取得済み期間に対象グループのプレイリスト掲載履歴はありません。' : '取得済み期間に対象グループのランクイン履歴はありません。',
    latestPoint: { radius: () => 2.5 },
  });
  renderChartTable(type, rows, dates);
  const status = state?.latest_status === 'error' || state?.history_status === 'error' || state?.status === 'error' ? '収集に失敗しています。取得済みの履歴を表示しています。'
    : type === 'viral-hits' && state?.latest_chart_date ? `${regionalProviderDateText(state.latest_chart_date)}時点の掲載順 / 全${integerFormat.format(state.playlist_total || 0)}曲 / 収集開始後の日次履歴`
    : state?.status === 'unavailable' ? 'このチャートは現在取得できません。'
    : !state?.latest_chart_date ? 'まだ取得されていません。'
    : `${regionalProviderDateText(state.latest_chart_date)}付 / ${state.history_complete ? '提供期間の確認完了' : '過去データを取得中'}${state.earliest_chart_date ? `（${regionalProviderDateText(state.earliest_chart_date)}まで確認）` : ''}${state.unavailable_periods ? ` / 未提供 ${state.unavailable_periods}期間` : ''}`;
  setText(`spotifyChartStatus-${type}`, status);
  setText('spotifyChartsUpdatedAt', musicDateTimeText(state?.observed_at));
}
async function loadActive({ refresh = false } = {}) {
  const sequence = ++requestId;
  filters.bind(); filters.sync();
  try {
    setNotice('spotifyChartsNotice');
    if (group === 'listeners') {
      const model = await loadSpotifyReadModel({ force: refresh });
      if (sequence !== requestId) return;
      monthlyRows = (model.monthly_listener_rows || []).filter(row => row.artist_key in colors);
      renderListeners();
      setText('spotifyChartsUpdatedAt', musicDateTimeText(Math.max(0, ...monthlyRows.map(row => Number(row.collected_at) || 0))));
      return;
    }
    const type = group; const chart = `${type}-jp-${periods[type]}`;
    index = await loadDashboardJson('/api/spotify-charts', { force: refresh });
    const state = index.charts.find(item => item.chart_id === chart);
    const years = spotifyChartYearsForRange(state, range);
    const data = await Promise.all(years.map(year => loadDashboardJson(`/api/spotify-charts?chart=${chart}&year=${year}`, { force: refresh })));
    if (sequence !== requestId) return;
    loaded.set(chart, { data, state }); renderChart(type, data, state);
  } catch (error) {
    if (sequence === requestId) setNotice('spotifyChartsNotice', `Spotifyチャート取得失敗：${error.message}`, true);
  }
}
export function loadSpotifyChartsView(options = {}) { return loadActive(options); }
root?.addEventListener('music-service:group-change', event => { group = event.detail.group; void loadActive(); });
if (root) observeDashboardChartResize(root, () => {
  if (group === 'listeners') renderListeners();
  else { const cached = loaded.get(`${group}-jp-${periods[group]}`); if (cached) renderChart(group, cached.data, cached.state); }
}, { delay: 220, watchHeight: false });
