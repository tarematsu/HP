import { finiteNumber as finite, integerFormat as integer } from './dashboard-ui-common.js?v=20260930.1';
import {
  drawDashboardGrid,
  drawDashboardLine,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
import {
  dashboardValueBounds,
  observeDashboardChartResize,
  roundedDashboardMaximum,
} from './dashboard-chart-runtime.js?v=20261001.1';
import { JST_TIME_HM } from './dashboard-time.js?v=20261001.1';

const DAY_MS = 86_400_000;
const FIVE_MINUTE_MS = 5 * 60_000;
const EXTREMA_POINT_COLOR = '#888';
const STREAM_BAR_COLOR = '#168b73';
let lastPayload = null;
let redrawTimer = 0;

function normalizeCurrent(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const latest = list.reduce((maximum, row) => Math.max(maximum, finite(row?.observed_at) || 0), 0);
  if (!latest) return [];
  const cutoff = latest - DAY_MS;
  const byTime = new Map();
  for (const row of list) {
    const observedAt = finite(row?.observed_at);
    if (observedAt == null || observedAt < cutoff || observedAt > latest) continue;
    byTime.set(observedAt, {
      observed_at: observedAt,
      online_member_count: finite(row.online_member_count),
    });
  }
  return [...byTime.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function normalizePrevious(rows, minTime, maxTime) {
  const points = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const observedAt = finite(row?.observed_at);
    const online = finite(row?.online_member_count);
    if (observedAt == null || online == null) continue;
    const shiftedAt = observedAt + DAY_MS;
    if (shiftedAt < minTime || shiftedAt > maxTime) continue;
    points.push({ observed_at: shiftedAt, online_member_count: online });
  }
  return points.sort((a, b) => a.observed_at - b.observed_at);
}

function normalizeStreamAverages(rows, minTime, maxTime) {
  const byTime = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const observedAt = finite(row?.observed_at);
    const streamDelta = finite(row?.stream_delta);
    if (observedAt == null || streamDelta == null || streamDelta < 0) continue;
    if (observedAt < minTime || observedAt > maxTime + FIVE_MINUTE_MS) continue;
    byTime.set(observedAt, { observed_at: observedAt, stream_delta: streamDelta });
  }
  return [...byTime.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function ensureLegend(hasPrevious, hasStreamAverages) {
  const legend = document.querySelector('#currentView .legend');
  if (!legend) return;
  let previous = legend.querySelector('.previous-online-key');
  if (!hasPrevious) previous?.remove();
  else if (!previous) {
    previous = document.createElement('span');
    previous.className = 'previous-online-key';
    previous.textContent = '24時間前';
    previous.style.color = '#969ca6';
    legend.append(previous);
  }

  const stream = legend.querySelector('.stream-growth-key');
  if (stream) {
    stream.textContent = '再生数増加';
    stream.hidden = !hasStreamAverages;
    stream.style.color = STREAM_BAR_COLOR;
  }
  legend.querySelector('.stream-delta-key')?.remove();
}

function labelBox(context, text, x, y, align, width, height) {
  context.save();
  context.font = '600 11px system-ui';
  const textWidth = context.measureText(text).width;
  const boxWidth = textWidth + 10;
  const boxHeight = 18;
  let left = align === 'right' ? x - boxWidth : x;
  left = Math.max(2, Math.min(width - boxWidth - 2, left));
  const top = Math.max(2, Math.min(height - boxHeight - 2, y - boxHeight / 2));
  context.fillStyle = 'rgba(255,255,255,.92)';
  context.fillRect(left, top, boxWidth, boxHeight);
  context.fillStyle = '#111';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(text, left + 5, top + boxHeight / 2);
  context.restore();
}

function drawSeries(context, rows, xFor, yFor, color, width) {
  return drawDashboardLine(context, rows, {
    x: (row) => xFor(finite(row?.observed_at)),
    y: (value) => yFor(value),
    value: (row) => finite(row?.online_member_count),
    valid: (value) => value != null,
    gap: (before, after) => finite(after?.observed_at) - finite(before?.observed_at) > 20 * 60_000,
    strokeStyle: color,
    lineWidth: width,
  });
}

function drawStreamBars(context, rows, xFor, yFor, baseline, plotWidth) {
  if (!rows.length) return;
  const bucketWidth = plotWidth * FIVE_MINUTE_MS / DAY_MS;
  const barWidth = Math.max(1, Math.min(6, bucketWidth * .82));
  context.fillStyle = STREAM_BAR_COLOR;
  context.globalAlpha = .34;
  for (const row of rows) {
    const x = xFor(row.observed_at);
    const y = yFor(row.stream_delta);
    const barHeight = Math.max(row.stream_delta > 0 ? .75 : 0, baseline - y);
    if (barHeight <= 0) continue;
    context.fillRect(x - barWidth / 2, baseline - barHeight, barWidth, barHeight);
  }
  context.globalAlpha = 1;
}

function canvasWidth(canvas) {
  if (!canvas) return 0;
  const width = Math.round(canvas.getBoundingClientRect().width);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function drawComparison(payload) {
  const canvas = document.getElementById('audienceChart');
  const current = normalizeCurrent(payload?.history);
  if (!canvas || !current.length) return false;

  const width = canvasWidth(canvas);
  if (!width) return false;

  const minTime = current[0].observed_at;
  const maxTime = current.at(-1).observed_at;
  const previous = normalizePrevious(payload?.previous_day_history, minTime, maxTime);
  const streamAverages = normalizeStreamAverages(payload?.stream_5m_history, minTime, maxTime);
  ensureLegend(previous.length > 0, streamAverages.length > 0);

  const targetHeight = width < 520 ? 330 : Math.max(350, Math.min(430, Math.round(width * .49)));
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 1,
    minimumHeight: 1,
    fallbackWidth: width,
    height: targetHeight,
  });
  if (!prepared) return false;
  const { context, width: drawWidth, height } = prepared;

  const padding = { left: 50, right: 50, top: 28, bottom: 42 };
  const plotWidth = Math.max(1, drawWidth - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const plotBottom = padding.top + plotHeight;
  const timeSpan = Math.max(1, maxTime - minTime);
  const xFor = (time) => padding.left + plotWidth * (time - minTime) / timeSpan;

  const onlineValues = [...current, ...previous]
    .map((row) => row.online_member_count)
    .filter((value) => value != null);
  const currentOnline = current.map((row) => row.online_member_count).filter((value) => value != null);
  const onlineBounds = dashboardValueBounds(onlineValues, { minimumPadding: 1 });
  const onlineMin = onlineBounds.minimum;
  const onlineMax = onlineBounds.maximum;
  const onlineRange = onlineBounds.range;
  const yOnline = (value) => plotBottom - (Number(value) - onlineMin) * plotHeight / onlineRange;

  const streamRawMax = streamAverages.length
    ? Math.max(...streamAverages.map((row) => row.stream_delta))
    : 0;
  const streamMax = roundedDashboardMaximum(streamRawMax);
  const yStream = (value) => plotBottom - Math.max(0, Number(value)) * plotHeight / streamMax;

  context.font = '11px system-ui';
  context.fillStyle = '#667287';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: padding.left,
    right: padding.right,
    top: padding.top,
    height: plotHeight,
    width: drawWidth,
  })) {
    context.textAlign = 'right';
    context.fillText(integer.format(Math.round(onlineMax - onlineRange * ratio)), padding.left - 6, y);
    context.textAlign = 'left';
    context.fillText(integer.format(Math.round(streamMax * (1 - ratio))), drawWidth - padding.right + 6, y);
  }

  drawStreamBars(context, streamAverages, xFor, yStream, plotBottom, plotWidth);
  drawSeries(context, previous, xFor, yOnline, '#969ca6', 2);
  drawSeries(context, current, xFor, yOnline, '#111', 2);

  context.fillStyle = '#667287';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (let index = 0; index < 5; index += 1) {
    const time = minTime + timeSpan * index / 4;
    context.fillText(JST_TIME_HM.format(new Date(time)), xFor(time), height - 14);
  }

  context.fillStyle = '#667287';
  context.textAlign = 'left';
  context.fillText('オンライン数（人）', 4, 12);
  context.textAlign = 'right';
  context.fillText('再生数増加', drawWidth - 4, 12);
  context.textAlign = 'center';
  context.fillText('時刻（JST）', drawWidth / 2, height - 2);

  if (currentOnline.length) {
    const currentMin = Math.min(...currentOnline);
    const currentMax = Math.max(...currentOnline);
    const minRow = current.find((row) => row.online_member_count === currentMin);
    const maxRow = current.find((row) => row.online_member_count === currentMax);
    if (minRow) {
      context.fillStyle = EXTREMA_POINT_COLOR;
      context.beginPath();
      context.arc(xFor(minRow.observed_at), yOnline(currentMin), 3, 0, Math.PI * 2);
      context.fill();
      labelBox(context, `最小 ${integer.format(currentMin)}（${JST_TIME_HM.format(new Date(minRow.observed_at))}）`, xFor(minRow.observed_at) + 5, yOnline(currentMin) + 14, 'left', drawWidth, height);
    }
    if (maxRow) {
      context.fillStyle = EXTREMA_POINT_COLOR;
      context.beginPath();
      context.arc(xFor(maxRow.observed_at), yOnline(currentMax), 3, 0, Math.PI * 2);
      context.fill();
      labelBox(context, `最大 ${integer.format(currentMax)}（${JST_TIME_HM.format(new Date(maxRow.observed_at))}）`, xFor(maxRow.observed_at) - 5, yOnline(currentMax) - 14, 'right', drawWidth, height);
    }
  }
  return true;
}

function scheduleDraw(payload = lastPayload) {
  if (!payload?.ok) return;
  lastPayload = payload;
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => drawComparison(lastPayload), 280);
}

const audienceChart = document.getElementById('audienceChart');
observeDashboardChartResize(audienceChart, () => drawComparison(lastPayload), {
  delay: 80,
  enabled: () => Boolean(lastPayload?.ok),
});
window.addEventListener('dashboard:payload', (event) => scheduleDraw(event?.detail?.payload));
