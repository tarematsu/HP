// UTC cell formatting, column contracts and table pagination.
import { appendEmptyTableRow, byId as el, finiteNumber as finite, integerFormat as integer } from '../dashboard-ui-common.js?v=20260930.1';

  const OFFICIAL_EVENT_DATE_GAP = /(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g;
  const dateOnly = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dateTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const SUMMARY_COLUMNS = [
    ['period_key', '期間'],
    ['sample_count', '取得記録数', 'その期間に保存された全サンプル数'],
    ['listener_avg', '平均同接'],
    ['listener_min', '最小同接'],
    ['listener_max', '最大同接'],
    ['stream_start', '再生数（開始）'],
    ['stream_end', '再生数（終了）'],
    ['stream_growth', '再生数増加'],
    ['member_start', 'メンバー数（開始）', '期間開始時点のメンバー数'],
    ['member_end', 'メンバー数（終了）', '期間終了時点のメンバー数'],
    ['member_growth', 'メンバー増加数', '期間内のメンバー数の増加'],
    ['distinct_tracks', '楽曲数', '期間内に確認された楽曲数'],
  ];
  const BROADCAST_COLUMNS = [
    ['event_name', '放送名'], ['started_at', '開始日時（UTC）'], ['ended_at', '終了日時（UTC）'],
    ['sample_count', '記録数'], ['listener_avg', '平均同接'], ['listener_min', '最小同接'],
    ['listener_max', '最大同接'], ['likes_max', '最大いいね'], ['distinct_tracks', '曲数'], ['host_handle', 'ホスト'],
  ];

export function createHistoryTable(state, dataMode, numberText, pageSize = 200) {
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
    const number = Number(value);
    return Number.isFinite(number) && number > 100_000_000_000 ? new Date(number) : new Date(text);
  }

  function formatDate(value, includeTime = false) {
    const date = parseDate(value);
    if (!date || Number.isNaN(date.getTime())) return '—';
    return (includeTime ? dateTime : dateOnly).format(date);
  }

  function columnsFor(mode) {
    if (mode === 'broadcasts') return BROADCAST_COLUMNS;
    return SUMMARY_COLUMNS;
  }

  function displayCell(key, row) {
    let value = row?.[key];
    if (value == null || value === '') return '—';
    if (key === 'event_name') return String(value).replace(OFFICIAL_EVENT_DATE_GAP, '$1');
    if (key.endsWith('_at')) return formatDate(value, true);
    if (['rank_change', 'stream_growth', 'member_growth'].includes(key)) {
      const number = finite(value);
      return number == null ? '—' : `${number > 0 ? '+' : ''}${integer.format(number)}`;
    }
    if (typeof value === 'number') return numberText(value);
    return String(value);
  }

  function syncTableModeClass(mode) {
    const table = el('thead')?.closest('table');
    if (!table) return;
    table.classList.toggle('official-party-table', mode === 'broadcasts');
  }

  function renderTable(reset = false) {
    if (reset) state.visibleRows = pageSize;
    const mode = dataMode();
    const columns = columnsFor(mode);
    syncTableModeClass(mode);
    const head = document.createElement('tr');
    for (const [, label, title] of columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      if (title) cell.title = title;
      head.appendChild(cell);
    }
    el('thead').replaceChildren(head);

    const rows = state.tableRows.slice(0, state.visibleRows);
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const [key] of columns) {
        const td = document.createElement('td');
        td.textContent = displayCell(key, row);
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    if (!rows.length) appendEmptyTableRow(fragment, 'データがありません。', columns.length);
    el('tbody').replaceChildren(fragment);
    el('more').hidden = state.tableRows.length <= state.visibleRows;
  }

  return { columnsFor, displayCell, renderTable };
}
