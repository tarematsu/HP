// Event-driven YouTube wake agent.
//
// Keep the page helper event-led: media and SPA events cover playback changes,
// while one MutationObserver handles the two small DOM surfaces that need it.
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
    try { existing.observer?.disconnect(); } catch (_) {}
    try {
      if (existing.navigationHandler) {
        document.removeEventListener(
            'yt-navigate-finish', existing.navigationHandler, true);
        document.removeEventListener(
            'yt-page-data-updated', existing.navigationHandler, true);
      }
    } catch (_) {}
    try { if (existing.wakeTimer) clearTimeout(existing.wakeTimer); } catch (_) {}
    try { if (existing.recoveryTimer) clearTimeout(existing.recoveryTimer); } catch (_) {}
  }

  const state = {
    player,
    video: null,
    wakeAt: 0,
    wakeTimer: 0,
    recoveryTimer: 0,
    forceWake: false,
    lastWakeSignature: '',
    observer: null,
    navigationHandler: null,
    adActive: player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting'),
    dialogCloseAt: 0,
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
  const messageDialogSelector = [
    'tp-yt-paper-dialog[opened]',
    '[role="dialog"]:not([aria-hidden="true"])',
    'yt-confirm-dialog-renderer',
    'ytd-confirm-dialog-renderer'
  ].join(',');
  const messageControlSelector =
      'button, tp-yt-paper-button, [role="button"], [aria-label], [title]';
  const surveyDialogMarkerSelector =
      '.ytp-ad-survey, .ytp-ad-feedback-dialog, '
      + 'yt-survey-renderer, ytd-survey-renderer';
  const closePattern = /^(閉じる|close)$/i;
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const controlText = element => {
    for (const value of [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.textContent]) {
      const normalized = normalize(value);
      if (normalized) return normalized;
    }
    return '';
  };
  const isSurveyDialog = root => Boolean(
      root?.matches?.(surveyDialogMarkerSelector) ||
      root?.closest?.(surveyDialogMarkerSelector) ||
      root?.querySelector?.(surveyDialogMarkerSelector));
  const dismissMessageDialog = () => {
    const now = Date.now();
    if (now - state.dialogCloseAt < 500) return false;
    for (const scope of [player, document.querySelector('ytd-popup-container')]) {
      if (!scope) continue;
      for (const root of scope.querySelectorAll(messageDialogSelector)) {
        if (!root.getClientRects().length || isSurveyDialog(root)) continue;
        const close = Array.from(root.querySelectorAll(messageControlSelector))
            .find(element => element.getClientRects().length &&
                closePattern.test(controlText(element)));
        if (!close) continue;
        state.dialogCloseAt = now;
        try { close.click(); } catch (_) {}
        return true;
      }
    }
    return false;
  };

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
    try {
      window.chrome?.webview?.postMessage('homepanel:youtube-wake');
    } catch (_) {}
  };

  // One timer coalesces event bursts. The signature is computed only once when
  // that timer fires, and identical states do not cross the WebView2 boundary.
  const wake = (force = false) => {
    state.forceWake ||= force;
    if (state.wakeTimer) return;
    const delay = Math.max(0, 250 - (Date.now() - state.wakeAt));
    state.wakeTimer = setTimeout(() => {
      state.wakeTimer = 0;
      const nextSignature = signature();
      const forced = state.forceWake;
      state.forceWake = false;
      if (forced || nextSignature !== state.lastWakeSignature) {
        postWake(nextSignature);
      }
    }, delay);
  };
  state.wake = wake;
)JS" LR"JS(

  const clearRecoveryWake = () => {
    if (!state.recoveryTimer) return;
    clearTimeout(state.recoveryTimer);
    state.recoveryTimer = 0;
  };
  const scheduleRecoveryWake = delayMs => {
    clearRecoveryWake();
    state.recoveryTimer = setTimeout(() => {
      state.recoveryTimer = 0;
      wake(true);
    }, delayMs);
  };

  const bindVideo = () => {
    const video = player.querySelector('video');
    if (!video || state.video === video) return;
    state.video = video;
    const onVideoState = event => {
      if (event.currentTarget !== state.video) return;
      if (event.type === 'pause') {
        scheduleRecoveryWake(10 * 1000 + 500);
      } else if (event.type === 'waiting' || event.type === 'stalled') {
        scheduleRecoveryWake(30 * 1000 + 500);
      } else if (event.type === 'play' || event.type === 'playing' ||
                 event.type === 'ended' || event.type === 'error' ||
                 event.type === 'loadedmetadata' || event.type === 'emptied') {
        clearRecoveryWake();
      }
      wake(event.type === 'waiting' || event.type === 'stalled');
    };
    for (const eventName of [
        'play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'error',
        'loadedmetadata', 'emptied']) {
      video.addEventListener(eventName, onVideoState, { passive: true });
    }
    if (video.paused && !video.ended) scheduleRecoveryWake(10 * 1000 + 500);
    wake(true);
  };

  state.navigationHandler = () => {
    bindVideo();
    wake(dismissMessageDialog());
  };
  document.addEventListener(
      'yt-navigate-finish', state.navigationHandler, true);
  document.addEventListener(
      'yt-page-data-updated', state.navigationHandler, true);

  if (typeof MutationObserver === 'function') {
    const popupContainer = document.querySelector('ytd-popup-container');
    state.observer = new MutationObserver(() => {
      const nextAdActive = player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting');
      if (nextAdActive !== state.adActive) {
        state.adActive = nextAdActive;
        if (nextAdActive) {
          scheduleRecoveryWake(5 * 1000 + 500);
        } else if (!state.video?.paused) {
          clearRecoveryWake();
        }
      }
      wake(dismissMessageDialog());
    });
    state.observer.observe(player, {
      attributes: true,
      attributeFilter: ['class']
    });
    if (popupContainer) {
      state.observer.observe(popupContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['opened', 'aria-hidden']
      });
    }
  }

  document.addEventListener('fullscreenchange', () => wake(), true);
  document.addEventListener('webkitfullscreenchange', () => wake(), true);
  bindVideo();
  wake(dismissMessageDialog());
  return true;
})()
)JS";
}  // namespace