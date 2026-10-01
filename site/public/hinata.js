import {
  appendEmptyTableRow,
  byId,
  cssColor,
  decimalOneFormat as decimal,
  finiteNumber as finite,
  integerFormat as integer,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
import {
  appendDashboardLegendItem,
  dashboardMissingGapBands,
  dashboardValueBounds,
  DASHBOARD_MISSING_KEY,
  drawDashboardMissingBands,
  nearestPositionIndex,
  observeDashboardChartResize,
  roundedDashboardMaximum,
} from './dashboard-chart-runtime.js?v=20261001.1';
import { JST_DATE_TIME_MDHM, JST_TIME_HM } from './dashboard-time.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';

const HINATA_URL = '/api/hinata';
const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const STREAM_BAR_COLOR = '#168b73';

let payload = null;
let chartRows = [];
let dailyChartRows = [];
let liveModel = null;
let dailyModel = null;
let liveSelection = null;
let dailySelection = null;

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
}

function canvasWidth(canvas) {
  if (!canvas) return 0;
  const width = Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 0);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function prepareCanvas(id, { currentHeight = false } = {}) {
  const canvas = byId(id);
  if (!canvas) return null;
  const measuredWidth = Math.max(320, canvasWidth(canvas) || 960);
  const height = currentHeight
    ? (measuredWidth < 520 ? 330 : Math.max(350, Math.min(430, Math.round(measuredWidth * .49))))
    : Math.max(260, Math.round(canvas.clientHeight || 360));
  return prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 260,
    fallbackWidth: measuredWidth,
    height,
  });
}

function setChartEmpty(canvasId, emptyId, empty) {
  const canvas = byId(canvasId);
  const message = byId(emptyId);
  if (canvas) canvas.hidden = Boolean(empty);
  if (message) message.hidden = !empty;
}

function drawGrid(context, { width, area, leftBounds, rightMaximum = null }) {
  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: area.left,
    right: area.right,
    top: area.top,
    height: area.height,
    width,
  })) {
    context.textAlign = 'right';
    const leftValue = leftBounds.maximum - leftBounds.range * ratio;
    context.fillText(integer.format(Math.round(leftValue)), area.left - 6, y);
    if (rightMaximum != null) {
      context.textAlign = 'left';
      context.fillText(integer.format(Math.round(rightMaximum * (1 - ratio))), width - area.right + 6, y);
    }
  }
}

