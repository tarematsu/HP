import { createChartPaintGate } from '../chart-paint-gate.js?v=20261001.1';

const canvas = document.getElementById('chart');
const STABLE_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking']);
const paintGate = createChartPaintGate(canvas, {
  pendingKey: 'paintPending',
  stableKey: 'paintStable',
  fallbackMs: 1800,
});
let paintedMode = '';

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || location.hash.slice(1) || 'weekly');
}

function conceal(mode = activeMode()) {
  if (!canvas || !STABLE_MODES.has(String(mode))) return;
  paintGate.conceal();
  delete canvas.dataset.periodChart;
  delete canvas.dataset.rankingChart;
}

function reveal(delay = 0) {
  paintGate.reveal(delay);
}

function hasStablePaint() {
  return paintGate.isStable();
}

function clearAxisLabel(id) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = '';
  node.hidden = true;
}

function resetSharedChartPresentation() {
  document.getElementById('chartLegend')?.replaceChildren();
  const start = document.getElementById('chartStartDate');
  const end = document.getElementById('chartEndDate');
  const detail = document.getElementById('chartDetail');
  if (start) start.textContent = '—';
  if (end) end.textContent = '—';
  if (detail) detail.textContent = '';
  for (const id of ['chartYAxisLeft', 'chartYAxisRight', 'chartXAxisTitle']) clearAxisLabel(id);
  canvas.width = canvas.width;
  delete canvas.dataset.sakurazakaMaxMinute;
  delete canvas.dataset.sakurazakaLeft;
  delete canvas.dataset.sakurazakaWidth;
}

function prepareBroadcastCanvas() {
  if (!canvas) return;
  paintGate.show();
  delete canvas.dataset.periodChart;
  delete canvas.dataset.rankingChart;
  paintedMode = 'broadcasts';
}

function prepareRankingQueryChange() {
  if (activeMode() !== 'ranking') return;
  resetSharedChartPresentation();
  paintedMode = '';
  conceal('ranking');
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

  document.getElementById('rankingScope')?.addEventListener('change', prepareRankingQueryChange, true);
  document.getElementById('rankingHost')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') prepareRankingQueryChange();
  }, true);

  document.getElementById('load')?.addEventListener('click', () => {
    if (!hasStablePaint()) conceal();
  }, true);
}
