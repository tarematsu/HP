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

  // Only escalate a click that the TVer runtime explicitly issued as its
  // fullscreen corner tap. Questionnaire, Play, quality and ad-skip trusted
  // clicks also pass through this verifier and must not trigger fullscreen.
  const fullscreenTapPending = !entered && state?.fullscreenCornerTapAt &&
      Date.now() - state.fullscreenCornerTapAt <= 3000;
  if (fullscreenTapPending) {
    try { window.chrome?.webview?.postMessage('homepanel:tver-fullscreen-key'); }
    catch (_) {}
  }

  try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
  catch (_) {}
  return entered;
})()
)JS"