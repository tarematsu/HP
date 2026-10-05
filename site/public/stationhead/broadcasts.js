// Listening-party summary, comparison series and selected-event chart.
import { appendEmptyTableRow, finiteNumber as finite } from '../dashboard-ui-common.js?v=20261004.1';
import { role, setText, numberText, colorFor, jstDate, jstTime } from './view-utils.js';
import { setupCanvas, drawGrid } from './chart-utils.js';
import { appendTableRow } from '../dashboard-table-dom.js?v=20261001.1';
import { renderSeriesSelector, visibleSeries } from '../dashboard-series-selector.js';

function epoch(value) { const number = finite(value); if (number == null) return null; return number < 100_000_000_000 ? number * 1000 : number; }

export function broadcastDuration(row) { const start = epoch(row?.started_at); const end = epoch(row?.ended_at); return start != null && end != null && end >= start ? (end - start) / 60_000 : null; }

export function broadcastSeries(payload) { return (Array.isArray(payload?.series) ? payload.series : []).map((item, index) => ({ id: `event-${index}`, name: item?.event_name || `イベント${index + 1}`, label: item?.event_name || `イベント${index + 1}`, color: colorFor(index), points: (Array.isArray(item?.points) ? item.points : []).map((point) => [finite(point?.[0]), finite(point?.[1])]).filter(([x, y]) => x != null && y != null) })).filter((item) => item.points.length); }

function renderBroadcastChart(runtime, payload, series = broadcastSeries(payload), rebuildSelector = true) {
  const canvas = role(runtime.root, 'broadcast-chart'); const empty = role(runtime.root, 'broadcast-chart-empty'); const options = role(runtime.root, 'broadcast-series-options'); const legend = role(runtime.root, 'broadcast-legend');
  if (rebuildSelector) renderSeriesSelector({ optionsContainer: options, legendContainer: legend, items: series, hidden: runtime.hiddenBroadcastSeries, onChange: () => renderBroadcastChart(runtime, payload, series, false) });
  else renderSeriesSelector({ legendContainer: legend, items: series, hidden: runtime.hiddenBroadcastSeries });
  const visible = visibleSeries(series, runtime.hiddenBroadcastSeries);
  if (!visible.length) { if (canvas) canvas.hidden = true; if (empty) { empty.hidden = false; empty.textContent = series.length ? '表示するイベントを選択してください。' : payload.chart_error ? 'グラフの取得に失敗しました。画面を開き直してください。' : 'グラフデータがありません。'; } return; }
  if (canvas) canvas.hidden = false; if (empty) empty.hidden = true; const prepared = setupCanvas(canvas, 360); if (!prepared) return; const { context, width, height } = prepared; const allPoints = visible.flatMap((item) => item.points); const area = { left: 54, right: 24, top: 24, bottom: 42 }; area.width = width - area.left - area.right; area.height = height - area.top - area.bottom; const maxX = Math.max(1, ...allPoints.map((point) => point[0])); const maxY = Math.max(10, ...allPoints.map((point) => point[1])); const x = (value) => area.left + area.width * value / maxX; const y = (value) => area.top + area.height - area.height * value / maxY; drawGrid(context, width, area, maxY, 0);
  visible.forEach((item) => { context.strokeStyle = item.color; context.lineWidth = 2; context.beginPath(); item.points.forEach(([px, py], index) => index ? context.lineTo(x(px), y(py)) : context.moveTo(x(px), y(py))); context.stroke(); });
  context.fillStyle = '#667287'; context.font = '11px system-ui'; context.textAlign = 'center'; context.textBaseline = 'alphabetic'; for (let index = 0; index < 5; index += 1) { const minute = maxX * index / 4; context.fillText(`${Math.round(minute)}分`, x(minute), height - 14); }
}

export function renderBroadcasts(runtime, payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : []; setText(runtime.root, 'broadcast-count', numberText(rows.length)); const averages = rows.map((row) => finite(row.listener_avg)).filter((value) => value != null); setText(runtime.root, 'broadcast-average', averages.length ? Number(averages.reduce((a, b) => a + b, 0) / averages.length).toFixed(1) : '—'); const maximums = rows.map((row) => finite(row.listener_max)).filter((value) => value != null); setText(runtime.root, 'broadcast-maximum', maximums.length ? numberText(Math.max(...maximums)) : '—'); const durations = rows.map(broadcastDuration).filter((value) => value != null); setText(runtime.root, 'broadcast-duration', durations.length ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}分` : '—');
  const body = role(runtime.root, 'broadcast-tbody'); if (body) { body.replaceChildren(); if (!rows.length) appendEmptyTableRow(body, 'リスパデータがありません。', 10); else for (const row of rows) { const start = epoch(row.started_at); const end = epoch(row.ended_at); appendTableRow(body, [start ? jstDate.format(new Date(start)) : '—', start ? `${jstTime.format(new Date(start))}-${end ? jstTime.format(new Date(end)) : payload.collection_active ? '現在' : '—'}` : '—', broadcastDuration(row) == null ? '—' : `${Math.round(broadcastDuration(row))}分`, finite(row.listener_avg) == null ? '—' : Number(row.listener_avg).toFixed(1), numberText(row.listener_min), numberText(row.listener_max), numberText(row.distinct_tracks), numberText(row.estimated_streams), { text: row.broadcast_content || '—', className: 'secondary-column' }, row.event_name || '—']); } }
  runtime.broadcastPayload = payload; renderBroadcastChart(runtime, payload);
}
