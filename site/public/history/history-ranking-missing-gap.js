const HOSTS = ['sakuramankai', 'sakurazaka46jp'];
const MISSING_START = '2026-01-27';
const MISSING_END = '2026-09-15';
const WEEK_MS = 7 * 86400000;
const MODE = 'ranking';
const previousFetch = window.fetch.bind(window);

let rankingWeeks = [];
let rankingRows = [];
let rankingFrom = null;
let rankingTo = null;
let overlayTimer = 0;

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function isMissing(value) {
  const date = isoDate(value);
  return date >= MISSING_START && date <= MISSING_END;
}

function missingWeeks(from = MISSING_START, to = MISSING_END) {
  const lower = isoDate(from) || MISSING_START;
  const upper = isoDate(to) || MISSING_END;
  const output = [];
  for (let ts = Date.parse(`${MISSING_START}T00:00:00Z`); ts <= Date.parse(`${MISSING_END}T00:00:00Z`); ts += WEEK_MS) {
    const date = new Date(ts).toISOString().slice(0, 10);
    if (date >= lower && date <= upper) output.push(date);
  }
  return output;
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

window.fetch = async (input, init) => {
  const response = await previousFetch(input, init);
  const url = requestUrl(input);
  if (response.ok && url?.origin === location.origin && url.pathname === '/api/history'
      && String(url.searchParams.get('mode') || '').toLowerCase() === MODE) {
    try {
      const data = await response.clone().json();
      if (data?.ok) {
        rankingWeeks = Array.isArray(data.ranking_weeks) ? data.ranking_weeks.map(isoDate).filter(Boolean) : [];
        rankingRows = Array.isArray(data.rows) ? data.rows : [];
        rankingFrom = isoDate(url.searchParams.get('from')) || null;
        rankingTo = isoDate(url.searchParams.get('to')) || null;
        queueMicrotask(ensureMissingRows);
        scheduleOverlay(20);
      }
    } catch {}
  }
  return response;
};

function setText(cell, text) {
  if (!cell || cell.textContent === text) return false;
  cell.textContent = text;
  return true;
}

function markMissingRow(tr) {
  if (!tr?.cells || tr.cells.length < 8 || !isMissing(tr.cells[0].textContent)) return false;
  let changed = false;
  changed = setText(tr.cells[2], '欠測') || changed;
  changed = setText(tr.cells[3], '—') || changed;
  changed = setText(tr.cells[4], '—') || changed;
  changed = setText(tr.cells[6], '欠測') || changed;
  changed = setText(tr.cells[7], '—') || changed;
  if (tr.dataset.rankingMissing !== 'true') {
    tr.dataset.rankingMissing = 'true';
    changed = true;
  }
  return changed;
}

function createMissingRow(week, host) {
  const tr = document.createElement('tr');
  for (const value of [week, host, '欠測', '—', '—', '週間リーダーボード', '欠測', '—']) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  }
  tr.dataset.rankingMissing = 'true';
  return tr;
}

