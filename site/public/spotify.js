import { loadSpotifyReadModel } from './dashboard-data-client.js?v=20261005.2';
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
const GRAPH_ARTIST_KEYS = Object.freeze(['sakurazaka46', 'nogizaka46', 'hinatazaka46']);
const GRAPH_ARTIST_KEY_SET = new Set(GRAPH_ARTIST_KEYS);
const MONTHLY_LISTENER_ARTIST_KEYS = Object.freeze([...GRAPH_ARTIST_KEYS, 'sakamichi-selection']);
const MONTHLY_LISTENER_ARTIST_KEY_SET = new Set(MONTHLY_LISTENER_ARTIST_KEYS);
const GRAPH_ARTIST_COLORS = Object.freeze({
  nogizaka46: '#8264b0',
  sakurazaka46: '#f3a6c8',
  hinatazaka46: '#9ecff3',
  'sakamichi-selection': '#667287',
});
const compactNumberFormat = new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 });
let requestSequence = 0;
let readModelPromise = null;
let latestCharts = null;

const setNotice = (message = '', error = false) => setSharedNotice('spotifyNotice', message, error);
const formatTrendDate = (value) => shortDate(value, '');
const formatInteger = (value) => {
  const parsed = integer(value);
  return parsed == null ? '-' : numberFormat.format(parsed);
};

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
    return { artistKey, artistName: String(metadata.artist_name || artistKey), points };
  }).filter((series) => series.points.length)
    .sort((a, b) => a.artistName.localeCompare(b.artistName, 'ja'));
}

function graphTrendSeries(seriesList = []) {
  const includesMonthlyListeners = seriesList.some((series) =>
    series.points.some((point) => integer(point?.monthly_listeners) != null));
  if (includesMonthlyListeners) {
    return seriesList
      .filter((series) => MONTHLY_LISTENER_ARTIST_KEY_SET.has(String(series?.artistKey || '')))
      .sort((a, b) => MONTHLY_LISTENER_ARTIST_KEYS.indexOf(a.artistKey) - MONTHLY_LISTENER_ARTIST_KEYS.indexOf(b.artistKey));
  }
  return seriesList
    .filter((series) => GRAPH_ARTIST_KEY_SET.has(String(series?.artistKey || '')))
    .sort((a, b) => GRAPH_ARTIST_KEYS.indexOf(a.artistKey) - GRAPH_ARTIST_KEYS.indexOf(b.artistKey));
}

function graphTrendColor(series) {
  return GRAPH_ARTIST_COLORS[series?.artistKey] || '#667287';
}

function monthlyListenerTrend(rows = []) {
  const trend = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const artistKey = String(row?.artist_key || '').trim();
    const snapshotDate = String(row?.snapshot_date || '').trim();
    const monthlyListeners = integer(row?.monthly_listeners);
    if (!MONTHLY_LISTENER_ARTIST_KEY_SET.has(artistKey) || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)
        || monthlyListeners == null || monthlyListeners < 0) continue;
    if (!trend[artistKey]) trend[artistKey] = [];
    trend[artistKey].push({
      snapshot_date: snapshotDate,
      artist_name: String(row?.artist_name || '').trim() || artistKey,
      monthly_listeners: monthlyListeners,
    });
  }
  return trend;
}

