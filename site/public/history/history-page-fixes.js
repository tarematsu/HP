import { aggregateCompleteTrackRows } from './history-track-view.js';

const originalBeginPath = CanvasRenderingContext2D.prototype.beginPath;
const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
const originalLineTo = CanvasRenderingContext2D.prototype.lineTo;
const originalStroke = CanvasRenderingContext2D.prototype.stroke;
const pathState = new WeakMap();
const DAY_MS = 86_400_000;
const integer = new Intl.NumberFormat('ja-JP');
let trackRankingRows = [];
let trackRankingRenderQueued = false;

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

function metric(label, value) {
  const box = document.createElement('span');
  box.append(document.createTextNode(label));
  const strong = document.createElement('b');
  strong.textContent = value;
  box.appendChild(strong);
  return box;
}

function renderTrackRanking() {
  const panel = document.querySelector('.data-panel');
  const tableWrap = panel?.querySelector('.table-wrap');
  let list = document.getElementById('trackRankingList');

  if (location.hash !== '#tracks') {
    if (tableWrap) tableWrap.hidden = false;
    if (list) list.hidden = true;
    return;
  }
  if (!panel || !tableWrap) return;

  if (!list) {
    list = document.createElement('ol');
    list.id = 'trackRankingList';
    list.className = 'like-ranking';
    tableWrap.before(list);
  }
  list.replaceChildren();
  list.hidden = false;
  tableWrap.hidden = true;

  if (!trackRankingRows.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-ranking';
    empty.textContent = 'この期間の有効な再生曲データがありません。';
    list.appendChild(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const row of trackRankingRows) {
      const item = document.createElement('li');
      item.className = 'like-rank-item';

      const rank = document.createElement('strong');
      rank.className = 'like-rank-number';
      rank.textContent = String(row.rank);

      const content = document.createElement('div');
      content.className = 'like-rank-content';
      const heading = document.createElement('div');
      heading.className = 'like-rank-heading';
      const title = document.createElement('span');
      title.textContent = row.title || '曲名不明';
      heading.appendChild(title);
      const artist = document.createElement('small');
      artist.textContent = row.artist || '—';
      content.append(heading, artist);

      const metrics = document.createElement('div');
      metrics.className = 'like-rank-metrics';
      metrics.append(
        metric('再生回数', `${integer.format(row.play_count)}回`),
        metric('最大いいね', integer.format(row.like_count)),
      );

      item.append(rank, content, metrics);
      fragment.appendChild(item);
    }
    list.appendChild(fragment);
  }

  const title = document.getElementById('tableTitle');
  if (title) {
    title.textContent = document.getElementById('trackWeekMode')?.checked
      ? '週間再生数ランキング'
      : '1日の再生数ランキング';
  }
}

function scheduleTrackRanking() {
  if (trackRankingRenderQueued) return;
  trackRankingRenderQueued = true;
  queueMicrotask(() => {
    trackRankingRenderQueued = false;
    renderTrackRanking();
  });
}

function todayJst() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function applyJstPreset(days) {
  const to = todayJst();
  const from = days === 'all'
    ? '2024-05-01'
    : shiftDate(to, -Math.max(1, Number(days) || 30));
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
  applyJstPreset(button.dataset.days);
  document.getElementById('load')?.click();
}, true);

window.addEventListener('history:runtime-ready', () => {
  if (['#tracks', '#broadcasts'].includes(location.hash)) return;
  const activePreset = document.querySelector('#rangePresets button.active')?.dataset.days || 'all';
  const toInput = document.getElementById('to');
  if (toInput?.value === todayJst()) return;
  applyJstPreset(activePreset);
  document.getElementById('load')?.click();
});

window.addEventListener('history:track-rows', (event) => {
  trackRankingRows = aggregateCompleteTrackRows(event.detail?.rows);
  scheduleTrackRanking();
});
window.addEventListener('hashchange', scheduleTrackRanking);
document.getElementById('trackWeekMode')?.addEventListener('change', scheduleTrackRanking);
