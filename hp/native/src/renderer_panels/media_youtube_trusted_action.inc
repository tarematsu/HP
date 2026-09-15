// Minimal trusted YouTube control bridge. The watchdog chooses the action; this
// helper only exposes a verified real control at a stable CDP click target.
namespace {
constexpr wchar_t kNativeMediaYoutubeTrustedActionBootstrapScript[] = LR"JS(
(() => {
  if (window.__homePanelYoutubeTrustedAction) return null;

  const player = () => document.querySelector('#movie_player');
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const text = element => normalize(
      element?.getAttribute?.('aria-label') ||
      element?.getAttribute?.('title') ||
      element?.textContent);
  const valid = element => Boolean(
      element?.isConnected && !element.disabled &&
      element.getAttribute?.('aria-disabled') !== 'true');
  const ad = () => {
    const root = player();
    return Boolean(root && (root.classList.contains('ad-showing') ||
        root.classList.contains('ad-interrupting')));
  };
  const fullscreen = () => Boolean(
      document.fullscreenElement || document.webkitFullscreenElement ||
      player()?.classList.contains('ytp-fullscreen'));

  const state = { action: '', at: 0, cleanup: null };
  const arm = (element, action, cooldownMs) => {
    const now = Date.now();
    if (!valid(element) ||
        (state.action === action && now - state.at < cooldownMs)) return null;
    state.cleanup?.();
    state.action = action;
    state.at = now;

    const css = element.style.cssText;
    const hidden = element.getAttribute('aria-hidden');
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener('click', onClick, true);
      if (element.isConnected) {
        element.style.cssText = css;
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      }
      if (state.cleanup === cleanup) state.cleanup = null;
    };
    const reject = event => {
      event.preventDefault();
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
      if (action === 'fullscreen' && fullscreen()) return reject(event);
      setTimeout(cleanup, 0);
    }

    const style = {
      position: 'fixed', left: 'calc(50vw - 48px)',
      top: 'calc(50vh - 48px)', width: '96px', height: '96px',
      margin: '0', padding: '0', transform: 'none', opacity: '0',
      visibility: 'visible', display: 'block', 'pointer-events': 'auto',
      'z-index': '2147483647'
    };
    for (const [name, value] of Object.entries(style)) {
      element.style.setProperty(name, value, 'important');
    }
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
