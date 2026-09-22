const canvas = document.getElementById('chart');
const STABLE_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking']);
let armed = false;
let fallbackTimer = 0;
let revealTimer = 0;

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

if (canvas) {
  conceal();
  new MutationObserver(() => {
    if (!armed) return;
    const mode = activeMode();
    if (['daily', 'weekly', 'monthly'].includes(mode) && canvas.dataset.periodChart) reveal(0);
  }).observe(canvas, {
    attributes: true,
    attributeFilter: ['data-period-chart'],
  });

  window.addEventListener('history:ranking-chart-drawn', () => {
    if (activeMode() === 'ranking') reveal(80);
  });

  document.getElementById('modeTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (button) conceal(button.dataset.mode);
  }, true);
  document.getElementById('load')?.addEventListener('click', () => conceal(), true);
}