function overviewTrend(trend = {}, monthlyListenerRows = []) {
  const listeners = monthlyListenerTrend(monthlyListenerRows);
  const output = {};
  for (const key of GRAPH_ARTIST_KEYS) {
    const byDate = new Map((trend[key] || []).map((point) => [String(point.snapshot_date), { ...point }]));
    for (const point of listeners[key] || []) {
      const current = byDate.get(point.snapshot_date) || { snapshot_date: point.snapshot_date };
      byDate.set(point.snapshot_date, { ...current, ...point });
    }
    output[key] = [...byDate.values()];
  }
  return output;
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
  return { legend, canvas };
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

function renderTrendChart(trend = {}, {
  containerId, metricKey, ariaLabel, latestFormatter = signedInteger,
  secondaryMetricKey = '', secondaryFormatter = formatInteger,
} = {}) {
  const container = element(containerId);
  if (!container) return;
  container.replaceChildren();
  const seriesList = graphTrendSeries(normalizeTrendSeries(trend));
  const dates = [...new Set(seriesList.flatMap((series) => series.points.map((point) => String(point.snapshot_date))))].sort();
  const values = seriesList.flatMap((series) => series.points.map((point) => integer(point?.[metricKey]))).filter((value) => value != null);
  const secondValues = secondaryMetricKey
    ? seriesList.flatMap((series) => series.points.map((point) => integer(point?.[secondaryMetricKey]))).filter((value) => value != null)
    : [];
  if (!dates.length || (!values.length && !secondValues.length)) {
    appendEmptyState(container, 'Spotify推移データはまだありません。', { className: 'spotify-trend-empty' });
    return;
  }

  let yMin = Math.min(0, ...(values.length ? values : [0]));
  let yMax = Math.max(0, ...(values.length ? values : [1]));
  if (yMin === yMax) yMax = yMin + 1;
  if (yMin < 0) yMin = Math.floor(yMin * 1.08);
  if (yMax > 0) yMax = Math.ceil(yMax * 1.08);
  const yRange = Math.max(1, yMax - yMin);
  const secondMax = Math.max(1, Math.ceil(Math.max(1, ...secondValues) * 1.08));
  const { legend, canvas } = trendFrame(container, ariaLabel);
  legend.setAttribute('aria-label', secondaryMetricKey
    ? 'アーティスト凡例と最新値。実線は再生数前日比、破線は月間リスナー。'
    : 'アーティスト凡例と最新値');
  seriesList.forEach((series) => {
    const latest = (key) => [...series.points].reverse().find((point) => integer(point?.[key]) != null)?.[key];
    const text = secondaryMetricKey
      ? `再生 ${latestFormatter(latest(metricKey))} / 月間 ${secondaryFormatter(latest(secondaryMetricKey))}`
      : latestFormatter(latest(metricKey));
    legend.append(legendItem(series.artistName, text, graphTrendColor(series)));
  });
  if (secondaryMetricKey) {
    const key = document.createElement('span');
    key.className = 'spotify-trend-metric-key';
    key.textContent = '実線＝再生数前日比 / 破線＝月間リスナー';
    legend.append(key);
  }

  const measuredWidth = Math.max(1, Math.round(canvas.parentElement?.getBoundingClientRect?.().width || 960));
  const targetHeight = measuredWidth < 520 ? 300 : Math.max(300, Math.min(380, Math.round(measuredWidth * .42)));
  const prepared = prepareDashboardCanvas(canvas, { minimumWidth: 1, minimumHeight: 1, fallbackWidth: measuredWidth, height: targetHeight });
  if (!prepared) return;
  const { context, width, height } = prepared;
  const margin = { left: 72, right: secondaryMetricKey ? 72 : 22, top: secondaryMetricKey ? 28 : 18, bottom: 40 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => margin.left + (dates.length <= 1 ? plotWidth / 2 : (dateIndex.get(date) || 0) / (dates.length - 1) * plotWidth);
  const yFor = (value) => margin.top + (yMax - value) / yRange * plotHeight;
  const yForSecond = (value) => margin.top + (secondMax - value) / secondMax * plotHeight;

  context.font = '500 11px system-ui';
  context.fillStyle = '#667287';
  context.textBaseline = 'middle';
  if (secondaryMetricKey) {
    context.textAlign = 'left';
    context.fillText('再生数前日比', margin.left, 11);
    context.textAlign = 'right';
    context.fillText('月間リスナー', width - margin.right, 11);
  }
  for (const { ratio, y } of drawDashboardGrid(context, { left: margin.left, right: margin.right, top: margin.top, height: plotHeight, width })) {
    context.textAlign = 'right';
    context.fillText(compactNumberFormat.format(Math.round(yMax - yRange * ratio)), margin.left - 8, y);
    if (secondaryMetricKey) {
      context.textAlign = 'left';
      context.fillText(compactNumberFormat.format(Math.round(secondMax * (1 - ratio))), width - margin.right + 8, y);
    }
  }
  context.textBaseline = 'alphabetic';
  for (const index of dashboardTickIndexes(dates.length, 5)) {
    context.textAlign = index === 0 ? 'left' : index === dates.length - 1 ? 'right' : 'center';
    context.fillText(formatTrendDate(dates[index]), xFor(dates[index]), height - 10);
  }

  const drawMetric = (series, key, y, lineDash = []) => {
    const byDate = new Map(series.points.map((point) => [String(point.snapshot_date), point]));
    const rows = dates.map((date) => ({ date, value: integer(byDate.get(date)?.[key]) }));
    const count = drawDashboardLine(context, rows, {
      x: (row) => xFor(row.date), y, value: (row) => row.value,
      valid: (value) => value != null, strokeStyle: graphTrendColor(series), lineWidth: 2, lineDash,
    });
    if (count === 1) {
      const row = rows.find((item) => item.value != null);
      context.save();
      context.fillStyle = graphTrendColor(series);
      context.beginPath();
      context.arc(xFor(row.date), y(row.value), 3, 0, Math.PI * 2);
      secondaryMetricKey && key === secondaryMetricKey ? context.stroke() : context.fill();
      context.restore();
    }
  };
  seriesList.forEach((series) => {
    drawMetric(series, metricKey, yFor);
    // lineDash: [6, 4]
    if (secondaryMetricKey) drawMetric(series, secondaryMetricKey, yForSecond, [6, 4]);
  });
}

export function normalizeArtistRankSeries(chart = {}, trend = {}) {
  const tracked = graphTrendSeries(normalizeTrendSeries(trend));
  const byKey = new Map(tracked.map((series) => [series.artistKey, { artistKey: series.artistKey, artistName: series.artistName, points: [] }]));
  const byName = new Map([...byKey.values()].map((series) => [series.artistName, series]));
  const days = (Array.isArray(chart?.days) ? [...chart.days] : [])
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.chart_date || '')))
    .sort((a, b) => String(a.chart_date).localeCompare(String(b.chart_date)));
  for (const day of days) {
    for (const entry of Array.isArray(day?.entries) ? day.entries : []) {
      const series = byKey.get(String(entry?.artist_key || '').trim()) || byName.get(String(entry?.artist_name || '').trim());
      const rank = integer(entry?.rank);
      if (!series || rank == null || rank < 1 || rank > 200) continue;
      series.points.push({ chart_date: String(day.chart_date), rank });
    }
  }
  return [...byKey.values()].filter((series) => series.points.length)
    .sort((a, b) => GRAPH_ARTIST_KEYS.indexOf(a.artistKey) - GRAPH_ARTIST_KEYS.indexOf(b.artistKey))
    .map((series, colorIndex) => ({ ...series, colorIndex }));
}

