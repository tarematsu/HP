import { ensureDashboardSectionStyles } from './dashboard-styles.js?v=20261005.2';
import { appendEmptyTableRow, finiteNumber as finite, integerFormat as integer } from './dashboard-ui-common.js?v=20261004.1';
import { prepareDashboardCanvas } from './dashboard-chart-canvas.js?v=20261001.2';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import { downloadCsv } from './csv-download.js?v=20261001.1';
import { stationheadChannelReadModel, DAY_MS } from './stationhead-channel-read-model.js?v=20261005.3';

const FIVE_MINUTES_MS = 300_000;
const EXTREMA_POINT_COLOR = '#888';
const PREVIOUS_ONLINE_COLOR = '#969ca6';
const STREAM_BAR_COLOR = '#168b73';
const jstDateTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const jstDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
const jstTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const MEDALS = ['🥇', '🥈', '🥉'];
const runtimes = new WeakMap();

function role(root, name) { return root.querySelector(`[data-role="${name}"]`); }
function numberText(value) { const n = finite(value); return n == null ? '—' : integer.format(Math.round(n)); }
function signedText(value) { const n = finite(value); return n == null ? '—' : `${n >= 0 ? '+' : ''}${integer.format(Math.round(n))}`; }
function setText(root, name, value) { const node = role(root, name); if (node) node.textContent = String(value); }
function setNotice(root, text = '', error = false) { const node = role(root, 'notice'); if (!node) return; node.textContent = text; node.hidden = !text; node.classList.toggle('error', Boolean(error)); }
function dateKey(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''; }
function parseDate(value) { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) ? date : null; }
function addDays(value, days) { const date = parseDate(value); if (!date) return ''; date.setUTCDate(date.getUTCDate() + days); return dateKey(date); }
function weekStart(value) { const date = parseDate(value); if (!date) return ''; date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return dateKey(date); }
function shortDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); return match ? `${Number(match[2])}/${Number(match[3])}` : String(value || ''); }

function setupCanvas(canvas, fallbackHeight = 360) {
  if (!canvas) return null;
  const width = Math.max(320, Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 960));
  return prepareDashboardCanvas(canvas, { minimumWidth: 320, minimumHeight: 240, fallbackWidth: width, height: Math.max(260, fallbackHeight) });
}

function drawGrid(context, width, height, area, maximum, minimum = 0) {
  context.strokeStyle = 'rgba(100,110,125,.18)';
  context.fillStyle = '#667287';
  context.font = '11px system-ui';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const y = area.top + area.height * ratio;
    context.beginPath(); context.moveTo(area.left, y); context.lineTo(width - area.right, y); context.stroke();
    context.fillText(integer.format(Math.round(maximum - (maximum - minimum) * ratio)), area.left - 6, y);
  }
}

function labelBox(context, text, x, y, align, width, height) {
  context.save();
  context.font = '600 11px system-ui';
  const textWidth = context.measureText(text).width;
  const boxWidth = textWidth + 10;
  const boxHeight = 18;
  let left = align === 'right' ? x - boxWidth : x;
  left = Math.max(2, Math.min(width - boxWidth - 2, left));
  const top = Math.max(2, Math.min(height - boxHeight - 2, y - boxHeight / 2));
  context.fillStyle = 'rgba(255,255,255,.92)';
  context.fillRect(left, top, boxWidth, boxHeight);
  context.fillStyle = '#111';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(text, left + 5, top + boxHeight / 2);
  context.restore();
}

