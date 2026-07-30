const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);

const currentView = document.getElementById('currentView');
const historyView = document.getElementById('historyView');
const tabs = document.getElementById('modeTabs');
let historyRuntimePromise = null;
let historyRuntimeMode = null;
let activeMode = 'current';

function updateTabs(mode) {
  tabs?.querySelectorAll('button').forEach((button) => {
    const selected = mode === 'current'
      ? button.dataset.view === 'current'
      : button.dataset.mode === mode;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function updateLocation(mode, { replace = false } = {}) {
  const target = mode === 'current'
    ? `${location.pathname}${location.search}`
    : `#${mode}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (current === target) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
}

function showCurrent({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'current';
  currentView.hidden = false;
  historyView.hidden = true;
  updateTabs('current');
  if (updateUrl) updateLocation('current', { replace: replaceUrl });
}

async function loadHistoryRuntime() {
  if (!historyRuntimePromise) {
    historyRuntimePromise = import('/history/history-main.js').catch((error) => {
      historyRuntimePromise = null;
      historyRuntimeMode = null;
      throw error;
    });
  }
  return historyRuntimePromise;
}

async function showHistory(mode, { updateUrl = true, replaceUrl = false, syncRuntime = true } = {}) {
  if (!HISTORY_MODES.has(mode)) {
    showCurrent({ updateUrl, replaceUrl });
    return;
  }

  activeMode = mode;
  currentView.hidden = true;
  historyView.hidden = false;
  updateTabs(mode);
  if (updateUrl) updateLocation(mode, { replace: replaceUrl });

  try {
    await loadHistoryRuntime();
    if (syncRuntime && historyRuntimeMode !== mode) {
      tabs?.querySelector(`button[data-mode="${mode}"]`)
        ?.dispatchEvent(new Event('click'));
    }
    historyRuntimeMode = mode;
  } catch (error) {
    console.error('history runtime failed to start', error);
    const notice = document.getElementById('notice');
    if (notice) {
      notice.textContent = '過去データの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
    }
  }
}

function modeFromLocation() {
  const mode = location.hash.slice(1);
  return HISTORY_MODES.has(mode) ? mode : 'current';
}

function syncFromLocation() {
  const mode = modeFromLocation();
  if (mode === activeMode) return;
  if (mode === 'current') showCurrent({ updateUrl: false });
  else void showHistory(mode, { updateUrl: false });
}

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !tabs.contains(button)) return;
  if (button.dataset.view === 'current') {
    showCurrent();
    return;
  }
  if (button.dataset.mode) {
    if (historyRuntimePromise) historyRuntimeMode = button.dataset.mode;
    void showHistory(button.dataset.mode, { syncRuntime: false });
  }
});

window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

// The legacy current-dashboard client still writes to #chartDetail. Keep that ID
// owned by the history view, copy the current-chart result, then restore history.
const audienceChart = document.getElementById('audienceChart');
const currentChartDetail = document.getElementById('currentChartDetail');
const historyChartDetail = document.getElementById('chartDetail');
audienceChart?.addEventListener('pointerup', () => {
  if (currentView.hidden || !currentChartDetail || !historyChartDetail) return;
  const savedHistoryDetail = historyChartDetail.innerHTML;
  queueMicrotask(() => {
    if (!currentView.hidden) currentChartDetail.textContent = historyChartDetail.textContent;
    historyChartDetail.innerHTML = savedHistoryDetail;
  });
});

const initialMode = modeFromLocation();
if (initialMode === 'current') {
  showCurrent({ updateUrl: Boolean(location.hash), replaceUrl: true });
} else {
  void showHistory(initialMode, { updateUrl: false, syncRuntime: false });
}
