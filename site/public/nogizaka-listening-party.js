import {
  appendEmptyTableRow,
  decimalOneFormat as decimal,
  finiteNumber as finite,
  integerFormat as integer,
} from './dashboard-ui-common.js?v=20260930.1';
import { downloadCsv } from './csv-download.js?v=20261001.1';
import {
  createOfficialPartyDataRow,
  createOfficialPartyHeaderRow,
  durationLabel,
  officialPartyNumberText,
  OFFICIAL_PARTY_HEADERS,
  splitOfficialEventName,
} from './official-listening-party-ui.js?v=20261001.1';

const API_URL = '/api/nogizaka-listening-party';
const MIN_REFRESH_MS = 15_000;
const MAX_REFRESH_MS = 60_000;
const jstDate = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
});
const jstTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

let latestPayload = null;
let refreshTimer = 0;
let controller = null;
let resizeTimer = 0;

const byId = (id) => document.getElementById(id);
const active = () => document.querySelector('#modeTabs button.active[data-view="nogizaka"]') != null;

function epoch(value) {
  const parsed = finite(value);
  if (parsed == null || parsed <= 0) return null;
  return parsed < 100_000_000_000 ? parsed * 1000 : parsed;
}

function clock(value) {
  const timestamp = epoch(value);
  return timestamp == null ? null : jstTime.format(new Date(timestamp)).replace(/\s+/g, '');
}

function durationMinutes(payload) {
  const row = payload?.row;
  const start = epoch(row?.started_at);
  const end = epoch(row?.ended_at);
  if (start != null && end != null && end >= start) return (end - start) / 60_000;
  const points = payload?.series?.[0]?.points || [];
  const last = finite(points.at(-1)?.[0]);
  return last == null ? null : last;
}

function clearRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = 0;
}

function scheduleRefresh(payload) {
  clearRefresh();
  if (!active() || document.visibilityState === 'hidden') return;
  const requested = finite(payload?.refresh_hint_ms) ?? MAX_REFRESH_MS;
  const delay = Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, requested));
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    if (active() && document.visibilityState !== 'hidden') void loadNogizakaListeningPartyView({ force: true });
  }, delay);
}

function setNotice(payload) {
  const notice = byId('nogizakaListeningPartyNotice');
  if (!notice) return;
  const event = payload?.event;
  if (!event) {
    notice.textContent = '本日の乃木坂46公式リスパはまだ検出されていません。';
    notice.hidden = false;
    notice.classList.remove('error');
    return;
  }
  const status = String(event.status || '');
  const generatedAt = epoch(payload?.generated_at);
  if (status === 'active') {
    notice.textContent = `開催中 · 最終更新 ${generatedAt == null ? '—' : jstDateTime.format(new Date(generatedAt))}`;
  } else if (status === 'scheduled') {
    const scheduledAt = epoch(event.scheduled_at);
    notice.textContent = scheduledAt == null
      ? '本日の公式リスパを待機中です。'
      : `開始予定 ${jstDateTime.format(new Date(scheduledAt))}`;
  } else {
    notice.textContent = `本日の公式リスパ ${status === 'ended' ? '終了' : '収集済み'}`;
  }
  notice.hidden = false;
  notice.classList.remove('error');
}

function renderSummary(payload) {
  const row = payload?.row;
  byId('nogizakaPartyPeriods').textContent = row ? '1' : '0';
  byId('nogizakaPartyAverage').textContent = officialPartyNumberText(row?.listener_avg, decimal);
  byId('nogizakaPartyMaximum').textContent = officialPartyNumberText(row?.listener_max, integer);
  byId('nogizakaPartyDuration').textContent = durationLabel(durationMinutes(payload));
}

function eventIdentity(row) {
  const startedAt = epoch(row?.started_at);
  return splitOfficialEventName(row?.event_name, {
    defaultName: '乃木坂46 公式リスパ',
    fallbackDate: startedAt == null ? '—' : jstDate.format(new Date(startedAt)),
  });
}

function renderTable(payload) {
  const head = byId('nogizakaPartyThead');
  const body = byId('nogizakaPartyTbody');
  if (!head || !body) return;
  head.replaceChildren(createOfficialPartyHeaderRow());

  const row = payload?.row;
  if (!row) {
    appendEmptyTableRow(body, 'データがありません。', OFFICIAL_PARTY_HEADERS.length, { replace: true });
    return;
  }

  const identity = eventIdentity(row);
  const start = clock(row.started_at);
  const end = clock(row.ended_at);
  const timeRange = start ? `${start}-${end || (payload.collection_active ? '現在' : '—')}` : '—';
  const values = [
    identity.date,
    timeRange,
    durationLabel(durationMinutes(payload)),
    officialPartyNumberText(row.listener_avg, decimal),
    officialPartyNumberText(row.listener_min, decimal),
    officialPartyNumberText(row.listener_max, decimal),
    officialPartyNumberText(row.distinct_tracks, integer),
    officialPartyNumberText(row.estimated_streams, integer),
    String(row.broadcast_content || '—'),
    identity.name,
  ];
  body.replaceChildren(createOfficialPartyDataRow(values, row.source_url));
}

