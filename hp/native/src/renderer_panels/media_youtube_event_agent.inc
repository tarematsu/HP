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
    try { existing.adObserver?.disconnect(); } catch (_) {}
    try { existing.classObserver?.disconnect(); } catch (_) {}
    try { existing.popupObserver?.disconnect(); } catch (_) {}
    try { if (existing.wakeTimer) clearTimeout(existing.wakeTimer); } catch (_) {}
    try { if (existing.recoveryTimer) clearTimeout(existing.recoveryTimer); } catch (_) {}
  }

  const state = {
    player,
    video: null,
    wakeAt: 0,
    wakeTimer: 0,
    recoveryTimer: 0,
    lastWakeSignature: '',
    pendingWakeDirty: false,
    playerObserver: null,
    adObserver: null,
    classObserver: null,
    popupObserver: null,
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
    const scopes = [player, document.querySelector('ytd-popup-container')]
        .filter(Boolean);
    for (const scope of scopes) {
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
    state.pendingWakeDirty = false;
    try {
      window.chrome?.webview?.postMessage('homepanel:youtube-wake');
    } catch (_) {}
  };

  // Coalesce bursts into one trailing notification and suppress an unchanged
  // state entirely. If a trailing wake is already armed, avoid rescanning the
  // player for every mutation; compute the expensive signature once at flush.
  const wake = (force = false) => {
    const delay = Math.max(0, 250 - (Date.now() - state.wakeAt));
    if (!force && delay > 0 && state.wakeTimer) {
      state.pendingWakeDirty = true;
      return;
    }

    const nextSignature = signature();
    if (!force && nextSignature === state.lastWakeSignature && !state.wakeTimer) {
      return;
    }
    state.pendingWakeDirty = true;
    if (delay === 0) {
      if (state.wakeTimer) {
        clearTimeout(state.wakeTimer);
        state.wakeTimer = 0;
      }
      if (force || nextSignature !== state.lastWakeSignature) {
        postWake(nextSignature);
      } else {
        state.pendingWakeDirty = false;
      }
      return;
    }
    if (state.wakeTimer) return;
    state.wakeTimer = setTimeout(() => {
      state.wakeTimer = 0;
      if (!state.pendingWakeDirty) return;
      const pending = signature();
      state.pendingWakeDirty = false;
      if (pending !== state.lastWakeSignature) postWake(pending);
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
      // The player state can remain bit-for-bit identical while it is stuck, so
      // this delayed escalation intentionally bypasses signature suppression.
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

  const bindAdObserver = () => {
    if (typeof MutationObserver !== 'function') return;
    if (!state.adObserver) {
      state.adObserver = new MutationObserver(() => wake());
    } else {
      try { state.adObserver.disconnect(); } catch (_) {}
    }
    const roots = Array.from(player.querySelectorAll(
        '.video-ads, .ytp-ad-module, .ytp-ad-player-overlay'));
    for (const root of roots) {
      state.adObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-hidden', 'disabled']
      });
    }
  };

  if (typeof MutationObserver === 'function') {
    // Video replacement is the only player-subtree mutation we need during
    // ordinary content playback. Scope this observer to the dedicated video
    // container instead of the full #movie_player tree.
    const videoContainer = player.querySelector('.html5-video-container');
    if (videoContainer) {
      state.playerObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            const element = node;
            if (element.matches?.('video') || element.querySelector?.('video')) {
              bindVideo();
              return;
            }
          }
        }
      });
      state.playerObserver.observe(videoContainer, { childList: true, subtree: true });
    }

    bindAdObserver();

    // YouTube signals ad transitions primarily by toggling player classes. Watch
    // only that one attribute on the one player node rather than page-wide DOM.
    state.classObserver = new MutationObserver(() => {
      bindAdObserver();
      wake();
    });
    state.classObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Message windows are rendered in YouTube's dedicated popup host. Observe
    // only that host; do not add a page-wide MutationObserver.
    const popupContainer = document.querySelector('ytd-popup-container');
    if (popupContainer) {
      state.popupObserver = new MutationObserver(() => {
        if (dismissMessageDialog()) wake(true);
      });
      state.popupObserver.observe(popupContainer, {
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
  if (dismissMessageDialog()) wake(true);
  else wake(true);
  return true;
})()
)JS";
}  // namespace