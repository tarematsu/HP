import './hinata-shell.js?v=20260930.4';

let hinataActive = false;
let runtimePromise = null;

function tabs() {
  return document.getElementById('modeTabs');
}

function hinataView() {
  return document.getElementById('hinataView');
}

function updateTabState(active) {
  tabs()?.querySelectorAll('button').forEach((button) => {
    const selected = active && button.dataset.view === 'hinata';
    if (selected) {
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    } else if (active) {
      button.classList.remove('active');
      button.removeAttribute('aria-current');
    }
  });
}

function deactivateHinata() {
  hinataActive = false;
  const view = hinataView();
  if (view) view.hidden = true;
}

function showOnlyHinata() {
  const view = hinataView();
  if (!view) return false;
  document.querySelectorAll('.dashboard-view').forEach((node) => {
    node.hidden = node !== view;
  });
  updateTabState(true);
  hinataActive = true;
  return true;
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('/hinata.js?v=20260930.3').catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function activateHinata({ updateUrl = true, replaceUrl = false } = {}) {
  if (!showOnlyHinata()) return;
  if (updateUrl) {
    const target = '/#hinata';
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current !== target) history[replaceUrl ? 'replaceState' : 'pushState'](null, '', target);
  }
  window.dispatchEvent(new Event('dashboard:route-ready'));
  try {
    const runtime = await loadRuntime();
    if (!hinataActive) return;
    await runtime.loadHinataView?.();
  } catch (error) {
    if (!hinataActive) return;
    console.error('hinata runtime failed to start', error);
    const notice = document.getElementById('hinataNotice');
    if (notice) {
      notice.textContent = '日向坂データの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  }
}

function selectedKnownButton(mode) {
  if (!mode || mode === 'current') return tabs()?.querySelector('button[data-view="current"]');
  return tabs()?.querySelector(`button[data-view="${CSS.escape(mode)}"], button[data-mode="${CSS.escape(mode)}"]`);
}

function leaveHinataForLocation() {
  if (!hinataActive) return;
  deactivateHinata();
  const mode = location.hash.slice(1) || 'current';
  const button = selectedKnownButton(mode) || selectedKnownButton('current');
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('#modeTabs button[data-view="hinata"]');
  if (!button) {
    if (hinataActive && event.target.closest('#modeTabs button')) deactivateHinata();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void activateHinata();
}, { capture: true });

window.addEventListener('popstate', (event) => {
  if (location.hash === '#hinata') {
    event.stopImmediatePropagation();
    void activateHinata({ updateUrl: false });
    return;
  }
  leaveHinataForLocation();
}, { capture: true });

window.addEventListener('hashchange', (event) => {
  if (location.hash === '#hinata') {
    event.stopImmediatePropagation();
    void activateHinata({ updateUrl: false });
    return;
  }
  leaveHinataForLocation();
}, { capture: true });

if (location.hash === '#hinata') {
  queueMicrotask(() => void activateHinata({ updateUrl: true, replaceUrl: true }));
}
