// Song aggregation, period selection and playback-count presentation.
import { appendEmptyTableRow, finiteNumber as finite } from '../dashboard-ui-common.js?v=20261004.1';
import { role, setText, numberText, weekStart, shortDate, addDays } from './view-utils.js';
import { setupCanvas } from './chart-utils.js';
import { appendTableRow } from '../dashboard-table-dom.js?v=20261001.1';

export function trackIdentity(row) { return row?.track_id ? `track:${row.track_id}` : row?.spotify_id ? `spotify:${row.spotify_id}` : `${String(row?.title || '').normalize('NFKC')}\u0000${String(row?.artist || '').normalize('NFKC')}`; }

export function aggregatePlayed(rows) { const map = new Map(); for (const row of Array.isArray(rows) ? rows : []) { const count = Math.max(0, finite(row?.play_count) || 0); if (!count) continue; const key = trackIdentity(row); const current = map.get(key); if (current) current.play_count += count; else map.set(key, { ...row, play_count: count }); } return [...map.values()].sort((a, b) => b.play_count - a.play_count || String(a.title || '').localeCompare(String(b.title || ''), 'ja')); }

export function playedChartRows(tracks) { const top = tracks.slice(0, 15).map((row) => ({ ...row, label: row.title || '曲名不明' })); const other = tracks.slice(15).reduce((sum, row) => sum + row.play_count, 0); if (other) top.push({ label: 'その他', play_count: other }); return top; }

export function renderPlayed(runtime, rows) {
  const tracks = aggregatePlayed(rows); const total = tracks.reduce((sum, row) => sum + row.play_count, 0); setText(runtime.root, 'played-total', numberText(total)); setText(runtime.root, 'played-unique', numberText(tracks.length));
  const body = role(runtime.root, 'played-tbody'); if (body) { body.replaceChildren(); if (!tracks.length) appendEmptyTableRow(body, '再生履歴データがありません。', 3); else tracks.forEach((row) => appendTableRow(body, [`${row.title || '曲名不明'}${row.artist ? ` / ${row.artist}` : ''}`, numberText(row.play_count), total ? `${(row.play_count / total * 100).toFixed(1)}%` : '—'])); }
  const canvas = role(runtime.root, 'played-chart'); const prepared = setupCanvas(canvas, 420); if (!prepared) return; const { context, width, height } = prepared;
  if (!total) { context.fillStyle = '#667287'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '14px system-ui'; context.fillText('再生履歴データがありません', width / 2, height / 2); return; }
  const chartRows = playedChartRows(tracks); const left = width < 520 ? 118 : 180; const right = 58; const top = 12; const bottom = 12; const availableHeight = height - top - bottom; const slot = availableHeight / Math.max(1, chartRows.length); const barHeight = Math.max(8, Math.min(18, slot * .6)); const maximum = Math.max(1, ...chartRows.map((row) => row.play_count));
  context.font = '11px system-ui'; context.textBaseline = 'middle';
  chartRows.forEach((row, index) => { const y = top + slot * (index + .5); const widthValue = Math.max(1, (width - left - right) * row.play_count / maximum); const label = String(row.label).length > 20 ? `${String(row.label).slice(0, 19)}…` : String(row.label); context.fillStyle = '#667287'; context.textAlign = 'right'; context.fillText(label, left - 8, y); context.fillStyle = '#111'; context.fillRect(left, y - barHeight / 2, widthValue, barHeight); context.textAlign = 'left'; context.fillText(numberText(row.play_count), Math.min(width - right + 4, left + widthValue + 5), y); });
}

export async function loadPlayed(runtime, { force = false } = {}) {
  const sequence = ++runtime.playedSequence; const current = () => sequence === runtime.playedSequence && runtime.section === 'played-tracks' && !runtime.root.hidden;
  if (!runtime.playedDates.length || force) runtime.playedDates = await runtime.model.loadPlayedIndex({ force }); if (!current()) return;
  const week = Boolean(role(runtime.root, 'played-week')?.checked); const periods = week ? [...new Set(runtime.playedDates.map(weekStart).filter(Boolean))] : runtime.playedDates; if (!runtime.playedPeriod || !periods.includes(runtime.playedPeriod)) runtime.playedPeriod = periods.at(-1) || '';
  const strip = role(runtime.root, 'played-periods'); if (strip) { strip.replaceChildren(); for (const period of periods) { const button = document.createElement('button'); button.type = 'button'; button.className = `played-tracks-period${period === runtime.playedPeriod ? ' is-selected' : ''}`; button.dataset.period = period; button.textContent = `${shortDate(period)}${week ? ' (週)' : ''}`; button.addEventListener('click', async () => { runtime.playedPeriod = period; await loadPlayed(runtime); }); strip.append(button); } }
  if (!runtime.playedPeriod) { renderPlayed(runtime, []); return; } const from = runtime.playedPeriod; const to = week ? addDays(from, 6) : from; const nextRows = await runtime.model.loadPlayedPeriod(from, to, { force }); if (current()) renderPlayed(runtime, nextRows);
}
