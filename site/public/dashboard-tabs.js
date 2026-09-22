const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);
const VIEW_MODES = new Set(['current', ...HISTORY_MODES, 'likes', 'unofficial']);

const currentView = document.getElementById('currentView');
const historyView = document.getElementById('historyView');
const likesView = document.getElementById('likesView');
const unofficialView = document.getElementById('unofficialView');
const tabs = document.getElementById('modeTabs');
const skipLink = document.querySelector('.skip-link');
let historyRuntimePromise = null;
let likesRuntimePromise = null;
let historyRuntimeMode = null;
let activeMode = 'current';

function releaseUnexpectedSkipLinkFocus() {
  if (document.activeElement === skipLink) skipLink?.blur();
  document.documentElement.classList.remove('keyboard-navigation');
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
  if (currentView) currentView.hidden = view !== currentView;
  if (historyView) historyView.hidden = view !== historyView;
  if (likesView) likesView.hidden = view !== likesView;
  if (unofficialView) unofficialView.hidden = view !== unofficialView;
}

function showCurrent({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'current';
  showOnly(currentView);
  updateTabs('current');
  if (updateUrl) updateLocation('current', { replace: replaceUrl });
}

async function loadHistoryRuntime() {
  if (!historyRuntimePromise) {
    historyRuntimePromise = import('/history/history-main.js?v=20260923.5').catch((error) => {
      historyRuntimePromise = null;
      historyRuntimeMode = null;
      throw error;
    });
  }
  return historyRuntimePromise;
}

async function loadLikesRuntime() {
  if (!likesRuntimePromise) {
    likesRuntimePromise = import('/history/history-likes.js?v=20260923.4').catch((error) => {
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
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showLikes({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'likes';
  showOnly(likesView);
  updateTabs('likes');
  if (updateUrl) updateLocation('likes', { replace: replaceUrl });

  try {
    await loadLikesRuntime();
  } catch (error) {
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

function showUnofficial({ updateUrl = true, replaceUrl = false } = {}) {
  activeMode = 'unofficial';
  showOnly(unofficialView);
  updateTabs('unofficial');
  if (updateUrl) updateLocation('unofficial', { replace: replaceUrl });
  releaseUnexpectedSkipLinkFocus();
}

function modeFromLocation() {
  const mode = location.hash.slice(1);
  return VIEW_MODES.has(mode) ? mode : 'current';
}

function showMode(mode, options = {}) {
  if (mode === 'current') showCurrent(options);
  else if (mode === 'likes') void showLikes(options);
  else if (mode === 'unofficial') showUnofficial(options);
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
  if (button.dataset.view === 'likes') {
    void showLikes();
    return;
  }
  if (button.dataset.view === 'unofficial') {
    showUnofficial();
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
