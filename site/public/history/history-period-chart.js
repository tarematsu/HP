import {
  byId,
  cssColor,
  finiteNumber as finite,
  integerFormat as integer,
} from '../dashboard-ui-common.js?v=20260930.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from '../dashboard-chart-canvas.js?v=20261001.2';
import {
  appendDashboardLegendItem,
  dashboardMissingIndexBands,
  dashboardValueBounds,
  DASHBOARD_MISSING_KEY,
  drawDashboardMissingBands,
  nearestPositionIndex,
  observeDashboardChartResize,
} from '../dashboard-chart-runtime.js?v=20261001.1';

const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);

let latestMode = '';
let latestRows = [];
let selectedIndex = null;
let drawTimer = 0;
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

function formatPeriodTick(periodKey, mode) {
  const text = String(periodKey || '');
  if (mode === 'monthly' && /^\d{4}-\d{2}$/.test(text)) return text.replace('-', '/');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : text;
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
  const hasMissingBand = drawDashboardMissingBands(
    context,
    dashboardMissingIndexBands(rows, positions, area),
    { top: area.top, height: area.height },
  );

  const listenerSeries = [
    { key: 'listener_avg', label: '平均同接', color: '#000000', width: 2 },
    { key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 2 },
    { key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 2 },
  ];
  const streamColor = cssColor('--green', '#168b73');
  const listenerValues = listenerSeries.flatMap(({ key }) =>
    rows.map((row) => finite(row?.[key])).filter((value) => value != null));
  const streamValues = rows.map((row) => finite(row?.stream_growth)).filter((value) => value != null && value >= 0);
  const lBounds = dashboardValueBounds(listenerValues);
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

  const targetTicks = Math.min(rows.length, Math.max(4, Math.floor(area.width / 140)));
  const xTickIndexes = dashboardTickIndexes(rows.length, targetTicks);
  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions,
    indexes: xTickIndexes,
    labelFor: (index) => formatPeriodTick(rows[index]?.period_key, mode),
    fillStyle: cssColor('--muted', '#667287'),
  });

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
      .map((series) => appendDashboardLegendItem(series.label, series.color));
    if (streamValues.length) items.push(appendDashboardLegendItem('再生数増加', streamColor, { className: 'period-stream-bars' }));
    if (hasMissingBand) items.push(appendDashboardLegendItem('欠測', DASHBOARD_MISSING_KEY, { className: 'period-missing-band' }));
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
  selectedIndex = nearestPositionIndex(chartModel.positions, pointer);
  draw();
}, true);

observeDashboardChartResize(chart, draw, {
  delay: 240,
  enabled: () => SUMMARY_MODES.has(activeMode()),
});
