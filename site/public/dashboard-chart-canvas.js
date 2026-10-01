// Shared canvas primitives used by current, history, and music-service charts.
export function prepareDashboardCanvas(canvas, {
  minimumWidth = 320,
  minimumHeight = 260,
  fallbackWidth = 960,
  fallbackHeight = 360,
  height = null,
} = {}) {
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const boundsWidth = Math.round(canvas.getBoundingClientRect?.().width || canvas.clientWidth || fallbackWidth);
  const width = Math.max(minimumWidth, boundsWidth || fallbackWidth);
  const resolvedHeight = Math.max(minimumHeight, Math.round(height || canvas.clientHeight || fallbackHeight));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(resolvedHeight * ratio);
  canvas.style.height = `${resolvedHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, resolvedHeight);
  return { canvas, context, width, height: resolvedHeight, ratio };
}

export function drawDashboardGrid(context, {
  left,
  right,
  top,
  height,
  width,
  ticks = 4,
  strokeStyle = 'rgba(31,45,68,.12)',
} = {}) {
  if (!context || !Number.isFinite(width) || !Number.isFinite(height)) return [];
  const positions = [];
  context.save();
  context.strokeStyle = strokeStyle;
  context.lineWidth = 1;
  for (let index = 0; index <= ticks; index += 1) {
    const ratio = index / Math.max(1, ticks);
    const y = top + height * ratio;
    positions.push({ index, ratio, y });
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
  }
  context.restore();
  return positions;
}

export function drawDashboardLine(context, rows, {
  x,
  y,
  value,
  valid = (next) => Number.isFinite(next),
  gap = null,
  strokeStyle = '#111',
  lineWidth = 2,
} = {}) {
  if (!context || !Array.isArray(rows) || typeof x !== 'function' || typeof y !== 'function' || typeof value !== 'function') return 0;
  context.save();
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  let open = false;
  let previous = null;
  let points = 0;
  rows.forEach((row, index) => {
    const next = value(row, index);
    if (!valid(next) || (previous && gap?.(previous.row, row, previous.index, index))) open = false;
    if (!valid(next)) {
      previous = { row, index };
      return;
    }
    const pointX = x(row, index);
    const pointY = y(next, row, index);
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
      open = false;
      previous = { row, index };
      return;
    }
    if (open) context.lineTo(pointX, pointY);
    else context.moveTo(pointX, pointY);
    open = true;
    points += 1;
    previous = { row, index };
  });
  context.stroke();
  context.restore();
  return points;
}

export function dashboardTickIndexes(count, target = 5) {
  if (!Number.isInteger(count) || count <= 0) return [];
  if (count === 1 || target <= 1) return [0];
  const output = [];
  const resolved = Math.min(count, target);
  for (let index = 0; index < resolved; index += 1) {
    output.push(Math.round(index * (count - 1) / (resolved - 1)));
  }
  return [...new Set(output)];
}
