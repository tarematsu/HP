LR"JS(
(() => {
  const isFullscreen = () => !!(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  const entered = isFullscreen();
  const state = window.__homePanelTverRuntime;
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); }
    catch (_) {}
  };

  // Keep TVer's real fullscreen control available even when aggressive CSS
  // reduction or responsive player styles would otherwise hide it. This is
  // deliberately scoped to fullscreen controls only; the rest of TVer's UI is
  // left untouched.
  try {
    const root = document.head || document.documentElement;
    if (root) {
      const id = '__homePanelTverFullscreenControlGuard';
      let style = document.getElementById(id);
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        root.appendChild(style);
      }
      style.textContent = [
        'button[aria-label*="全画面"]',
        'button[title*="全画面"]',
        '[role="button"][aria-label*="全画面"]',
        '[role="button"][title*="全画面"]',
        'button[aria-label*="fullscreen" i]',
        'button[title*="fullscreen" i]',
        '[role="button"][aria-label*="fullscreen" i]',
        '[role="button"][title*="fullscreen" i]',
        '[data-testid*="fullscreen" i]'
      ].join(',') +
          '{display:flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;}';
    }
  } catch (_) {}

  if (entered && state) state.fullscreenCornerTapAt = 0;

  const fullscreenTapPending = !entered && state?.fullscreenCornerTapAt &&
      Date.now() - state.fullscreenCornerTapAt <= 3000;
  if (fullscreenTapPending) {
    const fullscreenTarget = () => {
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos.find(element => {
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        try {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        } catch (_) {
          return true;
        }
      }) || videos[0] || null;
      if (!video) return null;
      return video.closest(
          '[data-testid*="player" i],[class*="player" i],[id*="player" i]') ||
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

    // This verifier runs immediately after the trusted CDP mouse release. Use
    // that transient activation directly first; Runtime.evaluate(userGesture)
    // and the trusted F key remain the delayed fallback if TVer rejects it.
    if (!requestBrowserFullscreen()) {
      post('homepanel:tver-fullscreen-key');
    } else {
      window.setTimeout(() => {
        if (isFullscreen()) {
          if (state) state.fullscreenCornerTapAt = 0;
        } else {
          post('homepanel:tver-fullscreen-key');
        }
        post('homepanel:tver-wake');
      }, 600);
    }
  }

  post('homepanel:tver-wake');
  return entered;
})()
)JS"