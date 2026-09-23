const MISSING_START = '2026-01-26';
const MISSING_END = '2026-09-14';
const MODE = 'ranking';

let renderedWeeks = [];
let overlayTimer = 0;

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function completeWeeks() {
  return [...new Set(renderedWeeks.map(isoDate).filter(Boolean))].sort();
}

function isMissing(value) {
  const date = isoDate(value);
  return date >= MISSING_START && date <= MISSING_END;
}

function active() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '') === MODE;
}

function scheduleOverlay(delay = 0) {
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(renderOverlay)), delay);
}

function renderOverlay() {
  if (!active()) return;
  const weeks = completeWeeks();
  if (!weeks.length) return;
  const canvas = document.getElementById('chart');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const width = Math.max(320, Math.round(canvas.clientWidth || 960));
  const height = Math.max(260, Math.round(canvas.clientHeight || 360));
  const area = { left: 46, right: 18, top: 18, bottom: 55 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const positions = weeks.map((_, index) => area.left + area.width * index / Math.max(1, weeks.length - 1));
  const missingIndexes = weeks.map((week, index) => isMissing(week) ? index : -1).filter((index) => index >= 0);

  if (missingIndexes.length) {
    const step = positions.length > 1 ? area.width / (positions.length - 1) : area.width;
    const left = Math.max(area.left, positions[missingIndexes[0]] - step / 2);
    const right = Math.min(area.left + area.width, positions[missingIndexes.at(-1)] + step / 2);
    context.save();
    context.fillStyle = 'rgba(100, 107, 116, .16)';
    context.fillRect(left, area.top, Math.max(1, right - left), area.height);
    context.restore();
  }

  const foot = document.getElementById('chartFoot');
  if (foot) foot.textContent = '順位は上ほど高順位です。灰色は欠測期間です。空白週は圏外です。';
  const legend = document.getElementById('chartLegend');
  if (legend && !legend.querySelector('[data-ranking-missing-legend]')) {
    const span = document.createElement('span');
    span.dataset.rankingMissingLegend = 'true';
    const marker = document.createElement('i');
    marker.style.background = 'rgba(100, 107, 116, .55)';
    span.append(marker, document.createTextNode('欠測'));
    legend.append(span);
  }
}

window.addEventListener('history:ranking-chart-drawn', (event) => {
  renderedWeeks = Array.isArray(event?.detail?.weeks) ? event.detail.weeks.map(isoDate).filter(Boolean) : [];
  scheduleOverlay(0);
});
