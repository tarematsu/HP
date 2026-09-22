const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const LABELS = Object.freeze({
  streamLabel: '平均再生数',
  memberLabel: '平均メンバー増加数',
});

function activeSummaryMode() {
  const active = document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode;
  if (SUMMARY_MODES.has(active)) return active;
  const hashMode = location.hash.slice(1);
  return SUMMARY_MODES.has(hashMode) ? hashMode : '';
}

function applyAverageLabels(mode = activeSummaryMode()) {
  if (!SUMMARY_MODES.has(mode)) return;
  for (const [id, label] of Object.entries(LABELS)) {
    const node = document.getElementById(id);
    if (node && node.textContent !== label) node.textContent = label;
  }
}

function observeLabel(id) {
  const node = document.getElementById(id);
  if (!node) return;
  new MutationObserver(() => applyAverageLabels()).observe(node, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

applyAverageLabels();
for (const id of Object.keys(LABELS)) observeLabel(id);
window.addEventListener('history:data-loaded', (event) => applyAverageLabels(event?.detail?.mode));
window.addEventListener('hashchange', () => applyAverageLabels());
