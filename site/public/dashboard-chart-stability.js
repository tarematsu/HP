import { createChartPaintGate } from './chart-paint-gate.js?v=20261001.1';

const canvas = document.getElementById('audienceChart');
const paintGate = createChartPaintGate(canvas, {
  pendingKey: 'initialPaintPending',
  stableKey: 'initialPaintStable',
  fallbackMs: 2500,
  oneShot: true,
});

function scheduleReveal(source) {
  if (!canvas) return;
  paintGate.reveal(source === 'network' ? 180 : 280);
}

if (canvas) {
  paintGate.conceal();
  window.addEventListener('dashboard:payload', (event) => {
    const payload = event?.detail?.payload;
    if (!Array.isArray(payload?.history) || !payload.history.length) return;
    scheduleReveal(String(event?.detail?.source || 'network'));
  });
}
