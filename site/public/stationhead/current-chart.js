// Current online chart, yesterday overlay and pointer details.
import { finiteNumber as finite, integerFormat as integer } from '../dashboard-ui-common.js?v=20261004.1';
import { role, setText, numberText, DAY_MS, jstDateTime, jstTime } from './view-utils.js';
import { setupCanvas, drawGrid } from './chart-utils.js';
import { labelBox } from './chart-utils.js';

const FIVE_MINUTES_MS = 300_000;
const EXTREMA_POINT_COLOR = '#888';
const PREVIOUS_ONLINE_COLOR = '#969ca6';
const STREAM_BAR_COLOR = '#168b73';

function drawOnlineSeries(context, rows, x, y, color, width = 2) {
  context.strokeStyle = color; context.lineWidth = width; context.beginPath();
  let started = false; let previousAt = null;
  for (const row of rows) {
    const value = finite(row?.online_member_count); const observedAt = finite(row?.observed_at);
    if (value == null || observedAt == null || (previousAt != null && observedAt - previousAt > 20 * 60_000)) started = false;
    if (value == null || observedAt == null) { previousAt = observedAt; continue; }
    const px = x(observedAt); const py = y(value);
    if (!started) { context.moveTo(px, py); started = true; } else context.lineTo(px, py);
    previousAt = observedAt;
  }
  context.stroke();
}

function ensureCurrentLegend(root, canvas, hasPrevious, hasStreams) {
  let legend = role(root, 'live-legend');
  if (!legend && canvas) { legend = document.createElement('div'); legend.className = 'legend current-chart-legend'; legend.dataset.role = 'live-legend'; canvas.before(legend); }
  if (!legend) return;
  legend.replaceChildren();
  const entries = [['現在', '#111']];
  if (hasPrevious) entries.push(['24時間前', PREVIOUS_ONLINE_COLOR]);
  if (hasStreams) entries.push(['再生数増加', STREAM_BAR_COLOR]);
  entries.forEach(([label, color], index) => { if (index) legend.append(' / '); const span = document.createElement('span'); span.textContent = label; span.style.color = color; legend.append(span); });
}

function shiftedPreviousRows(payload, minTime, maxTime) {
  return (Array.isArray(payload?.previous_day_history) ? payload.previous_day_history : [])
    .map((row) => ({ observed_at: finite(row?.observed_at) == null ? null : finite(row.observed_at) + DAY_MS, online_member_count: finite(row?.online_member_count) }))
    .filter((row) => row.observed_at != null && row.online_member_count != null && row.observed_at >= minTime && row.observed_at <= maxTime)
    .sort((a, b) => a.observed_at - b.observed_at);
}

function nearestRow(rows, target, maxDistance = Infinity) {
  let selected = null; let distance = Infinity;
  for (const row of rows) { const observedAt = finite(row?.observed_at); if (observedAt == null) continue; const next = Math.abs(observedAt - target); if (next < distance) { selected = row; distance = next; } }
  return distance <= maxDistance ? selected : null;
}

export function renderCurrentDetail(runtime, event) {
  const rows = (Array.isArray(runtime.current?.history_24h) ? runtime.current.history_24h : []).filter((row) => finite(row?.observed_at) != null);
  const canvas = role(runtime.root, 'live-chart'); const bounds = canvas?.getBoundingClientRect();
  if (!rows.length || !canvas || !bounds || bounds.width <= 0) return;
  const area = { left: 54, right: 54 }; const plotWidth = Math.max(1, bounds.width - area.left - area.right);
  const minTime = Number(rows[0].observed_at); const maxTime = Number(rows.at(-1).observed_at); const span = Math.max(1, maxTime - minTime);
  const pointer = Math.max(area.left, Math.min(bounds.width - area.right, event.clientX - bounds.left));
  const target = minTime + span * (pointer - area.left) / plotWidth;
  const onlineRow = nearestRow(rows, target); const streamRow = nearestRow(rows.filter((row) => finite(row?.stream_delta_5m) != null), target, FIVE_MINUTES_MS / 2);
  if (!onlineRow) return;
  setText(runtime.root, 'live-detail', `${jstDateTime.format(new Date(streamRow?.observed_at ?? onlineRow.observed_at))} JST　オンライン ${numberText(onlineRow.online_member_count)}人${streamRow ? `　再生数増加 +${numberText(streamRow.stream_delta_5m)}` : ''}`);
}

