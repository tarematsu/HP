import {
  appendEmptyState,
  byId as element,
  fullDate as formatDate,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate,
  signedInteger,
} from './dashboard-ui-common.js?v=20260930.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
import { observeDashboardChartResize } from './dashboard-chart-runtime.js?v=20261001.1';

let selectedArtistKey = 'sakurazaka46';
const TREND_ARTIST_LIMIT = 10;
const TREND_COLORS = Object.freeze([
  '#f3a6c8', '#8264b0', '#9ecff3', '#ef8a62', '#67a9cf',
  '#a6d854', '#ffd92f', '#e78ac3', '#8da0cb', '#fc8d62',
  '#66c2a5', '#e5c494', '#b3b3b3', '#1b9e77', '#d95f02',
  '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d',
  '#1f78b4', '#b15928',
]);
const compactNumberFormat = new Intl.NumberFormat('ja-JP', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
let requestSequence = 0;
let readModelPromise = null;
let latestCharts = null;

const setNotice = (message = '', error = false) => setSharedNotice('spotifyNotice', message, error);
const formatTrendDate = (value) => shortDate(value, '');

function renderRows(payload = {}) {
  const body = element('spotifyTbody');
  if (!body) return;
  body.replaceChildren();
  for (const track of payload.tracks || []) {
    const row = document.createElement('tr');
    const rank = document.createElement('td');
    const name = document.createElement('td');
    const playcount = document.createElement('td');
    const delta = document.createElement('td');
    rank.textContent = numberFormat.format(Number(track.rank) || 0);
    name.textContent = String(track.name || '曲名不明');
    playcount.textContent = numberFormat.format(Number(track.playcount) || 0);
    delta.textContent = signedInteger(track.delta);
    playcount.className = 'spotify-number';
    delta.className = 'spotify-number';
    row.append(rank, name, playcount, delta);
    body.append(row);
  }
}

function normalizeTrendSeries(trend = {}) {
  return Object.entries(trend || {}).map(([artistKey, rawPoints]) => {
    const points = (Array.isArray(rawPoints) ? [...rawPoints] : [])
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point?.snapshot_date || '')))
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    const metadata = points.find((point) => point?.artist_name || point?.current_rank != null) || {};
    return {
      artistKey,
      artistName: String(metadata.artist_name || artistKey),
      points,
    };
  }).filter((series) => series.points.length)
    .sort((a, b) => a.artistName.localeCompare(b.artistName, 'ja'));
}

export function selectTrendSeriesByLatestMetric(seriesList = [], metricKey, limit = TREND_ARTIST_LIMIT) {
  let latestSnapshotDate = '';
  for (const series of seriesList) {
    for (const point of Array.isArray(series?.points) ? series.points : []) {
      const snapshotDate = String(point?.snapshot_date || '');
      if (integer(point?.[metricKey]) != null && snapshotDate > latestSnapshotDate) latestSnapshotDate = snapshotDate;
    }
  }
  if (!latestSnapshotDate) return [];

  const ranked = seriesList.map((series) => {
    const point = (Array.isArray(series?.points) ? series.points : [])
      .find((candidate) => String(candidate?.snapshot_date || '') === latestSnapshotDate);
    return { series, value: integer(point?.[metricKey]) };
  }).filter(({ value }) => value != null)
    .sort((a, b) => (b.value - a.value)
      || String(a.series?.artistName || '').localeCompare(String(b.series?.artistName || ''), 'ja'));

  const selected = Number.isInteger(limit) && limit > 0 ? ranked.slice(0, limit) : ranked;
  return selected.map(({ series }) => series);
}

function trendFrame(container, ariaLabel) {
  const chart = document.createElement('section');
  chart.className = 'spotify-trend-series spotify-trend-combined';
  const legend = document.createElement('div');
  legend.className = 'spotify-trend-legend';
  const scroll = document.createElement('div');
  scroll.className = 'spotify-trend-scroll chart-fit';
  const canvas = document.createElement('canvas');
  canvas.className = 'spotify-trend-canvas shared-dashboard-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', ariaLabel);
  scroll.append(canvas);
  chart.append(legend, scroll);
  container.append(chart);
  return { chart, legend, canvas };
}

