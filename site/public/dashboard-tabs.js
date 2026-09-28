const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);
const VIEW_MODES = new Set(['current', ...HISTORY_MODES, 'first-week', 'played-tracks', 'spotify', 'likes']);
const VIEW_IDS = ['currentView', 'historyView', 'firstWeekView', 'playedTracksView', 'spotifyView', 'likesView'];

const currentView = document.getElementById('currentView');
const historyView = document.getElementById('historyView');
const likesView = document.getElementById('likesView');
const tabs = document.getElementById('modeTabs');
const skipLink = document.querySelector('.skip-link');
let historyRuntimePromise = null;
let rankingStatusRuntimePromise = null;
let firstWeekShellPromise = null;
let firstWeekRuntimePromise = null;
let playedTracksShellPromise = null;
let playedTracksRuntimePromise = null;
let spotifyShellPromise = null;
let spotifyRuntimePromise = null;
let likesRuntimePromise = null;
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

function showCurrent({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'current';
  showOnly(currentView);
  updateTabs('current');
  if (updateUrl) updateLocation('current', { replace: replaceUrl });
  markRouteReady();
}

function ensureFirstWeekShell() {
  if (!firstWeekShellPromise) {
    firstWeekShellPromise = import('/first-week-comparison-shell.js?v=20260928.1').catch((error) => {
      firstWeekShellPromise = null;
      throw error;
    });
  }
  return firstWeekShellPromise;
}

function ensurePlayedTracksShell() {
  if (!playedTracksShellPromise) {
    playedTracksShellPromise = import('/played-tracks-shell.js?v=20260928.1').catch((error) => {
      playedTracksShellPromise = null;
      throw error;
    });
  }
  return playedTracksShellPromise;
}

function ensureSpotifyShell() {
  if (!spotifyShellPromise) {
    spotifyShellPromise = import('/spotify-shell.js?v=20260929.1').catch((error) => {
      spotifyShellPromise = null;
      throw error;
    });
  }
  return spotifyShellPromise;
}

async function loadRankingStatusRuntime() {
  if (!rankingStatusRuntimePromise) {
    rankingStatusRuntimePromise = import('/history/history-ranking-table-status.js?v=20260923.2').catch((error) => {
      rankingStatusRuntimePromise = null;
      throw error;
    });
  }
  return rankingStatusRuntimePromise;
}

async function loadHistoryRuntime() {
  if (!historyRuntimePromise) {
    historyRuntimePromise = import('/history/history-main.js?v=20260928.1').catch((error) => {
      historyRuntimePromise = null;
      historyRuntimeMode = null;
      throw error;
    });
  }
  return historyRuntimePromise;
}

async function loadFirstWeekRuntime() {
  if (!firstWeekRuntimePromise) {
    firstWeekRuntimePromise = import('/first-week-comparison.js?v=20260927.1').catch((error) => {
      firstWeekRuntimePromise = null;
      throw error;
    });
  }
  return firstWeekRuntimePromise;
}

async function loadPlayedTracksRuntime() {
  if (!playedTracksRuntimePromise) {
    playedTracksRuntimePromise = import('/played-tracks.js?v=20260927.2').catch((error) => {
      playedTracksRuntimePromise = null;
      throw error;
    });
  }
  return playedTracksRuntimePromise;
}

async function loadSpotifyRuntime() {
  if (!spotifyRuntimePromise) {
    spotifyRuntimePromise = import('/spotify.js?v=20260929.1').catch((error) => {
      spotifyRuntimePromise = null;
      throw error;
    });
  }
  return spotifyRuntimePromise;
}

async function loadLikesRuntime() {
  if (!likesRuntimePromise) {
    likesRuntimePromise = import('/history/history-likes.js?v=20260925.1').catch((error) => {
      likesRuntimePromise = null;
      throw error;
    });
  }
  return likesRuntimePromise;
}

async function showHistory(mode, { updateUrl = true, replaceUrl = false, syncRuntime = true } = {}) {
  if (!HISTORY_MODES.has(mode)) {
    showCurrent({ updateUrl, replaceUrl });
    return;
  }

  activeMode = mode;
  showOnly(historyView);
  updateTabs(mode);
  if (updateUrl) updateLocation(mode, { replace: replaceUrl });
  markRouteReady();

  try {
    if (mode === 'ranking') {
      await loadRankingStatusRuntime();
      if (activeMode !== mode) return;
    }
    await loadHistoryRuntime();
    if (activeMode !== mode) return;
    if (syncRuntime && historyRuntimeMode !== mode) {
      tabs?.querySelector(`button[data-mode="${mode}"]`)
        ?.dispatchEvent(new Event('click'));
    }
    if (activeMode !== mode) return;
    historyRuntimeMode = mode;
  } catch (error) {
    if (activeMode !== mode) return;
    console.error('history runtime failed to start', error);
    const notice = document.getElementById('notice');
    if (notice) {
      notice.textContent = '過去データの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
    }
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showFirstWeek({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'first-week';
  showOnly(null);
  updateTabs('first-week');
  if (updateUrl) updateLocation('first-week', { replace: replaceUrl });

  try {
    await ensureFirstWeekShell();
    if (activeMode !== 'first-week') return;
    const view = document.getElementById('firstWeekView');
    showOnly(view);
    markRouteReady();
    const runtime = await loadFirstWeekRuntime();
    if (activeMode !== 'first-week') return;
    await runtime.loadFirstWeekComparisonView?.();
  } catch (error) {
    if (activeMode !== 'first-week') return;
    markRouteReady();
    console.error('first-week runtime failed to start', error);
    const notice = document.getElementById('firstWeekNotice');
    if (notice) {
      notice.textContent = '初週比較データの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showPlayedTracks({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'played-tracks';
  showOnly(null);
  updateTabs('played-tracks');
  if (updateUrl) updateLocation('played-tracks', { replace: replaceUrl });

  try {
    await ensurePlayedTracksShell();
    if (activeMode !== 'played-tracks') return;
    const view = document.getElementById('playedTracksView');
    showOnly(view);
    markRouteReady();
    await loadPlayedTracksRuntime();
  } catch (error) {
    if (activeMode !== 'played-tracks') return;
    markRouteReady();
    console.error('played tracks runtime failed to start', error);
    const notice = document.getElementById('playedTracksNotice');
    if (notice) {
      notice.textContent = '再生履歴データの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showSpotify({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'spotify';
  showOnly(null);
  updateTabs('spotify');
  if (updateUrl) updateLocation('spotify', { replace: replaceUrl });

  try {
    await ensureSpotifyShell();
    if (activeMode !== 'spotify') return;
    const view = document.getElementById('spotifyView');
    showOnly(view);
    markRouteReady();
    const runtime = await loadSpotifyRuntime();
    if (activeMode !== 'spotify') return;
    await runtime.loadSpotifyView?.();
  } catch (error) {
    if (activeMode !== 'spotify') return;
    markRouteReady();
    console.error('spotify runtime failed to start', error);
    const notice = document.getElementById('spotifyNotice');
    if (notice) {
      notice.textContent = 'Spotify再生数の初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showLikes({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'likes';
  showOnly(likesView);
  updateTabs('likes');
  if (updateUrl) updateLocation('likes', { replace: replaceUrl });
  markRouteReady();

  try {
    await loadLikesRuntime();
  } catch (error) {
    if (activeMode !== 'likes') return;
    console.error('likes runtime failed to start', error);
    const notice = document.getElementById('likesNotice');
    if (notice) {
      notice.textContent = 'いいねデータの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
    }
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
  else if (mode === 'first-week') void showFirstWeek(options);
  else if (mode === 'played-tracks') void showPlayedTracks(options);
  else if (mode === 'spotify') void showSpotify(options);
  else if (mode === 'likes') void showLikes(options);
  else void showHistory(mode, options);
}

function syncFromLocation() {
  const mode = modeFromLocation();
  if (mode === activeMode) return;
  showMode(mode, { updateUrl: false });
}

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !tabs.contains(button)) return;
  event.preventDefault();

  if (button.dataset.view === 'current') {
    showCurrent();
    return;
  }
  if (button.dataset.view === 'first-week') {
    void showFirstWeek();
    return;
  }
  if (button.dataset.view === 'played-tracks') {
    void showPlayedTracks();
    return;
  }
  if (button.dataset.view === 'spotify') {
    void showSpotify();
    return;
  }
  if (button.dataset.view === 'likes') {
    void showLikes();
    return;
  }
  if (button.dataset.mode) {
    if (historyRuntimePromise) historyRuntimeMode = button.dataset.mode;
    void showHistory(button.dataset.mode, { syncRuntime: false });
  }
}, { capture: true });

window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

const initialMode = modeFromLocation();
showMode(initialMode, {
  updateUrl: initialMode === 'current' && Boolean(location.hash),
  replaceUrl: true,
  syncRuntime: false,
});
