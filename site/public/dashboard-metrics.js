import './dashboard-tab-registry.js?v=20261004.1';
import './current-shell.js?v=20261001.2';
import './dashboard-header.js?v=20260928.1';
import './dashboard-tabs.js?v=20261004.1';

let currentRuntimePromise = null;

function showCurrentRuntimeError(error) {
  console.error('dashboard client failed to start', error);
  const status = document.getElementById('statusMessage');
  if (status) {
    status.textContent = '画面の初期化に失敗しました。再読み込みしてください。';
    status.hidden = false;
  }
}

function ensureCurrentRuntime() {
  if (currentRuntimePromise) return currentRuntimePromise;
  currentRuntimePromise = (async () => {
    await Promise.all([
      import('./dashboard-current-layout.js?v=20260924.1'),
      import('./dashboard-chart-stability.js?v=20260930.2'),
      import('./dashboard-chart-comparison.js?v=20260930.2'),
      import('./dashboard-chart-detail.js?v=20260930.2'),
      import('./dashboard-daily-summaries.js?v=20260930.2'),
    ]);
    await import('./dashboard-fetch-cache.js?v=20260930.1');
    await import('/dashboard-client.js?v=20261004.1');
  })().catch((error) => {
    currentRuntimePromise = null;
    showCurrentRuntimeError(error);
    throw error;
  });
  return currentRuntimePromise;
}

function startCurrentRuntimeFromLocation() {
  if (!location.hash || location.hash === '#current') void ensureCurrentRuntime();
}

startCurrentRuntimeFromLocation();
window.addEventListener('popstate', startCurrentRuntimeFromLocation);
window.addEventListener('hashchange', startCurrentRuntimeFromLocation);