function legendItem(artistName, latestText, color) {
  const item = document.createElement('span');
  item.className = 'spotify-trend-legend-item';
  item.style.setProperty('--spotify-trend-color', color);
  const name = document.createElement('span');
  name.className = 'spotify-trend-name';
  name.textContent = artistName;
  const latest = document.createElement('strong');
  latest.className = 'spotify-trend-latest';
  latest.textContent = latestText;
  item.append(name, latest);
  return item;
}

function renderTrendChart(trend = {}, { containerId, metricKey, ariaLabel, maxSeries = null }) {
  const container = element(containerId);
  if (!container) return;
  container.replaceChildren();

  const normalizedSeries = normalizeTrendSeries(trend);
  const seriesList = Number.isInteger(maxSeries) && maxSeries > 0
    ? selectTrendSeriesByLatestMetric(normalizedSeries, metricKey, maxSeries)
    : normalizedSeries;
  const dates = [...new Set(seriesList.flatMap((series) =>
    series.points.map((point) => String(point.snapshot_date))))].sort();
  const values = seriesList.flatMap((series) =>
    series.points.map((point) => integer(point?.[metricKey]))).filter((value) => value != null);
  if (!dates.length || !values.length) {
    appendEmptyState(container, 'Spotify再生数の推移データはまだありません。', { className: 'spotify-trend-empty' });
    return;
  }

  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) yMax = yMin + 1;
  if (yMin < 0) yMin = Math.floor(yMin * 1.08);
  if (yMax > 0) yMax = Math.ceil(yMax * 1.08);
  const yRange = Math.max(1, yMax - yMin);
  const { legend, canvas } = trendFrame(container, ariaLabel);
  legend.setAttribute('aria-label', 'アイドル凡例と最新の再生数前日比');
  seriesList.forEach(({ artistName, points }, seriesIndex) => {
    const color = TREND_COLORS[seriesIndex % TREND_COLORS.length];
    const latest = [...points].reverse().find((point) => integer(point?.[metricKey]) != null);
    legend.append(legendItem(artistName, signedInteger(latest?.[metricKey]), color));
  });

  const measuredWidth = Math.max(1, Math.round(canvas.parentElement?.getBoundingClientRect?.().width || 960));
  const targetHeight = measuredWidth < 520 ? 300 : Math.max(300, Math.min(380, Math.round(measuredWidth * .42)));
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 1,
    minimumHeight: 1,
    fallbackWidth: measuredWidth,
    height: targetHeight,
  });
  if (!prepared) return;
  const { context, width, height } = prepared;
  const margin = { left: 72, right: 22, top: 18, bottom: 40 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => margin.left + (dates.length <= 1
    ? plotWidth / 2
    : (dateIndex.get(date) || 0) / (dates.length - 1) * plotWidth);
  const yFor = (value) => margin.top + (yMax - value) / yRange * plotHeight;

  context.font = '500 11px system-ui';
  context.fillStyle = '#667287';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: margin.left,
    right: margin.right,
    top: margin.top,
    height: plotHeight,
    width,
  })) {
    const value = yMax - yRange * ratio;
    context.textAlign = 'right';
    context.fillText(compactNumberFormat.format(Math.round(value)), margin.left - 8, y);
  }
  context.textBaseline = 'alphabetic';
  for (const index of dashboardTickIndexes(dates.length, 5)) {
    context.textAlign = index === 0 ? 'left' : index === dates.length - 1 ? 'right' : 'center';
    context.fillText(formatTrendDate(dates[index]), xFor(dates[index]), height - 10);
  }

  seriesList.forEach(({ points }, seriesIndex) => {
    const color = TREND_COLORS[seriesIndex % TREND_COLORS.length];
    const byDate = new Map(points.map((point) => [String(point.snapshot_date), point]));
    const rows = dates.map((date) => ({ date, value: integer(byDate.get(date)?.[metricKey]) }));
    const plotted = rows.filter((row) => row.value != null);
    drawDashboardLine(context, rows, {
      x: (row) => xFor(row.date),
      y: (value) => yFor(value),
      value: (row) => row.value,
      valid: (value) => value != null,
      strokeStyle: color,
      lineWidth: 2,
    });
    if (plotted.length === 1) {
      const [row] = plotted;
      context.save();
      context.fillStyle = color;
      context.beginPath();
      context.arc(xFor(row.date), yFor(row.value), 3, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  });
}

export function normalizeArtistRankSeries(chart = {}, trend = {}) {
  const tracked = normalizeTrendSeries(trend);
  const byKey = new Map(tracked.map((series) => [series.artistKey, {
    artistKey: series.artistKey,
    artistName: series.artistName,
    points: [],
  }]));
  const byName = new Map([...byKey.values()].map((series) => [series.artistName, series]));
  const days = (Array.isArray(chart?.days) ? [...chart.days] : [])
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.chart_date || '')))
    .sort((a, b) => String(a.chart_date).localeCompare(String(b.chart_date)));
  for (const day of days) {
    for (const entry of Array.isArray(day?.entries) ? day.entries : []) {
      const artistKey = String(entry?.artist_key || '').trim();
      const artistName = String(entry?.artist_name || '').trim();
      const series = byKey.get(artistKey) || byName.get(artistName);
      const rank = integer(entry?.rank);
      if (!series || rank == null || rank < 1 || rank > 200) continue;
      series.points.push({ chart_date: String(day.chart_date), rank });
    }
  }
  return [...byKey.values()].filter((series) => series.points.length)
    .sort((a, b) => {
      const aRank = a.points.at(-1)?.rank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.points.at(-1)?.rank ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.artistName.localeCompare(b.artistName, 'ja');
    })
    .map((series, colorIndex) => ({ ...series, colorIndex }));
}

