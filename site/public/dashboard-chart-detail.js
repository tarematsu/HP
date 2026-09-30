import { finiteNumber as finite, integerFormat as integer } from './dashboard-ui-common.js?v=20260930.1';

const DAY_MS = 86_400_000;
const FIVE_MINUTE_MS = 5 * 60_000;
const jstChartDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
let rows = [];
let streamRows = [];

const numberText = (value) => finite(value) == null ? '—' : integer.format(Number(value));

function normalizeHistory(history) {
  const list = Array.isArray(history) ? history : [];
  const latest = list.reduce((maximum, row) => Math.max(maximum, finite(row?.observed_at) || 0), 0);
  if (!latest) return [];
  const cutoff = latest - DAY_MS;
  const byTime = new Map();
  for (const row of list) {
    const observedAt = finite(row?.observed_at);
    if (observedAt == null || observedAt < cutoff || observedAt > latest) continue;
    byTime.set(observedAt, {
      observed_at: observedAt,
      online_member_count: finite(row.online_member_count),
    });
  }
  return [...byTime.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function normalizeStreamHistory(history) {
  const byTime = new Map();
  for (const row of Array.isArray(history) ? history : []) {
    const observedAt = finite(row?.observed_at);
    const streamDelta = finite(row?.stream_delta);
    if (observedAt == null || streamDelta == null || streamDelta < 0) continue;
    byTime.set(observedAt, { observed_at: observedAt, stream_delta: streamDelta });
  }
  return [...byTime.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function nearestRow(list, target, maxDistance = Infinity) {
  let selected = null;
  let distance = Infinity;
  for (const row of list) {
    const next = Math.abs(row.observed_at - target);
    if (next < distance) {
      distance = next;
      selected = row;
    }
  }
  return distance <= maxDistance ? selected : null;
}

function selectPoint(event) {
  if (!rows.length) return;
  const canvas = document.getElementById('audienceChart');
  const bounds = canvas?.getBoundingClientRect();
  if (!canvas || !bounds || bounds.width <= 0) return;
  const minTime = rows[0].observed_at;
  const maxTime = rows.at(-1).observed_at;
  const span = Math.max(1, maxTime - minTime);
  const padding = { left: 50, right: 24 };
  const plotWidth = Math.max(1, bounds.width - padding.left - padding.right);
  const pointer = Math.max(padding.left, Math.min(bounds.width - padding.right, event.clientX - bounds.left));
  const targetTime = minTime + span * (pointer - padding.left) / plotWidth;
  const onlineRow = nearestRow(rows, targetTime);
  const streamRow = nearestRow(streamRows, targetTime, FIVE_MINUTE_MS / 2);
  if (!onlineRow) return;
  const displayTime = streamRow?.observed_at ?? onlineRow.observed_at;
  const detail = document.getElementById('currentChartDetail');
  if (detail) {
    const streamText = streamRow
      ? `　再生数 +${numberText(streamRow.stream_delta)}`
      : '';
    detail.textContent = `${jstChartDateTime.format(new Date(displayTime))} JST　オンライン数 ${numberText(onlineRow.online_member_count)}人${streamText}`;
  }
}

window.addEventListener('dashboard:payload', (event) => {
  const payload = event?.detail?.payload;
  if (!payload?.ok) return;
  const nextRows = normalizeHistory(payload.history);
  if (nextRows.length) rows = nextRows;
  if (Array.isArray(payload.stream_5m_history)) {
    const nextStreamRows = normalizeStreamHistory(payload.stream_5m_history);
    if (nextStreamRows.length || payload.stream_5m_history.length === 0) streamRows = nextStreamRows;
  }
  const legend = document.querySelector('#currentView .stream-growth-key');
  if (legend) legend.textContent = '再生数';
});
document.getElementById('audienceChart')?.addEventListener('pointerup', selectPoint, true);