function drawLine(context, rows, { key, color, width = 2, xFor, yFor, maxGap = Infinity }) {
  return drawDashboardLine(context, rows, {
    x: (row) => xFor(finite(row?.timestamp ?? row?.observed_at)),
    y: (value) => yFor(value),
    value: (row) => finite(row?.[key]),
    valid: (value) => value != null,
    gap: (before, after) => {
      const previousTime = finite(before?.timestamp ?? before?.observed_at);
      const nextTime = finite(after?.timestamp ?? after?.observed_at);
      return previousTime != null && nextTime != null && nextTime - previousTime > maxGap;
    },
    strokeStyle: color,
    lineWidth: width,
  });
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

function renderLiveDetail() {
  const detail = byId('hinataChartDetail');
  if (!detail) return;
  const selected = Number.isInteger(liveSelection) ? chartRows[liveSelection] : null;
  if (!selected) {
    detail.textContent = '';
    return;
  }
  const growth = selected.stream_delta_5m == null ? '—' : `+${decimal.format(selected.stream_delta_5m)}`;
  detail.textContent = `${JST_DATE_TIME_MDHM.format(new Date(selected.observed_at))} JST　オンライン ${numberText(selected.online_member_count)}人　再生数増加 ${growth}/5分`;
}

function renderChart(value) {
  chartRows = normalizedHistory(value);
  if (!chartRows.length) {
    setChartEmpty('hinataChart', 'hinataChartEmpty', true);
    liveModel = null;
    renderLiveDetail();
    return;
  }
  setChartEmpty('hinataChart', 'hinataChartEmpty', false);
  const prepared = prepareCanvas('hinataChart', { currentHeight: true });
  if (!prepared) return;
  const { canvas, context, width, height } = prepared;
  const area = { left: 50, right: 50, top: 28, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const plotBottom = area.top + area.height;
  const minTime = chartRows[0].observed_at;
  const maxTime = chartRows.at(-1).observed_at;
  const span = Math.max(1, maxTime - minTime);
  const xFor = (time) => area.left + area.width * (time - minTime) / span;

  const onlineValues = chartRows
    .map((row) => finite(row.online_member_count))
    .filter((item) => item != null);
  const bounds = dashboardValueBounds(onlineValues);
  const yOnline = (value) => plotBottom - (Number(value) - bounds.minimum) * area.height / bounds.range;
  const streamRows = chartRows.filter((row) => finite(row.stream_delta_5m) != null && row.stream_delta_5m >= 0);
  const streamMax = roundedDashboardMaximum(streamRows.length
    ? Math.max(...streamRows.map((row) => row.stream_delta_5m))
    : 0);
  const yStream = (value) => plotBottom - Math.max(0, Number(value)) * area.height / streamMax;

  drawGrid(context, { width, area, leftBounds: bounds, rightMaximum: streamRows.length ? streamMax : null });

  if (streamRows.length) {
    const bucketWidth = area.width * FIVE_MINUTES_MS / Math.max(DAY_MS, span);
    const barWidth = Math.max(1, Math.min(6, bucketWidth * .82));
    context.save();
    context.fillStyle = STREAM_BAR_COLOR;
    context.globalAlpha = .34;
    for (const row of streamRows) {
      const x = xFor(row.observed_at);
      const y = yStream(row.stream_delta_5m);
      const barHeight = Math.max(row.stream_delta_5m > 0 ? .75 : 0, plotBottom - y);
      if (barHeight > 0) context.fillRect(x - barWidth / 2, plotBottom - barHeight, barWidth, barHeight);
    }
    context.restore();
  }

  drawLine(context, chartRows, {
    key: 'online_member_count',
    color: '#111',
    width: 2,
    xFor,
    yFor: yOnline,
    maxGap: 20 * 60_000,
  });

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (let index = 0; index < 5; index += 1) {
    const time = minTime + span * index / 4;
    context.fillText(JST_TIME_HM.format(new Date(time)), xFor(time), height - 14);
  }
  context.textAlign = 'left';
  context.fillText('オンライン数（人）', 4, 12);
  context.textAlign = 'right';
  context.fillText('再生数増加', width - 4, 12);
  context.textAlign = 'center';
  context.fillText('時刻（JST）', width / 2, height - 2);

  liveModel = { canvas, xFor, minTime, span };
  renderLiveDetail();
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

function formatPeriodTick(periodKey) {
  const match = String(periodKey || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : String(periodKey || '');
}

function renderDailyDetail() {
  const detail = byId('hinataDailyChartDetail');
  if (!detail) return;
  const row = Number.isInteger(dailySelection) ? dailyChartRows[dailySelection] : null;
  if (!row) {
    detail.textContent = '';
    return;
  }
  detail.textContent = `${row.period_key}　平均同接 ${numberText(row.listener_avg)}`
    + `　最大同接 ${numberText(row.listener_max)}`
    + `　最小同接 ${numberText(row.listener_min)}`
    + `　再生数増加 ${row.stream_growth == null ? '—' : integer.format(Math.round(row.stream_growth))}`;
}

function renderDailyChart(value) {
  dailyChartRows = normalizeDailyChartRows(value);
  const legend = byId('hinataDailyChartLegend');
  legend?.replaceChildren();
  if (!dailyChartRows.length) {
    setChartEmpty('hinataDailyChart', 'hinataDailyChartEmpty', true);
    dailyModel = null;
    renderDailyDetail();
    return;
  }
  setChartEmpty('hinataDailyChart', 'hinataDailyChartEmpty', false);
  const prepared = prepareCanvas('hinataDailyChart');
  if (!prepared) return;
  const { canvas, context, width, height } = prepared;
  const area = { left: 58, right: 70, top: 18, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const minTime = dailyChartRows[0].timestamp;
  const maxTime = dailyChartRows.at(-1).timestamp;
  const span = Math.max(DAY_MS, maxTime - minTime);
  const xFor = (time) => area.left + (time - minTime) / span * area.width;

  const listenerSeries = [
    { key: 'listener_avg', label: '平均同接', color: '#000000', width: 2 },
    { key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 2 },
    { key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 2 },
  ];
  const listenerValues = listenerSeries.flatMap(({ key }) =>
    dailyChartRows.map((row) => finite(row?.[key])).filter((item) => item != null));
  const bounds = dashboardValueBounds(listenerValues);
  const yListener = (value) => area.top + area.height
    - (Number(value) - bounds.minimum) / bounds.range * area.height;
  const streamValues = dailyChartRows
    .map((row) => finite(row.stream_growth))
    .filter((item) => item != null && item >= 0);
  const streamMax = roundedDashboardMaximum(streamValues.length ? Math.max(...streamValues) : 0);
  const yStream = (value) => area.top + area.height
    - Math.max(0, Number(value) || 0) / streamMax * area.height;

  const positions = dailyChartRows.map((row) => xFor(row.timestamp));
  const hasMissing = drawDashboardMissingBands(
    context,
    dashboardMissingGapBands(dailyChartRows, positions, area, {
      time: (row) => row.timestamp,
      maxGap: DAY_MS * 1.5,
      edgeInset: area.width * DAY_MS / span / 2,
    }),
    { top: area.top, height: area.height },
  );
  drawGrid(context, {
    width,
    area,
    leftBounds: bounds,
    rightMaximum: streamValues.length ? streamMax : null,
  });

  if (streamValues.length) {
    const totalDays = Math.max(1, Math.round(span / DAY_MS) + 1);
    const slot = area.width / totalDays;
    const barWidth = Math.max(2, Math.min(18, slot * .58));
    context.save();
    context.fillStyle = STREAM_BAR_COLOR;
    context.globalAlpha = .42;
    for (const row of dailyChartRows) {
      const streamGrowth = finite(row.stream_growth);
      if (streamGrowth == null || streamGrowth < 0) continue;
      const y = yStream(streamGrowth);
      context.fillRect(xFor(row.timestamp) - barWidth / 2, y, barWidth, area.top + area.height - y);
    }
    context.restore();
  }

  for (const series of listenerSeries) {
    drawLine(context, dailyChartRows, {
      ...series,
      xFor,
      yFor: yListener,
      maxGap: DAY_MS * 1.5,
    });
  }

  const tickIndexes = dashboardTickIndexes(
    dailyChartRows.length,
    Math.min(dailyChartRows.length, Math.max(4, Math.floor(area.width / 140))),
  );
  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions,
    indexes: tickIndexes,
    labelFor: (index) => formatPeriodTick(dailyChartRows[index].period_key),
    fillStyle: cssColor('--muted', '#667287'),
  });

  if (legend) {
    const items = listenerSeries
      .filter((series) => dailyChartRows.some((row) => finite(row?.[series.key]) != null))
      .map((series) => appendDashboardLegendItem(series.label, series.color));
    if (streamValues.length) items.push(appendDashboardLegendItem('再生数増加', STREAM_BAR_COLOR, { className: 'period-stream-bars' }));
    if (hasMissing) items.push(appendDashboardLegendItem('欠測', DASHBOARD_MISSING_KEY, { className: 'period-missing-band' }));
    legend.replaceChildren(...items);
  }

  const foot = byId('hinataDailyChartFoot');
  if (foot) {
    foot.textContent = hasMissing
      ? '左軸は同接（平均・最大・最小）、右軸は日次の再生数増加です。灰色は欠測期間です。'
      : '左軸は同接（平均・最大・最小）、右軸は日次の再生数増加です。';
  }

  dailyModel = { canvas, rows: dailyChartRows, xFor, positions };
  renderDailyDetail();
}

function renderDaily(value) {
  const tbody = byId('hinataDailyTbody');
  if (!tbody) return;
  const rows = Array.isArray(value?.daily) ? value.daily : [];
  tbody.replaceChildren();
  if (!rows.length) {
    appendEmptyTableRow(tbody, '日次データはまだありません。', 10, { className: 'shared-empty' });
    return;
  }

  for (const item of rows) {
    appendTableRow(tbody, [
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
    ]);
  }
}

function render(value) {
  payload = value;
  liveSelection = null;
  dailySelection = null;
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
}

byId('hinataChart')?.addEventListener('pointerup', (event) => {
  if (!liveModel || !chartRows.length) return;
  const bounds = liveModel.canvas.getBoundingClientRect();
  if (!bounds.width) return;
  const pointer = event.clientX - bounds.left;
  const areaLeft = 50;
  const areaRight = 50;
  const plotWidth = Math.max(1, bounds.width - areaLeft - areaRight);
  const ratio = Math.max(0, Math.min(1, (pointer - areaLeft) / plotWidth));
  const target = liveModel.minTime + liveModel.span * ratio;
  liveSelection = nearestPositionIndex(chartRows.map((row) => row.observed_at), target);
  renderLiveDetail();
});

byId('hinataDailyChart')?.addEventListener('pointerup', (event) => {
  if (!dailyModel?.rows?.length) return;
  const bounds = dailyModel.canvas.getBoundingClientRect();
  const pointer = event.clientX - bounds.left;
  dailySelection = nearestPositionIndex(dailyModel.positions, pointer);
  renderDailyDetail();
});

const hinataView = byId('hinataView');
const redraw = () => {
  if (!payload || hinataView?.hidden) return;
  renderChart(payload);
  renderDailyChart(payload);
};
observeDashboardChartResize(byId('hinataChart'), redraw, { delay: 240, enabled: () => Boolean(payload && !hinataView?.hidden) });
observeDashboardChartResize(byId('hinataDailyChart'), redraw, { delay: 240, enabled: () => Boolean(payload && !hinataView?.hidden) });
