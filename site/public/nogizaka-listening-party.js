import {
  appendEmptyTableRow,
  decimalOneFormat as decimal,
  finiteNumber as finite,
  integerFormat as integer,
} from './dashboard-ui-common.js?v=20260930.1';
import {
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
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

let latestPayload = null;
let refreshTimer = 0;
let controller = null;
let resizeTimer = 0;

const byId = (id) => document.getElementById(id);
const active = () => byId('nogizakaListeningPartyView')?.hidden === false;

function epoch(value) {
  const parsed = finite(value);
  if (parsed == null || parsed <= 0) return null;
  return parsed < 100_000_000_000 ? parsed * 1000 : parsed;
}

function clock(value) {
  const timestamp = epoch(value);
  return timestamp == null ? null : jstTime.format(new Date(timestamp)).replace(/\s+/g, '');
}

function payloadRows(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  return payload?.row ? [payload.row] : [];
}

function durationMinutes(payload, row = payload?.row) {
  const start = epoch(row?.started_at);
  const end = epoch(row?.ended_at);
  if (start != null && end != null && end >= start) return (end - start) / 60_000;
  if (row !== payload?.row) return null;
  const points = payload?.series?.[0]?.points || [];
  const last = finite(points.at(-1)?.[0]);
  return last == null ? null : last;
}

function mean(values) {
  const numbers = values.map(finite).filter((value) => value != null);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
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

function renderSummary(payload) {
  const rows = payloadRows(payload);
  const listenerAverage = mean(rows.map((row) => row?.listener_avg));
  const maximums = rows.map((row) => finite(row?.listener_max)).filter((value) => value != null);
  const durationAverage = mean(rows.map((row) => durationMinutes(payload, row)));
  byId('nogizakaPartyPeriods').textContent = integer.format(rows.length);
  byId('nogizakaPartyAverage').textContent = officialPartyNumberText(listenerAverage, decimal);
  byId('nogizakaPartyMaximum').textContent = officialPartyNumberText(maximums.length ? Math.max(...maximums) : null, integer);
  byId('nogizakaPartyDuration').textContent = durationLabel(durationAverage);
}

function eventIdentity(row) {
  const startedAt = epoch(row?.started_at);
  return splitOfficialEventName(row?.event_name, {
    defaultName: '乃木坂46 公式リスパ',
    fallbackDate: startedAt == null ? '—' : jstDate.format(new Date(startedAt)),
  });
}

function tableValues(payload, row) {
  const identity = eventIdentity(row);
  const start = clock(row?.started_at);
  const end = clock(row?.ended_at);
  const isLive = row === payload?.row && payload?.collection_active;
  return [
    identity.date,
    start ? `${start}-${end || (isLive ? '現在' : '—')}` : '—',
    durationLabel(durationMinutes(payload, row)),
    officialPartyNumberText(row?.listener_avg, decimal),
    officialPartyNumberText(row?.listener_min, decimal),
    officialPartyNumberText(row?.listener_max, decimal),
    officialPartyNumberText(row?.distinct_tracks, integer),
    officialPartyNumberText(row?.estimated_streams, integer),
    String(row?.broadcast_content || '—'),
    identity.name,
  ];
}

function renderTable(payload) {
  const head = byId('nogizakaPartyThead');
  const body = byId('nogizakaPartyTbody');
  if (!head || !body) return;
  head.replaceChildren(createOfficialPartyHeaderRow());

  const rows = payloadRows(payload);
  if (!rows.length) {
    appendEmptyTableRow(body, 'データがありません。', OFFICIAL_PARTY_HEADERS.length, { replace: true });
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of rows) fragment.append(createOfficialPartyDataRow(tableValues(payload, row), row?.source_url));
  body.replaceChildren(fragment);
}

function drawChart(payload) {
  const canvas = byId('nogizakaPartyChart');
  const legend = byId('nogizakaPartyLegend');
  const endLabel = byId('nogizakaPartyChartEnd');
  if (!canvas || !legend || !endLabel) return;
  const series = payload?.series?.[0];
  const points = Array.isArray(series?.points) ? series.points : [];
  const empty = byId('nogizakaPartyChartEmpty');
  const axis = byId('nogizakaPartyChartAxis');
  canvas.hidden = !points.length;
  if (empty) empty.hidden = Boolean(points.length);
  if (axis) axis.hidden = !points.length;
  legend.replaceChildren();
  if (!points.length) {
    endLabel.textContent = '-';
    return;
  }

  const measuredWidth = Math.max(320, Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 960));
  const targetHeight = Math.max(260, Math.round(canvas.clientHeight || 360));
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 260,
    fallbackWidth: measuredWidth,
    height: targetHeight,
  });
  if (!prepared) return;
  const { context, width, height } = prepared;

  const maxMinute = Math.max(1, ...points.map((point) => finite(point?.[0]) || 0));
  const maxListenerValue = Math.max(1, ...points.map((point) => finite(point?.[1]) || 0));
  const maxListener = Math.max(50, Math.ceil(maxListenerValue / 50) * 50);
  const area = { left: 58, right: 18, top: 18, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const xFor = (minute) => area.left + area.width * Math.max(0, finite(minute) || 0) / maxMinute;
  const yFor = (listener) => area.top + area.height - area.height * Math.max(0, finite(listener) || 0) / maxListener;

  context.fillStyle = '#667287';
  context.font = '11px system-ui';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: area.left,
    right: area.right,
    top: area.top,
    height: area.height,
    width,
  })) {
    context.textAlign = 'right';
    context.fillText(integer.format(Math.round(maxListener * (1 - ratio))), area.left - 8, y + 3);
  }

  const ticks = width < 560 ? 4 : 6;
  const tickPositions = Array.from({ length: ticks + 1 }, (_, index) => xFor(Math.round(maxMinute * index / ticks)));
  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions: tickPositions,
    indexes: tickPositions.map((_, index) => index),
    labelFor: (index) => integer.format(Math.round(maxMinute * index / ticks)),
    fillStyle: '#667287',
  });
  context.fillStyle = '#667287';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillText('経過時間（分）', area.left + area.width / 2, height - 5);

  const rows = points.map((point) => ({ minute: finite(point?.[0]), listener: finite(point?.[1]) }));
  drawDashboardLine(context, rows, {
    x: (row) => xFor(row.minute),
    y: (value) => yFor(value),
    value: (row) => row.listener,
    valid: (value) => value != null,
    strokeStyle: '#000000',
    lineWidth: 2.4,
  });

  const marker = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.style.background = '#000000';
  marker.append(swatch, String(series?.event_name || '乃木坂46 公式リスパ'));
  legend.appendChild(marker);
  endLabel.textContent = `${payload?.collection_active ? '現在' : '最長'} ${durationLabel(maxMinute)}`;
}

function exportCsv() {
  const rows = payloadRows(latestPayload);
  if (!rows.length) return;
  const body = rows.map((row) => [...tableValues(latestPayload, row), row?.source_url ?? '']);
  downloadCsv(
    'nogizaka-listening-party.csv',
    [OFFICIAL_PARTY_HEADERS, ...body],
    { quoteAll: false, trailingNewline: true },
  );
}

function render(payload) {
  latestPayload = payload;
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
    const body = byId('nogizakaPartyTbody');
    if (body && !body.childElementCount) {
      appendEmptyTableRow(body, `データの取得に失敗しました：${error.message}`, OFFICIAL_PARTY_HEADERS.length, { replace: true });
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