function renderArtistRankChart(chart = {}, trend = {}) {
  const container = element('spotifyArtistRankTrendCharts');
  if (!container) return;
  container.replaceChildren();
  const seriesList = normalizeArtistRankSeries(chart, trend);
  const dates = [...new Set(seriesList.flatMap((series) =>
    series.points.map((point) => point.chart_date)))].sort();
  const ranks = seriesList.flatMap((series) => series.points.map((point) => point.rank));
  if (!dates.length || !ranks.length) {
    appendEmptyState(container, 'Spotify日本 Daily Top Artist の順位データはまだありません。', { className: 'spotify-trend-empty' });
    return;
  }

  const maxRank = Math.min(200, Math.max(20, Math.ceil(Math.max(...ranks) / 10) * 10));
  const { legend, canvas } = trendFrame(container, 'Spotify日本 Daily Top Artist の順位推移。1位が上。');
  legend.setAttribute('aria-label', 'アーティスト凡例と最新順位');
  for (const series of seriesList) {
    const latest = series.points.at(-1);
    const color = TREND_COLORS[series.colorIndex % TREND_COLORS.length];
    legend.append(legendItem(series.artistName, latest ? `${numberFormat.format(latest.rank)}位` : '-', color));
  }

  const measuredWidth = Math.max(1, Math.round(canvas.parentElement?.getBoundingClientRect?.().width || 960));
  const targetHeight = measuredWidth < 520 ? 300 : Math.max(300, Math.min(380, Math.round(measuredWidth * .42)));
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 1,
    minimumHeight: 1,
    fallbackWidth: measuredWidth,
    height: targetHeight,
  });
  if (!prepared) return;
  const { context, width, height } = prepared;
  const margin = { left: 72, right: 22, top: 18, bottom: 40 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => margin.left + (dates.length <= 1
    ? plotWidth / 2
    : (dateIndex.get(date) || 0) / (dates.length - 1) * plotWidth);
  const yFor = (rank) => margin.top + (rank - 1) / Math.max(1, maxRank - 1) * plotHeight;

  context.font = '500 11px system-ui';
  context.fillStyle = '#667287';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: margin.left,
    right: margin.right,
    top: margin.top,
    height: plotHeight,
    width,
  })) {
    const rank = Math.max(1, Math.round(1 + (maxRank - 1) * ratio));
    context.textAlign = 'right';
    context.fillText(`${numberFormat.format(rank)}位`, margin.left - 8, y);
  }
  context.textBaseline = 'alphabetic';
  for (const index of dashboardTickIndexes(dates.length, 5)) {
    context.textAlign = index === 0 ? 'left' : index === dates.length - 1 ? 'right' : 'center';
    context.fillText(formatTrendDate(dates[index]), xFor(dates[index]), height - 10);
  }

  for (const series of seriesList) {
    const color = TREND_COLORS[series.colorIndex % TREND_COLORS.length];
    const byDate = new Map(series.points.map((point) => [point.chart_date, point]));
    const rows = dates.map((date) => ({ date, rank: integer(byDate.get(date)?.rank) }));
    drawDashboardLine(context, rows, {
      x: (row) => xFor(row.date),
      y: (rank) => yFor(rank),
      value: (row) => row.rank,
      valid: (rank) => rank != null,
      strokeStyle: color,
      lineWidth: 2,
    });
  }
}

