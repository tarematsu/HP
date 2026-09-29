import './followers-shell.js?v=20260930.1';

let followersActive = false;
let runtimePromise = null;

function tabs() {
  return document.getElementById('modeTabs');
}

function followerView() {
  return document.getElementById('followersView');
}

function updateTabState(active) {
  tabs()?.querySelectorAll('button').forEach((button) => {
    const selected = active && button.dataset.view === 'followers';
    if (selected) {
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    } else if (active) {
      button.classList.remove('active');
      button.removeAttribute('aria-current');
    }
  });
}

function deactivateFollowers() {
  followersActive = false;
  const view = followerView();
  if (view) view.hidden = true;
}

function showOnlyFollowers() {
  const view = followerView();
  if (!view) return false;
  document.querySelectorAll('.dashboard-view').forEach((node) => {
    node.hidden = node !== view;
  });
  updateTabState(true);
  followersActive = true;
  return true;
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('/followers.js?v=20260930.1').catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function activateFollowers({ updateUrl = true, replaceUrl = false } = {}) {
  if (!showOnlyFollowers()) return;
  if (updateUrl) {
    const target = '/#followers';
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current !== target) history[replaceUrl ? 'replaceState' : 'pushState'](null, '', target);
  }
  window.dispatchEvent(new Event('dashboard:route-ready'));
  try {
    const runtime = await loadRuntime();
    if (!followersActive) return;
    await runtime.loadFollowersView?.();
  } catch (error) {
    if (!followersActive) return;
    console.error('followers runtime failed to start', error);
    const notice = document.getElementById('followersNotice');
    if (notice) {
      notice.textContent = 'フォロワーデータの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  }
}

function selectedKnownButton(mode) {
  if (!mode || mode === 'current') return tabs()?.querySelector('button[data-view="current"]');
  return tabs()?.querySelector(`button[data-view="${CSS.escape(mode)}"], button[data-mode="${CSS.escape(mode)}"]`);
}

function leaveFollowersForLocation() {
  if (!followersActive) return;
  deactivateFollowers();
  const mode = location.hash.slice(1) || 'current';
  const button = selectedKnownButton(mode) || selectedKnownButton('current');
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('#modeTabs button[data-view="followers"]');
  if (!button) {
    if (followersActive && event.target.closest('#modeTabs button')) deactivateFollowers();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void activateFollowers();
}, { capture: true });

window.addEventListener('popstate', (event) => {
  if (location.hash === '#followers') {
    event.stopImmediatePropagation();
    void activateFollowers({ updateUrl: false });
    return;
  }
  leaveFollowersForLocation();
}, { capture: true });

window.addEventListener('hashchange', (event) => {
  if (location.hash === '#followers') {
    event.stopImmediatePropagation();
    void activateFollowers({ updateUrl: false });
    return;
  }
  leaveFollowersForLocation();
}, { capture: true });

if (location.hash === '#followers') {
  queueMicrotask(() => void activateFollowers({ updateUrl: true, replaceUrl: true }));
}
