const DAY_MS = 86_400_000;
const EXTREMA_POINT_COLOR = '#888';
const integer = new Intl.NumberFormat('ja-JP');
const jstExtremaTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
let lastPayload = null;
let redrawTimer = 0;
let observedCanvasWidth = 0;

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

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

function ensureLegend(hasPrevious) {
  const legend = document.querySelector('#currentView .legend');
  if (!legend) return;
  let previous = legend.querySelector('.previous-online-key');
  if (!hasPrevious) {
    previous?.remove();
    return;
  }
  if (!previous) {
    previous = document.createElement('span');
    previous.className = 'previous-online-key';
    previous.textContent = '24時間前';
    previous.style.color = '#969ca6';
    legend.append(previous);
  }
}

function labelBox(context, text, x, y, align, width, height) {
  context.save();
  context.font = 'bold 10px system-ui';
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
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  let started = false;
  let previousTime = null;
  for (const row of rows) {
    const time = finite(row.observed_at);
    const value = finite(row.online_member_count);
    const gap = previousTime != null && time != null && time - previousTime > 20 * 60_000;
    if (value == null || time == null || gap) started = false;
    if (value == null || time == null) continue;
    const x = xFor(time);
    const y = yFor(value);
    if (!started) context.moveTo(x, y);
    else context.lineTo(x, y);
    started = true;
    previousTime = time;
  }
  context.stroke();
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
  ensureLegend(previous.length > 0);

  const height = width < 520 ? 270 : Math.max(280, Math.min(370, Math.round(width * .42)));
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { left: 50, right: 24, top: 28, bottom: 42 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const timeSpan = Math.max(1, maxTime - minTime);
  const xFor = (time) => padding.left + plotWidth * (time - minTime) / timeSpan;

  const onlineValues = [...current, ...previous]
    .map((row) => row.online_member_count)
    .filter((value) => value != null);
  const currentOnline = current.map((row) => row.online_member_count).filter((value) => value != null);
  const onlineRawMin = onlineValues.length ? Math.min(...onlineValues) : 0;
  const onlineRawMax = onlineValues.length ? Math.max(...onlineValues) : 1;
  const onlineRawRange = Math.max(1, onlineRawMax - onlineRawMin);
  const onlinePadding = Math.max(1, Math.ceil(onlineRawRange * .08));
  const onlineMin = Math.max(0, onlineRawMin - onlinePadding);
  const onlineMax = onlineRawMax + onlinePadding;
  const onlineRange = Math.max(1, onlineMax - onlineMin);
  const yOnline = (value) => padding.top + plotHeight - (Number(value) - onlineMin) * plotHeight / onlineRange;

  context.font = '10px system-ui';
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = padding.top + plotHeight * ratio;
    context.strokeStyle = 'rgba(31,45,68,.12)';
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = '#667287';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(integer.format(Math.round(onlineMax - onlineRange * ratio)), padding.left - 6, y);
  }

  drawSeries(context, previous, xFor, yOnline, '#969ca6', 2);
  drawSeries(context, current, xFor, yOnline, '#111', 2.5);

  context.fillStyle = '#667287';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (let index = 0; index < 5; index += 1) {
    const time = minTime + timeSpan * index / 4;
    context.fillText(new Date(time).toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
    }), xFor(time), height - 14);
  }

  context.font = '10px system-ui';
  context.fillStyle = '#667287';
  context.textAlign = 'left';
  context.fillText('オンライン数(人)', 4, 12);
  context.textAlign = 'center';
  context.fillText('時刻 (JST)', width / 2, height - 2);

  if (currentOnline.length) {
    const currentMin = Math.min(...currentOnline);
    const currentMax = Math.max(...currentOnline);
    const minRow = current.find((row) => row.online_member_count === currentMin);
    const maxRow = current.find((row) => row.online_member_count === currentMax);
    if (minRow) {
      context.fillStyle = EXTREMA_POINT_COLOR;
      context.beginPath();
      context.arc(xFor(minRow.observed_at), yOnline(currentMin), 3.5, 0, Math.PI * 2);
      context.fill();
      labelBox(
        context,
        `最小 ${integer.format(currentMin)}（${jstExtremaTime.format(new Date(minRow.observed_at))}）`,
        xFor(minRow.observed_at) + 5,
        yOnline(currentMin) + 14,
        'left',
        width,
        height,
      );
    }
    if (maxRow) {
      context.fillStyle = EXTREMA_POINT_COLOR;
      context.beginPath();
      context.arc(xFor(maxRow.observed_at), yOnline(currentMax), 3.5, 0, Math.PI * 2);
      context.fill();
      labelBox(
        context,
        `最大 ${integer.format(currentMax)}（${jstExtremaTime.format(new Date(maxRow.observed_at))}）`,
        xFor(maxRow.observed_at) - 5,
        yOnline(currentMax) - 14,
        'right',
        width,
        height,
      );
    }
  }
  observedCanvasWidth = width;
  return true;
}

function scheduleDraw(payload = lastPayload) {
  if (!payload?.ok) return;
  lastPayload = payload;
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => drawComparison(lastPayload), 280);
}

function installCanvasResizeObserver() {
  const canvas = document.getElementById('audienceChart');
  if (!canvas || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0]?.contentRect?.width || canvasWidth(canvas));
    if (!width || width === observedCanvasWidth || !lastPayload?.ok) return;
    observedCanvasWidth = width;
    clearTimeout(redrawTimer);
    requestAnimationFrame(() => drawComparison(lastPayload));
  });
  observer.observe(canvas);
}

installCanvasResizeObserver();
window.addEventListener('dashboard:payload', (event) => scheduleDraw(event?.detail?.payload));
window.addEventListener('resize', () => scheduleDraw(), { passive: true });