function drawChart(payload) {
  const canvas = byId('nogizakaPartyChart');
  const legend = byId('nogizakaPartyLegend');
  const endLabel = byId('nogizakaPartyChartEnd');
  if (!canvas || !legend || !endLabel) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const series = payload?.series?.[0];
  const points = Array.isArray(series?.points) ? series.points : [];
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = canvas.clientWidth || 960;
  const height = canvas.clientHeight || 360;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.height = `${height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  legend.replaceChildren();

  if (!points.length) {
    context.fillStyle = '#667287';
    context.font = '14px system-ui';
    context.textAlign = 'center';
    context.fillText('公式リスパ開始後に同接推移を表示します', width / 2, height / 2);
    endLabel.textContent = '-';
    return;
  }

  const maxMinute = Math.max(1, ...points.map((point) => finite(point?.[0]) || 0));
  const maxListenerValue = Math.max(1, ...points.map((point) => finite(point?.[1]) || 0));
  const maxListener = Math.max(50, Math.ceil(maxListenerValue / 50) * 50);
  const area = { left: 58, right: 18, top: 18, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const xFor = (minute) => area.left + area.width * Math.max(0, finite(minute) || 0) / maxMinute;
  const yFor = (listener) => area.top + area.height - area.height * Math.max(0, finite(listener) || 0) / maxListener;

  context.strokeStyle = 'rgba(31,45,68,.12)';
  context.fillStyle = '#667287';
  context.lineWidth = 1;
  context.font = '11px system-ui';
  for (let index = 0; index <= 4; index += 1) {
    const y = area.top + area.height * index / 4;
    context.beginPath();
    context.moveTo(area.left, y);
    context.lineTo(width - area.right, y);
    context.stroke();
    context.textAlign = 'right';
    context.fillText(integer.format(Math.round(maxListener * (1 - index / 4))), area.left - 8, y + 3);
  }
  const ticks = width < 560 ? 4 : 6;
  for (let index = 0; index <= ticks; index += 1) {
    const minute = Math.round(maxMinute * index / ticks);
    const x = xFor(minute);
    context.textAlign = index === 0 ? 'left' : index === ticks ? 'right' : 'center';
    context.fillText(integer.format(minute), x, area.top + area.height + 16);
  }
  context.textAlign = 'center';
  context.fillText('経過時間（分）', area.left + area.width / 2, height - 5);

  context.strokeStyle = '#000000';
  context.lineWidth = 2.4;
  context.beginPath();
  let opened = false;
  for (const point of points) {
    const minute = finite(point?.[0]);
    const listener = finite(point?.[1]);
    if (minute == null || listener == null) continue;
    if (!opened) context.moveTo(xFor(minute), yFor(listener));
    else context.lineTo(xFor(minute), yFor(listener));
    opened = true;
  }
  context.stroke();

  const marker = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.style.background = '#000000';
  marker.append(swatch, String(series?.event_name || '乃木坂46 公式リスパ'));
  legend.appendChild(marker);
  endLabel.textContent = `${payload?.collection_active ? '現在' : '最長'} ${durationLabel(maxMinute)}`;
}

function exportCsv() {
  const row = latestPayload?.row;
  if (!row) return;
  const identity = eventIdentity(row);
  const start = clock(row.started_at);
  const end = clock(row.ended_at);
  const values = [
    identity.date,
    start ? `${start}-${end || (latestPayload.collection_active ? '現在' : '—')}` : '—',
    durationLabel(durationMinutes(latestPayload)),
    row.listener_avg ?? '', row.listener_min ?? '', row.listener_max ?? '',
    row.distinct_tracks ?? '', row.estimated_streams ?? '', row.broadcast_content ?? '',
    identity.name, row.source_url ?? '',
  ];
  downloadCsv(
    `nogizaka-listening-party-${latestPayload.date || 'today'}.csv`,
    [OFFICIAL_PARTY_HEADERS, values],
    { quoteAll: false, trailingNewline: true },
  );
}

function render(payload) {
  latestPayload = payload;
  setNotice(payload);
  renderSummary(payload);
  renderTable(payload);
  drawChart(payload);
  scheduleRefresh(payload);
}

export async function loadNogizakaListeningPartyView({ force = false } = {}) {
  if (!active()) return;
  controller?.abort();
  controller = new AbortController();
  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      cache: force ? 'no-store' : 'default',
      headers: { accept: 'application/json' },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `API ${response.status}`);
    if (!active()) return;
    render(payload);
  } catch (error) {
    if (error?.name === 'AbortError' || !active()) return;
    const notice = byId('nogizakaListeningPartyNotice');
    if (notice) {
      notice.textContent = `データの取得に失敗しました：${error.message}`;
      notice.hidden = false;
      notice.classList.add('error');
    }
    scheduleRefresh({ refresh_hint_ms: MAX_REFRESH_MS });
  } finally {
    controller = null;
  }
}

byId('nogizakaPartyCsv')?.addEventListener('click', exportCsv);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clearRefresh();
  else if (active()) void loadNogizakaListeningPartyView({ force: true });
});
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (active() && latestPayload) drawChart(latestPayload);
  }, 120);
});
