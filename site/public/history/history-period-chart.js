import {
  byId,
  cssColor,
  finiteNumber as finite,
  integerFormat as integer,
} from '../dashboard-ui-common.js?v=20260930.1';
import {
  drawDashboardGrid,
  drawDashboardLine,
  prepareDashboardCanvas,
} from '../dashboard-chart-canvas.js?v=20261001.1';

const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);

let latestMode = '';
let latestRows = [];
let selectedIndex = null;
let drawTimer = 0;
let resizeTimer = 0;
let chartModel = null;

function activeMode() {
  const active = document.querySelector('#modeTabs button.active[data-mode]');
  const routeMode = String(active?.dataset?.mode || latestMode || '');
  if (routeMode === 'daily' && byId('historyPastWeekMode')?.checked) return 'weekly';
  return routeMode;
}

function scheduleDraw(delay = 0) {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(draw));
  }, delay);
}

function listenerBounds(values) {
  if (!values.length) return { minimum: 0, maximum: 1, range: 1 };
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max(1, (rawMaximum - rawMinimum) * 0.08);
  const minimum = Math.max(0, rawMinimum - padding);
  const maximum = Math.max(minimum + 1, rawMaximum + padding);
  return { minimum, maximum, range: maximum - minimum };
}

function appendLegend(label, color, className = '') {
  const span = document.createElement('span');
  if (className) span.className = className;
  const marker = document.createElement('i');
  marker.style.background = color;
  span.append(marker, document.createTextNode(label));
  return span;
}

function drawMissingBands(context, rows, positions, area) {
  if (!rows.length || !positions.length) return false;
  const step = area.width / Math.max(1, rows.length);
  let segmentStart = -1;
  let painted = false;
  const paint = (start, end) => {
    const left = Math.max(area.left, positions[start] - step / 2);
    const right = Math.min(area.left + area.width, positions[end] + step / 2);
    context.fillRect(left, area.top, Math.max(1, right - left), area.height);
    painted = true;
  };

  context.save();
  context.fillStyle = 'rgba(100, 107, 116, .16)';
  for (let index = 0; index <= rows.length; index += 1) {
    const missing = index < rows.length && rows[index]?.known_missing === true;
    if (missing && segmentStart < 0) segmentStart = index;
    if (!missing && segmentStart >= 0) {
      paint(segmentStart, index - 1);
      segmentStart = -1;
    }
  }
  context.restore();
  return painted;
}

function formatPeriodTick(periodKey, mode) {
  const text = String(periodKey || '');
  if (mode === 'monthly' && /^\d{4}-\d{2}$/.test(text)) return text.replace('-', '/');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : text;
}

function xAxisTickIndices(rowCount, plotWidth) {
  if (rowCount <= 0) return [];
  const target = Math.min(rowCount, Math.max(4, Math.floor(plotWidth / 140)));
  if (target <= 1) return [0];
  const indexes = [];
  for (let index = 0; index < target; index += 1) {
    indexes.push(Math.round(index * (rowCount - 1) / (target - 1)));
  }
  return [...new Set(indexes)];
}

