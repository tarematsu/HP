const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const integer = new Intl.NumberFormat('ja-JP');

let latestMode = '';
let latestRows = [];
let selectedIndex = null;
let drawTimer = 0;
let resizeTimer = 0;
let chartModel = null;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeMode() {
  const active = document.querySelector('#modeTabs button.active[data-mode]');
  return String(active?.dataset?.mode || latestMode || '');
}

function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function scheduleDraw(delay = 0) {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(draw));
  }, delay);
}

function prepareCanvas() {
  const canvas = document.getElementById('chart');
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const width = Math.max(320, Math.round(canvas.clientWidth || 960));
  const height = Math.max(260, Math.round(canvas.clientHeight || 360));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { canvas, context, width, height };
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

function draw() {
  const mode = activeMode();
  if (!SUMMARY_MODES.has(mode) || mode !== latestMode) return;
  const chartPanel = document.getElementById('chartPanel');
  if (!chartPanel || chartPanel.hidden) return;
  const rows = latestRows.filter((row) =>
    ['listener_avg', 'listener_max', 'listener_min', 'stream_growth']
      .some((key) => finite(row?.[key]) != null));
  if (!rows.length) return;

  const prepared = prepareCanvas();
  if (!prepared) return;
  const { canvas, context, width, height } = prepared;
  const area = { left: 58, right: 70, top: 18, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const step = area.width / Math.max(1, rows.length);
  const positions = rows.map((_, index) => area.left + step * (index + 0.5));

  const listenerSeries = [
    { key: 'listener_avg', label: '平均同接', color: cssColor('--accent', '#d93f79'), width: 2.6 },
    { key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 1.9 },
    { key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 1.9 },
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

  context.strokeStyle = 'rgba(31,45,68,.12)';
  context.fillStyle = cssColor('--muted', '#667287');
  context.lineWidth = 1;
  context.font = '10.5px system-ui';
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = area.top + area.height * ratio;
    context.beginPath();
    context.moveTo(area.left, y);
    context.lineTo(width - area.right, y);
    context.stroke();
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

  const drawLine = (series) => {
    if (!rows.some((row) => finite(row?.[series.key]) != null)) return;
    context.save();
    context.strokeStyle = series.color;
    context.fillStyle = series.color;
    context.lineWidth = series.width;
    context.beginPath();
    let open = false;
    let lineCount = 0;
    const points = [];
    rows.forEach((row, index) => {
      const value = finite(row?.[series.key]);
      if (value == null) {
        open = false;
        return;
      }
      const point = [positions[index], listenerY(value)];
      points.push(point);
      if (!open) context.moveTo(point[0], point[1]);
      else {
        context.lineTo(point[0], point[1]);
        lineCount += 1;
      }
      open = true;
    });
    context.stroke();
    if (mode === 'daily' && lineCount === 0) {
      for (const [x, y] of points) {
        context.beginPath();
        context.arc(x, y, 3, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  };
  listenerSeries.forEach(drawLine);

  const detail = document.getElementById('chartDetail');
  if (detail) {
    if (Number.isInteger(selectedIndex) && rows[selectedIndex]) {
      const row = rows[selectedIndex];
      detail.textContent = `${row.period_key || ''}　平均同接 ${integer.format(Math.round(finite(row.listener_avg) || 0))}`
        + `　最大同接 ${integer.format(Math.round(finite(row.listener_max) || 0))}`
        + `　最小同接 ${integer.format(Math.round(finite(row.listener_min) || 0))}`
        + `　期間再生数 ${finite(row.stream_growth) == null ? '—' : integer.format(Math.round(Number(row.stream_growth)))}`;
    } else {
      detail.textContent = '';
    }
  }

  const legend = document.getElementById('chartLegend');
  if (legend) {
    const items = listenerSeries
      .filter((series) => rows.some((row) => finite(row?.[series.key]) != null))
      .map((series) => appendLegend(series.label, series.color));
    if (streamValues.length) items.push(appendLegend('期間再生数', streamColor, 'period-stream-bars'));
    legend.replaceChildren(...items);
  }
  const title = document.getElementById('chartTitle');
  if (title) title.textContent = '同接・期間再生数の推移';
  const foot = document.getElementById('chartFoot');
  if (foot) foot.textContent = '';
  const start = document.getElementById('chartStartDate');
  const end = document.getElementById('chartEndDate');
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

const chart = document.getElementById('chart');
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
