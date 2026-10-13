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
  const mobileList = byId('leaderboardMobileList');
  mobileList?.replaceChildren();
  for (const row of rows) {
    appendTableRow(body, columns.map((column) => ({
      text: cellText(column, row),
      className: column.numeric ? 'leaderboard-number' : '',
    })));
    if (!mobileList) continue;
    const card = document.createElement('article');
    card.className = 'leaderboard-mobile-card';
    for (const column of columns) {
      const field = document.createElement('div');
      field.className = 'leaderboard-mobile-field';
      field.dataset.key = column.key || '';
      const label = document.createElement('span');
      label.className = 'leaderboard-mobile-label';
      label.textContent = column.label || column.key || '';
      const value = document.createElement('span');
      value.className = 'leaderboard-mobile-value';
      value.textContent = cellText(column, row);
      field.append(label, value);
      card.append(field);
    }
    mobileList.append(card);
  }
  if (mobileList && !rows.length) mobileList.textContent = 'リーダーボードデータはありません。';
  if (!rows.length) appendEmptyTableRow(body, 'リーダーボードデータはありません。', Math.max(1, columns.length));
}