function renderArtistRankChart(chart = {}, trend = {}) {
  const container = element('spotifyArtistRankTrendCharts');
  if (!container) return;
  container.replaceChildren();
  const seriesList = normalizeArtistRankSeries(chart, trend);
  const dates = [...new Set(seriesList.flatMap((series) => series.points.map((point) => point.chart_date)))].sort();
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
    legend.append(legendItem(series.artistName, latest ? `${numberFormat.format(latest.rank)}位` : '-', graphTrendColor(series)));
  }

  const measuredWidth = Math.max(1, Math.round(canvas.parentElement?.getBoundingClientRect?.().width || 960));
  const targetHeight = measuredWidth < 520 ? 300 : Math.max(300, Math.min(380, Math.round(measuredWidth * .42)));
  const prepared = prepareDashboardCanvas(canvas, { minimumWidth: 1, minimumHeight: 1, fallbackWidth: measuredWidth, height: targetHeight });
  if (!prepared) return;
  const { context, width, height } = prepared;
  const margin = { left: 72, right: 22, top: 18, bottom: 40 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => margin.left + (dates.length <= 1 ? plotWidth / 2 : (dateIndex.get(date) || 0) / (dates.length - 1) * plotWidth);
  const yFor = (rank) => margin.top + (rank - 1) / Math.max(1, maxRank - 1) * plotHeight;

  context.font = '500 11px system-ui';
  context.fillStyle = '#667287';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, { left: margin.left, right: margin.right, top: margin.top, height: plotHeight, width })) {
    context.textAlign = 'right';
    context.fillText(`${numberFormat.format(Math.max(1, Math.round(1 + (maxRank - 1) * ratio)))}位`, margin.left - 8, y);
  }
  context.textBaseline = 'alphabetic';
  for (const index of dashboardTickIndexes(dates.length, 5)) {
    context.textAlign = index === 0 ? 'left' : index === dates.length - 1 ? 'right' : 'center';
    context.fillText(formatTrendDate(dates[index]), xFor(dates[index]), height - 10);
  }

  for (const series of seriesList) {
    const byDate = new Map(series.points.map((point) => [point.chart_date, point]));
    drawDashboardLine(context, dates.map((date) => ({ date, rank: integer(byDate.get(date)?.rank) })), {
      x: (row) => xFor(row.date), y: (rank) => yFor(rank), value: (row) => row.rank,
      valid: (rank) => rank != null, strokeStyle: graphTrendColor(series), lineWidth: 2,
    });
  }
}

