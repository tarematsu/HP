const MODE = 'ranking';
const MISSING_START = '2026-01-26';
const MISSING_END = '2026-09-14';

let statusByRow = new Map();

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase();
}

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function rowKey(week, host) {
  return `${isoDate(week)}\u0000${normalizeHost(host)}`;
}

function finiteRank(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rankStatus(row) {
  if (finiteRank(row?.rank) != null) return '';
  const week = isoDate(row?.ranking_date);
  if (week && week >= MISSING_START && week <= MISSING_END) return '欠測';
  if (row?.synthetic || row?.is_out_of_rank) return '圏外';
  return '—';
}

function capture(payload) {
  statusByRow = new Map();
  if (!payload || payload.mode !== MODE || !Array.isArray(payload.rows)) return;
  for (const row of payload.rows) {
    const key = rowKey(row?.ranking_date, row?.host_name);
    if (!key.startsWith('\u0000')) statusByRow.set(key, rankStatus(row));
  }
}

function applyStatusLabels() {
  if (activeMode() !== MODE || !statusByRow.size) return;
  const head = document.getElementById('thead');
  const body = document.getElementById('tbody');
  if (!head || !body) return;

  const headers = [...head.querySelectorAll('th')].map((cell) => cell.textContent.trim());
  const weekIndex = headers.indexOf('週');
  const hostIndex = headers.indexOf('ホスト');
  const rankIndex = headers.indexOf('順位');
  if (weekIndex < 0 || hostIndex < 0 || rankIndex < 0) return;

  for (const row of body.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length <= Math.max(weekIndex, hostIndex, rankIndex)) continue;
    const status = statusByRow.get(rowKey(cells[weekIndex].textContent, cells[hostIndex].textContent));
    if (!status) continue;
    cells[rankIndex].textContent = status;
    cells[rankIndex].classList.toggle('ranking-missing-cell', status === '欠測');
    cells[rankIndex].classList.toggle('ranking-out-cell', status === '圏外');
  }
}

function scheduleApply() {
  queueMicrotask(() => queueMicrotask(applyStatusLabels));
}

window.addEventListener('history:data-loaded', (event) => {
  if (String(event?.detail?.mode || '') !== MODE) return;
  capture(event?.detail?.data);
  scheduleApply();
});

document.getElementById('more')?.addEventListener('click', scheduleApply);
window.addEventListener('hashchange', scheduleApply);
