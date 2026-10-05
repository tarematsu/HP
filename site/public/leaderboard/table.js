// Column-driven table rendering; missing ranks retain their explicit status.
import { appendEmptyTableRow, byId, integerFormat as numberFormat } from '../dashboard-ui-common.js?v=20261004.1';
import { appendTableRow } from '../dashboard-table-dom.js?v=20261001.1';
import { rankValue } from './format.js';

export function cellText(column, row) {
  const value = row?.[column?.key];
  if (column?.format === 'rank') {
    const rank = rankValue(value);
    return rank == null ? String(row?.rank_status || '圏外') : `${numberFormat.format(rank)}位`;
  }
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return numberFormat.format(value);
  return String(value);
}

export function renderTable(payload) {
  const head = byId('leaderboardThead');
  const body = byId('leaderboardTbody');
  if (!head || !body) return;
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const tr = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column.label || column.key || '';
    if (column.numeric) th.className = 'leaderboard-number';
    tr.append(th);
  }
  head.replaceChildren(tr);
  body.replaceChildren();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  for (const row of rows) {
    appendTableRow(body, columns.map((column) => ({
      text: cellText(column, row),
      className: column.numeric ? 'leaderboard-number' : '',
    })));
  }
  if (!rows.length) appendEmptyTableRow(body, 'リーダーボードデータはありません。', Math.max(1, columns.length));
}

