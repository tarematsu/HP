import {
  appendEmptyTableRow,
  decimalOneFormat as decimal,
  finiteNumber as finite,
  integerFormat as integer,
} from '../dashboard-ui-common.js?v=20260930.1';
import {
  createOfficialPartyDataRow,
  createOfficialPartyHeaderRow,
  durationLabel,
  officialPartyNumberText,
  OFFICIAL_PARTY_HEADERS,
  splitOfficialEventName,
} from '../official-listening-party-ui.js?v=20261001.1';

(() => {
  const MODE = 'broadcasts';
  const jstDate = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const jstTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });

  function active() {
    return document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode === MODE;
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

  function durationMinutes(row) {
    const start = finite(row?.started_at);
    const end = finite(row?.ended_at);
    if (start == null || end == null || end < start) return null;
    return (end - start) / 60_000;
  }

  function render(rows) {
    if (!active()) return;
    const head = document.getElementById('thead');
    const body = document.getElementById('tbody');
    if (!head || !body) return;

    const table = head.closest('table');
    table?.classList.remove('compact-columns');
    table?.classList.add('official-party-table');
    if (table) table.dataset.officialPartyReadModel = 'complete';

    const headRow = createOfficialPartyHeaderRow({ layoutMarker: true });
    const fragment = document.createDocumentFragment();
    const ordered = [...(Array.isArray(rows) ? rows : [])].reverse();
    for (const row of ordered) {
      const identity = splitOfficialEventName(row?.event_name, {
        defaultName: '公式リスパ',
        fallbackDate: fallbackDate(row?.started_at),
      });
      const average = finite(row?.listener_avg);
      const tracks = finite(row?.distinct_tracks);
      const estimated = finite(row?.estimated_streams)
        ?? (average != null && tracks != null ? Math.round(average * tracks) : null);
      const values = [
        identity.date,
        broadcastTimeLabel(row),
        durationLabel(durationMinutes(row)),
        officialPartyNumberText(average, decimal),
        officialPartyNumberText(row?.listener_min, decimal),
        officialPartyNumberText(row?.listener_max, decimal),
        officialPartyNumberText(tracks, integer),
        officialPartyNumberText(estimated, integer),
        String(row?.broadcast_content || '—'),
        identity.name,
      ];
      fragment.append(createOfficialPartyDataRow(values, row?.source_url));
    }

    if (!ordered.length) appendEmptyTableRow(fragment, 'データがありません。', OFFICIAL_PARTY_HEADERS.length);

    head.replaceChildren(headRow);
    body.replaceChildren(fragment);
  }

  window.addEventListener('history:data-loaded', (event) => {
    const detail = event?.detail || {};
    if (detail.mode !== MODE || !detail.data?.ok) return;
    render(detail.data.rows);
  });
})();
