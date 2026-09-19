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
  const fullscreenTarget = () => {
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(element => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
    }) || videos[0] || null;
    if (!video) return null;
    return video.closest(
        '[data-testid*="player" i], [class*="player" i], [id*="player" i]') ||
        video.parentElement || video;
  };
  const requestBrowserFullscreen = () => {
    const target = fullscreenTarget();
    if (!target) return false;
    const request = target.requestFullscreen || target.webkitRequestFullscreen ||
        target.msRequestFullscreen;
    if (typeof request !== 'function') return false;
    try {
      const pending = request.call(target);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
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

  // The trusted native key/click has just completed. Consume any remaining
  // transient user activation by requesting browser fullscreen directly; if
  // TVer's own control already handled the gesture this is a harmless no-op.
  requestBrowserFullscreen();

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