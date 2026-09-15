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

  if (hasVisibleLoginPrompt()) {
    if (state) state.fullscreenDirty = true;
    return;
  }
  if (document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement) {
    if (state) state.fullscreenDirty = false;
    return;
  }

  // Never depend on a page-script fullscreen API. If the trusted CDP click did
  // not enter fullscreen, mark the action dirty again and wake the native
  // watchdog so it can dispatch another trusted pointer click in background.
  if (state) state.fullscreenDirty = true;
  try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
  catch (_) {}
})()
)JS"