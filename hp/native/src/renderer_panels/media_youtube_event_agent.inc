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
    try { existing.classObserver?.disconnect(); } catch (_) {}
    try { existing.popupObserver?.disconnect(); } catch (_) {}
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
    lastWakeSignature: '',
    pendingWakeDirty: false,
    classObserver: null,
    popupObserver: null,
    navigationHandler: null,
    adActive: player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting'),
    dialogCloseAt: 0,
  };
  window.__homePanelYoutubeEventAgent = state;

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
    const fullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement);
    return [location.href, ad, paused, ended, failed, fullscreen].join('|');
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
  // state entirely. The signature is intentionally media-only; skip/survey DOM
  // discovery is deferred to ad/recovery wakes instead of every event burst.
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
  state.scheduleRecoveryWake = scheduleRecoveryWake;

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

  // YouTube already emits SPA navigation events. Use those plus media events
  // instead of observing the entire #movie_player subtree, which mutates heavily
  // during normal playback and ads.
  state.navigationHandler = () => {
    bindVideo();
    if (dismissMessageDialog()) wake(true);
    else wake(true);
  };
  document.addEventListener(
      'yt-navigate-finish', state.navigationHandler, true);
  document.addEventListener(
      'yt-page-data-updated', state.navigationHandler, true);

  if (typeof MutationObserver === 'function') {
    // Ad transitions are represented on the player itself. A delayed wake after
    // entering an ad gives the skip control time to appear without a subtree
    // observer continuously walking ad DOM mutations.
    state.classObserver = new MutationObserver(() => {
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