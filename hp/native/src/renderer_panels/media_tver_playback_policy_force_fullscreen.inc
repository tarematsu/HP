LR"JS(
(() => {
  const state = window.__homePanelSakuraMeetsState;
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
  const isFullscreen = () => !!(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  const wake = () => {
    try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
    catch (_) {}
  };

  if (hasVisibleLoginPrompt()) {
    if (state) state.fullscreenDirty = true;
    if (state) state.fullscreenKeyRequestedAt = 0;
    return;
  }
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
    if (hasVisibleLoginPrompt()) {
      if (latestState) {
        latestState.fullscreenDirty = true;
        latestState.fullscreenKeyRequestedAt = 0;
      }
      return;
    }
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