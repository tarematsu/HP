// Event-driven YouTube wake agent.
//
// The expensive recovery policy remains native-owned and trusted-input based.
// This page-local helper only reports state transitions that merit an immediate
// watchdog pass, allowing the steady native watchdog cadence to stay very low.
namespace {
constexpr wchar_t kNativeMediaYoutubeEventAgentScript[] = LR"JS(
(() => {
  if ((location.hostname !== 'www.youtube.com' &&
       location.hostname !== 'youtube.com') ||
      !location.pathname.startsWith('/watch')) return null;

  const player = document.querySelector('#movie_player');
  if (!player) return null;
  const existing = window.__homePanelYoutubeEventAgent;
  if (existing && existing.player === player) return true;
  if (existing) {
    try { existing.playerObserver?.disconnect(); } catch (_) {}
    try { existing.classObserver?.disconnect(); } catch (_) {}
  }

  const state = {
    player,
    video: null,
    wakeAt: 0,
    playerObserver: null,
    classObserver: null,
  };
  window.__homePanelYoutubeEventAgent = state;

  const wake = () => {
    const now = Date.now();
    if (now - state.wakeAt < 250) return;
    state.wakeAt = now;
    try {
      window.chrome?.webview?.postMessage('homepanel:youtube-wake');
    } catch (_) {}
  };

  const bindVideo = () => {
    const video = player.querySelector('video');
    if (!video || state.video === video) return;
    state.video = video;
    for (const eventName of [
        'play', 'pause', 'ended', 'error', 'loadedmetadata', 'emptied']) {
      video.addEventListener(eventName, wake, { passive: true });
    }
    wake();
  };

  const interestingSelector = [
    'video',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot',
    '.ytp-ad-skip-button-container',
    '.ytp-ad-survey',
    '.ytp-ad-feedback-dialog',
    'yt-survey-renderer',
    'ytd-survey-renderer',
    '[role="dialog"]'
  ].join(',');

  if (typeof MutationObserver === 'function') {
    state.playerObserver = new MutationObserver(mutations => {
      let interesting = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node;
          if (element.matches?.(interestingSelector) ||
              element.querySelector?.(interestingSelector)) {
            interesting = true;
            break;
          }
        }
        if (interesting) break;
      }
      if (!interesting) return;
      bindVideo();
      wake();
    });
    state.playerObserver.observe(player, { childList: true, subtree: true });

    // YouTube signals ad transitions primarily by toggling player classes. Watch
    // only that one attribute on the one player node rather than page-wide DOM.
    state.classObserver = new MutationObserver(wake);
    state.classObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  document.addEventListener('fullscreenchange', wake, true);
  document.addEventListener('webkitfullscreenchange', wake, true);
  bindVideo();
  wake();
  return true;
})()
)JS";
}  // namespace
