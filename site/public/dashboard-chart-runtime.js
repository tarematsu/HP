export const DASHBOARD_MISSING_FILL = 'rgba(100, 107, 116, .16)';
export const DASHBOARD_MISSING_KEY = 'rgba(100, 107, 116, .55)';

export function dashboardValueBounds(values, {
  floor = 0,
  paddingRatio = 0.08,
  minimumPadding = 1,
  minimumRange = 1,
} = {}) {
  const finiteValues = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite);
  if (!finiteValues.length) {
    const minimum = Number.isFinite(floor) ? Number(floor) : 0;
    return { minimum, maximum: minimum + minimumRange, range: minimumRange };
  }
  const rawMinimum = Math.min(...finiteValues);
  const rawMaximum = Math.max(...finiteValues);
  const padding = Math.max(minimumPadding, (rawMaximum - rawMinimum) * paddingRatio);
  const minimum = Number.isFinite(floor) ? Math.max(floor, rawMinimum - padding) : rawMinimum - padding;
  const maximum = Math.max(minimum + minimumRange, rawMaximum + padding);
  return { minimum, maximum, range: maximum - minimum };
}

export function roundedDashboardMaximum(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  const step = number <= 20 ? 5 : number <= 100 ? 10 : number <= 500 ? 50 : 100;
  return Math.max(step, Math.ceil(number / step) * step);
}

export function appendDashboardLegendItem(label, color, {
  className = '',
  datasetKey = '',
  datasetValue = 'true',
} = {}) {
  const span = document.createElement('span');
  if (className) span.className = className;
  if (datasetKey) span.dataset[datasetKey] = String(datasetValue);
  const marker = document.createElement('i');
  marker.style.background = color;
  span.append(marker, document.createTextNode(String(label ?? '')));
  return span;
}

function defaultPointValue(point) {
  if (Array.isArray(point)) return Number(point[0]);
  return Number(point?.x ?? point?.timestamp ?? point?.observed_at ?? point?.time);
}

export function nearestSortedPoint(points, target, valueAt = defaultPointValue) {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(Number(target))) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(valueAt(points[middle], middle)) < Number(target)) low = middle + 1;
    else high = middle;
  }
  const current = points[low];
  const previous = low > 0 ? points[low - 1] : null;
  if (!previous) return current;
  const previousDistance = Math.abs(Number(valueAt(previous, low - 1)) - Number(target));
  const currentDistance = Math.abs(Number(valueAt(current, low)) - Number(target));
  return previousDistance <= currentDistance ? previous : current;
}

export function nearestPositionIndex(positions, target) {
  if (!Array.isArray(positions) || !positions.length || !Number.isFinite(Number(target))) return -1;
  let low = 0;
  let high = positions.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(positions[middle]) < Number(target)) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  return Math.abs(Number(positions[low - 1]) - Number(target)) <= Math.abs(Number(positions[low]) - Number(target))
    ? low - 1
    : low;
}

export function drawDashboardMissingBands(context, bands, {
  top,
  height,
  fillStyle = DASHBOARD_MISSING_FILL,
} = {}) {
  if (!context || !Array.isArray(bands) || !bands.length || !Number.isFinite(top) || !Number.isFinite(height)) return false;
  context.save();
  context.fillStyle = fillStyle;
  let painted = false;
  for (const band of bands) {
    const left = Number(band?.left);
    const right = Number(band?.right);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;
    context.fillRect(left, top, Math.max(1, right - left), height);
    painted = true;
  }
  context.restore();
  return painted;
}

export function dashboardMissingIndexBands(rows, positions, area, {
  isMissing = (row) => row?.known_missing === true,
  step = null,
} = {}) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(positions) || !positions.length || !area) return [];
  const resolvedStep = Number.isFinite(step) ? step : Number(area.width) / Math.max(1, rows.length);
  const bands = [];
  let start = -1;
  for (let index = 0; index <= rows.length; index += 1) {
    const missing = index < rows.length && Boolean(isMissing(rows[index], index));
    if (missing && start < 0) start = index;
    if (!missing && start >= 0) {
      const end = index - 1;
      bands.push({
        left: Math.max(Number(area.left), Number(positions[start]) - resolvedStep / 2),
        right: Math.min(Number(area.left) + Number(area.width), Number(positions[end]) + resolvedStep / 2),
      });
      start = -1;
    }
  }
  return bands;
}

export function dashboardMissingGapBands(rows, positions, area, {
  time = (row) => Number(row?.timestamp ?? row?.observed_at),
  maxGap,
  edgeInset = 0,
} = {}) {
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(positions) || positions.length < 2 || !area || !Number.isFinite(maxGap)) return [];
  const inset = Math.max(0, Number(edgeInset) || 0);
  const bands = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previousTime = Number(time(rows[index - 1], index - 1));
    const currentTime = Number(time(rows[index], index));
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime - previousTime <= maxGap) continue;
    const previousX = Number(positions[index - 1]);
    const currentX = Number(positions[index]);
    if (!Number.isFinite(previousX) || !Number.isFinite(currentX)) continue;
    bands.push({
      left: Math.max(Number(area.left), previousX + inset),
      right: Math.min(Number(area.left) + Number(area.width), currentX - inset),
    });
  }
  return bands;
}

export function observeDashboardChartResize(target, redraw, {
  delay = 220,
  enabled = () => true,
} = {}) {
  if (!target || typeof redraw !== 'function') return () => {};
  let timer = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      if (enabled()) redraw();
    }, delay);
  };
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const width = Math.round(box?.width || 0);
      const height = Math.round(box?.height || 0);
      if (!width || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      schedule();
    });
    observer.observe(target);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof window.removeEventListener === 'function') {
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', schedule);
    };
  }
  return () => clearTimeout(timer);
}
