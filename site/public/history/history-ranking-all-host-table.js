const MODE = 'ranking';
const EXCLUDED_ALL_HOSTS = new Set(['sakuramankai', 'sakurazaka46jp']);
const ALL_HOST_COLUMNS = [
  ['position', '順位'],
  ['host_name', 'ホスト名'],
  ['fandom_label', 'ファンダム'],
  ['ranked_weeks', 'ランクイン週数'],
  ['average_rank', '平均順位'],
  ['best_rank', '最高順位'],
  ['worst_rank', '最低順位'],
];
const integer = new Intl.NumberFormat('ja-JP');
const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

let lastData = null;
let selectedHost = '';
let forcedRefresh = false;

function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function displayValue(key, value) {
  if (key === 'fandom_label') return String(value || '').trim() || '—';
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) return '—';
  if (key === 'average_rank') return decimal.format(number);
  return integer.format(number);
}

function visibleHostRows(data) {
  const visible = (Array.isArray(data?.host_rankings) ? data.host_rankings : [])
    .filter((row) => !EXCLUDED_ALL_HOSTS.has(hostKey(row?.host_name)));
  let previousWeeks = null;
  let previousPosition = 0;
  return visible.map((row, index) => {
    const rankedWeeks = Number(row?.ranked_weeks) || 0;
    const position = rankedWeeks === previousWeeks ? previousPosition : index + 1;
    previousWeeks = rankedWeeks;
    previousPosition = position;
    return { ...row, position };
  });
}

function setSelectedHost(host) {
  selectedHost = String(host || '').trim();
  const selectedKey = hostKey(selectedHost);
  for (const button of document.querySelectorAll('#tbody [data-ranking-host]')) {
    const selected = hostKey(button.dataset.rankingHost) === selectedKey;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.closest('tr')?.classList.toggle('selected-ranking-host', selected);
  }
}

function installStyle() {
  if (document.getElementById('all-host-ranking-table-style')) return;
  const style = document.createElement('style');
  style.id = 'all-host-ranking-table-style';
  style.textContent = `
    #historyView table.all-host-ranking-table .ranking-host-button {
      appearance: none;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 650;
      padding: 2px 0;
      text-align: left;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      cursor: pointer;
      width: 100%;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #historyView table.all-host-ranking-table tr.selected-ranking-host td {
      background: rgba(31, 45, 68, .055);
    }
    @media (max-width: 760px) {
      #historyView .table-wrap table.all-host-ranking-table.compact-columns {
        width: 100% !important;
        min-width: 100% !important;
        table-layout: fixed !important;
        font-size: 10px !important;
      }
      #historyView table.all-host-ranking-table th:nth-child(1),
      #historyView table.all-host-ranking-table td:nth-child(1) { width: 7% !important; }
      #historyView table.all-host-ranking-table th:nth-child(2),
      #historyView table.all-host-ranking-table td:nth-child(2) { width: 22% !important; }
      #historyView table.all-host-ranking-table th:nth-child(3),
      #historyView table.all-host-ranking-table td:nth-child(3) { width: 24% !important; }
      #historyView table.all-host-ranking-table th:nth-child(4),
      #historyView table.all-host-ranking-table td:nth-child(4) { width: 13% !important; }
      #historyView table.all-host-ranking-table th:nth-child(5),
      #historyView table.all-host-ranking-table td:nth-child(5) { width: 12% !important; }
      #historyView table.all-host-ranking-table th:nth-child(6),
      #historyView table.all-host-ranking-table td:nth-child(6) { width: 11% !important; }
      #historyView table.all-host-ranking-table th:nth-child(7),
      #historyView table.all-host-ranking-table td:nth-child(7) { width: 11% !important; }
      #historyView table.all-host-ranking-table th,
      #historyView table.all-host-ranking-table td {
        padding-left: 3px !important;
        padding-right: 3px !important;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #historyView table.all-host-ranking-table th {
        padding-left: 2px !important;
        padding-right: 2px !important;
        font-size: 8.5px !important;
        line-height: 1.15 !important;
        letter-spacing: -.035em !important;
        text-overflow: clip !important;
        white-space: nowrap !important;
      }
      #historyView table.all-host-ranking-table th:not(:nth-child(2)):not(:nth-child(3)),
      #historyView table.all-host-ranking-table td:not(:nth-child(2)):not(:nth-child(3)) {
        text-align: center !important;
      }
      #historyView table.all-host-ranking-table .ranking-host-button {
        font-size: 10px !important;
      }
    }
  `;
  document.head.append(style);
}

