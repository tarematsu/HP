namespace hp {
namespace {

// Owns target identity, observer state, and recovery decisions. Event binding and
// periodic health checks are separate scripts that consume this stable runtime.
constexpr wchar_t kSpotifyMediaObserverRuntimeScript[] = LR"JS(
(() => {
  if (window.__homePanelSpotifyMediaObserverRuntime) return true;

  window.__homePanelSpotifyGeneration =
      window.__homePanelSpotifyGeneration || '0';
  const normalize = value =>
      (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sameTrackPath = (value, expected) => {
    if (!value || !expected) return false;
    return value === expected ||
        (expected.startsWith('/track/') && value.endsWith(expected));
  };
  const state = {
    key: '',
    started: false,
    startPosted: false,
    endedPosted: false,
    recoveryPosted: false,
    targetMedia: null,
    stallTimer: 0,
    heartbeatTime: -1,
    heartbeatMisses: 0
  };
  const generation = () => String(window.__homePanelSpotifyGeneration || '0');
  const post = message => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(
            message + '\u001f' + generation());
      }
    } catch (_) {}
  };
  const targetKey = target => target
      ? [target.pagePath, target.trackPath, normalize(target.title),
         target.kind, generation()].join('|')
      : '';
  const resetState = key => {
    clearTimeout(state.stallTimer);
    state.key = key;
    state.started = false;
    state.startPosted = false;
    state.endedPosted = false;
    state.recoveryPosted = false;
    state.targetMedia = null;
    state.stallTimer = 0;
    state.heartbeatTime = -1;
    state.heartbeatMisses = 0;
  };
  const syncTarget = () => {
    const target = window.__homePanelSpotifyNativeTarget;
    const key = targetKey(target);
    if (state.key !== key) resetState(key);
    return target;
  };
  const currentTrack = () => {
    for (const selector of [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="now-playing-bar"] [data-testid="context-item-link"][href*="/track/"]',
      'footer [data-testid="context-item-link"][href*="/track/"]'
    ]) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (path.includes('/track/')) {
          return { path, title: normalize(link.textContent) };
        }
      } catch (_) {}
    }
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    return { path: '', title: normalize(metadata && metadata.title) };
  };
  const matchesTarget = (target, track) => {
    if (!target) return false;
    if (target.trackPath && track.path) {
      return sameTrackPath(track.path, target.trackPath);
    }
    return !!target.title && track.title === normalize(target.title);
  };
  const isMedia = value => value instanceof HTMLMediaElement;
  const requestRecovery = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !state.started ||
        state.endedPosted || state.recoveryPosted ||
        state.targetMedia !== media || media.ended) {
      return false;
    }
    const identity = currentTrack();
    if ((identity.path || identity.title) && !matchesTarget(target, identity)) {
      return false;
    }
    state.recoveryPosted = true;
    post('spotify:not-playing');
    return true;
  };
  const confirmStarted = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !target.pagePath ||
        state.endedPosted || media.paused || media.ended) {
      return false;
    }
    if (!matchesTarget(target, currentTrack())) {
      state.started = false;
      state.targetMedia = null;
      state.heartbeatTime = -1;
      state.heartbeatMisses = 0;
      return false;
    }

    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.started = true;
    state.recoveryPosted = false;
    state.targetMedia = media;
    state.heartbeatTime = Number(media.currentTime) || 0;
    state.heartbeatMisses = 0;
    if (!state.startPosted) {
      state.startPosted = true;
      post('spotify:timed-started');
    }
    return true;
  };
  const scheduleStartChecks = media => {
    [0, 250, 1000, 2500, 5000].forEach(delay => {
      setTimeout(() => confirmStarted(media), delay);
    });
  };
  const scheduleRecovery = (media, delay, requirePaused) => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !state.started ||
        state.endedPosted || state.recoveryPosted ||
        state.targetMedia !== media || media.ended) {
      return;
    }

    clearTimeout(state.stallTimer);
    const startTime = Number(media.currentTime) || 0;
    state.stallTimer = setTimeout(() => {
      state.stallTimer = 0;
      const currentTarget = syncTarget();
      if (!currentTarget || currentTarget.kind !== 'music' ||
          !state.started || state.endedPosted || state.recoveryPosted ||
          state.targetMedia !== media || media.ended) {
        return;
      }
      const currentTime = Number(media.currentTime) || 0;
      if (requirePaused ? !media.paused : currentTime > startTime + 0.05) {
        if (!requirePaused) {
          state.heartbeatTime = currentTime;
          state.heartbeatMisses = 0;
        }
        return;
      }
      requestRecovery(media);
    }, delay);
  };

  const runtime = {
    state,
    post,
    syncTarget,
    isMedia,
    requestRecovery,
    confirmStarted,
    scheduleStartChecks,
    scheduleRecovery,
    eventsInstalled: false,
    heartbeatTimer: 0
  };
  window.__homePanelSpotifyMediaObserverRuntime = runtime;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:generation') {
        window.__homePanelSpotifyGeneration = fields[1] || '0';
        syncTarget();
      } else if (fields[0] === 'spotify:target') {
        syncTarget();
      }
    });
  }
  syncTarget();
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
