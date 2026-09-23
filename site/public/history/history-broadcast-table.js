(() => {
  const MODE = 'broadcasts';
  const VISIBLE_HEADERS = ['日付', '時間', '長さ', '平均同接', '最大同接', '曲数', '推定再生数', '放送内容', '名前', '出典'];
  const TECHNICAL_HEADERS = ['放送名', '開始日時（UTC）', '最小同接', 'コメント数'];
  const OFFICIAL_NEWS = new Map([
    ['2024.07.23『YUI KOBAYASHI GRADUATION CONCERT』Stationhead Listening Party', 'https://sakurazaka46.com/s/s46/news/detail/M01328'],
    ['2024.11.22「4th YEAR ANNIVERSARY LIVE」開催直前！Stationheadリスニングパーティー', 'https://sakurazaka46.com/s/s46/news/detail/M01519'],
    ['2024.11.25「4th YEAR ANNIVERSARY LIVE」Stationheadリスニングパーティー', 'https://sakurazaka46.com/s/s46/news/detail/M01523'],
    ['2025.04.30 2nd Album『Addiction』Stationheadリスニングパーティー', 'https://sakurazaka46.com/s/s46/news/detail/M01667'],
    ['2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー', 'https://sakurazaka46.com/s/s46/news/detail/M01853'],
    ['2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』', 'https://sakurazaka46.com/s/s46/news/detail/R00518'],
    ['2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』', 'https://sakurazaka46.com/s/s46/news/detail/R00621'],
  ]);
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

  function utcDateTime(value) {
    const timestamp = finite(value);
    if (timestamp == null) return '—';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
      + ` ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  }

  function fallbackDate(value) {
    const timestamp = finite(value);
    if (timestamp == null) return '—';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '—';
    return jstDate.format(date);
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
      #historyView .table-wrap table.official-party-table th:nth-child(n+11),
      #historyView .table-wrap table.official-party-table td:nth-child(n+11) {
        display: none !important;
      }
      #historyView .table-wrap table.official-party-table th:nth-child(8),
      #historyView .table-wrap table.official-party-table td:nth-child(8),
      #historyView .table-wrap table.official-party-table th:nth-child(9),
      #historyView .table-wrap table.official-party-table td:nth-child(9),
      #historyView .table-wrap table.official-party-table th:nth-child(10),
      #historyView .table-wrap table.official-party-table td:nth-child(10) {
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

  function createSourceCell(eventName) {
    const cell = document.createElement('td');
    const source = OFFICIAL_NEWS.get(String(eventName || '').trim());
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

    const table = head.closest('table');
    table?.classList.remove('compact-columns');
    table?.classList.add('official-party-table');

    const headRow = document.createElement('tr');
    headRow.dataset.officialPartyLayout = '1';
    for (const label of [...VISIBLE_HEADERS, ...TECHNICAL_HEADERS]) headRow.appendChild(createHeader(label));

    const fragment = document.createDocumentFragment();
    const ordered = [...(Array.isArray(rows) ? rows : [])].reverse();
    for (const row of ordered) {
      const identity = splitEvent(row);
      const eventName = String(row?.event_name || '公式リスパ').trim();
      const average = finite(row?.listener_avg);
      const maximum = finite(row?.listener_max);
      const tracks = finite(row?.distinct_tracks);
      const minimum = finite(row?.listener_min);
      const estimated = average != null && tracks != null ? Math.round(average * tracks) : null;
      const visibleValues = [
        identity.date,
        broadcastTimeLabel(row),
        elapsedLabel(durationMinutes(row)),
        numberText(average),
        numberText(maximum),
        numberText(tracks, integer),
        numberText(estimated, integer),
        String(row?.broadcast_content || '—'),
        identity.name,
      ];
      const technicalValues = [
        eventName,
        utcDateTime(row?.started_at),
        numberText(minimum),
        '—',
      ];
      const tableRow = document.createElement('tr');
      for (const value of visibleValues) tableRow.appendChild(createCell(value));
      tableRow.appendChild(createSourceCell(eventName));
      for (const value of technicalValues) tableRow.appendChild(createCell(value));
      fragment.appendChild(tableRow);
    }

    if (!ordered.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = VISIBLE_HEADERS.length + TECHNICAL_HEADERS.length;
      cell.textContent = 'データがありません。';
      row.appendChild(cell);
      fragment.appendChild(row);
    }

    head.replaceChildren(headRow);
    body.replaceChildren(fragment);
  }

  let latestRows = [];
  installStyle();

  window.addEventListener('history:data-loaded', (event) => {
    const detail = event?.detail || {};
    if (detail.mode !== MODE || !detail.data?.ok) return;
    latestRows = Array.isArray(detail.data.rows) ? detail.data.rows : [];
    render(latestRows);
  });

  document.getElementById('more')?.addEventListener('click', () => {
    setTimeout(() => render(latestRows), 0);
  });
})();
