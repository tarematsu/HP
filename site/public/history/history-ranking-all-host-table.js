import {
  appendEmptyTableRow,
  integerFormat as integer,
} from '../dashboard-ui-common.js?v=20260930.1';
import { createTableHeaderRow, createTableRow } from '../dashboard-table-dom.js?v=20261001.1';
import { downloadCsv } from '../csv-download.js?v=20261001.1';

const MODE = 'ranking';
const EXCLUDED_ALL_HOSTS = new Set(['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej']);
const ALL_HOST_COLUMNS = [
  ['position', '順位'],
  ['host_name', 'ホスト名'],
  ['stationhead_channel_name', 'チャンネル'],
  ['artist_name', 'アーティスト名'],
  ['relation_label', '種別'],
  ['ranked_weeks', 'ランクイン週数'],
  ['average_rank', '平均順位'],
  ['best_rank', '最高順位'],
  ['worst_rank', '最低順位'],
];
const TEXT_COLUMNS = new Set(['stationhead_channel_name', 'artist_name', 'relation_label']);
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
  if (TEXT_COLUMNS.has(key)) return String(value || '').trim() || '—';
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) return '—';
  if (key === 'average_rank') return decimal.format(number);
  return integer.format(number);
}

function metadataByHost(data) {
  const result = new Map();
  for (const row of Array.isArray(data?.rows) ? data.rows : []) {
    const key = hostKey(row?.host_name);
    if (!key || result.has(key)) continue;
    result.set(key, row);
  }
  return result;
}

function visibleHostRows(data) {
  const metadata = metadataByHost(data);
  const visible = (Array.isArray(data?.host_rankings) ? data.host_rankings : [])
    .filter((row) => !EXCLUDED_ALL_HOSTS.has(hostKey(row?.host_name)));
  let previousWeeks = null;
  let previousPosition = 0;
  return visible.map((row, index) => {
    const source = metadata.get(hostKey(row?.host_name));
    const artistName = String(row?.artist_name || source?.artist_name || '').trim();
    const fandomType = row?.fandom_type || source?.fandom_type;
    const rankedWeeks = Number(row?.ranked_weeks) || 0;
    const position = rankedWeeks === previousWeeks ? previousPosition : index + 1;
    previousWeeks = rankedWeeks;
    previousPosition = position;
    return {
      ...row,
      position,
      stationhead_channel_name: String(row?.stationhead_channel_name || source?.stationhead_channel_name || '').trim() || null,
      artist_name: artistName || null,
      relation_label: artistName ? (fandomType === 'official' ? '公式' : 'ファンダム') : null,
    };
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

function rankingHostButton(row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ranking-host-button';
  button.dataset.rankingHost = String(row.host_name || '');
  button.textContent = String(row.host_name || '—');
  button.setAttribute('aria-label', `${button.textContent}の順位推移を表示`);
  return button;
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
  head.replaceChildren(createTableHeaderRow(ALL_HOST_COLUMNS.map(([, label]) => label)));

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const cells = ALL_HOST_COLUMNS.map(([key]) => key === 'host_name'
      ? { node: rankingHostButton(row) }
      : displayValue(key, row[key]));
    fragment.append(createTableRow(cells));
  }
  if (!rows.length) appendEmptyTableRow(fragment, 'データがありません。', ALL_HOST_COLUMNS.length);
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
  const csvRows = [
    ALL_HOST_COLUMNS.map(([, label]) => label),
    ...rows.map((row) => ALL_HOST_COLUMNS.map(([key]) => key === 'host_name'
      ? String(row.host_name || '')
      : displayValue(key, row[key]))),
  ];
  downloadCsv(`sh-ranking-all-hosts-${new Date().toISOString().slice(0, 10)}.csv`, csvRows);
}

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
