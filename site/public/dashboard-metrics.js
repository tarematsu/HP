import './dashboard-tab-registry.js?v=20261004.1';
import './current-shell.js?v=20261004.2';
import './dashboard-header.js?v=20260928.1';
import './dashboard-tabs.js?v=20261004.1';
import './dashboard-fetch-cache.js?v=20260930.1';
import './stationhead-channel-style-loader.js?v=20261004.2';

let currentRuntimePromise = null;

function showCurrentRuntimeError(error) {
  console.error('Stationhead channel runtime failed to start', error);
  const status = document.querySelector('#currentView [data-role="notice"]');
  if (status) {
    status.textContent = '画面の初期化に失敗しました。再読み込みしてください。';
    status.classList.add('error');
    status.hidden = false;
  }
}

function ensureCurrentRuntime() {
  if (currentRuntimePromise) return currentRuntimePromise;
  currentRuntimePromise = import('/stationhead-channel.js?v=20261004.2')
    .then((runtime) => runtime.loadStationheadChannelView('currentView'))
    .catch((error) => {
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
