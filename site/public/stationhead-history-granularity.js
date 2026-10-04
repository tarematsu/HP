import { stationheadChannelReadModel } from './stationhead-channel-read-model.js?v=20261004.2';

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizedMode(value) {
  return value === 'weekly' ? 'weekly' : 'daily';
}

function periodDuration(mode) {
  return normalizedMode(mode) === 'weekly' ? 7 * DAY_MS : DAY_MS;
}

function mergeRanges(ranges) {
  const sorted = ranges
    .filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

export function historyMissingRanges(rows, mode = 'daily') {
  const periodMs = periodDuration(mode);
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      timestamp: Number(row?.timestamp),
      missing: Boolean(row?.missing),
    }))
    .filter((row) => Number.isFinite(row.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const observed = normalized.filter((row) => !row.missing);
  if (observed.length < 2) return [];

  const first = observed[0].timestamp;
  const last = observed.at(-1).timestamp;
  const ranges = normalized
    .filter((row) => row.missing && row.timestamp > first && row.timestamp < last)
    .map((row) => ({
      start: row.timestamp - periodMs / 2,
      end: row.timestamp + periodMs / 2,
    }));

  for (let index = 1; index < observed.length; index += 1) {
    const previous = observed[index - 1].timestamp;
    const next = observed[index].timestamp;
    if (next - previous <= periodMs * 1.5) continue;
    ranges.push({
      start: previous + periodMs / 2,
      end: next - periodMs / 2,
    });
  }
  return mergeRanges(ranges);
}

function syncLabels(root, mode) {
  const weekly = mode === 'weekly';
  root.querySelectorAll('[data-history-table-mode]').forEach((button) => {
    const active = button.dataset.historyTableMode === mode;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const tableTitle = root.querySelector('[data-role="history-table-title"]');
  if (tableTitle) tableTitle.textContent = weekly ? '週次データ' : '日次データ';
  const panel = root.querySelector('[data-stationhead-panel="history"]');
  const chartTitle = panel?.querySelector('.chart-head h2');
  if (chartTitle) chartTitle.textContent = weekly ? '週次推移' : '日次推移';
  const firstHeader = panel?.querySelector('.data-panel thead th');
  if (firstHeader) firstHeader.textContent = weekly ? '週' : '日付';
  const canvas = panel?.querySelector('[data-role="daily-chart"]');
  if (canvas) canvas.setAttribute('aria-label', `${weekly ? '週次' : '日次'}の同接と再生数増加`);
}

function tableHistoryRows(root) {
  return [...root.querySelectorAll('[data-role="daily-tbody"] > tr')]
    .map((row) => {
      const key = row.cells?.[0]?.textContent?.trim() || '';
      if (!DATE_RE.test(key)) return null;
      const timestamp = Date.parse(`${key}T00:00:00Z`);
      const metricCells = [...row.cells].slice(1);
      const missing = metricCells.length > 0
        && metricCells.every((cell) => ['—', '-', ''].includes(cell.textContent?.trim() || ''));
      return { timestamp, missing };
    })
    .filter(Boolean);
}

function ensureGapOverlay(root) {
  const canvas = root.querySelector('[data-role="daily-chart"]');
  if (!canvas) return null;
  let wrap = canvas.closest('.stationhead-history-chart-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'stationhead-history-chart-wrap';
    canvas.before(wrap);
    wrap.append(canvas);
  }
  let overlay = wrap.querySelector('.stationhead-history-gap-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'stationhead-history-gap-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    wrap.append(overlay);
  }
  return { canvas, overlay };
}

function updateMissingLegend(root, visible) {
  const legend = root.querySelector('[data-role="daily-legend"]');
  if (!legend) return;
  legend.querySelector('[data-history-missing-legend]')?.remove();
  if (!visible) return;
  const marker = document.createElement('span');
  marker.dataset.historyMissingLegend = '1';
  marker.className = 'history-missing-legend';
  marker.textContent = ' / 欠測（灰色）';
  legend.append(marker);
}

function paintMissingPeriods(root, mode) {
  const target = ensureGapOverlay(root);
  if (!target) return;
  const { canvas, overlay } = target;
  overlay.replaceChildren();
  const rows = tableHistoryRows(root);
  const observed = rows.filter((row) => !row.missing).sort((a, b) => a.timestamp - b.timestamp);
  const ranges = historyMissingRanges(rows, mode);
  updateMissingLegend(root, ranges.length > 0);
  if (observed.length < 2 || !ranges.length) return;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const minTime = observed[0].timestamp;
  const maxTime = observed.at(-1).timestamp;
  const span = Math.max(DAY_MS, maxTime - minTime);
  const plotLeft = Math.min(54, rect.width * 0.18);
  const plotRight = Math.min(42, rect.width * 0.14);
  const plotWidth = Math.max(1, rect.width - plotLeft - plotRight);
  const x = (timestamp) => plotLeft + (timestamp - minTime) / span * plotWidth;

  for (const range of ranges) {
    const left = Math.max(plotLeft, x(range.start));
    const right = Math.min(rect.width - plotRight, x(range.end));
    if (right <= left) continue;
    const band = document.createElement('i');
    band.className = 'stationhead-history-gap-band';
    band.style.left = `${left}px`;
    band.style.width = `${Math.max(1, right - left)}px`;
    band.style.top = '26px';
    band.style.height = `${Math.max(1, rect.height - 68)}px`;
    overlay.append(band);
  }
}

export function bindStationheadHistoryGranularity(root) {
  if (!root || root.dataset.historyGranularityBound === '1') return;
  const buttons = [...root.querySelectorAll('[data-history-table-mode]')];
  if (!buttons.length) return;
  const model = stationheadChannelReadModel(root.dataset.stationheadModel || 'buddies');
  if (typeof model.setHistoryMode !== 'function') return;

  let mode = 'daily';
  const repaint = () => queueMicrotask(() => paintMissingPeriods(root, mode));
  const select = (nextMode, reload = true) => {
    mode = normalizedMode(nextMode);
    model.setHistoryMode(mode);
    syncLabels(root, mode);
    const overlay = root.querySelector('.stationhead-history-gap-overlay');
    if (overlay) overlay.replaceChildren();
    updateMissingLegend(root, false);
    if (!reload) {
      repaint();
      return;
    }
    const historyTab = root.querySelector('[data-stationhead-section="history"]');
    if (historyTab && !historyTab.disabled) historyTab.click();
  };

  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset.historyTableMode));
  }
  root.querySelector('[data-stationhead-section="history"]')?.addEventListener('click', () => {
    queueMicrotask(() => {
      syncLabels(root, mode);
      paintMissingPeriods(root, mode);
    });
  });

  const tbody = root.querySelector('[data-role="daily-tbody"]');
  if (tbody && typeof MutationObserver === 'function') {
    new MutationObserver(repaint).observe(tbody, { childList: true });
  }
  if (typeof ResizeObserver === 'function') {
    const canvas = root.querySelector('[data-role="daily-chart"]');
    if (canvas) new ResizeObserver(repaint).observe(canvas);
  }

  root.dataset.historyGranularityBound = '1';
  select('daily', false);
}