export function renderCurrentChart(runtime, payload) {
  const { root } = runtime; const canvas = role(root, 'live-chart');
  const rows = (Array.isArray(payload?.history_24h) ? payload.history_24h : []).filter((row) => finite(row?.observed_at) != null).sort((a, b) => a.observed_at - b.observed_at);
  const prepared = setupCanvas(canvas, 360); if (!prepared) return; const { context, width, height } = prepared;
  if (!rows.length) { context.fillStyle = '#667287'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '14px system-ui'; context.fillText('履歴データがありません', width / 2, height / 2); setText(root, 'live-detail', ''); ensureCurrentLegend(root, canvas, false, false); return; }
  const area = { left: 54, right: 54, top: 30, bottom: 42 }; area.width = width - area.left - area.right; area.height = height - area.top - area.bottom;
  const minTime = Number(rows[0].observed_at); const maxTime = Number(rows.at(-1).observed_at); const span = Math.max(FIVE_MINUTES_MS, maxTime - minTime);
  const previous = shiftedPreviousRows(payload, minTime, maxTime); const online = [...rows, ...previous].map((row) => finite(row.online_member_count)).filter((value) => value != null);
  const rawMin = online.length ? Math.min(...online) : 0; const rawMax = online.length ? Math.max(...online) : 10; const padding = Math.max(1, (rawMax - rawMin) * .06);
  const minimum = Math.max(0, Math.floor((rawMin - padding) / 10) * 10); const maximum = Math.max(minimum + 10, Math.ceil((rawMax + padding) / 10) * 10);
  const x = (time) => area.left + area.width * (Number(time) - minTime) / span; const y = (value) => area.top + area.height - area.height * (Number(value) - minimum) / Math.max(1, maximum - minimum);
  drawGrid(context, width, area, maximum, minimum);
  const deltas = rows.map((row) => finite(row.stream_delta_5m)).filter((value) => value != null && value >= 0); const deltaMax = Math.max(1, ...deltas);
  context.fillStyle = STREAM_BAR_COLOR; context.globalAlpha = .34; const barWidth = Math.max(1, Math.min(6, area.width * FIVE_MINUTES_MS / Math.max(DAY_MS, span) * .82));
  for (const row of rows) { const value = finite(row.stream_delta_5m); if (value == null || value < 0) continue; const bar = area.height * value / deltaMax; context.fillRect(x(row.observed_at) - barWidth / 2, area.top + area.height - bar, barWidth, bar); }
  context.globalAlpha = 1; drawOnlineSeries(context, previous, x, y, PREVIOUS_ONLINE_COLOR, 2); drawOnlineSeries(context, rows, x, y, '#111', 2);
  context.fillStyle = '#667287'; context.font = '11px system-ui'; context.textAlign = 'center'; context.textBaseline = 'alphabetic';
  for (let index = 0; index < 5; index += 1) { const time = minTime + span * index / 4; context.fillText(jstTime.format(new Date(time)), x(time), height - 14); }
  context.textAlign = 'left'; context.fillText('オンライン数（人）', 4, 12); context.textAlign = 'right'; context.fillText('再生数増加', width - 4, 12); context.textAlign = 'center'; context.fillText('時刻（JST）', width / 2, height - 2);
  const currentOnline = rows.filter((row) => finite(row.online_member_count) != null);
  if (currentOnline.length) {
    const minRow = currentOnline.reduce((selected, row) => finite(row.online_member_count) < finite(selected.online_member_count) ? row : selected);
    const maxRow = currentOnline.reduce((selected, row) => finite(row.online_member_count) > finite(selected.online_member_count) ? row : selected);
    for (const [row, label, align, dx, dy] of [[minRow, '最小', 'left', 5, 14], [maxRow, '最大', 'right', -5, -14]]) { const value = finite(row.online_member_count); context.fillStyle = EXTREMA_POINT_COLOR; context.beginPath(); context.arc(x(row.observed_at), y(value), 3, 0, Math.PI * 2); context.fill(); labelBox(context, `${label} ${integer.format(Math.round(value))}（${jstTime.format(new Date(row.observed_at))}）`, x(row.observed_at) + dx, y(value) + dy, align, width, height); }
  }
  ensureCurrentLegend(root, canvas, previous.length > 0, deltas.length > 0);
  const latest = rows.at(-1); setText(root, 'live-detail', `${jstDateTime.format(new Date(latest.observed_at))} JST　オンライン ${numberText(latest.online_member_count)}人　再生数増加 ${latest.stream_delta_5m == null ? '—' : `+${numberText(latest.stream_delta_5m)}`}/5分`);
}
