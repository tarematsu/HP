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

  if (hasVisibleLoginPrompt()) {
    if (state) state.fullscreenDirty = true;
    return;
  }
  if (isFullscreen()) {
    if (state) state.fullscreenDirty = false;
    return;
  }
  if (window.__homePanelTverFullscreenPending) return;

  // A trusted CDP click completes asynchronously relative to this callback.
  // Keep the action consumed for a short grace period so a second click cannot
  // immediately toggle fullscreen back off before fullscreenchange is observed.
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(() => {
    window.__homePanelTverFullscreenPending = false;
    const latestState = window.__homePanelSakuraMeetsState;
    if (hasVisibleLoginPrompt()) {
      if (latestState) latestState.fullscreenDirty = true;
      return;
    }
    if (isFullscreen()) {
      if (latestState) latestState.fullscreenDirty = false;
      return;
    }
    if (latestState) latestState.fullscreenDirty = true;
    try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
    catch (_) {}
  }, 800);
})()
)JS"