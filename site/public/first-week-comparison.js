import { cssColor, finiteNumber as finite, integerFormat as number } from './dashboard-ui-common.js?v=20260930.1';
import {
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';

const view = document.getElementById('firstWeekView');
const canvas = document.getElementById('firstWeekChart');
const legend = document.getElementById('firstWeekLegend');
const detail = document.getElementById('firstWeekChartDetail');
const notice = document.getElementById('firstWeekNotice');
const tbody = document.getElementById('firstWeekTbody');

const CACHE_KEY = 'sh.first-week-comparison.v2';
const CACHE_MS = 60 * 60_000;
const DURATION_MINUTES = 7 * 24 * 60;
const SERIES_COLORS = [
  ['--accent', '#d93f79'],
  ['--accent-2', '#6657d8'],
  ['--green', '#168b73'],
  ['--orange', '#c56a18'],
  ['--blue', '#2776b9'],
  ['--danger', '#c53d4d'],
  [null, '#00838f'],
  [null, '#8c6d1f'],
];

let series = [];
let selectedMinute = null;
let loading = false;
let resizeTimer = 0;

function active() {
  return Boolean(view && !view.hidden);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function colorFor(index) {
  const preset = SERIES_COLORS[index];
  if (preset) return cssColor(preset[0], preset[1]);
  return `hsl(${(18 + index * 137.508) % 360} 62% 44%)`;
}

function pointValue(point) {
  return finite(point?.[1]);
}

function valueLabel(value) {
  return `${number.format(Math.round(Number(value) || 0))}人`;
}

function elapsedLabel(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value === 0) return '0時間';
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const mins = value % 60;
  if (days && !hours && !mins) return `${days}日`;
  if (days) return `${days}日${hours ? `${hours}時間` : ''}${mins ? `${mins}分` : ''}`;
  if (hours) return `${hours}時間${mins ? `${mins}分` : ''}`;
  return `${mins}分`;
}

function nearestPoint(points, targetMinute) {
  if (!Array.isArray(points) || !points.length) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(points[middle]?.[0]) < targetMinute) low = middle + 1;
    else high = middle;
  }
  const current = points[low];
  const previous = low > 0 ? points[low - 1] : null;
  if (!previous) return current;
  return Math.abs(Number(previous[0]) - targetMinute) <= Math.abs(Number(current?.[0]) - targetMinute)
    ? previous
    : current;
}

function renderDetail() {
  if (!detail) return;
  if (selectedMinute == null) {
    detail.replaceChildren();
    return;
  }

  const values = series.map((item, index) => ({
    item,
    index,
    point: nearestPoint(item.points, selectedMinute),
  })).filter(({ point }) => {
    if (!point || pointValue(point) == null) return false;
    return Math.abs(Number(point[0]) - selectedMinute) <= 10;
  });

  detail.innerHTML = `<time>配信から ${escapeHtml(elapsedLabel(selectedMinute))}</time><div class="first-week-detail-values">${values.map(({ item, index, point }) =>
    `<div><i style="background:${colorFor(index)}"></i><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(valueLabel(pointValue(point)))}</span></div>`).join('')}</div>`;
}

function statusLabel(item) {
  if (item.status === 'known_missing') return '欠測';
  if (item.status === 'available') return '取得済み';
  return 'データなし';
}

function renderTable() {
  if (!tbody) return;
  tbody.innerHTML = series.map((item) => {
    const missing = item.status !== 'available' ? ' class="first-week-status-missing"' : '';
    return `<tr>
      <td>${escapeHtml(item.single)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.release_date_jst.replaceAll('-', '/'))}</td>
      <td${missing}>${escapeHtml(statusLabel(item))}</td>
      <td><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">公式</a></td>
    </tr>`;
  }).join('');
}

function renderLegend() {
  if (!legend) return;
  legend.innerHTML = series
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.points.some((point) => pointValue(point) != null))
    .map(({ item, index }) => `<span><i style="background:${colorFor(index)}"></i>${escapeHtml(item.title)}</span>`)
    .join('');
}