function drawOnlineSeries(context, rows, x, y, color, width = 2) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  let started = false;
  let previousAt = null;
  for (const row of rows) {
    const value = finite(row?.online_member_count);
    const observedAt = finite(row?.observed_at);
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
  if (!legend && canvas) {
    legend = document.createElement('div');
    legend.className = 'legend current-chart-legend';
    legend.dataset.role = 'live-legend';
    canvas.before(legend);
  }
  if (!legend) return;
  legend.replaceChildren();
  const entries = [['現在', '#111']];
  if (hasPrevious) entries.push(['24時間前', PREVIOUS_ONLINE_COLOR]);
  if (hasStreams) entries.push(['再生数増加', STREAM_BAR_COLOR]);
  entries.forEach(([label, color], index) => {
    if (index) legend.append(' / ');
    const span = document.createElement('span'); span.textContent = label; span.style.color = color; legend.append(span);
  });
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

function renderCurrentDetail(runtime, event) {
  const rows = (Array.isArray(runtime.current?.history_24h) ? runtime.current.history_24h : []).filter((row) => finite(row?.observed_at) != null);
  if (!rows.length) return;
  const canvas = role(runtime.root, 'live-chart'); const bounds = canvas?.getBoundingClientRect();
  if (!canvas || !bounds || bounds.width <= 0) return;
  const area = { left: 54, right: 54 }; const plotWidth = Math.max(1, bounds.width - area.left - area.right);
  const minTime = Number(rows[0].observed_at); const maxTime = Number(rows.at(-1).observed_at); const span = Math.max(1, maxTime - minTime);
  const pointer = Math.max(area.left, Math.min(bounds.width - area.right, event.clientX - bounds.left));
  const target = minTime + span * (pointer - area.left) / plotWidth;
  const onlineRow = nearestRow(rows, target); const streamRow = nearestRow(rows.filter((row) => finite(row?.stream_delta_5m) != null), target, FIVE_MINUTES_MS / 2);
  if (!onlineRow) return;
  setText(runtime.root, 'live-detail', `${jstDateTime.format(new Date(streamRow?.observed_at ?? onlineRow.observed_at))} JST　オンライン ${numberText(onlineRow.online_member_count)}人${streamRow ? `　再生数増加 +${numberText(streamRow.stream_delta_5m)}` : ''}`);
}

function renderCurrentChart(runtime, payload) {
  const { root } = runtime;
  const canvas = role(root, 'live-chart');
  const rows = (Array.isArray(payload?.history_24h) ? payload.history_24h : []).filter((row) => finite(row?.observed_at) != null).sort((a, b) => a.observed_at - b.observed_at);
  const prepared = setupCanvas(canvas, 360);
  if (!prepared) return;
  const { context, width, height } = prepared;
  if (!rows.length) {
    context.fillStyle = '#667287'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '14px system-ui'; context.fillText('履歴データがありません', width / 2, height / 2);
    setText(root, 'live-detail', ''); ensureCurrentLegend(root, canvas, false, false); return;
  }
  const area = { left: 54, right: 54, top: 30, bottom: 42 }; area.width = width - area.left - area.right; area.height = height - area.top - area.bottom;
  const minTime = Number(rows[0].observed_at); const maxTime = Number(rows.at(-1).observed_at); const span = Math.max(FIVE_MINUTES_MS, maxTime - minTime);
  const previous = shiftedPreviousRows(payload, minTime, maxTime);
  const online = [...rows, ...previous].map((row) => finite(row.online_member_count)).filter((value) => value != null);
  const rawMin = online.length ? Math.min(...online) : 0; const rawMax = online.length ? Math.max(...online) : 10; const padding = Math.max(1, (rawMax - rawMin) * .06);
  const min = Math.max(0, Math.floor((rawMin - padding) / 10) * 10); const max = Math.max(min + 10, Math.ceil((rawMax + padding) / 10) * 10);
  const x = (time) => area.left + area.width * (Number(time) - minTime) / span; const y = (value) => area.top + area.height - area.height * (Number(value) - min) / Math.max(1, max - min);
  drawGrid(context, width, height, area, max, min);
  const deltas = rows.map((row) => finite(row.stream_delta_5m)).filter((value) => value != null && value >= 0); const deltaMax = Math.max(1, ...deltas);
  context.fillStyle = STREAM_BAR_COLOR; context.globalAlpha = .34;
  const barWidth = Math.max(1, Math.min(6, area.width * FIVE_MINUTES_MS / Math.max(DAY_MS, span) * .82));
  for (const row of rows) { const value = finite(row.stream_delta_5m); if (value == null || value < 0) continue; const bar = area.height * value / deltaMax; context.fillRect(x(row.observed_at) - barWidth / 2, area.top + area.height - bar, barWidth, bar); }
  context.globalAlpha = 1;
  drawOnlineSeries(context, previous, x, y, PREVIOUS_ONLINE_COLOR, 2);
  drawOnlineSeries(context, rows, x, y, '#111', 2);
  context.fillStyle = '#667287'; context.font = '11px system-ui'; context.textAlign = 'center'; context.textBaseline = 'alphabetic';
  for (let i = 0; i < 5; i += 1) { const time = minTime + span * i / 4; context.fillText(jstTime.format(new Date(time)), x(time), height - 14); }
  context.textAlign = 'left'; context.fillText('オンライン数（人）', 4, 12); context.textAlign = 'right'; context.fillText('再生数増加', width - 4, 12); context.textAlign = 'center'; context.fillText('時刻（JST）', width / 2, height - 2);
  const currentOnline = rows.filter((row) => finite(row.online_member_count) != null); if (currentOnline.length) {
    const minRow = currentOnline.reduce((selected, row) => finite(row.online_member_count) < finite(selected.online_member_count) ? row : selected);
    const maxRow = currentOnline.reduce((selected, row) => finite(row.online_member_count) > finite(selected.online_member_count) ? row : selected);
    for (const [row, label, align, dx, dy] of [[minRow, '最小', 'left', 5, 14], [maxRow, '最大', 'right', -5, -14]]) {
      const value = finite(row.online_member_count); context.fillStyle = EXTREMA_POINT_COLOR; context.beginPath(); context.arc(x(row.observed_at), y(value), 3, 0, Math.PI * 2); context.fill(); labelBox(context, `${label} ${integer.format(Math.round(value))}（${jstTime.format(new Date(row.observed_at))}）`, x(row.observed_at) + dx, y(value) + dy, align, width, height);
    }
  }
  ensureCurrentLegend(root, canvas, previous.length > 0, deltas.length > 0);
  const latest = rows.at(-1); setText(root, 'live-detail', `${jstDateTime.format(new Date(latest.observed_at))} JST　オンライン ${numberText(latest.online_member_count)}人　再生数増加 ${latest.stream_delta_5m == null ? '—' : `+${numberText(latest.stream_delta_5m)}`}/5分`);
}

function reducedImage(source) { return String(source || '').trim(); }
function trackArtist(track) { return String(track?.artist || track?.artist_name || track?.album_artist || '').trim(); }
function playbackView(runtime) {
  const payload = runtime.current || {}; const queue = Array.isArray(payload.queue) ? payload.queue : [];
  let index = queue.findIndex((track) => track?.is_current); if (index < 0) index = Math.max(0, Number(payload?.queue_status?.current_index) || 0);
  const status = payload.queue_status || {}; const anchor = finite(status.anchor_at); const playing = status.playing ?? !status.is_paused;
  let progress = playing && anchor != null ? Math.max(0, Date.now() - anchor) : Math.max(0, finite(queue[index]?.progress_ms) || 0);
  while (index >= 0 && index < queue.length - 1) { const duration = Math.max(0, finite(queue[index]?.duration_ms) || 0); if (!duration || progress < duration) break; progress -= duration; index += 1; }
  const duration = index >= 0 ? Math.max(0, finite(queue[index]?.duration_ms) || 0) : 0;
  return { queue, index: queue.length ? index : -1, progress: duration ? Math.min(progress, duration) : progress, duration };
}
function durationText(ms) { const seconds = Math.max(0, Math.floor((finite(ms) || 0) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function renderPlayback(runtime, force = false) {
  const { root, model } = runtime; const view = playbackView(runtime); const track = view.index >= 0 ? view.queue[view.index] : null;
  const link = role(root, 'station-link'); if (link) link.href = model.meta.station_url;
  const host = role(root, 'host'); if (host) { host.replaceChildren(); const handle = String(runtime.current?.latest?.host_handle || '').replace(/^@/, '').trim(); if (handle) { const a = document.createElement('a'); a.href = `https://stationhead.com/${encodeURIComponent(handle)}`; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `@${handle}`; host.append('配信ホスト ', a); } }
  setText(root, 'track-title', track ? (track.title || track.display_title || track.spotify_id || '曲名不明') : 'キュー情報がありません'); setText(root, 'track-artist', track ? trackArtist(track) : '');
  const image = role(root, 'track-image'); if (image) { const source = reducedImage(track?.thumbnail_url); if (source) { if (image.src !== source) image.src = source; image.hidden = false; } else { image.removeAttribute('src'); image.hidden = true; } }
  setText(root, 'track-time', `${durationText(view.progress)} / ${durationText(view.duration)}`); const bar = role(root, 'track-bar'); if (bar) bar.style.width = `${view.duration ? Math.min(100, view.progress / view.duration * 100) : 0}%`;
  const bites = role(root, 'track-bites'); if (bites) { const value = finite(track?.bite_count); bites.hidden = value == null; bites.textContent = value == null ? '' : `♡ ${numberText(value)}`; }
  if (!force && runtime.playbackIndex === view.index) return; runtime.playbackIndex = view.index;
  const box = role(root, 'queue'); if (!box) return; const upcoming = view.queue.slice(Math.max(0, view.index + 1), Math.max(0, view.index + 1) + 8); box.replaceChildren();
  setText(root, 'queue-count', `取得 ${numberText(runtime.current?.queue_status?.returned_items ?? view.queue.length)}曲／登録 ${numberText(runtime.current?.queue_status?.total_items ?? view.queue.length)}曲`);
  for (const [index, item] of upcoming.entries()) { const a = document.createElement('a'); a.className = 'queue-item'; const spotify = item?.spotify_url || (item?.spotify_id ? `https://open.spotify.com/track/${item.spotify_id}` : ''); a.href = spotify || '#'; if (spotify) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } else a.addEventListener('click', (event) => event.preventDefault()); const number = document.createElement('span'); number.className = 'queue-index'; number.textContent = String(index + 1); const img = document.createElement('img'); img.className = 'queue-thumb'; img.width = 42; img.height = 42; img.alt = ''; img.loading = 'lazy'; const src = reducedImage(item?.thumbnail_url); if (src) img.src = src; else img.hidden = true; const copy = document.createElement('span'); copy.className = 'queue-copy'; const strong = document.createElement('strong'); strong.textContent = item?.title || item?.display_title || item?.spotify_id || '曲名不明'; const small = document.createElement('small'); small.textContent = trackArtist(item); copy.append(strong, small); const duration = document.createElement('span'); duration.className = 'queue-duration'; duration.textContent = durationText(item?.duration_ms); a.append(number, img, copy, duration); box.append(a); }
  if (!upcoming.length) { const empty = document.createElement('p'); empty.className = 'subtle'; empty.textContent = '次の曲はありません。'; box.append(empty); }
}

function renderCurrent(runtime, payload) {
  runtime.current = payload; runtime.playbackIndex = -1; setText(runtime.root, 'online', numberText(payload?.latest?.online_member_count)); setText(runtime.root, 'streams', numberText(payload?.latest?.total_stream_count)); setText(runtime.root, 'members', numberText(payload?.latest?.total_member_count)); renderCurrentChart(runtime, payload); renderPlayback(runtime, true);
}

function renderDaily(runtime, payload) {
  const rows = Array.isArray(payload?.daily) ? payload.daily : []; const body = role(runtime.root, 'daily-tbody'); if (body) { body.replaceChildren(); if (!rows.length) appendEmptyTableRow(body, '日次データはまだありません。', 10); else for (const row of [...rows].reverse()) appendTableRow(body, [row.period_key || '—', finite(row.listener_avg) == null ? '—' : Number(row.listener_avg).toFixed(1), numberText(row.listener_min), numberText(row.listener_max), numberText(row.stream_start), numberText(row.stream_end), signedText(row.stream_growth), numberText(row.member_start), numberText(row.member_end), signedText(row.member_growth)]); }
  const canvas = role(runtime.root, 'daily-chart'); const prepared = setupCanvas(canvas, 360); if (!prepared) return; const { context, width, height } = prepared; const points = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.period_key || '') && finite(row.listener_avg) != null); if (!points.length) { context.fillStyle = '#667287'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '14px system-ui'; context.fillText('日次データがありません', width / 2, height / 2); return; }
  const area = { left: 54, right: 42, top: 26, bottom: 42 }; area.width = width - area.left - area.right; area.height = height - area.top - area.bottom; const times = points.map((r) => Date.parse(`${r.period_key}T00:00:00Z`)); const minTime = times[0]; const maxTime = times.at(-1); const span = Math.max(DAY_MS, maxTime - minTime); const values = points.flatMap((r) => [finite(r.listener_avg), finite(r.listener_min), finite(r.listener_max)]).filter((v) => v != null); const min = Math.max(0, Math.floor(Math.min(...values) / 10) * 10); const max = Math.max(min + 10, Math.ceil(Math.max(...values) / 10) * 10); const x = (time) => area.left + area.width * (time - minTime) / span; const y = (v) => area.top + area.height - area.height * (v - min) / (max - min); drawGrid(context, width, height, area, max, min);
  const series = [['listener_min', '#2776b9'], ['listener_max', '#c56a18'], ['listener_avg', '#111']]; for (const [key, color] of series) { context.strokeStyle = color; context.lineWidth = key === 'listener_avg' ? 2.2 : 1.7; context.beginPath(); let started = false; points.forEach((row, i) => { const value = finite(row[key]); if (value == null) { started = false; return; } const px = x(times[i]); const py = y(value); if (!started) { context.moveTo(px, py); started = true; } else context.lineTo(px, py); }); context.stroke(); }
  const growths = points.map((r) => finite(r.stream_growth)).filter((v) => v != null && v >= 0); const growthMax = Math.max(1, ...growths); const slot = area.width / Math.max(1, points.length); context.fillStyle = 'rgba(22,139,115,.28)'; points.forEach((row, i) => { const value = finite(row.stream_growth); if (value == null || value < 0) return; const h = area.height * value / growthMax; context.fillRect(x(times[i]) - Math.min(8, slot * .3), area.top + area.height - h, Math.min(16, slot * .6), h); });
  const legend = role(runtime.root, 'daily-legend'); if (legend) legend.textContent = '平均同接 / 最大同接 / 最小同接 / 再生数増加';
}

function trackIdentity(row) { return row?.track_id ? `track:${row.track_id}` : row?.spotify_id ? `spotify:${row.spotify_id}` : `${String(row?.title || '').normalize('NFKC')}\u0000${String(row?.artist || '').normalize('NFKC')}`; }
function aggregatePlayed(rows) { const map = new Map(); for (const row of Array.isArray(rows) ? rows : []) { const count = Math.max(0, finite(row?.play_count) || 0); if (!count) continue; const key = trackIdentity(row); const current = map.get(key); if (current) current.play_count += count; else map.set(key, { ...row, play_count: count }); } return [...map.values()].sort((a, b) => b.play_count - a.play_count || String(a.title || '').localeCompare(String(b.title || ''), 'ja')); }
function colorFor(index) { return `hsl(${Math.round((index * 137.508 + 332) % 360)} 72% 52%)`; }
function renderPlayed(runtime, rows) {
  const tracks = aggregatePlayed(rows); const total = tracks.reduce((sum, row) => sum + row.play_count, 0); setText(runtime.root, 'played-total', numberText(total)); setText(runtime.root, 'played-unique', numberText(tracks.length)); const body = role(runtime.root, 'played-tbody'); if (body) { body.replaceChildren(); if (!tracks.length) appendEmptyTableRow(body, '再生履歴データがありません。', 3); else tracks.forEach((row) => appendTableRow(body, [`${row.title || '曲名不明'}${row.artist ? ` / ${row.artist}` : ''}`, numberText(row.play_count), total ? `${(row.play_count / total * 100).toFixed(1)}%` : '—'])); }
  const canvas = role(runtime.root, 'played-chart'); const prepared = setupCanvas(canvas, 360); if (!prepared) return; const { context, width, height } = prepared; if (!total) { context.fillStyle = '#667287'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '14px system-ui'; context.fillText('再生履歴データがありません', width / 2, height / 2); return; } const radius = Math.min(width, height) * .31; const cx = width / 2; const cy = height / 2; let angle = -Math.PI / 2; tracks.forEach((row, index) => { const next = angle + Math.PI * 2 * row.play_count / total; context.beginPath(); context.moveTo(cx, cy); context.arc(cx, cy, radius, angle, next); context.closePath(); context.fillStyle = colorFor(index); context.fill(); context.strokeStyle = '#fff'; context.stroke(); angle = next; });
}

async function loadPlayed(runtime, { force = false } = {}) {
  const sequence = ++runtime.playedSequence;
  const current = () => sequence === runtime.playedSequence && runtime.section === 'played-tracks' && !runtime.root.hidden;
  if (!runtime.playedDates.length || force) runtime.playedDates = await runtime.model.loadPlayedIndex({ force });
  if (!current()) return;
  const week = Boolean(role(runtime.root, 'played-week')?.checked); const periods = week ? [...new Set(runtime.playedDates.map(weekStart).filter(Boolean))] : runtime.playedDates; if (!runtime.playedPeriod || !periods.includes(runtime.playedPeriod)) runtime.playedPeriod = periods.at(-1) || '';
  const strip = role(runtime.root, 'played-periods'); if (strip) { strip.replaceChildren(); for (const period of periods) { const button = document.createElement('button'); button.type = 'button'; button.className = `played-tracks-period${period === runtime.playedPeriod ? ' is-selected' : ''}`; button.dataset.period = period; button.textContent = `${shortDate(period)}${week ? ' (週)' : ''}`; button.addEventListener('click', async () => { runtime.playedPeriod = period; await loadPlayed(runtime); }); strip.append(button); } }
  if (!runtime.playedPeriod) { renderPlayed(runtime, []); return; } const from = runtime.playedPeriod; const to = week ? addDays(from, 6) : from; const rows = await runtime.model.loadPlayedPeriod(from, to, { force }); if (current()) renderPlayed(runtime, rows);
}

function likeThumbnail(row) { const box = document.createElement('span'); box.className = 'like-rank-thumb'; const source = reducedImage(row.thumbnail_url); if (!source) { box.textContent = '♪'; box.classList.add('is-fallback'); return box; } const img = document.createElement('img'); img.src = source; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => { img.remove(); box.textContent = '♪'; box.classList.add('is-fallback'); }, { once: true }); box.append(img); return box; }
function renderLikes(runtime, rows) {
  runtime.likes = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => Number(b.like_count || 0) - Number(a.like_count || 0)); setText(runtime.root, 'likes-count', numberText(runtime.likes.length)); const latest = runtime.likes.reduce((value, row) => Math.max(value, finite(row.observed_at) || 0), 0); setText(runtime.root, 'likes-latest', latest ? `${jstDateTime.format(new Date(latest))} JST` : '—');
  const list = role(runtime.root, 'likes-ranking'); if (list) { list.replaceChildren(); for (const [index, row] of runtime.likes.slice(0, 10).entries()) { const li = document.createElement('li'); li.className = 'like-rank-item'; const rank = document.createElement('strong'); rank.className = 'like-rank-number'; rank.textContent = MEDALS[index] || String(index + 1); const content = document.createElement('div'); content.className = 'like-rank-content'; const heading = document.createElement('div'); heading.className = 'like-rank-heading'; const title = document.createElement('span'); title.textContent = row.title || '曲名不明'; heading.append(title); const artist = document.createElement('small'); artist.textContent = row.artist || '—'; content.append(heading, artist); const metrics = document.createElement('div'); metrics.className = 'like-rank-metrics'; const metric = document.createElement('span'); metric.append('最新いいね数'); const strong = document.createElement('b'); strong.textContent = numberText(row.like_count); metric.append(strong); metrics.append(metric); li.append(rank, likeThumbnail(row), content, metrics); list.append(li); } }
  const body = role(runtime.root, 'likes-tbody'); if (body) { body.replaceChildren(); if (!runtime.likes.length) appendEmptyTableRow(body, 'いいねデータがありません。', 5); else runtime.likes.forEach((row, index) => appendTableRow(body, [index + 1, row.title || '曲名不明', row.artist || '—', numberText(row.like_count), row.observed_at ? `${jstDateTime.format(new Date(row.observed_at))} JST` : '—'])); }
}

