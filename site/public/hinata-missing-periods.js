import { byId, svgElement } from './dashboard-ui-common.js?v=20261001.1';

const DAY_MS = 24 * 60 * 60_000;
const MISSING_FILL = 'rgba(100, 107, 116, .16)';
const MISSING_KEY = 'rgba(100, 107, 116, .55)';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function periodTimestamp(value) {
  const key = String(value || '').trim();
  if (!DATE_RE.test(key)) return null;
  const timestamp = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function missingDailyRanges(periodKeys) {
  const timestamps = [...new Set((Array.isArray(periodKeys) ? periodKeys : [])
    .map(periodTimestamp)
    .filter((value) => value != null))]
    .sort((a, b) => a - b);
  const ranges = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = timestamps[index - 1];
    const next = timestamps[index];
    if (next - previous <= DAY_MS) continue;
    ranges.push({
      start: previous + DAY_MS,
      end: next - DAY_MS,
      previous,
      next,
    });
  }
  return { timestamps, ranges };
}

function tablePeriodKeys() {
  return [...document.querySelectorAll('#hinataDailyTbody tr')]
    .map((row) => row.cells?.[0]?.textContent?.trim() || '')
    .filter((value) => DATE_RE.test(value));
}

function updateLegend(hasMissing) {
  const legend = byId('hinataDailyChartLegend');
  if (!legend) return;
  legend.querySelector('[data-hinata-missing-legend]')?.remove();
  if (!hasMissing) return;
  const item = document.createElement('span');
  item.dataset.hinataMissingLegend = '1';
  const marker = document.createElement('i');
  marker.className = 'hinata-line-key';
  marker.style.background = MISSING_KEY;
  item.append(marker, document.createTextNode('欠測'));
  legend.append(item);
}

function paintMissingBands() {
  const host = byId('hinataDailyChart');
  const svg = host?.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('[data-hinata-missing-band]').forEach((node) => node.remove());

  const { timestamps, ranges } = missingDailyRanges(tablePeriodKeys());
  if (timestamps.length < 2 || !ranges.length) {
    updateLegend(false);
    return;
  }

  const width = 1000;
  const height = 340;
  const padding = { left: 58, right: 70, top: 20, bottom: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minTime = timestamps[0];
  const maxTime = timestamps.at(-1);
  const span = Math.max(DAY_MS, maxTime - minTime);
  const x = (time) => padding.left + (time - minTime) / span * plotWidth;

  const anchor = svg.firstChild;
  for (const range of ranges) {
    const left = Math.max(padding.left, x(range.start - DAY_MS / 2));
    const right = Math.min(width - padding.right, x(range.end + DAY_MS / 2));
    const band = svgElement('rect', {
      x: left,
      y: padding.top,
      width: Math.max(1, right - left),
      height: plotHeight,
      fill: MISSING_FILL,
      'pointer-events': 'none',
      'data-hinata-missing-band': '1',
    });
    svg.insertBefore(band, anchor);
  }
  updateLegend(true);
}

function install() {
  const host = byId('hinataDailyChart');
  if (!host || typeof MutationObserver !== 'function') return;
  new MutationObserver(() => paintMissingBands()).observe(host, { childList: true });
  paintMissingBands();
}

if (typeof document !== 'undefined') queueMicrotask(install);
