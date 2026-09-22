const MISSING_START = '2026-01-26';
const MISSING_END = '2026-09-14';
const WEEK_MS = 7 * 86400000;
const MODE = 'ranking';
const previousFetch = window.fetch.bind(window);

let rankingWeeks = [];
let rankingFrom = null;
let rankingTo = null;
let overlayTimer = 0;

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function mondayOnOrAfter(value) {
  const iso = isoDate(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  const delta = (8 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function mondayOnOrBefore(value) {
  const iso = isoDate(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  const delta = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

function weeklyRange(from, to) {
  const start = mondayOnOrAfter(from);
  const end = mondayOnOrBefore(to);
  if (!start || !end || start > end) return [];
  const weeks = [];
  for (let ts = Date.parse(`${start}T00:00:00Z`); ts <= Date.parse(`${end}T00:00:00Z`); ts += WEEK_MS) {
    weeks.push(new Date(ts).toISOString().slice(0, 10));
  }
  return weeks;
}

function completeWeeks() {
  const source = [...new Set(rankingWeeks.map(isoDate).filter(Boolean))].sort();
  const from = rankingFrom || source[0] || MISSING_START;
  const to = rankingTo || source.at(-1) || MISSING_END;
  return [...new Set([...weeklyRange(from, to), ...source])].sort();
}

function isMissing(value) {
  const date = isoDate(value);
  return date >= MISSING_START && date <= MISSING_END;
}

function active() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '') === MODE;
}

function requestUrl(input) {
  try {
    const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
    return new URL(value, location.href);
  } catch {
    return null;
  }
}

function scheduleOverlay(delay = 0) {
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(renderOverlay)), delay);
}

function hasNumericRank(row) {
  const text = String(row?.cells?.[2]?.textContent || '').trim();
  return /^#?\d+$/.test(text);
}

function keepRankedRowsOnly() {
  if (!active()) return;
  const tbody = document.getElementById('tbody');
  if (!tbody) return;

  for (const row of [...tbody.querySelectorAll('tr')]) {
    if (row.cells.length < 3) continue;
    if (!hasNumericRank(row)) row.remove();
  }
}

window.fetch = async (input, init) => {
  const response = await previousFetch(input, init);
  const url = requestUrl(input);
  if (response.ok && url?.origin === location.origin && url.pathname === '/api/history'
      && String(url.searchParams.get('mode') || '').toLowerCase() === MODE) {
    try {
      const data = await response.clone().json();
      if (data?.ok) {
        rankingWeeks = Array.isArray(data.ranking_weeks) ? data.ranking_weeks.map(isoDate).filter(Boolean) : [];
        rankingFrom = isoDate(url.searchParams.get('from')) || null;
        rankingTo = isoDate(url.searchParams.get('to')) || null;
        queueMicrotask(keepRankedRowsOnly);
        scheduleOverlay(20);
      }
    } catch {}
  }
  return response;
};

function renderOverlay() {
  if (!active()) return;
  const weeks = completeWeeks();
  if (!weeks.length) return;
  const canvas = document.getElementById('chart');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const width = Math.max(320, Math.round(canvas.clientWidth || 960));
  const height = Math.max(260, Math.round(canvas.clientHeight || 360));
  const area = { left: 46, right: 18, top: 18, bottom: 55 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const positions = weeks.map((_, index) => area.left + area.width * index / Math.max(1, weeks.length - 1));
  const missingIndexes = weeks.map((week, index) => isMissing(week) ? index : -1).filter((index) => index >= 0);

  if (missingIndexes.length) {
    const step = positions.length > 1 ? area.width / (positions.length - 1) : area.width;
    const left = Math.max(area.left, positions[missingIndexes[0]] - step / 2);
    const right = Math.min(area.left + area.width, positions[missingIndexes.at(-1)] + step / 2);
    context.save();
    context.fillStyle = 'rgba(100, 107, 116, .16)';
    context.fillRect(left, area.top, Math.max(1, right - left), area.height);
    context.fillStyle = 'rgba(70, 77, 86, .82)';
    context.font = '600 11px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText('欠測', (left + right) / 2, area.top + 7);
    context.restore();
  }

  const foot = document.getElementById('chartFoot');
  if (foot) foot.textContent = '順位は上ほど高順位です。灰色は欠測期間です。空白週は圏外です。';
  const legend = document.getElementById('chartLegend');
  if (legend && !legend.querySelector('[data-ranking-missing-legend]')) {
    const span = document.createElement('span');
    span.dataset.rankingMissingLegend = 'true';
    const marker = document.createElement('i');
    marker.style.background = 'rgba(100, 107, 116, .55)';
    span.append(marker, document.createTextNode('欠測'));
    legend.append(span);
  }
}

const tbody = document.getElementById('tbody');
if (tbody) new MutationObserver(() => {
  if (!active()) return;
  queueMicrotask(keepRankedRowsOnly);
  scheduleOverlay(20);
}).observe(tbody, { childList: true });

document.getElementById('modeTabs')?.addEventListener('click', () => {
  queueMicrotask(keepRankedRowsOnly);
  scheduleOverlay(40);
});
document.getElementById('chart')?.addEventListener('pointerup', () => scheduleOverlay(20));
window.addEventListener('resize', () => scheduleOverlay(280), { passive: true });
window.addEventListener('history:runtime-ready', () => {
  queueMicrotask(keepRankedRowsOnly);
  scheduleOverlay(40);
});
