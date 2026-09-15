LR"JS(
(() => {
  if (window.__homePanelTverFullscreenPending) return;
  const state = window.__homePanelSakuraMeetsState;
  if (state && state.fullscreenDirty === false) return;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const hasVisibleLoginPrompt = () => Array.from(document.querySelectorAll(
      'button, a, [role="button"], [role="dialog"], [aria-modal="true"], '
      + 'h1, h2, h3, [aria-label], [title]')).some(element => {
    if (!visible(element)) return false;
    const label = normalize(
        (element.getAttribute('aria-label') || '') + ' ' +
        (element.getAttribute('title') || '') + ' ' +
        (element.textContent || '')).toLowerCase();
    return label.includes('ログイン') || /\b(?:log\s*in|sign\s*in)\b/i.test(label);
  });

  // Login is user-controlled. Keep the fullscreen attempt pending so it can be
  // retried after authentication instead of consuming the one-shot here.
  if (hasVisibleLoginPrompt()) return;

  // Consume the per-video fullscreen attempt before the asynchronous fallback.
  // Failure is intentionally not retried until the media identity changes.
  if (state) state.fullscreenDirty = false;
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(async () => {
    window.__homePanelTverFullscreenPending = false;
    try {
      // The login prompt can appear after the trusted click but before this
      // delayed fullscreen request. Restore the pending attempt in that case.
      if (hasVisibleLoginPrompt()) {
        if (state) state.fullscreenDirty = true;
        return;
      }
      if (document.fullscreenElement || document.webkitFullscreenElement ||
          document.msFullscreenElement) return;
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