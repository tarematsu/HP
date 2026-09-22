const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const VALID_MODES = new Set([...SUMMARY_MODES, 'ranking', 'broadcasts']);
const requestedMode = location.hash.slice(1);
const runtimePromises = new Map();

function runtimeKey(mode) {
  if (SUMMARY_MODES.has(mode)) return 'summary';
  if (mode === 'ranking' || mode === 'broadcasts') return mode;
  return '';
}

async function importModeRuntime(mode) {
  const key = runtimeKey(mode);
  if (!key) return;
  if (key === 'summary') {
    await import('/history/history-period-chart.js?v=20260923.4');
    return;
  }
  if (key === 'ranking') {
    await import('/history/history-ranking-chart.js?v=20260923.5');
    await import('/history/history-ranking-missing-gap.js?v=20260923.6');
    return;
  }
  await import('/history/history-broadcast-summary.js?v=20260923.2');
  await import('/history/history-broadcasts.js?v=20260923.3');
}

async function ensureHistoryModeRuntime(mode) {
  const key = runtimeKey(mode);
  if (!key) return;
  if (!runtimePromises.has(key)) {
    const promise = importModeRuntime(mode).catch((error) => {
      runtimePromises.delete(key);
      throw error;
    });
    runtimePromises.set(key, promise);
  }
  await runtimePromises.get(key);
}

window.__ensureHistoryModeRuntime = ensureHistoryModeRuntime;

const initialMode = VALID_MODES.has(requestedMode) ? requestedMode : 'weekly';
if (initialMode !== requestedMode) history.replaceState(null, '', '/#weekly');

await import('/history/history-page-fixes.js?v=20260923.5');
await import('/history/history-axis-labels.js?v=20260923.6');
await import('/history/history-chart-stability.js?v=20260923.2');
await import('/history/history-table-cleanup.js?v=20260923.1');
await ensureHistoryModeRuntime(initialMode);
await import('/history/history-lite.js?v=20260923.3');
window.dispatchEvent(new Event('history:runtime-ready'));
