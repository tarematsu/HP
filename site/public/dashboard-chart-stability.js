const canvas = document.getElementById('audienceChart');
let settled = false;
let revealTimer = 0;
let fallbackTimer = 0;

function conceal() {
  if (!canvas || settled) return;
  canvas.style.opacity = '0';
  canvas.style.pointerEvents = 'none';
  canvas.dataset.initialPaintPending = 'true';
}

function reveal() {
  if (!canvas || settled) return;
  settled = true;
  clearTimeout(revealTimer);
  clearTimeout(fallbackTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    canvas.style.opacity = '1';
    canvas.style.pointerEvents = '';
    delete canvas.dataset.initialPaintPending;
    canvas.dataset.initialPaintStable = 'true';
  }));
}

function scheduleReveal(source) {
  if (!canvas || settled) return;
  conceal();
  clearTimeout(revealTimer);
  const delay = source === 'details-network' ? 180 : 280;
  revealTimer = setTimeout(reveal, delay);
}

if (canvas) {
  conceal();
  fallbackTimer = setTimeout(reveal, 2500);
  window.addEventListener('dashboard:details', (event) => {
    const payload = event?.detail?.payload;
    if (!Array.isArray(payload?.history) || !payload.history.length) return;
    scheduleReveal(String(event?.detail?.source || 'details-network'));
  });
}
