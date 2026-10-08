// Normalized daily/weekly channel history table and chart.
import { appendEmptyTableRow, finiteNumber as finite } from '../dashboard-ui-common.js?v=20261004.1';
import { role, numberText, signedText, setText, DAY_MS } from './view-utils.js';
import { setupCanvas, drawGrid } from './chart-utils.js';
import { appendTableRow } from '../dashboard-table-dom.js?v=20261001.1';
import { downloadCsv } from '../csv-download.js?v=20261001.1';

const HISTORY_COLUMNS = ['日付', '平均同接', '最小', '最大', '開始再生', '終了再生', '増加', '開始メンバー', '終了メンバー', '増加'];

function historyRowCells(row) {
  return [row.period_key || '—',
    finite(row.listener_avg) == null ? '—' : Number(row.listener_avg).toFixed(1),
    numberText(row.listener_min), numberText(row.listener_max),
    numberText(row.stream_start), numberText(row.stream_end), signedText(row.stream_growth),
    numberText(row.member_start), numberText(row.member_end), signedText(row.member_growth)];
}

export function visibleHistoryRows(rows, range = 'all', offset = 0) {
  if (range === 'all' || !Array.isArray(rows) || !rows.length) return Array.isArray(rows) ? rows : [];
  const days = Number(range);
  if (![30, 180, 365].includes(days)) return rows;
  const latest = Date.parse(`${rows.at(-1)?.period_key}T00:00:00Z`);
  if (!Number.isFinite(latest)) return rows;
  const shiftedEnd = latest - Math.max(0, offset) * Math.max(1, Math.floor(days / 2)) * DAY_MS;
  const earliest = shiftedEnd - (days - 1) * DAY_MS;
  return rows.filter((row) => {
    const time = Date.parse(`${row.period_key}T00:00:00Z`);
    return Number.isFinite(time) && time >= earliest && time <= shiftedEnd;
  });
}

export function exportHistoryCsv(runtime) {
  const rows = runtime.historyVisibleRows || [];
  const mode = runtime.historyPayload?.mode === 'weekly' ? 'weekly' : 'daily';
  downloadCsv(`${runtime.model.source}-${mode}-${new Date().toISOString().slice(0, 10)}.csv`,
    [HISTORY_COLUMNS, ...[...rows].reverse().map(historyRowCells)]);
}

function setHistorySummary(runtime, rows, total) {
  const max = rows.map((row) => finite(row.listener_max)).filter((value) => value != null);
  const label = rows.length ? `${rows[0].period_key}〜${rows.at(-1).period_key}` : '—';
  setText(runtime.root, 'history-periods', label);
  setText(runtime.root, 'history-max', max.length ? numberText(Math.max(...max)) : '—');
  setText(runtime.root, 'history-streams', rows.some((row) => finite(row.stream_growth) != null) ? signedText(total('stream_growth')) : '—');
  setText(runtime.root, 'history-members', rows.some((row) => finite(row.member_growth) != null) ? signedText(total('member_growth')) : '—');
}

export function renderDaily(runtime, payload) {
  runtime.historyPayload = payload;
  const isWeekly = payload?.mode === 'weekly';
  setText(runtime.root, 'history-chart-title', isWeekly ? '週次推移' : '日次推移');
  setText(runtime.root, 'history-table-title', isWeekly ? '週次データ' : '日次データ');
  setText(runtime.root, 'history-period-column', isWeekly ? '週' : '日付');
  const allRows = Array.isArray(payload?.daily) ? payload.daily : [];
  const rows = visibleHistoryRows(allRows, runtime.historyRange || 'all', runtime.historyOffset || 0);
  runtime.historyVisibleRows = rows;
  const total = (key) => rows.reduce((sum, row) => {
    const value = finite(row?.[key]);
    return value == null ? sum : sum + value;
  }, 0);
  setHistorySummary(runtime, rows, total);
  const body = role(runtime.root, 'daily-tbody');
  if (body) { body.replaceChildren(); if (!rows.length) appendEmptyTableRow(body, isWeekly ? '週次データはまだありません。' : '日次データはまだありません。', 10); else for (const row of [...rows].reverse()) appendTableRow(body, historyRowCells(row)); }
  const canvas = role(runtime.root, 'daily-chart'); const prepared = setupCanvas(canvas, 360); if (!prepared) return; const { context, width, height } = prepared; const points = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.period_key || '') && finite(row.listener_avg) != null);
  if (!points.length) { context.fillStyle = '#667287'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '14px system-ui'; context.fillText(isWeekly ? '週次データがありません' : '日次データがありません', width / 2, height / 2); return; }
  const area = { left: 54, right: 42, top: 26, bottom: 42 }; area.width = width - area.left - area.right; area.height = height - area.top - area.bottom; const times = points.map((row) => Date.parse(`${row.period_key}T00:00:00Z`)); const minTime = times[0]; const maxTime = times.at(-1); const span = Math.max(DAY_MS, maxTime - minTime); const values = points.flatMap((row) => [finite(row.listener_avg), finite(row.listener_min), finite(row.listener_max)]).filter((value) => value != null); const minimum = Math.max(0, Math.floor(Math.min(...values) / 10) * 10); const maximum = Math.max(minimum + 10, Math.ceil(Math.max(...values) / 10) * 10); const x = (time) => area.left + area.width * (time - minTime) / span; const y = (value) => area.top + area.height - area.height * (value - minimum) / (maximum - minimum); drawGrid(context, width, area, maximum, minimum);
  const series = [['listener_min', '#2776b9'], ['listener_max', '#c56a18'], ['listener_avg', '#111']]; for (const [key, color] of series) { context.strokeStyle = color; context.lineWidth = key === 'listener_avg' ? 2.2 : 1.7; context.beginPath(); let started = false; points.forEach((row, index) => { const value = finite(row[key]); if (value == null) { started = false; return; } const px = x(times[index]); const py = y(value); if (!started) { context.moveTo(px, py); started = true; } else context.lineTo(px, py); }); context.stroke(); }
  const growths = points.map((row) => finite(row.stream_growth)).filter((value) => value != null && value >= 0); const growthMax = Math.max(1, ...growths); const slot = area.width / Math.max(1, points.length); context.fillStyle = 'rgba(22,139,115,.28)'; points.forEach((row, index) => { const value = finite(row.stream_growth); if (value == null || value < 0) return; const barHeight = area.height * value / growthMax; context.fillRect(x(times[index]) - Math.min(8, slot * .3), area.top + area.height - barHeight, Math.min(16, slot * .6), barHeight); });
  const legend = role(runtime.root, 'daily-legend'); if (legend) legend.textContent = '平均同接 / 最大同接 / 最小同接 / 再生数増加';
}