function epoch(value) { const n = finite(value); if (n == null) return null; return n < 100_000_000_000 ? n * 1000 : n; }
function broadcastDuration(row) { const start = epoch(row?.started_at); const end = epoch(row?.ended_at); return start != null && end != null && end >= start ? (end - start) / 60_000 : null; }
function renderBroadcasts(runtime, payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : []; setText(runtime.root, 'broadcast-count', numberText(rows.length)); const averages = rows.map((r) => finite(r.listener_avg)).filter((v) => v != null); setText(runtime.root, 'broadcast-average', averages.length ? Number(averages.reduce((a, b) => a + b, 0) / averages.length).toFixed(1) : '—'); const maximums = rows.map((r) => finite(r.listener_max)).filter((v) => v != null); setText(runtime.root, 'broadcast-maximum', maximums.length ? numberText(Math.max(...maximums)) : '—'); const durations = rows.map(broadcastDuration).filter((v) => v != null); setText(runtime.root, 'broadcast-duration', durations.length ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}分` : '—');
  const body = role(runtime.root, 'broadcast-tbody'); if (body) { body.replaceChildren(); if (!rows.length) appendEmptyTableRow(body, 'リスパデータがありません。', 10); else for (const row of rows) { const start = epoch(row.started_at); const end = epoch(row.ended_at); appendTableRow(body, [start ? jstDate.format(new Date(start)) : '—', start ? `${jstTime.format(new Date(start))}-${end ? jstTime.format(new Date(end)) : payload.collection_active ? '現在' : '—'}` : '—', broadcastDuration(row) == null ? '—' : `${Math.round(broadcastDuration(row))}分`, finite(row.listener_avg) == null ? '—' : Number(row.listener_avg).toFixed(1), numberText(row.listener_min), numberText(row.listener_max), numberText(row.distinct_tracks), numberText(row.estimated_streams), row.broadcast_content || '—', row.event_name || '—']); } }
  const series = (Array.isArray(payload?.series) ? payload.series : []).map((item, index) => ({ name: item?.event_name || `イベント${index + 1}`, points: (Array.isArray(item?.points) ? item.points : []).map((point) => [finite(point?.[0]), finite(point?.[1])]).filter(([x, y]) => x != null && y != null) })).filter((item) => item.points.length);
  const canvas = role(runtime.root, 'broadcast-chart'); const empty = role(runtime.root, 'broadcast-chart-empty'); if (!series.length) { if (canvas) canvas.hidden = true; if (empty) { empty.hidden = false; empty.textContent = payload.chart_error ? 'グラフの取得に失敗しました。画面を開き直してください。' : 'グラフデータがありません。'; } const legend = role(runtime.root, 'broadcast-legend'); if (legend) legend.replaceChildren(); return; }
  if (canvas) canvas.hidden = false; if (empty) empty.hidden = true; const prepared = setupCanvas(canvas, 360); if (!prepared) return; const { context, width, height } = prepared; const allPoints = series.flatMap((item) => item.points); const area = { left: 54, right: 24, top: 24, bottom: 42 }; area.width = width - area.left - area.right; area.height = height - area.top - area.bottom; const maxX = Math.max(1, ...allPoints.map((point) => point[0])); const maxY = Math.max(10, ...allPoints.map((point) => point[1])); const x = (value) => area.left + area.width * value / maxX; const y = (value) => area.top + area.height - area.height * value / maxY; drawGrid(context, width, height, area, maxY, 0);
  series.forEach((item, index) => { context.strokeStyle = colorFor(index); context.lineWidth = 2; context.beginPath(); item.points.forEach(([px, py], pointIndex) => pointIndex ? context.lineTo(x(px), y(py)) : context.moveTo(x(px), y(py))); context.stroke(); });
  context.fillStyle = '#667287'; context.font = '11px system-ui'; context.textAlign = 'center'; context.textBaseline = 'alphabetic'; for (let index = 0; index < 5; index += 1) { const minute = maxX * index / 4; context.fillText(`${Math.round(minute)}分`, x(minute), height - 14); }
  const legend = role(runtime.root, 'broadcast-legend'); if (legend) { legend.replaceChildren(); series.forEach((item, index) => { if (index) legend.append(' / '); const span = document.createElement('span'); span.textContent = item.name; span.style.color = colorFor(index); legend.append(span); }); }
}

async function loadSection(runtime, section, { force = false } = {}) {
  if (!runtime.model.capabilities.includes(section)) return;
  const sequence = ++runtime.requestSequence;
  const current = () => sequence === runtime.requestSequence && runtime.section === section && !runtime.root.hidden;
  setNotice(runtime.root, '');
  try {
    if (section === 'played-tracks') { await loadPlayed(runtime, { force }); return; }
    const methods = { current: 'loadCurrent', history: 'loadHistory', likes: 'loadLikes', broadcasts: 'loadBroadcasts' };
    const payload = await runtime.model[methods[section]]({ force });
    if (!current()) return;
    const renderers = { current: renderCurrent, history: renderDaily, likes: renderLikes, broadcasts: renderBroadcasts };
    renderers[section](runtime, payload);
  } catch (error) {
    if (!current()) return;
    console.error(error);
    setNotice(runtime.root, `データの取得に失敗しました：${error.message}`, true);
  }
}

async function selectSection(runtime, section, { force = false, load = true } = {}) {
  if (!runtime.model.capabilities.includes(section)) return;
  const sequence = ++runtime.selectionSequence;
  runtime.section = section;
  if (section !== 'current') {
    try { await ensureDashboardSectionStyles('stationhead'); }
    catch (error) { if (sequence === runtime.selectionSequence) setNotice(runtime.root, '表示スタイルの取得に失敗しました。再読み込みしてください。', true); return; }
    if (sequence !== runtime.selectionSequence) return;
  }
  runtime.root.querySelectorAll('[data-stationhead-section]').forEach((button) => { const active = button.dataset.stationheadSection === section; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  runtime.root.querySelectorAll('[data-stationhead-panel]').forEach((panel) => { panel.hidden = panel.dataset.stationheadPanel !== section; });
  if (load) void loadSection(runtime, section, { force }); requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function initialize(root) {
  if (runtimes.has(root)) return runtimes.get(root);
  const model = stationheadChannelReadModel(root.dataset.stationheadModel || 'buddies');
  const runtime = { root, model, section: '', selectionSequence: 0, requestSequence: 0, playedSequence: 0, current: null, playbackIndex: -1, playedDates: [], playedPeriod: '', likes: [] };
  const capabilities = new Set(model.capabilities);
  root.querySelectorAll('[data-stationhead-section]').forEach((button) => { const enabled = capabilities.has(button.dataset.stationheadSection); button.disabled = !enabled; button.setAttribute('aria-disabled', String(!enabled)); button.title = enabled ? '' : '未提供'; if (enabled) button.addEventListener('click', () => selectSection(runtime, button.dataset.stationheadSection)); });
  role(root, 'live-chart')?.addEventListener('pointerup', (event) => renderCurrentDetail(runtime, event), true);
  role(root, 'played-week')?.addEventListener('change', () => { runtime.playedPeriod = ''; void loadPlayed(runtime); });
  role(root, 'likes-csv')?.addEventListener('click', () => downloadCsv(`${model.source}-like-ranking-${new Date().toISOString().slice(0, 10)}.csv`, [['順位', '曲名', 'アーティスト', '最新いいね数', '最終取得'], ...runtime.likes.map((row, index) => [index + 1, row.title || '曲名不明', row.artist || '', row.like_count ?? '', row.observed_at ? new Date(row.observed_at).toISOString() : ''])]));
  const initial = model.capabilities.includes('current') ? 'current' : model.capabilities[0];
  runtimes.set(root, runtime); selectSection(runtime, initial, { load: false });
  return runtime;
}

export async function loadStationheadChannelView(viewId, { force = false } = {}) {
  const root = typeof viewId === 'string' ? document.getElementById(viewId) : viewId;
  if (!root) return;
  const runtime = initialize(root);
  if (root.hidden) return;
  await loadSection(runtime, runtime.section, { force });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.querySelectorAll('.stationhead-channel-view:not([hidden])').forEach((root) => { const runtime = initialize(root); void loadSection(runtime, runtime.section); });
});

// One scheduler serves whichever channel is visible; hidden channels create no timers.
function visibleCurrentRuntime() {
  if (document.hidden) return null;
  const root = document.querySelector('.stationhead-channel-view:not([hidden])');
  const runtime = root && runtimes.get(root);
  return runtime?.section === 'current' ? runtime : null;
}
setInterval(() => {
  const runtime = visibleCurrentRuntime();
  if (runtime) void loadSection(runtime, 'current', { force: true });
}, 60_000);
setInterval(() => {
  const runtime = visibleCurrentRuntime();
  if (runtime?.current) renderPlayback(runtime);
}, 1_000);