function ensureMissingRows() {
  if (!active()) return;
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  const from = rankingFrom || isoDate(document.getElementById('from')?.value) || MISSING_START;
  const to = rankingTo || isoDate(document.getElementById('to')?.value) || MISSING_END;
  const weeks = missingWeeks(from, to);
  if (!weeks.length) return;

  const visibleHosts = [...new Set(rankingRows
    .map((row) => String(row?.host_name || '').trim().toLowerCase())
    .filter((host) => HOSTS.includes(host)))];
  const hosts = visibleHosts.length ? visibleHosts : HOSTS;
  const existing = new Set();
  let changed = false;

  for (const tr of tbody.querySelectorAll('tr')) {
    if (tr.cells.length >= 2) {
      const week = isoDate(tr.cells[0].textContent);
      const host = String(tr.cells[1].textContent || '').trim().toLowerCase();
      if (week && host) existing.add(`${week}::${host}`);
      changed = markMissingRow(tr) || changed;
    } else if (/データがありません/.test(tr.textContent || '')) {
      tr.remove();
      changed = true;
    }
  }

  for (const week of weeks) {
    for (const host of hosts) {
      const key = `${week}::${host}`;
      if (existing.has(key)) continue;
      tbody.appendChild(createMissingRow(week, host));
      existing.add(key);
      changed = true;
    }
  }

  if (!changed) return;
  const hostOrder = new Map(HOSTS.map((host, index) => [host, index]));
  const ordered = [...tbody.querySelectorAll('tr')].sort((a, b) => {
    const aWeek = isoDate(a.cells?.[0]?.textContent);
    const bWeek = isoDate(b.cells?.[0]?.textContent);
    if (aWeek && bWeek && aWeek !== bWeek) return bWeek.localeCompare(aWeek);
    const aHost = String(a.cells?.[1]?.textContent || '').trim().toLowerCase();
    const bHost = String(b.cells?.[1]?.textContent || '').trim().toLowerCase();
    return (hostOrder.get(aHost) ?? 999) - (hostOrder.get(bHost) ?? 999);
  });
  tbody.replaceChildren(...ordered);
}

function tickIndices(length, count) {
  if (length <= 1) return [0];
  const indexes = new Set();
  for (let index = 0; index < count; index += 1) {
    indexes.add(Math.round((length - 1) * index / Math.max(1, count - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

function yearDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : String(value || '');
}

function renderOverlay() {
  if (!active() || !rankingWeeks.length) return;
  const canvas = document.getElementById('chart');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const width = Math.max(320, Math.round(canvas.clientWidth || 960));
  const height = Math.max(260, Math.round(canvas.clientHeight || 360));
  const area = { left: 46, right: 18, top: 18, bottom: 55 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const weeks = [...new Set(rankingWeeks)].sort();
  const positions = weeks.map((_, index) => area.left + area.width * index / Math.max(1, weeks.length - 1));
  const missingIndexes = weeks.map((week, index) => isMissing(week) ? index : -1).filter((index) => index >= 0);

  if (missingIndexes.length) {
    const step = positions.length > 1 ? area.width / (positions.length - 1) : area.width;
    const left = Math.max(area.left, positions[missingIndexes[0]] - step / 2);
    const right = Math.min(area.left + area.width, positions[missingIndexes.at(-1)] + step / 2);
    context.save();
    context.fillStyle = 'rgba(100, 107, 116, .14)';
    context.fillRect(left, area.top, Math.max(1, right - left), area.height);
    context.fillStyle = 'rgba(70, 77, 86, .75)';
    context.font = '600 11px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText('欠測', (left + right) / 2, area.top + 7);
    context.restore();
  }

  context.save();
  context.clearRect(area.left - 4, area.top + area.height + 6, area.width + 8, area.bottom - 6);
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#667287';
  context.strokeStyle = 'rgba(31,45,68,.16)';
  context.font = '10px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const xTickCount = Math.min(weeks.length, width < 520 ? 4 : 6);
  for (const index of tickIndices(weeks.length, xTickCount)) {
    const x = positions[index];
    context.beginPath();
    context.moveTo(x, area.top + area.height);
    context.lineTo(x, area.top + area.height + 5);
    context.stroke();
    context.fillText(yearDate(weeks[index]), x, area.top + area.height + 9);
  }
  context.restore();

  const foot = document.getElementById('chartFoot');
  if (foot) foot.textContent = '順位は上ほど高順位です。灰色は欠測期間です。';
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
  ensureMissingRows();
  scheduleOverlay(20);
}).observe(tbody, { childList: true });

document.getElementById('modeTabs')?.addEventListener('click', () => {
  ensureMissingRows();
  scheduleOverlay(40);
});
document.getElementById('chart')?.addEventListener('pointerup', () => scheduleOverlay(20));
window.addEventListener('resize', () => scheduleOverlay(280), { passive: true });