function render(data) {
  const table = document.getElementById('thead')?.closest('table');
  const head = document.getElementById('thead');
  const body = document.getElementById('tbody');
  if (!table || !head || !body) return;

  if (data?.scope !== 'all') {
    table.classList.remove('all-host-ranking-table');
    lastData = null;
    selectedHost = '';
    forcedRefresh = false;
    return;
  }

  if (!Array.isArray(data.host_rankings)) {
    if (!forcedRefresh) {
      forcedRefresh = true;
      queueMicrotask(() => document.getElementById('load')?.click());
    }
    return;
  }

  forcedRefresh = false;
  const rows = visibleHostRows(data);
  lastData = { ...data, host_rankings: rows };
  table.classList.add('all-host-ranking-table');

  const headRow = document.createElement('tr');
  for (const [, label] of ALL_HOST_COLUMNS) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.append(th);
  }
  head.replaceChildren(headRow);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const [key] of ALL_HOST_COLUMNS) {
      const td = document.createElement('td');
      if (key === 'host_name') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ranking-host-button';
        button.dataset.rankingHost = String(row.host_name || '');
        button.textContent = String(row.host_name || '—');
        button.setAttribute('aria-label', `${button.textContent}の順位推移を表示`);
        td.append(button);
      } else {
        td.textContent = displayValue(key, row[key]);
      }
      tr.append(td);
    }
    fragment.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = ALL_HOST_COLUMNS.length;
    td.textContent = 'データがありません。';
    tr.append(td);
    fragment.append(tr);
  }
  body.replaceChildren(fragment);
  const more = document.getElementById('more');
  if (more) more.hidden = true;

  const defaultHost = String(rows[0]?.host_name || '').trim();
  setSelectedHost(defaultHost);
  const currentChartHost = String(data.chart_hosts?.[0] || '').trim();
  if (defaultHost && hostKey(defaultHost) !== hostKey(currentChartHost)) {
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('history:ranking-host-selected', {
      detail: { host: defaultHost },
    })));
  }
}

function exportCsv() {
  if (!lastData || lastData.scope !== 'all') return;
  const rows = Array.isArray(lastData.host_rankings) ? lastData.host_rankings : [];
  const lines = [
    ALL_HOST_COLUMNS.map(([, label]) => label),
    ...rows.map((row) => ALL_HOST_COLUMNS.map(([key]) => key === 'host_name'
      ? String(row.host_name || '')
      : displayValue(key, row[key]))),
  ].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `sh-ranking-all-hosts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

installStyle();

window.addEventListener('history:data-loaded', (event) => {
  const detail = event?.detail || {};
  if (detail.mode !== MODE || !detail.data?.ok) return;
  render(detail.data);
});

document.getElementById('tbody')?.addEventListener('click', (event) => {
  if (activeMode() !== MODE || lastData?.scope !== 'all') return;
  const button = event.target.closest('[data-ranking-host]');
  if (!button) return;
  const host = String(button.dataset.rankingHost || '').trim();
  if (!host) return;
  setSelectedHost(host);
  window.dispatchEvent(new CustomEvent('history:ranking-host-selected', { detail: { host } }));
});

document.getElementById('csv')?.addEventListener('click', (event) => {
  if (activeMode() !== MODE || lastData?.scope !== 'all') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  exportCsv();
}, true);
