LR"JS(
(() => {
  if (window.__homePanelTverFullscreenPending) return;
  const state = window.__homePanelSakuraMeetsState;
  if (state && state.fullscreenDirty === false) return;
  // Consume the per-video fullscreen attempt before the asynchronous fallback.
  // Failure is intentionally not retried until the media identity changes.
  if (state) state.fullscreenDirty = false;
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(async () => {
    window.__homePanelTverFullscreenPending = false;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement ||
          document.msFullscreenElement) return;
      const visible = element => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
               rect.width > 0 && rect.height > 0;
      };
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos.find(visible) || videos[0] || null;
      if (!video) return;
      const candidates = [video, video.parentElement].filter(Boolean);
      for (const target of candidates) {
        const request = target.requestFullscreen || target.webkitRequestFullscreen ||
            target.msRequestFullscreen;
        if (typeof request !== 'function') continue;
        try {
          const result = request.call(target);
          if (result && typeof result.then === 'function') await result;
          if (document.fullscreenElement || document.webkitFullscreenElement ||
              document.msFullscreenElement) {
            if (state) state.fullscreenDirty = false;
            return;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, 180);
})()
)JS"