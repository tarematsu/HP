const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);
const LAZY_VIEWS = Object.freeze({
  'first-week': {
    viewId: 'firstWeekView',
    shell: () => import('/first-week-comparison-shell.js?v=20260929.1'),
    runtime: () => import('/first-week-comparison.js?v=20260929.1'),
    loadExport: 'loadFirstWeekComparisonView',
    noticeId: 'firstWeekNotice',
    errorLabel: 'first-week',
    errorMessage: '初週比較データの初期化に失敗しました。再読み込みしてください。',
  },
  'played-tracks': {
    viewId: 'playedTracksView',
    shell: () => import('/played-tracks-shell.js?v=20260928.1'),
    runtime: () => import('/played-tracks.js?v=20260927.2'),
    noticeId: 'playedTracksNotice',
    errorLabel: 'played tracks',
    errorMessage: '再生履歴データの初期化に失敗しました。再読み込みしてください。',
  },
  spotify: {
    viewId: 'spotifyView',
    shell: () => import('/spotify-shell.js?v=20260929.1'),
    runtime: () => import('/spotify.js?v=20260929.1'),
    loadExport: 'loadSpotifyView',
    noticeId: 'spotifyNotice',
    errorLabel: 'spotify',
    errorMessage: 'Spotify再生数の初期化に失敗しました。再読み込みしてください。',
  },
  'amazon-music': {
    viewId: 'amazonMusicView',
    shell: () => import('/amazon-music-shell.js?v=20260929.1'),
    runtime: () => import('/amazon-music.js?v=20260929.1'),
    loadExport: 'loadAmazonMusicView',
    noticeId: 'amazonMusicNotice',
    errorLabel: 'amazon music',
    errorMessage: 'Amazon Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'apple-music': {
    viewId: 'appleMusicView',
    shell: () => import('/apple-music-shell.js?v=20260930.1'),
    runtime: () => import('/apple-music.js?v=20260930.1'),
    loadExport: 'loadAppleMusicView',
    noticeId: 'appleMusicNotice',
    errorLabel: 'apple music',
    errorMessage: 'Apple Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  likes: {
    viewId: 'likesView',
    runtime: () => import('/history/history-likes.js?v=20260930.1'),
    noticeId: 'likesNotice',
    errorLabel: 'likes',
    errorMessage: 'いいねデータの初期化に失敗しました。再読み込みしてください。',
  },
});
const VIEW_MODES = new Set(['current', ...HISTORY_MODES, ...Object.keys(LAZY_VIEWS)]);
const VIEW_IDS = ['currentView', 'historyView', ...Object.values(LAZY_VIEWS).map(({ viewId }) => viewId)];

const currentView = document.getElementById('currentView');
const historyView = document.getElementById('historyView');
const tabs = document.getElementById('modeTabs');
const skipLink = document.querySelector('.skip-link');
const modulePromises = new Map();
let historyRuntimeMode = null;
let activeMode = 'current';
let initialRouteReady = false;

function releaseUnexpectedSkipLinkFocus() {
  if (document.activeElement === skipLink) skipLink?.blur();
  document.documentElement.classList.remove('keyboard-navigation');
}

function markRouteReady() {
  if (initialRouteReady) return;
  initialRouteReady = true;
  window.dispatchEvent(new Event('dashboard:route-ready'));
}

