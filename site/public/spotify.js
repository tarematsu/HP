import {
  byId as element,
  fullDate as formatDate,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate,
  svgElement,
} from './dashboard-ui-common.js?v=20260930.1';

const SAKURAZAKA_KEY = 'sakurazaka46';
const SAKURAZAKA_NAME = '櫻坂46';
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

const setNotice = (message = '', error = false) => setSharedNotice('spotifyNotice', message, error);
const formatTrendDate = (value) => shortDate(value, '');

function formatDelta(value) {
  const number = integer(value);
  if (number == null) return '-';
  return number > 0 ? `+${numberFormat.format(number)}` : numberFormat.format(number);
}

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
    delta.textContent = formatDelta(track.delta);
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
      currentRank: integer(metadata.current_rank),
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
      if (integer(point?.[metricKey]) != null && snapshotDate > latestSnapshotDate) {
        latestSnapshotDate = snapshotDate;
      }
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

function xAxis(dates, margin, width) {
  const plotWidth = width - margin.left - margin.right;
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xForIndex = (index) => margin.left + (dates.length <= 1
    ? plotWidth / 2
    : index / (dates.length - 1) * plotWidth);
  const xTicks = [...new Set(dates.length <= 1
    ? [0]
    : [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((dates.length - 1) * ratio)))];
  return { dateIndex, xForIndex, xTicks };
}

