const MIN_GAP_ROWS = 3;
const MISSING_VALUE = /^(?:—|-)$/;

export function isMissingHistoryValues(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every((value) => MISSING_VALUE.test(String(value ?? '').trim()));
}

export function historyGapLabel(periods) {
  const values = Array.isArray(periods)
    ? periods.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!values.length) return '欠測';
  const first = values[0];
  const last = values.at(-1);
  const range = first === last ? first : `${last}〜${first}`;
  return `欠測 ${range}（${values.length}期間）`;
}

function rowIsMissing(row) {
  const cells = [...(row?.cells || [])];
  return cells.length > 1 && isMissingHistoryValues(cells.slice(1).map((cell) => cell.textContent));
}

export function compactHistoryGapRows(tbody) {
  if (!tbody || tbody.dataset.gapCompacting === '1') return 0;
  const rows = [...tbody.rows].filter((row) => !row.classList.contains('history-gap-row'));
  let collapsed = 0;
  let index = 0;
  tbody.dataset.gapCompacting = '1';

  try {
    while (index < rows.length) {
      if (!rowIsMissing(rows[index])) {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < rows.length && rowIsMissing(rows[end])) end += 1;
      const group = rows.slice(index, end);
      if (group.length >= MIN_GAP_ROWS) {
        const periods = group.map((row) => row.cells[0]?.textContent || '');
        const summaryRow = document.createElement('tr');
        summaryRow.className = 'history-gap-row';
        const cell = document.createElement('td');
        cell.colSpan = Math.max(1, group[0].cells.length);
        cell.textContent = historyGapLabel(periods);
        summaryRow.append(cell);
        group[0].before(summaryRow);
        for (const row of group) row.remove();
        collapsed += group.length - 1;
      }
      index = end;
    }
  } finally {
    delete tbody.dataset.gapCompacting;
  }
  return collapsed;
}

function attachHistoryGapObserver() {
  const tbody = document.getElementById('tbody');
  if (!tbody || tbody.dataset.gapObserver === '1') return Boolean(tbody);
  tbody.dataset.gapObserver = '1';
  let queued = false;
  const compact = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      compactHistoryGapRows(tbody);
    });
  };
  new MutationObserver(compact).observe(tbody, { childList: true });
  compact();
  return true;
}

function scheduleAttach() {
  if (attachHistoryGapObserver()) return;
  requestAnimationFrame(() => attachHistoryGapObserver());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAttach, { once: true });
  } else {
    queueMicrotask(scheduleAttach);
  }
  window.addEventListener('dashboard:route-ready', scheduleAttach);
}