function draw() {
  if (!active() || !canvas) return;
  const measuredWidth = Math.max(300, Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 960));
  const targetHeight = measuredWidth < 560 ? 300 : 360;
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 300,
    minimumHeight: 1,
    fallbackWidth: measuredWidth,
    height: targetHeight,
  });
  if (!prepared) return;
  const { context, width, height } = prepared;

  const available = series.filter((item) => item.points.some((point) => pointValue(point) != null));
  if (!available.length) {
    context.font = '14px system-ui';
    context.fillStyle = cssColor('--muted', '#667287');
    context.textAlign = 'center';
    context.fillText('表示できる初週データがありません', width / 2, height / 2);
    renderLegend();
    renderDetail();
    return;
  }

  let rawMax = 0;
  for (const item of available) {
    for (const point of item.points) {
      const value = pointValue(point);
      if (value != null) rawMax = Math.max(rawMax, value);
    }
  }
  const stepBase = 50;
  const maxValue = Math.max(stepBase, Math.ceil(rawMax / stepBase) * stepBase);
  const area = { left: 58, right: 18, top: 18, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const xFor = (minutes) => area.left + area.width * Math.max(0, Math.min(DURATION_MINUTES, Number(minutes) || 0)) / DURATION_MINUTES;
  const yFor = (value) => area.top + area.height - area.height * Math.max(0, Number(value) || 0) / maxValue;

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
    context.fillText(number.format(Math.round(maxValue * (1 - ratio))), area.left - 8, y + 3);
  }

  const dayPositions = Array.from({ length: 8 }, (_, day) => xFor(day * 1440));
  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions: dayPositions,
    indexes: dayPositions.map((_, index) => index),
    labelFor: (day) => day === 0 ? '0時間' : `${day}日`,
    fillStyle: cssColor('--muted', '#667287'),
  });

  available.forEach((item) => {
    const index = series.indexOf(item);
    const rows = item.points.map((point) => ({
      minutes: finite(point?.[0]),
      value: pointValue(point),
    }));
    drawDashboardLine(context, rows, {
      x: (row) => xFor(row.minutes),
      y: (value) => yFor(value),
      value: (row) => row.value,
      valid: (value) => value != null,
      gap: (before, after) => after.minutes - before.minutes > 15,
      strokeStyle: colorFor(index),
      lineWidth: 2,
    });
  });

  if (selectedMinute != null) {
    const x = xFor(selectedMinute);
    context.save();
    context.strokeStyle = cssColor('--muted', '#667287');
    context.globalAlpha = .55;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x, area.top);
    context.lineTo(x, area.top + area.height);
    context.stroke();
    context.restore();
  }

  canvas.dataset.firstWeekLeft = String(area.left);
  canvas.dataset.firstWeekWidth = String(area.width);
  renderLegend();
  renderDetail();
}

function readCache() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    return stored && Date.now() - Number(stored.at || 0) < CACHE_MS ? stored.data : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {}
}

async function load() {
  if (!active() || loading) return;
  loading = true;
  if (notice) {
    notice.hidden = true;
    notice.textContent = '';
    notice.classList.remove('error');
  }

  try {
    let data = readCache();
    if (!data) {
      const response = await fetch('/api/first-week-comparison?v=20260926.2', {
        headers: { accept: 'application/json' },
      });
      data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || `API ${response.status}`);
      writeCache(data);
    }
    series = Array.isArray(data.series) ? data.series : [];
    selectedMinute = null;
    renderTable();
    draw();
  } catch (error) {
    series = [];
    renderTable();
    draw();
    if (notice) {
      notice.hidden = false;
      notice.classList.add('error');
      notice.textContent = `初週比較データの取得に失敗しました：${error.message}`;
    }
  } finally {
    loading = false;
  }
}

function handlePointer(event) {
  if (!active() || !series.length || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const clientX = event.touches?.[0]?.clientX ?? event.clientX;
  const left = Number(canvas.dataset.firstWeekLeft) || 58;
  const chartWidth = Number(canvas.dataset.firstWeekWidth) || Math.max(1, rect.width - 76);
  selectedMinute = Math.max(0, Math.min(DURATION_MINUTES,
    (clientX - rect.left - left) / chartWidth * DURATION_MINUTES));
  draw();
}

canvas?.addEventListener('click', handlePointer);
canvas?.addEventListener('touchstart', handlePointer, { passive: true });
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (active() && series.length) draw();
  }, 220);
}, { passive: true });

if (active()) void load();

export { load as loadFirstWeekComparisonView };