function updateTabs(mode) {
  tabs?.querySelectorAll('button').forEach((button) => {
    const selected = button.dataset.view === mode || button.dataset.mode === mode;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function updateLocation(mode, { replace = false } = {}) {
  const target = mode === 'current' ? '/' : `/#${mode}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (current === target) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
}

function showOnly(view) {
  for (const id of VIEW_IDS) {
    const node = document.getElementById(id);
    if (node) node.hidden = node !== view;
  }
}

function loadOnce(key, importer) {
  if (!modulePromises.has(key)) {
    const promise = importer().catch((error) => {
      modulePromises.delete(key);
      throw error;
    });
    modulePromises.set(key, promise);
  }
  return modulePromises.get(key);
}

function setRoute(mode, view, { updateUrl = true, replaceUrl = false } = {}) {
  activeMode = mode;
  showOnly(view);
  updateTabs(mode);
  if (updateUrl) updateLocation(mode, { replace: replaceUrl });
}

function showCurrent(options = {}) {
  setRoute('current', currentView, options);
  markRouteReady();
}

function showRuntimeError(config, error) {
  console.error(`${config.errorLabel} runtime failed to start`, error);
  const notice = document.getElementById(config.noticeId);
  if (!notice) return;
  notice.textContent = config.errorMessage;
  notice.classList.add('error');
  notice.hidden = false;
}

async function ensureLazyShell(mode) {
  const config = LAZY_VIEWS[mode];
  if (!config?.shell) return;
  await loadOnce(`${mode}:shell`, config.shell);
}

async function showLazyView(mode, options = {}) {
  const config = LAZY_VIEWS[mode];
  if (!config) return;
  setRoute(mode, config.shell ? null : document.getElementById(config.viewId), options);
  if (!config.shell) markRouteReady();

  try {
    await ensureLazyShell(mode);
    if (activeMode !== mode) return;
    if (config.shell) {
      showOnly(document.getElementById(config.viewId));
      markRouteReady();
    }
    const runtime = await loadOnce(`${mode}:runtime`, config.runtime);
    if (activeMode !== mode) return;
    if (config.loadExport) await runtime[config.loadExport]?.();
  } catch (error) {
    if (activeMode !== mode) return;
    markRouteReady();
    showRuntimeError(config, error);
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showHistory(mode, { updateUrl = true, replaceUrl = false, syncRuntime = true } = {}) {
  if (!HISTORY_MODES.has(mode)) {
    showCurrent({ updateUrl, replaceUrl });
    return;
  }

  setRoute(mode, historyView, { updateUrl, replaceUrl });
  markRouteReady();

  try {
    if (mode === 'ranking') {
      await loadOnce('ranking-status', () => import('/history/history-ranking-table-status.js?v=20260923.2'));
      if (activeMode !== mode) return;
    }
    await loadOnce('history-runtime', () => import('/history/history-main.js?v=20260928.1'));
    if (activeMode !== mode) return;
    if (syncRuntime && historyRuntimeMode !== mode) {
      tabs?.querySelector(`button[data-mode="${mode}"]`)?.dispatchEvent(new Event('click'));
    }
    if (activeMode !== mode) return;
    historyRuntimeMode = mode;
  } catch (error) {
    if (activeMode !== mode) return;
    historyRuntimeMode = null;
    showRuntimeError({
      noticeId: 'notice',
      errorLabel: 'history',
      errorMessage: '過去データの初期化に失敗しました。再読み込みしてください。',
    }, error);
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

function modeFromLocation() {
  const mode = location.hash.slice(1);
  return VIEW_MODES.has(mode) ? mode : 'current';
}

function showMode(mode, options = {}) {
  if (mode === 'current') showCurrent(options);
  else if (HISTORY_MODES.has(mode)) void showHistory(mode, options);
  else void showLazyView(mode, options);
}

function syncFromLocation() {
  const mode = modeFromLocation();
  if (mode !== activeMode) showMode(mode, { updateUrl: false });
}

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !tabs.contains(button)) return;
  const mode = button.dataset.view || button.dataset.mode;
  if (!mode || !VIEW_MODES.has(mode)) return;
  event.preventDefault();
  if (HISTORY_MODES.has(mode)) {
    if (modulePromises.has('history-runtime')) historyRuntimeMode = mode;
    void showHistory(mode, { syncRuntime: false });
  } else {
    showMode(mode);
  }
}, { capture: true });

window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

void Promise.all([
  ensureLazyShell('amazon-music'),
  ensureLazyShell('apple-music'),
]).catch((error) => {
  console.error('music tab shell failed to start', error);
});

const initialMode = modeFromLocation();
showMode(initialMode, {
  updateUrl: initialMode === 'current' && Boolean(location.hash),
  replaceUrl: true,
  syncRuntime: false,
});
