import { inclusivePresetStart, utcDate } from './history-date-utils.js';

const visualFixes = document.createElement('style');
visualFixes.textContent = `
  .data-panel { content-visibility: visible !important; contain-intrinsic-size: none !important; }
  .summary-cards strong {
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: normal !important;
    overflow-wrap: anywhere;
    font-size: clamp(1.35rem, 4.8vw, 2.5rem);
  }
`;
document.head.appendChild(visualFixes);

const originalFetch = window.fetch.bind(window);
const isIdentifier = (value) => {
  const text = String(value ?? '').trim();
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(text)
    || /^[A-Za-z0-9]{22}$/.test(text)
    || /^spotify[_:-]?[a-z0-9]{8,}$/i.test(text);
};
const isUnknownTitle = (value) => {
  const text = String(value ?? '').trim();
  const normalized = text.normalize('NFKC').toLowerCase();
  return !text
    || ['曲名不明', '曲名…', '曲名...', 'unknown', 'unknown title', '_', '-', '—'].includes(normalized)
    || isIdentifier(text);
};
const isUnknownArtist = (value) => {
  const text = String(value ?? '').trim();
  const normalized = text.normalize('NFKC').toLowerCase();
  return !text
    || ['_', '-', '—', 'unknown', 'unknown artist', 'アーティスト不明'].includes(normalized)
    || isIdentifier(text);
};

function enrichTrackRow(row) {
  if (!row) return row;
  const title = [row.title, row.raw_title, row.display_title, row.raw_name]
    .map((value) => String(value ?? '').trim())
    .find((value) => value && !isUnknownTitle(value));
  const artist = [row.artist, row.raw_artist]
    .map((value) => String(value ?? '').trim())
    .find((value) => value && !isUnknownArtist(value));
  return {
    ...row,
    title: title || '曲名不明',
    artist: artist || '',
  };
}

let lastRankingPayload = null;

function enrichHistoryPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.mode === 'tracks' && Array.isArray(payload.rows)) {
    return { ...payload, rows: payload.rows.map(enrichTrackRow) };
  }
  if (payload.mode === 'likes' && Array.isArray(payload.ranking)) {
    return { ...payload, ranking: payload.ranking.map(enrichTrackRow) };
  }
  if (payload.mode === 'ranking' && Array.isArray(payload.rows)) {
    const enriched = {
      ...payload,
      rows: payload.rows.map((row) => ({
        ...row,
        rank: row?.rank == null ? '圏外' : row.rank,
        previous_rank: row?.previous_rank == null
          ? (row?.previous_out_of_rank ? '圏外' : 'なし')
          : row.previous_rank,
        source_sheet: row?.source_sheet || '記録なし',
      })),
    };
    lastRankingPayload = payload;
    return enriched;
  }
  return payload;
}

window.fetch = async function historyMetadataFetch(input, init) {
  const response = await originalFetch(input, init);
  try {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    const pathname = requestUrl ? new URL(requestUrl, location.href).pathname : '';
    if (!pathname.endsWith('/api/track-history') && !pathname.endsWith('/api/history')) return response;
    const payload = await response.clone().json();
    const enriched = enrichHistoryPayload(payload);
    if (enriched === payload) return response;
    return new Response(JSON.stringify(enriched), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    return response;
  }
};

function applyRankingPresentation() {
  if (location.hash !== '#ranking') return;
  const rows = Array.isArray(lastRankingPayload?.rows) ? lastRankingPayload.rows : [];
  const rankedCount = rows.filter((row) => Number.isFinite(Number(row?.rank))).length;
  const outCount = rows.length - rankedCount;
  const hostCount = Number(lastRankingPayload?.host_count || 0);
  const labels = [
    ['maxLabel', '掲載行'], ['streamLabel', '圏外行'], ['memberLabel', '対象ホスト'],
  ];
  const values = [
    ['maxListener', rankedCount], ['streamGrowth', outCount], ['memberGrowth', hostCount],
  ];
  for (const [id, text] of labels) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }
  for (const [id, value] of values) {
    const node = document.getElementById(id);
    if (node) node.textContent = new Intl.NumberFormat('ja-JP').format(value);
  }
  document.querySelectorAll('#tbody tr').forEach((row) => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;
    if (cells[4].textContent.trim() === '—') cells[4].textContent = '比較なし';
    if (cells[6].textContent.trim() === '—') cells[6].textContent = '記録なし';
    if (cells[7].textContent.trim() === '—') cells[7].textContent = '対象外';
  });
}

const rankingObserver = new MutationObserver(() => queueMicrotask(applyRankingPresentation));
const historyBody = document.getElementById('tbody');
if (historyBody) rankingObserver.observe(historyBody, { childList: true, subtree: true });
window.addEventListener('hashchange', () => queueMicrotask(applyRankingPresentation));

const originalBeginPath = CanvasRenderingContext2D.prototype.beginPath;
const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
const originalLineTo = CanvasRenderingContext2D.prototype.lineTo;
const originalStroke = CanvasRenderingContext2D.prototype.stroke;
const pathState = new WeakMap();

CanvasRenderingContext2D.prototype.beginPath = function beginPathWithDailyPoints() {
  pathState.set(this, { moves: [], lines: 0 });
  return originalBeginPath.call(this);
};

CanvasRenderingContext2D.prototype.moveTo = function moveToWithDailyPoints(x, y) {
  const state = pathState.get(this);
  if (state) state.moves.push([x, y]);
  return originalMoveTo.call(this, x, y);
};

CanvasRenderingContext2D.prototype.lineTo = function lineToWithDailyPoints(x, y) {
  const state = pathState.get(this);
  if (state) state.lines += 1;
  return originalLineTo.call(this, x, y);
};

CanvasRenderingContext2D.prototype.stroke = function strokeWithDailyPoints(...args) {
  const result = originalStroke.apply(this, args);
  const canvas = this.canvas;
  const state = pathState.get(this);
  if (canvas?.id !== 'chart' || location.hash !== '#daily' || !state?.moves.length || state.lines > 0) return result;
  this.save();
  this.globalAlpha = Math.max(.65, this.globalAlpha || 1);
  this.fillStyle = this.strokeStyle;
  for (const [x, y] of state.moves) {
    originalBeginPath.call(this);
    this.arc(x, y, 3, 0, Math.PI * 2);
    this.fill();
  }
  this.restore();
  return result;
};

function applyUtcPreset(days) {
  const to = utcDate();
  const from = days === 'all'
    ? '2024-05-01'
    : inclusivePresetStart(to, days);
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  if (fromInput) fromInput.value = from;
  if (toInput) toInput.value = to;
  document.querySelectorAll('#rangePresets button').forEach((button) => {
    button.classList.toggle('active', button.dataset.days === String(days));
  });
}

const rangePresets = document.getElementById('rangePresets');
rangePresets?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-days]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  applyUtcPreset(button.dataset.days);
  document.getElementById('load')?.click();
}, true);

window.addEventListener('history:runtime-ready', () => {
  if (location.hash === '#broadcasts') return;
  const activePreset = document.querySelector('#rangePresets button.active')?.dataset.days || 'all';
  const toInput = document.getElementById('to');
  if (toInput?.value !== utcDate()) {
    applyUtcPreset(activePreset);
    document.getElementById('load')?.click();
  }
  queueMicrotask(applyRankingPresentation);
});