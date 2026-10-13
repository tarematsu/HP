// Column-driven table rendering; missing ranks retain their explicit status.
import { byId, integerFormat as numberFormat } from '../dashboard-ui-common.js?v=20261004.1';
import { renderResponsiveTable } from '../dashboard-table-dom.js?v=20261001.1';
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
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  renderResponsiveTable({
    head: byId('leaderboardThead'),
    body: byId('leaderboardTbody'),
    cards: byId('leaderboardMobileList'),
    columns,
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
    valuesForRow: (row) => columns.map((column) => ({
      text: cellText(column, row),
      className: column.numeric ? 'dashboard-number' : '',
    })),
    emptyMessage: 'リーダーボードデータはありません。',
  });
}
