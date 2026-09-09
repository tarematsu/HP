// Trusted YouTube action bridge.
//
// The watchdog decides WHAT should happen. This module owns HOW a verified DOM
// control receives the native WebView2 CDP click without stale coordinates
// falling through to the video surface. It is installed once per WebView source.
namespace {
constexpr wchar_t kNativeMediaYoutubeTrustedActionBootstrapScript[] = LR"JS(
(() => {
  if (window.__homePanelYoutubeTrustedAction) return null;

  const player = () => document.querySelector('#movie_player');
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const text = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent
  ].filter(Boolean).join(' '));
  const valid = element => Boolean(
    element && element.isConnected && !element.disabled &&
    element.getAttribute?.('aria-disabled') !== 'true');
  const ad = () => {
    const root = player();
    return Boolean(root && (root.classList.contains('ad-showing') ||
        root.classList.contains('ad-interrupting')));
  };
  const fullscreen = () => {
    const root = player();
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement ||
        root?.classList.contains('ytp-fullscreen'));
  };

  const state = { action: '', at: 0, cleanup: null };
  const reserve = (action, cooldownMs) => {
    const now = Date.now();
    if (state.action === action && now - state.at < cooldownMs) return false;
    state.action = action;
    state.at = now;
    return true;
  };

  const arm = (element, action, cooldownMs) => {
    if (!valid(element) || !reserve(action, cooldownMs)) return null;
    if (typeof state.cleanup === 'function') state.cleanup();

    const originalStyle = element.getAttribute('style');
    const originalAriaHidden = element.getAttribute('aria-hidden');
    let timer = 0;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      element.removeEventListener('click', onClick, true);
      if (element.isConnected) {
        if (originalStyle === null) element.removeAttribute('style');
        else element.setAttribute('style', originalStyle);
        if (originalAriaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', originalAriaHidden);
      }
      if (state.cleanup === cleanup) state.cleanup = null;
    };
    const reject = event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cleanup();
    };
    function onClick(event) {
      if (!valid(element)) return reject(event);
      if (action === 'skip-ad' && !ad()) return reject(event);
      if (action === 'play') {
        const video = player()?.querySelector('video');
        if (ad() || !video || video.ended || !video.paused) return reject(event);
      }
      if (action === 'fullscreen') {
        const root = player();
        if (ad() || fullscreen() || !root) return reject(event);
        const request = root.requestFullscreen || root.webkitRequestFullscreen ||
            root.webkitRequestFullScreen;
        if (typeof request === 'function') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          try {
            const pending = request.call(root);
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
          } catch (_) {}
        }
      }
      setTimeout(cleanup, 0);
    }

    // Move the REAL validated control to a stable hit target. The CDP click is
    // therefore delivered to YouTube as an isTrusted event; skip-ad does not
    // depend on a synthetic element.click().
    element.style.setProperty('position', 'fixed', 'important');
    element.style.setProperty('left', 'calc(50vw - 48px)', 'important');
    element.style.setProperty('top', 'calc(50vh - 48px)', 'important');
    element.style.setProperty('width', '96px', 'important');
    element.style.setProperty('height', '96px', 'important');
    element.style.setProperty('margin', '0', 'important');
    element.style.setProperty('padding', '0', 'important');
    element.style.setProperty('transform', 'none', 'important');
    element.style.setProperty('opacity', '0', 'important');
    element.style.setProperty('visibility', 'visible', 'important');
    element.style.setProperty('display', 'block', 'important');
    element.style.setProperty('pointer-events', 'auto', 'important');
    element.style.setProperty('z-index', '2147483647', 'important');
    element.removeAttribute('aria-hidden');
    element.addEventListener('click', onClick, true);
    state.cleanup = cleanup;
    timer = setTimeout(cleanup, 1400);
    return [5000, 5000];
  };

  window.__homePanelYoutubeTrustedAction = { text, valid, ad, fullscreen, arm };
  return null;
})()
)JS";
}  // namespace
