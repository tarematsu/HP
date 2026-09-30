import {
  byId,
  cssColor,
  decimalOneFormat as decimal,
  finiteNumber as finite,
  integerFormat as integer,
  setText,
  svgElement,
} from './dashboard-ui-common.js?v=20260930.1';

const HINATA_URL = '/api/hinata';
const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const jstTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const utcDay = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'UTC',
  month: 'numeric',
  day: 'numeric',
});

let payload = null;
let chartRows = [];
let dailyChartRows = [];

const numberText = (value) => finite(value) == null ? '—' : integer.format(Number(value));
const signedText = (value) => {
  const number = finite(value);
  if (number == null) return '—';
  return `${number >= 0 ? '+' : ''}${integer.format(Math.round(number))}`;
};

function renderMetrics(value) {
  const latest = value?.latest || {};
  setText('hinataOnline', numberText(latest.online_member_count));
  setText('hinataStreams', numberText(latest.total_stream_count));
  setText('hinataMembers', numberText(latest.total_member_count));
  const updatedAt = finite(value?.updated_at);
  setText('hinataUpdated', updatedAt == null ? '—' : `${jstTime.format(new Date(updatedAt))} JST`);
}

function normalizedHistory(value) {
  const rows = Array.isArray(value?.history_24h) ? value.history_24h : [];
  const buckets = new Map();
  for (const raw of rows) {
    const observedAt = finite(raw?.observed_at);
    if (observedAt == null) continue;
    const bucket = Math.floor(observedAt / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
    const candidate = {
      observed_at: observedAt,
      bucket,
      online_member_count: finite(raw?.online_member_count),
      stream_count: finite(raw?.stream_count),
    };
    const current = buckets.get(bucket);
    if (!current || candidate.observed_at >= current.observed_at) buckets.set(bucket, candidate);
  }

  const points = [...buckets.values()].sort((left, right) => left.bucket - right.bucket);
  return points.map((point, index) => {
    const previous = points[index - 1];
    let streamDelta = null;
    if (
      previous
      && point.bucket - previous.bucket === FIVE_MINUTES_MS
      && point.stream_count != null
      && previous.stream_count != null
    ) {
      const delta = point.stream_count - previous.stream_count;
      if (delta >= 0) streamDelta = delta;
    }
    return {
      observed_at: point.bucket,
      online_member_count: point.online_member_count,
      stream_delta_5m: streamDelta,
    };
  });
}

function renderChart(value) {
  const host = byId('hinataChart');
  if (!host) return;
  chartRows = normalizedHistory(value);
  host.replaceChildren();
  if (!chartRows.length) {
    const empty = document.createElement('p');
    empty.className = 'hinata-empty';
    empty.textContent = 'グラフデータはまだありません。';
    host.append(empty);
    return;
  }

  const width = 1000;
  const height = 320;
  const padding = { left: 58, right: 24, top: 20, bottom: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minTime = chartRows[0].observed_at;
  const maxTime = chartRows.at(-1).observed_at;
  const span = Math.max(1, maxTime - minTime);
  const onlineMax = Math.max(1, ...chartRows.map((row) => row.online_member_count ?? 0));
  const growthMax = Math.max(1, ...chartRows.map((row) => Math.max(0, row.stream_delta_5m ?? 0)));
  const x = (time) => padding.left + (time - minTime) / span * plotWidth;
  const y = (online) => padding.top + plotHeight - Math.max(0, online || 0) / onlineMax * plotHeight;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'presentation',
    preserveAspectRatio: 'none',
  });

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const gridY = padding.top + plotHeight * ratio;
    svg.append(svgElement('line', {
      x1: padding.left,
      x2: width - padding.right,
      y1: gridY,
      y2: gridY,
      stroke: '#e5e5e5',
      'stroke-width': 1,
    }));
    svg.append(svgElement('text', {
      x: padding.left - 9,
      y: gridY + 4,
      'text-anchor': 'end',
      'font-size': 20,
      fill: '#777',
    }, integer.format(Math.round(onlineMax * (1 - ratio)))));
  }

  const barSlot = Math.max(2, plotWidth / Math.max(1, chartRows.length));
  const barWidth = Math.max(2, Math.min(16, barSlot * 0.72));
  const barMaxHeight = Math.min(92, plotHeight * 0.36);
  for (const row of chartRows) {
    const growth = Math.max(0, row.stream_delta_5m ?? 0);
    if (!growth) continue;
    const barHeight = growth / growthMax * barMaxHeight;
    svg.append(svgElement('rect', {
      x: x(row.observed_at) - barWidth / 2,
      y: padding.top + plotHeight - barHeight,
      width: barWidth,
      height: barHeight,
      fill: '#b9b9b9',
      rx: 1,
    }));
  }

  const onlineRows = chartRows.filter((row) => row.online_member_count != null);
  if (onlineRows.length) {
    const path = onlineRows.map((row, index) => `${index ? 'L' : 'M'} ${x(row.observed_at).toFixed(2)} ${y(row.online_member_count).toFixed(2)}`).join(' ');
    svg.append(svgElement('path', {
      d: path,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 3,
      'vector-effect': 'non-scaling-stroke',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
  }

  for (let index = 0; index <= 4; index += 1) {
    const timestamp = minTime + span * index / 4;
    svg.append(svgElement('text', {
      x: padding.left + plotWidth * index / 4,
      y: height - 8,
      'text-anchor': index === 0 ? 'start' : index === 4 ? 'end' : 'middle',
      'font-size': 20,
      fill: '#777',
    }, jstTime.format(new Date(timestamp))));
  }

  const hit = svgElement('rect', {
    x: padding.left,
    y: padding.top,
    width: plotWidth,
    height: plotHeight,
    fill: 'transparent',
  });
  hit.addEventListener('pointerup', (event) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const svgX = (event.clientX - bounds.left) / bounds.width * width;
    const target = minTime + Math.max(0, Math.min(1, (svgX - padding.left) / plotWidth)) * span;
    let selected = chartRows[0];
    for (const row of chartRows) {
      if (Math.abs(row.observed_at - target) < Math.abs(selected.observed_at - target)) selected = row;
    }
    const growth = selected.stream_delta_5m == null ? '—' : `+${decimal.format(selected.stream_delta_5m)}`;
    setText(
      'hinataChartDetail',
      `${jstDateTime.format(new Date(selected.observed_at))} JST　オンライン ${numberText(selected.online_member_count)}人　再生数増加 ${growth}/5分`,
    );
  });
  svg.append(hit);
  host.append(svg);
}

function normalizeDailyChartRows(value) {
  return (Array.isArray(value?.daily) ? value.daily : [])
    .map((row) => {
      const periodKey = String(row?.period_key || '');
      const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(periodKey)
        ? Date.parse(`${periodKey}T00:00:00Z`)
        : NaN;
      return {
        period_key: periodKey,
        timestamp,
        listener_avg: finite(row?.listener_avg),
        listener_min: finite(row?.listener_min),
        listener_max: finite(row?.listener_max),
        stream_growth: finite(row?.stream_growth),
      };
    })
    .filter((row) => Number.isFinite(row.timestamp)
      && ['listener_avg', 'listener_min', 'listener_max', 'stream_growth']
        .some((key) => row[key] != null))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function appendDailyLegend(label, color, bar = false) {
  const span = document.createElement('span');
  const marker = document.createElement('i');
  marker.className = bar ? 'hinata-bar-key' : 'hinata-line-key';
  marker.style.background = color;
  span.append(marker, document.createTextNode(label));
  return span;
}

function renderDailyChart(value) {
  const host = byId('hinataDailyChart');
  if (!host) return;
  dailyChartRows = normalizeDailyChartRows(value);
  host.replaceChildren();
  const legend = byId('hinataDailyChartLegend');
  legend?.replaceChildren();
  if (!dailyChartRows.length) {
    const empty = document.createElement('p');
    empty.className = 'hinata-empty';
    empty.textContent = '日次グラフデータはまだありません。';
    host.append(empty);
    return;
  }

  const width = 1000;
  const height = 340;
  const padding = { left: 58, right: 70, top: 20, bottom: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minTime = dailyChartRows[0].timestamp;
  const maxTime = dailyChartRows.at(-1).timestamp;
  const span = Math.max(DAY_MS, maxTime - minTime);
  const x = (time) => padding.left + (time - minTime) / span * plotWidth;

  const listenerSeries = [
    { key: 'listener_avg', label: '平均同接', color: '#000000', width: 3 },
    { key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 2 },
    { key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 2 },
  ];
  const listenerValues = listenerSeries.flatMap(({ key }) =>
    dailyChartRows.map((row) => row[key]).filter((item) => item != null));
  const rawMin = listenerValues.length ? Math.min(...listenerValues) : 0;
  const rawMax = listenerValues.length ? Math.max(...listenerValues) : 1;
  const listenerPadding = Math.max(1, (rawMax - rawMin) * 0.08);
  const listenerMin = Math.max(0, rawMin - listenerPadding);
  const listenerMax = Math.max(listenerMin + 1, rawMax + listenerPadding);
  const listenerRange = listenerMax - listenerMin;
  const listenerY = (number) => padding.top + plotHeight
    - (Number(number) - listenerMin) / listenerRange * plotHeight;

  const streamValues = dailyChartRows
    .map((row) => row.stream_growth)
    .filter((item) => item != null && item >= 0);
  const streamColor = cssColor('--green', '#168b73');
  const streamMax = Math.max(1, ...streamValues);
  const streamCeiling = Math.max(1, streamMax * 1.08);
  const streamY = (number) => padding.top + plotHeight
    - Math.max(0, Number(number) || 0) / streamCeiling * plotHeight;

  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'presentation',
    preserveAspectRatio: 'none',
  });

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const gridY = padding.top + plotHeight * ratio;
    svg.append(svgElement('line', {
      x1: padding.left,
      x2: width - padding.right,
      y1: gridY,
      y2: gridY,
      stroke: 'rgba(31,45,68,.12)',
      'stroke-width': 1,
    }));
    if (listenerValues.length) {
      svg.append(svgElement('text', {
        x: padding.left - 9,
        y: gridY + 4,
        'text-anchor': 'end',
        'font-size': 20,
        fill: '#777',
      }, integer.format(Math.round(listenerMax - listenerRange * ratio))));
    }
    if (streamValues.length) {
      svg.append(svgElement('text', {
        x: width - padding.right + 9,
        y: gridY + 4,
        'text-anchor': 'start',
        'font-size': 20,
        fill: '#777',
      }, integer.format(Math.round(streamCeiling * (1 - ratio)))));
    }
  }

  if (streamValues.length) {
    const totalDays = Math.max(1, Math.round(span / DAY_MS) + 1);
    const slot = plotWidth / totalDays;
    const barWidth = Math.max(1.5, Math.min(16, slot * 0.58));
    for (const row of dailyChartRows) {
      if (row.stream_growth == null || row.stream_growth < 0) continue;
      const y = streamY(row.stream_growth);
      svg.append(svgElement('rect', {
        x: x(row.timestamp) - barWidth / 2,
        y,
        width: barWidth,
        height: padding.top + plotHeight - y,
        fill: streamColor,
        'fill-opacity': 0.42,
      }));
    }
  }

  for (const series of listenerSeries) {
    let path = '';
    let previousTime = null;
    for (const row of dailyChartRows) {
      const next = row[series.key];
      if (next == null) {
        previousTime = null;
        continue;
      }
      const command = previousTime != null && row.timestamp - previousTime <= DAY_MS * 1.5 ? 'L' : 'M';
      path += `${command} ${x(row.timestamp).toFixed(2)} ${listenerY(next).toFixed(2)} `;
      previousTime = row.timestamp;
    }
    if (!path) continue;
    svg.append(svgElement('path', {
      d: path.trim(),
      fill: 'none',
      stroke: series.color,
      'stroke-width': series.width,
      'vector-effect': 'non-scaling-stroke',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
  }

  svg.append(svgElement('line', {
    x1: padding.left,
    x2: width - padding.right,
    y1: padding.top + plotHeight,
    y2: padding.top + plotHeight,
    stroke: 'rgba(31,45,68,.24)',
    'stroke-width': 1,
  }));
  for (let index = 0; index <= 4; index += 1) {
    const timestamp = minTime + span * index / 4;
    svg.append(svgElement('text', {
      x: padding.left + plotWidth * index / 4,
      y: height - 8,
      'text-anchor': index === 0 ? 'start' : index === 4 ? 'end' : 'middle',
      'font-size': 20,
      fill: '#777',
    }, utcDay.format(new Date(timestamp))));
  }

  const hit = svgElement('rect', {
    x: padding.left,
    y: padding.top,
    width: plotWidth,
    height: plotHeight,
    fill: 'transparent',
  });
  hit.addEventListener('pointerup', (event) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const svgX = (event.clientX - bounds.left) / bounds.width * width;
    const target = minTime + Math.max(0, Math.min(1, (svgX - padding.left) / plotWidth)) * span;
    let selected = dailyChartRows[0];
    for (const row of dailyChartRows) {
      if (Math.abs(row.timestamp - target) < Math.abs(selected.timestamp - target)) selected = row;
    }
    setText(
      'hinataDailyChartDetail',
      `${selected.period_key}　平均同接 ${numberText(selected.listener_avg)}`
      + `　最大同接 ${numberText(selected.listener_max)}`
      + `　最小同接 ${numberText(selected.listener_min)}`
      + `　再生数増加 ${numberText(selected.stream_growth)}`,
    );
  });
  svg.append(hit);
  host.append(svg);

  if (legend) {
    const items = listenerSeries
      .filter((series) => dailyChartRows.some((row) => row[series.key] != null))
      .map((series) => appendDailyLegend(series.label, series.color));
    if (streamValues.length) items.push(appendDailyLegend('再生数増加', streamColor, true));
    legend.replaceChildren(...items);
  }
}

function renderDaily(value) {
  const tbody = byId('hinataDailyTbody');
  if (!tbody) return;
  const rows = Array.isArray(value?.daily) ? value.daily : [];
  tbody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 10;
    cell.className = 'hinata-empty';
    cell.textContent = '日次データはまだありません。';
    row.append(cell);
    tbody.append(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement('tr');
    const values = [
      String(item?.period_key || '—'),
      finite(item?.listener_avg) == null ? '—' : decimal.format(item.listener_avg),
      numberText(item?.listener_min),
      numberText(item?.listener_max),
      numberText(item?.stream_start),
      numberText(item?.stream_end),
      signedText(item?.stream_growth),
      numberText(item?.member_start),
      numberText(item?.member_end),
      signedText(item?.member_growth),
    ];
    for (const valueText of values) {
      const cell = document.createElement('td');
      cell.textContent = valueText;
      row.append(cell);
    }
    tbody.append(row);
  }
}

function render(value) {
  payload = value;
  renderMetrics(value);
  renderChart(value);
  renderDailyChart(value);
  renderDaily(value);
  const notice = byId('hinataNotice');
  if (notice) {
    notice.hidden = true;
    notice.classList.remove('error');
    notice.textContent = '';
  }
}

export async function loadHinataView() {
  const response = await fetch(HINATA_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`hinata API HTTP ${response.status}`);
  const next = await response.json();
  if (!next?.ok) throw new Error(next?.error || 'hinata read model unavailable');
  render(next);
  return next;
}

window.addEventListener('resize', () => {
  if (payload && !byId('hinataView')?.hidden) {
    renderChart(payload);
    renderDailyChart(payload);
  }
});