function appendDateTicks(svg, dates, axis, height) {
  for (const index of axis.xTicks) {
    const label = svgElement('text', {
      x: axis.xForIndex(index),
      y: height - 12,
      'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle',
      class: 'spotify-trend-axis-label',
    });
    label.textContent = formatTrendDate(dates[index]);
    svg.append(label);
  }
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
    const empty = document.createElement('p');
    empty.className = 'spotify-trend-empty';
    empty.textContent = 'Spotify再生数の推移データはまだありません。';
    container.append(empty);
    return;
  }

  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) yMax = yMin + 1;
  if (yMin < 0) yMin = Math.floor(yMin * 1.08);
  if (yMax > 0) yMax = Math.ceil(yMax * 1.08);
  const yRange = Math.max(1, yMax - yMin);
  const width = 960;
  const height = 340;
  const margin = { left: 72, right: 22, top: 18, bottom: 40 };
  const plotHeight = height - margin.top - margin.bottom;
  const yForValue = (value) => margin.top + (yMax - value) / yRange * plotHeight;
  const axis = xAxis(dates, margin, width);

  const chart = document.createElement('section');
  chart.className = 'spotify-trend-series spotify-trend-combined';
  const legend = document.createElement('div');
  legend.className = 'spotify-trend-legend';
  legend.setAttribute('aria-label', 'アイドル凡例と最新の再生数前日比');
  seriesList.forEach(({ artistName, points }, seriesIndex) => {
    const color = TREND_COLORS[seriesIndex % TREND_COLORS.length];
    const latest = [...points].reverse().find((point) => integer(point?.[metricKey]) != null);
    const item = document.createElement('span');
    item.className = 'spotify-trend-legend-item';
    item.style.setProperty('--spotify-trend-color', color);
    const name = document.createElement('span');
    name.className = 'spotify-trend-name';
    name.textContent = artistName;
    const latestValue = document.createElement('strong');
    latestValue.className = 'spotify-trend-latest';
    latestValue.textContent = formatDelta(latest?.[metricKey]);
    item.append(name, latestValue);
    legend.append(item);
  });

  const scroll = document.createElement('div');
  scroll.className = 'spotify-trend-scroll chart-fit';
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': ariaLabel,
    class: 'spotify-trend-svg',
  });
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMax - yRange * tick / 4;
    const y = yForValue(value);
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: 'spotify-trend-grid',
    }));
    const label = svgElement('text', {
      x: margin.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: 'spotify-trend-axis-label',
    });
    label.textContent = compactNumberFormat.format(Math.round(value));
    svg.append(label);
  }
  appendDateTicks(svg, dates, axis, height);

  seriesList.forEach(({ artistName, points }, seriesIndex) => {
    const color = TREND_COLORS[seriesIndex % TREND_COLORS.length];
    const byDate = new Map(points.map((point) => [String(point.snapshot_date), point]));
    const plotted = [];
    let pathData = '';
    let drawing = false;
    for (const date of dates) {
      const value = integer(byDate.get(date)?.[metricKey]);
      if (value == null) {
        drawing = false;
        continue;
      }
      const x = axis.xForIndex(axis.dateIndex.get(date));
      const y = yForValue(value);
      plotted.push({ x, y });
      pathData += `${drawing ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      drawing = true;
    }
    if (plotted.length > 1 && pathData) {
      const path = svgElement('path', { d: pathData.trim(), class: 'spotify-trend-line' });
      path.style.setProperty('--spotify-trend-color', color);
      const title = svgElement('title');
      title.textContent = artistName;
      path.append(title);
      svg.append(path);
    } else if (plotted.length === 1) {
      const [{ x, y }] = plotted;
      const marker = svgElement('line', {
        x1: x - 5,
        x2: x + 5,
        y1: y,
        y2: y,
        class: 'spotify-trend-line spotify-single-point-line',
      });
      marker.style.setProperty('--spotify-trend-color', color);
      const title = svgElement('title');
      title.textContent = `${artistName}（取得済み1点）`;
      marker.append(title);
      svg.append(marker);
    }
    for (const point of points) {
      const value = integer(point?.[metricKey]);
      const index = axis.dateIndex.get(String(point.snapshot_date));
      if (value == null || index == null) continue;
      const circle = svgElement('circle', {
        cx: axis.xForIndex(index),
        cy: yForValue(value),
        r: plotted.length === 1 ? 3.4 : 2.4,
        class: 'spotify-trend-point',
      });
      circle.style.setProperty('--spotify-trend-color', color);
      const title = svgElement('title');
      title.textContent = `${artistName} ${formatDate(point.snapshot_date)} ${formatDelta(value)}`;
      circle.append(title);
      svg.append(circle);
    }
  });

  scroll.append(svg);
  chart.append(legend, scroll);
  container.append(chart);
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
    const empty = document.createElement('p');
    empty.className = 'spotify-trend-empty';
    empty.textContent = 'Spotify日本 Daily Top Artist の順位データはまだありません。';
    container.append(empty);
    return;
  }

  const maxRank = Math.min(200, Math.max(20, Math.ceil(Math.max(...ranks) / 10) * 10));
  const width = 960;
  const height = 340;
  const margin = { left: 72, right: 22, top: 18, bottom: 40 };
  const plotHeight = height - margin.top - margin.bottom;
  const yForRank = (rank) => margin.top + (rank - 1) / Math.max(1, maxRank - 1) * plotHeight;
  const axis = xAxis(dates, margin, width);
  const rankTicks = [...new Set([1, ...[0.25, 0.5, 0.75, 1]
    .map((ratio) => Math.max(1, Math.round(maxRank * ratio)))])].sort((a, b) => a - b);

  const chartElement = document.createElement('section');
  chartElement.className = 'spotify-trend-series spotify-trend-combined';
  const legend = document.createElement('div');
  legend.className = 'spotify-trend-legend';
  legend.setAttribute('aria-label', 'アーティスト凡例と最新順位');
  for (const series of seriesList) {
    const latest = series.points.at(-1);
    const color = TREND_COLORS[series.colorIndex % TREND_COLORS.length];
    const item = document.createElement('span');
    item.className = 'spotify-trend-legend-item';
    item.style.setProperty('--spotify-trend-color', color);
    const name = document.createElement('span');
    name.className = 'spotify-trend-name';
    name.textContent = series.artistName;
    const latestValue = document.createElement('strong');
    latestValue.className = 'spotify-trend-latest';
    latestValue.textContent = latest ? `${numberFormat.format(latest.rank)}位` : '-';
    item.append(name, latestValue);
    legend.append(item);
  }

  const scroll = document.createElement('div');
  scroll.className = 'spotify-trend-scroll chart-fit';
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Spotify日本 Daily Top Artist の順位推移。1位が上。',
    class: 'spotify-trend-svg',
  });
  for (const rank of rankTicks) {
    const y = yForRank(rank);
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: 'spotify-trend-grid',
    }));
    const label = svgElement('text', {
      x: margin.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: 'spotify-trend-axis-label',
    });
    label.textContent = `${numberFormat.format(rank)}位`;
    svg.append(label);
  }
  appendDateTicks(svg, dates, axis, height);

  for (const series of seriesList) {
    const color = TREND_COLORS[series.colorIndex % TREND_COLORS.length];
    const byDate = new Map(series.points.map((point) => [point.chart_date, point]));
    let pathData = '';
    let drawing = false;
    for (const date of dates) {
      const point = byDate.get(date);
      if (!point) {
        drawing = false;
        continue;
      }
      const x = axis.xForIndex(axis.dateIndex.get(date));
      const y = yForRank(point.rank);
      pathData += `${drawing ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      drawing = true;
    }
    if (pathData) {
      const path = svgElement('path', { d: pathData.trim(), class: 'spotify-trend-line' });
      path.style.setProperty('--spotify-trend-color', color);
      const title = svgElement('title');
      title.textContent = series.artistName;
      path.append(title);
      svg.append(path);
    }
    for (const point of series.points) {
      const index = axis.dateIndex.get(point.chart_date);
      if (index == null) continue;
      const circle = svgElement('circle', {
        cx: axis.xForIndex(index),
        cy: yForRank(point.rank),
        r: 2.4,
        class: 'spotify-trend-point',
      });
      circle.style.setProperty('--spotify-trend-color', color);
      const title = svgElement('title');
      title.textContent = `${series.artistName} ${formatDate(point.chart_date)} ${numberFormat.format(point.rank)}位`;
      circle.append(title);
      svg.append(circle);
    }
  }

  scroll.append(svg);
  chartElement.append(legend, scroll);
  container.append(chartElement);
}

function render(payload, trend, artistChart) {
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const delta = element('spotifyTotalDelta');
  if (delta) delta.textContent = formatDelta(payload?.total_delta);

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
  renderRows(payload || {});

  if (!payload?.track_count) {
    setNotice(`${SAKURAZAKA_NAME}のSpotify再生数はまだ収集されていません。`);
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
    const payload = model?.groups?.[SAKURAZAKA_KEY];
    if (!payload) throw new Error(`${SAKURAZAKA_NAME}のリードモデルがありません`);
    render(payload, model?.trend || {}, model?.artist_chart || {});
  } catch (error) {
    if (sequence !== requestSequence) return;
    setNotice(`Spotify再生数の取得に失敗しました：${error.message}`, true);
  }
}