function renderCharts(trend, artistChart) {
  renderTrendChart(trend, {
    containerId: 'spotifyTrendCharts',
    metricKey: 'total_delta',
    ariaLabel: '最新日の全曲合計再生数前日比が大きい女性アイドル上位10組の推移',
    maxSeries: TREND_ARTIST_LIMIT,
  });
  renderTrendChart(trend, {
    containerId: 'spotifyTop10YearTrendCharts',
    metricKey: 'top10_year_delta',
    ariaLabel: '今年リリース曲のうち再生数前日比上位10曲の合計が最新日に大きい女性アイドル上位10組の推移',
    maxSeries: TREND_ARTIST_LIMIT,
  });
  renderArtistRankChart(artistChart, trend);
}

function render(payload, trend, artistChart) {
  const artistName = payload?.artist?.name || selectedArtistKey;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const delta = element('spotifyTotalDelta');
  if (delta) delta.textContent = signedInteger(payload?.total_delta);
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${artistName}の再生数一覧`;
  const countLabel = element('spotifyTrackCountLabel');
  if (countLabel) countLabel.textContent = `${artistName}の楽曲数`;
  const deltaLabel = element('spotifyTotalDeltaLabel');
  if (deltaLabel) deltaLabel.textContent = `${artistName}の再生数前日比合計`;
  document.querySelectorAll('[data-spotify-artist]').forEach((button) => button.classList.toggle('active', button.dataset.spotifyArtist === selectedArtistKey));

  latestCharts = { trend, artistChart };
  renderCharts(trend, artistChart);
  renderRows(payload || {});

  if (!payload?.track_count) {
    setNotice(`${artistName}のSpotify再生数はまだ収集されていません。`);
  } else if (payload.carried_forward) {
    setNotice(`${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`);
  } else {
    setNotice('');
  }
}

async function fetchReadModel({ refresh = false } = {}) {
  if (refresh) readModelPromise = null;
  if (!readModelPromise) {
    readModelPromise = fetch('/api/spotify-playcounts')
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
      })
      .catch((error) => {
        readModelPromise = null;
        throw error;
      });
  }
  return readModelPromise;
}

export async function loadSpotifyView({ refresh = false } = {}) {
  const sequence = ++requestSequence;
  try {
    setNotice('');
    const model = await fetchReadModel({ refresh });
    if (sequence !== requestSequence) return;
    const payload = model?.groups?.[selectedArtistKey];
    if (!payload) throw new Error(`${selectedArtistKey}のリードモデルがありません`);
    render(payload, model?.trend || {}, model?.artist_chart || {});
  } catch (error) {
    if (sequence !== requestSequence) return;
    setNotice(`Spotify再生数の取得に失敗しました：${error.message}`, true);
  }
}

globalThis.document?.querySelectorAll('[data-spotify-artist]').forEach((button) => button.addEventListener('click', () => {
  selectedArtistKey = button.dataset.spotifyArtist;
  loadSpotifyView();
}));

if (typeof document !== 'undefined') {
  observeDashboardChartResize(element('spotifyView'), () => {
    if (latestCharts) renderCharts(latestCharts.trend, latestCharts.artistChart);
  }, { delay: 220, enabled: () => Boolean(latestCharts) });
}