const canvas = document.getElementById('chart');
const STABLE_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking']);
let armed = false;
let fallbackTimer = 0;
let revealTimer = 0;
let paintedMode = '';

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || location.hash.slice(1) || 'weekly');
}

function conceal(mode = activeMode()) {
  if (!canvas || !STABLE_MODES.has(String(mode))) return;
  armed = true;
  clearTimeout(fallbackTimer);
  clearTimeout(revealTimer);
  canvas.style.opacity = '0';
  canvas.style.pointerEvents = 'none';
  canvas.dataset.paintPending = 'true';
  delete canvas.dataset.paintStable;
  delete canvas.dataset.periodChart;
  delete canvas.dataset.rankingChart;
  fallbackTimer = setTimeout(() => reveal(0), 1800);
}

function reveal(delay = 0) {
  if (!canvas || !armed) return;
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!armed) return;
      armed = false;
      clearTimeout(fallbackTimer);
      canvas.style.opacity = '1';
      canvas.style.pointerEvents = '';
      delete canvas.dataset.paintPending;
      canvas.dataset.paintStable = 'true';
    }));
  }, delay);
}

function hasStablePaint() {
  return Boolean(canvas?.dataset?.paintStable === 'true' && canvas.style.opacity !== '0');
}

function resetSharedChartPresentation() {
  document.getElementById('chartLegend')?.replaceChildren();
  const start = document.getElementById('chartStartDate');
  const end = document.getElementById('chartEndDate');
  const detail = document.getElementById('chartDetail');
  if (start) start.textContent = '—';
  if (end) end.textContent = '—';
  if (detail) detail.textContent = 'グラフを読み込み中です。';
  delete canvas?.dataset?.sakurazakaMaxMinute;
  delete canvas?.dataset?.sakurazakaLeft;
  delete canvas?.dataset?.sakurazakaWidth;
}

function prepareBroadcastCanvas() {
  if (!canvas) return;
  clearTimeout(fallbackTimer);
  clearTimeout(revealTimer);
  armed = false;
  canvas.width = canvas.width;
  canvas.style.opacity = '1';
  canvas.style.pointerEvents = '';
  delete canvas.dataset.paintPending;
  delete canvas.dataset.paintStable;
  delete canvas.dataset.periodChart;
  delete canvas.dataset.rankingChart;
  paintedMode = 'broadcasts';
}

if (canvas) {
  conceal();

  window.addEventListener('history:period-chart-drawn', (event) => {
    const mode = String(event?.detail?.mode || activeMode());
    if (!['daily', 'weekly', 'monthly'].includes(mode)) return;
    paintedMode = mode;
    reveal(0);
  });

  window.addEventListener('history:ranking-chart-drawn', () => {
    paintedMode = 'ranking';
    if (activeMode() === 'ranking') reveal(80);
  });

  document.getElementById('modeTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    const nextMode = String(button.dataset.mode || '');
    if (!nextMode) return;
    resetSharedChartPresentation();
    if (nextMode === 'broadcasts') {
      prepareBroadcastCanvas();
      return;
    }
    if (nextMode !== paintedMode) conceal(nextMode);
  }, true);

  document.getElementById('load')?.addEventListener('click', () => {
    if (!hasStablePaint()) conceal();
  }, true);
}
