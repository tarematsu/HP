// Event-driven YouTube wake agent.
//
// The expensive recovery policy remains native-owned and trusted-input based.
// This page-local helper reports only meaningful player-state transitions, so
// repeated DOM mutations do not bounce through WebView2/native unnecessarily.
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
    try { if (existing.wakeTimer) clearTimeout(existing.wakeTimer); } catch (_) {}
  }

  const state = {
    player,
    video: null,
    wakeAt: 0,
    wakeTimer: 0,
    lastWakeSignature: '',
    pendingWakeSignature: '',
    playerObserver: null,
    classObserver: null,
  };
  window.__homePanelYoutubeEventAgent = state;

  const skipSelector = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot',
    '.ytp-ad-skip-button-container',
    '[class*="ytp-ad-skip"]',
    '[aria-label*="Skip ad" i]',
    '[aria-label*="広告をスキップ"]'
  ].join(',');
  const surveySelector = [
    '.ytp-ad-survey',
    '.ytp-ad-feedback-dialog',
    'yt-survey-renderer',
    'ytd-survey-renderer',
    '[role="dialog"]'
  ].join(',');

  const signature = () => {
    const video = state.video || player.querySelector('video');
    const ad = player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting');
    const paused = !video || video.paused;
    const ended = !!video?.ended;
    const failed = !!video?.error || player.classList.contains('ytp-error');
    const skip = !!player.querySelector(skipSelector);
    const survey = !!player.querySelector(surveySelector);
    const fullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement);
    return [location.href, ad, paused, ended, failed, skip, survey, fullscreen]
        .join('|');
  };

  const postWake = nextSignature => {
    state.wakeAt = Date.now();
    state.lastWakeSignature = nextSignature;
    state.pendingWakeSignature = '';
    try {
      window.chrome?.webview?.postMessage('homepanel:youtube-wake');
    } catch (_) {}
  };

  // Coalesce bursts into one trailing notification and suppress an unchanged
  // state entirely. The native 30-second watchdog remains the recovery backstop.
  const wake = (force = false) => {
    const nextSignature = signature();
    if (!force && nextSignature === state.lastWakeSignature && !state.wakeTimer) {
      return;
    }
    state.pendingWakeSignature = nextSignature;
    const delay = Math.max(0, 250 - (Date.now() - state.wakeAt));
    if (delay === 0) {
      if (state.wakeTimer) {
        clearTimeout(state.wakeTimer);
        state.wakeTimer = 0;
      }
      if (force || nextSignature !== state.lastWakeSignature) postWake(nextSignature);
      return;
    }
    if (state.wakeTimer) return;
    state.wakeTimer = setTimeout(() => {
      state.wakeTimer = 0;
      const pending = state.pendingWakeSignature || signature();
      if (pending !== state.lastWakeSignature) postWake(pending);
    }, delay);
  };
  state.wake = wake;

  const bindVideo = () => {
    const video = player.querySelector('video');
    if (!video || state.video === video) return;
    state.video = video;
    for (const eventName of [
        'play', 'pause', 'ended', 'error', 'loadedmetadata', 'emptied']) {
      video.addEventListener(eventName, () => wake(), { passive: true });
    }
    wake(true);
  };

  const interestingSelector = [
    'video',
    skipSelector,
    surveySelector
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
    state.classObserver = new MutationObserver(() => wake());
    state.classObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  document.addEventListener('fullscreenchange', () => wake(), true);
  document.addEventListener('webkitfullscreenchange', () => wake(), true);
  bindVideo();
  wake(true);
  return true;
})()
)JS";
}  // namespace