function draw() {
  const mode = activeMode();
  if (!SUMMARY_MODES.has(mode) || mode !== latestMode) return;
  const chartPanel = byId('chartPanel');
  if (!chartPanel || chartPanel.hidden) return;
  const rows = latestRows.filter((row) => row?.known_missing === true
    || ['listener_avg', 'listener_max', 'listener_min', 'stream_growth']
      .some((key) => finite(row?.[key]) != null));
  if (!rows.length) return;

  const canvas = byId('chart');
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 260,
    fallbackWidth: 960,
    fallbackHeight: 360,
  });
  if (!prepared) return;
  const { context, width, height } = prepared;
  const area = { left: 58, right: 70, top: 18, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const step = area.width / Math.max(1, rows.length);
  const positions = rows.map((_, index) => area.left + step * (index + 0.5));
  const hasMissingBand = drawMissingBands(context, rows, positions, area);

  const listenerSeries = [
    { key: 'listener_avg', label: '平均同接', color: '#000000', width: 2 },
    { key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 2 },
    { key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 2 },
  ];
  const streamColor = cssColor('--green', '#168b73');
  const listenerValues = listenerSeries.flatMap(({ key }) =>
    rows.map((row) => finite(row?.[key])).filter((value) => value != null));
  const streamValues = rows.map((row) => finite(row?.stream_growth)).filter((value) => value != null && value >= 0);
  const lBounds = listenerBounds(listenerValues);
  const streamMax = Math.max(1, ...streamValues);
  const streamCeiling = Math.max(1, streamMax * 1.08);
  const listenerY = (value) => area.top + area.height
    - (Number(value) - lBounds.minimum) / lBounds.range * area.height;
  const streamY = (value) => area.top + area.height
    - Math.max(0, Number(value) || 0) / streamCeiling * area.height;

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: area.left,
    right: area.right,
    top: area.top,
    height: area.height,
    width,
  })) {
    if (listenerValues.length) {
      context.textAlign = 'right';
      const value = lBounds.maximum - lBounds.range * ratio;
      context.fillText(integer.format(Math.round(value)), area.left - 7, y + 3);
    }
    if (streamValues.length) {
      context.textAlign = 'left';
      context.fillText(integer.format(Math.round(streamCeiling * (1 - ratio))), width - area.right + 7, y + 3);
    }
  }

  const xAxisY = area.top + area.height;
  const xTickIndexes = xAxisTickIndices(rows.length, area.width);
  context.save();
  context.strokeStyle = 'rgba(31,45,68,.12)';
  context.fillStyle = cssColor('--muted', '#667287');
  context.lineWidth = 1;
  context.font = '11px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.beginPath();
  context.moveTo(area.left, xAxisY);
  context.lineTo(width - area.right, xAxisY);
  context.stroke();
  for (const rowIndex of xTickIndexes) {
    const x = positions[rowIndex];
    context.beginPath();
    context.moveTo(x, xAxisY);
    context.lineTo(x, xAxisY + 4);
    context.stroke();
    context.fillText(formatPeriodTick(rows[rowIndex]?.period_key, mode), x, xAxisY + 7);
  }
  context.restore();

  if (streamValues.length) {
    const barWidth = Math.max(2, Math.min(18, step * 0.58));
    context.save();
    context.fillStyle = streamColor;
    context.globalAlpha = 0.42;
    rows.forEach((row, index) => {
      const value = finite(row?.stream_growth);
      if (value == null || value < 0) return;
      const y = streamY(value);
      context.fillRect(positions[index] - barWidth / 2, y, barWidth, area.top + area.height - y);
    });
    context.restore();
  }

  listenerSeries.forEach((series) => {
    const pointCount = drawDashboardLine(context, rows, {
      x: (_row, index) => positions[index],
      y: (value) => listenerY(value),
      value: (row) => finite(row?.[series.key]),
      valid: (value) => value != null,
      strokeStyle: series.color,
      lineWidth: series.width,
    });
    const lineCount = Math.max(0, pointCount - 1);
    if (!(mode === 'daily' && lineCount === 0 && pointCount === 1)) return;
    const index = rows.findIndex((row) => finite(row?.[series.key]) != null);
    if (index < 0) return;
    const value = finite(rows[index]?.[series.key]);
    context.save();
    context.fillStyle = series.color;
    context.beginPath();
    context.arc(positions[index], listenerY(value), 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  const detail = byId('chartDetail');
  if (detail) {
    if (Number.isInteger(selectedIndex) && rows[selectedIndex]) {
      const row = rows[selectedIndex];
      if (row.known_missing === true) {
        detail.textContent = `${row.period_key || ''}　欠測`;
      } else {
        detail.textContent = `${row.period_key || ''}　平均同接 ${integer.format(Math.round(finite(row.listener_avg) || 0))}`
          + `　最大同接 ${integer.format(Math.round(finite(row.listener_max) || 0))}`
          + `　最小同接 ${integer.format(Math.round(finite(row.listener_min) || 0))}`
          + `　再生数増加 ${finite(row.stream_growth) == null ? '—' : integer.format(Math.round(Number(row.stream_growth)))}`;
      }
    } else {
      detail.textContent = '';
    }
  }

  const legend = byId('chartLegend');
  if (legend) {
    const items = listenerSeries
      .filter((series) => rows.some((row) => finite(row?.[series.key]) != null))
      .map((series) => appendLegend(series.label, series.color));
    if (streamValues.length) items.push(appendLegend('再生数増加', streamColor, 'period-stream-bars'));
    if (hasMissingBand) items.push(appendLegend('欠測', 'rgba(100, 107, 116, .55)', 'period-missing-band'));
    legend.replaceChildren(...items);
  }
  const foot = byId('chartFoot');
  if (foot) {
    foot.textContent = hasMissingBand
      ? '左軸は同接（平均・最大・最小）、右軸は各期間の再生数増加です。灰色は欠測期間です。'
      : '左軸は同接（平均・最大・最小）、右軸は各期間の再生数増加です。';
  }
  const start = byId('chartStartDate');
  const end = byId('chartEndDate');
  if (start) start.textContent = rows[0]?.period_key || '—';
  if (end) end.textContent = rows.at(-1)?.period_key || '—';

  chartModel = { positions, rows };
  canvas.dataset.periodChart = 'bars';
  window.dispatchEvent(new CustomEvent('history:period-chart-drawn', { detail: { mode } }));
}

window.addEventListener('history:data-loaded', (event) => {
  const detail = event?.detail || {};
  const mode = String(detail.mode || '');
  const data = detail.data;
  if (!SUMMARY_MODES.has(mode) || !data?.ok || !Array.isArray(data.rows)) return;
  latestMode = mode;
  latestRows = data.rows;
  selectedIndex = null;
  scheduleDraw();
});

const chart = byId('chart');
chart?.addEventListener('pointerup', (event) => {
  if (!SUMMARY_MODES.has(activeMode()) || !chartModel?.positions?.length) return;
  event.stopImmediatePropagation();
  const bounds = chart.getBoundingClientRect();
  const pointer = event.clientX - bounds.left;
  let nearest = 0;
  let distance = Infinity;
  chartModel.positions.forEach((position, index) => {
    const next = Math.abs(position - pointer);
    if (next < distance) {
      distance = next;
      nearest = index;
    }
  });
  selectedIndex = nearest;
  draw();
}, true);

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (SUMMARY_MODES.has(activeMode())) draw();
  }, 240);
}, { passive: true });
