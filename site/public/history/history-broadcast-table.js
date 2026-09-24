(() => {
  const MODE = 'broadcasts';
  const VISIBLE_HEADERS = [
    '日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接',
    '楽曲数', '推定再生数', 'コメント数', '放送内容', 'イベント名', '出典',
  ];
  const DATE_PREFIX = /^\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*/;
  const integer = new Intl.NumberFormat('ja-JP');
  const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  const jstDate = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const jstTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const STYLE_ID = 'official-party-table-layout';

  function active() {
    return document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode === MODE;
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function numberText(value, formatter = decimal) {
    const parsed = finite(value);
    return parsed == null ? '—' : formatter.format(parsed);
  }

  function elapsedLabel(minutes) {
    const value = finite(minutes);
    if (value == null || value < 0) return '—';
    const rounded = Math.round(value);
    if (rounded < 60) return `${rounded}分`;
    const hours = Math.floor(rounded / 60);
    const rest = rounded % 60;
    return rest ? `${hours}時間${rest}分` : `${hours}時間`;
  }

  function fallbackDate(value) {
    const timestamp = finite(value);
    if (timestamp == null) return '—';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '—' : jstDate.format(date);
  }

  function clockText(value) {
    const timestamp = finite(value);
    if (timestamp == null) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return jstTime.format(date).replace(/\s+/g, '');
  }

  function broadcastTimeLabel(row) {
    const start = clockText(row?.started_at);
    const end = clockText(row?.ended_at);
    return start && end ? `${start}-${end}` : '—';
  }

  function splitEvent(row) {
    const raw = String(row?.event_name || '公式リスパ').trim();
    const match = DATE_PREFIX.exec(raw);
    if (!match) return { date: fallbackDate(row?.started_at), name: raw };
    const date = `${match[1]}/${String(Number(match[2])).padStart(2, '0')}/${String(Number(match[3])).padStart(2, '0')}`;
    const name = raw.slice(match[0].length).trim() || '公式リスパ';
    return { date, name };
  }

  function durationMinutes(row) {
    const start = finite(row?.started_at);
    const end = finite(row?.ended_at);
    if (start == null || end == null || end < start) return null;
    return (end - start) / 60_000;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #historyView .table-wrap table.official-party-table th:nth-child(10),
      #historyView .table-wrap table.official-party-table td:nth-child(10),
      #historyView .table-wrap table.official-party-table th:nth-child(11),
      #historyView .table-wrap table.official-party-table td:nth-child(11),
      #historyView .table-wrap table.official-party-table th:nth-child(12),
      #historyView .table-wrap table.official-party-table td:nth-child(12) {
        text-align: left !important;
      }
    `;
    document.head.appendChild(style);
  }

  function createHeader(label) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    return cell;
  }

  function createCell(value) {
    const cell = document.createElement('td');
    cell.textContent = String(value ?? '—');
    return cell;
  }

  function createSourceCell(sourceUrl) {
    const cell = document.createElement('td');
    const source = String(sourceUrl || '').trim();
    if (!source) {
      cell.textContent = '—';
      return cell;
    }
    const link = document.createElement('a');
    link.href = source;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '公式告知';
    cell.appendChild(link);
    return cell;
  }

  function render(rows) {
    if (!active()) return;
    const head = document.getElementById('thead');
    const body = document.getElementById('tbody');
    if (!head || !body) return;
    const tableTitle = document.getElementById('tableTitle');
    if (tableTitle) tableTitle.textContent = '公式リスパ一覧';

    const table = head.closest('table');
    table?.classList.remove('compact-columns');
    table?.classList.add('official-party-table');
    if (table) table.dataset.officialPartyReadModel = 'complete';

    const headRow = document.createElement('tr');
    headRow.dataset.officialPartyLayout = '1';
    for (const label of VISIBLE_HEADERS) headRow.appendChild(createHeader(label));

    const fragment = document.createDocumentFragment();
    const ordered = [...(Array.isArray(rows) ? rows : [])].reverse();
    for (const row of ordered) {
      const identity = splitEvent(row);
      const average = finite(row?.listener_avg);
      const tracks = finite(row?.distinct_tracks);
      const estimated = finite(row?.estimated_streams)
        ?? (average != null && tracks != null ? Math.round(average * tracks) : null);
      const values = [
        identity.date,
        broadcastTimeLabel(row),
        elapsedLabel(durationMinutes(row)),
        numberText(average),
        numberText(row?.listener_min),
        numberText(row?.listener_max),
        numberText(tracks, integer),
        numberText(estimated, integer),
        numberText(row?.comment_count, integer),
        String(row?.broadcast_content || '—'),
        identity.name,
      ];
      const tableRow = document.createElement('tr');
      for (const value of values) tableRow.appendChild(createCell(value));
      tableRow.appendChild(createSourceCell(row?.source_url));
      fragment.appendChild(tableRow);
    }

    if (!ordered.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = VISIBLE_HEADERS.length;
      cell.textContent = 'データがありません。';
      row.appendChild(cell);
      fragment.appendChild(row);
    }

    head.replaceChildren(headRow);
    body.replaceChildren(fragment);
  }

  installStyle();

  window.addEventListener('history:data-loaded', (event) => {
    const detail = event?.detail || {};
    if (detail.mode !== MODE || !detail.data?.ok) return;
    render(detail.data.rows);
  });
})();
