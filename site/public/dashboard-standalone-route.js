import { byId } from './dashboard-ui-common.js?v=20260930.1';

export function registerStandaloneDashboardRoute({
  mode,
  viewId,
  noticeId,
  runtimeUrl,
  loadExport,
  errorMessage,
  errorLabel = mode,
} = {}) {
  if (!mode || !viewId || !runtimeUrl) throw new Error('standalone dashboard route config is incomplete');

  let active = false;
  let runtimePromise = null;
  const tabs = () => byId('modeTabs');
  const view = () => byId(viewId);

  function updateTabState(enabled) {
    tabs()?.querySelectorAll('button').forEach((button) => {
      const selected = enabled && button.dataset.view === mode;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else if (enabled) button.removeAttribute('aria-current');
    });
  }

  function deactivate() {
    active = false;
    const node = view();
    if (node) node.hidden = true;
  }

  function showOnly() {
    const node = view();
    if (!node) return false;
    document.querySelectorAll('.dashboard-view').forEach((item) => {
      item.hidden = item !== node;
    });
    updateTabState(true);
    active = true;
    return true;
  }

  function loadRuntime() {
    if (!runtimePromise) {
      runtimePromise = import(runtimeUrl).catch((error) => {
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise;
  }

  async function activate({ updateUrl = true, replaceUrl = false } = {}) {
    if (!showOnly()) return;
    if (updateUrl) {
      const target = `/#${mode}`;
      const current = `${location.pathname}${location.search}${location.hash}`;
      if (current !== target) history[replaceUrl ? 'replaceState' : 'pushState'](null, '', target);
    }
    window.dispatchEvent(new Event('dashboard:route-ready'));
    try {
      const runtime = await loadRuntime();
      if (!active) return;
      if (loadExport && typeof runtime?.[loadExport] === 'function') await runtime[loadExport]();
    } catch (error) {
      if (!active) return;
      console.error(`${errorLabel} runtime failed to start`, error);
      const notice = noticeId ? byId(noticeId) : null;
      if (notice) {
        notice.textContent = errorMessage || 'データの初期化に失敗しました。再読み込みしてください。';
        notice.classList.add('error');
        notice.hidden = false;
      }
    }
  }

  function selectedKnownButton(nextMode) {
    if (!nextMode || nextMode === 'current') return tabs()?.querySelector('button[data-view="current"]');
    return tabs()?.querySelector(`button[data-view="${CSS.escape(nextMode)}"], button[data-mode="${CSS.escape(nextMode)}"]`);
  }

  function leaveForLocation() {
    if (!active) return;
    deactivate();
    const nextMode = location.hash.slice(1) || 'current';
    const button = selectedKnownButton(nextMode) || selectedKnownButton('current');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest(`#modeTabs button[data-view="${CSS.escape(mode)}"]`);
    if (!button) {
      if (active && event.target.closest('#modeTabs button')) deactivate();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void activate();
  }, { capture: true });

  const syncLocation = (event) => {
    if (location.hash === `#${mode}`) {
      event.stopImmediatePropagation();
      void activate({ updateUrl: false });
      return;
    }
    leaveForLocation();
  };
  window.addEventListener('popstate', syncLocation, { capture: true });
  window.addEventListener('hashchange', syncLocation, { capture: true });

  if (location.hash === `#${mode}`) {
    queueMicrotask(() => void activate({ updateUrl: true, replaceUrl: true }));
  }

  return { activate, deactivate };
}
