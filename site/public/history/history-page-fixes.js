import { inclusivePresetStart, utcDate } from './history-date-utils.js';

const originalFetch = window.fetch.bind(window);
const isUnknownTitle = (value) => {
  const text = String(value ?? '').trim();
  return !text || text === '曲名不明' || /^spotify[_:-]?[a-z0-9]{8,}$/i.test(text);
};

function enrichHistoryPayload(payload) {
  if (!payload || payload.mode !== 'tracks' || !Array.isArray(payload.rows)) return payload;
  return {
    ...payload,
    rows: payload.rows.map((row) => {
      if (!row || !isUnknownTitle(row.title)) return row;
      const title = [row.raw_title, row.display_title, row.raw_name]
        .map((value) => String(value ?? '').trim())
        .find((value) => value && !isUnknownTitle(value));
      if (!title) return row;
      const artist = String(row.artist ?? '').trim() || String(row.raw_artist ?? '').trim();
      return {
        ...row,
        title,
        ...(artist ? { artist } : {}),
      };
    }),
  };
}

window.fetch = async function historyMetadataFetch(input, init) {
  const response = await originalFetch(input, init);
  try {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    if (!requestUrl || !new URL(requestUrl, location.href).pathname.endsWith('/api/track-history')) {
      return response;
    }
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
  if (toInput?.value === utcDate()) return;
  applyUtcPreset(activePreset);
  document.getElementById('load')?.click();
});
