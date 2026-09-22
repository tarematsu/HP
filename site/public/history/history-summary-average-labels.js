const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);

function activeSummaryMode() {
  const active = document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode;
  if (SUMMARY_MODES.has(active)) return active;
  const hashMode = location.hash.slice(1);
  return SUMMARY_MODES.has(hashMode) ? hashMode : '';
}

function applyAverageLabels(mode = activeSummaryMode()) {
  if (!SUMMARY_MODES.has(mode)) return;
  const stream = document.getElementById('streamLabel');
  const member = document.getElementById('memberLabel');
  if (stream) stream.textContent = '平均再生数';
  if (member) member.textContent = '平均メンバー増加数';
}

applyAverageLabels();
window.addEventListener('history:data-loaded', (event) => applyAverageLabels(event?.detail?.mode));
window.addEventListener('hashchange', () => applyAverageLabels());
