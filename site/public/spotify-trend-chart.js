import {
  appendEmptyState,
  byId as element,
  integerFormat as numberFormat,
  safeInteger as integer,
  shortDate,
  signedInteger,
} from './dashboard-ui-common.js?v=20260930.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
const GRAPH_ARTIST_KEYS = Object.freeze(['sakurazaka46', 'nogizaka46', 'hinatazaka46']);
const GRAPH_ARTIST_KEY_SET = new Set(GRAPH_ARTIST_KEYS);
const MONTHLY_LISTENER_ARTIST_KEYS = Object.freeze([...GRAPH_ARTIST_KEYS, 'sakamichi-selection']);
const MONTHLY_LISTENER_ARTIST_KEY_SET = new Set(MONTHLY_LISTENER_ARTIST_KEYS);
const GRAPH_ARTIST_COLORS = Object.freeze({
  nogizaka46: '#8264b0',
  sakurazaka46: '#b43a75',
  hinatazaka46: '#287ca6',
  'sakamichi-selection': '#667287',
});
const compactNumberFormat = new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 });
const formatTrendDate = (value) => shortDate(value, '');
const formatInteger = (value) => {
  const parsed = integer(value);
  return parsed == null ? '-' : numberFormat.format(parsed);
};

export function normalizeTrendSeries(trend = {}) {
  return Object.entries(trend || {}).map(([artistKey, rawPoints]) => {
    const points = (Array.isArray(rawPoints) ? [...rawPoints] : [])
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point?.snapshot_date || '')))
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    const metadata = points.find((point) => point?.artist_name || point?.current_rank != null) || {};
    return { artistKey, artistName: String(metadata.artist_name || artistKey), points };
  }).filter((series) => series.points.length)
    .sort((a, b) => a.artistName.localeCompare(b.artistName, 'ja'));
}

export function graphTrendSeries(seriesList = [], artistFilter = 'all') {
  if (artistFilter !== 'all') seriesList = seriesList.filter(series => series.artistKey === artistFilter);
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

export function monthlyListenerTrend(rows = []) {
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

export function renderTrendChart(trend = {}, {
  containerId, metricKey, ariaLabel, latestFormatter = signedInteger,
  secondaryMetricKey = '', secondaryFormatter = formatInteger, artistFilter = 'all',
} = {}) {
  const container = element(containerId);
  if (!container) return;
  container.replaceChildren();
  const seriesList = graphTrendSeries(normalizeTrendSeries(trend), artistFilter);
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