function syncTrendTitles() {
  const titles = {
    spotifyTrendTitle: 'Spotify 全曲合計再生数前日比推移',
    spotifyMonthlyListenerTrendTitle: 'Spotify 月間リスナー推移',
    spotifyTop10YearTrendTitle: 'Spotify 今年リリース上位10曲合計の再生数前日比推移',
    spotifyArtistRankTrendTitle: 'Spotify Daily Top Artist（日本）の順位推移',
  };
  for (const [id, label] of Object.entries(titles)) {
    const title = element(id);
    if (title) title.textContent = label;
  }
}

function renderCharts(trend, artistChart, monthlyListenerRows) {
  syncTrendTitles();
  renderTrendChart(trend, {
    containerId: 'spotifyTrendCharts', metricKey: 'total_delta',
    ariaLabel: '櫻坂46・乃木坂46・日向坂46の全曲合計再生数前日比推移',
  });
  renderTrendChart(monthlyListenerTrend(monthlyListenerRows), {
    containerId: 'spotifyMonthlyListenerTrendCharts', metricKey: 'monthly_listeners',
    latestFormatter: formatInteger,
    ariaLabel: '櫻坂46・乃木坂46・日向坂46のSpotify月間リスナー推移（坂道選抜を含む）',
  });
  renderTrendChart(trend, {
    containerId: 'spotifyTop10YearTrendCharts', metricKey: 'top10_year_delta',
    ariaLabel: '櫻坂46・乃木坂46・日向坂46の今年リリース上位10曲合計の再生数前日比推移',
  });
  renderArtistRankChart(artistChart, trend);
}

function render(payload, trend, artistChart, monthlyListenerRows) {
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

  latestCharts = { trend, artistChart, monthlyListenerRows };
  renderCharts(trend, artistChart, monthlyListenerRows);
  renderRows(payload || {});
  if (!payload?.track_count) setNotice(`${artistName}のSpotify再生数はまだ収集されていません。`);
  else if (payload.carried_forward) setNotice(`${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`);
  else setNotice('');
}

async function fetchReadModel({ refresh = false } = {}) {
  readModelPromise = loadSpotifyReadModel({ force: refresh });
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
    render(payload, model?.trend || {}, model?.artist_chart || {}, model?.monthly_listener_rows || []);
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
  syncTrendTitles();
  observeDashboardChartResize(element('spotifyView'), () => {
    if (latestCharts) renderCharts(latestCharts.trend, latestCharts.artistChart, latestCharts.monthlyListenerRows);
  }, { delay: 220, enabled: () => Boolean(latestCharts) });
}
