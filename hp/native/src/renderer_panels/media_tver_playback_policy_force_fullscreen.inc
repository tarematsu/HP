LR"JS(
(() => {
  const state = window.__homePanelSakuraMeetsState;
  const isFullscreen = () => !!(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  const wake = () => {
    try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
    catch (_) {}
  };

  if (isFullscreen()) {
    if (state) {
      state.fullscreenDirty = false;
      state.fullscreenKeyRequestedAt = 0;
    }
    wake();
    return;
  }
  if (window.__homePanelTverFullscreenPending) return;

  // Trusted keyboard/click fullscreen actions settle asynchronously. Keep the
  // action consumed briefly so a second action cannot immediately toggle it off.
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(() => {
    window.__homePanelTverFullscreenPending = false;
    const latestState = window.__homePanelSakuraMeetsState;
    if (isFullscreen()) {
      if (latestState) {
        latestState.fullscreenDirty = false;
        latestState.fullscreenKeyRequestedAt = 0;
      }
      wake();
      return;
    }
    if (latestState) latestState.fullscreenDirty = true;
    wake();
  }, 800);
})()
)JS"