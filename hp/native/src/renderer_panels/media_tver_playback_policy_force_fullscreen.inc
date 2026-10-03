LR"JS(
(() => {
  const entered = !!(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  const state = window.__homePanelTverRuntime;

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

  // The normal runtime first performs a trusted click near TVer's native
  // fullscreen control. If CSS/layout changes make that control unusable,
  // escalate through the native bridge. The native side evaluates the real
  // Fullscreen API with userGesture=true and falls back to a trusted F key.
  if (!entered) {
    try { window.chrome?.webview?.postMessage('homepanel:tver-fullscreen-key'); }
    catch (_) {}
  }

  try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
  catch (_) {}
  return entered;
})()
)JS"