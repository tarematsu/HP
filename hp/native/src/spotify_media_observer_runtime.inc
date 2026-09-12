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
    heartbeatMisses: 0,
    lastIdentityCheckTime: -1
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
  const heartbeatRuntime = () =>
      window.__homePanelSpotifyMediaObserverRuntime || null;
  const startHeartbeatIfAvailable = () => {
    const runtime = heartbeatRuntime();
    if (runtime && typeof runtime.startHeartbeat === 'function') {
      runtime.startHeartbeat();
    }
  };
  const stopHeartbeatIfAvailable = () => {
    const runtime = heartbeatRuntime();
    if (runtime && typeof runtime.stopHeartbeat === 'function') {
      runtime.stopHeartbeat();
    }
  };
  const targetKey = target => target
      ? [target.pagePath, target.trackPath, normalize(target.title),
         target.kind, generation()].join('|')
      : '';
  const resetState = key => {
    clearTimeout(state.stallTimer);
    stopHeartbeatIfAvailable();
    state.key = key;
    state.started = false;
    state.startPosted = false;
    state.endedPosted = false;
    state.recoveryPosted = false;
    state.targetMedia = null;
    state.stallTimer = 0;
    state.heartbeatTime = -1;
    state.heartbeatMisses = 0;
    state.lastIdentityCheckTime = -1;
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

  // Observer responsibility is detection only. Once the requested generation
  // has really started, a different identifiable track requests native recovery
  // but never calls media.pause(). Navigation owns target replacement, so media
  // observation cannot race a new start and freeze it at currentTime=0.
  const enforceTarget = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !target.pagePath ||
        state.endedPosted || !isMedia(media) || media.ended) {
      return 'ignore';
    }

    const identity = currentTrack();
    if (!identity.path && !identity.title) return 'unknown';
    if (!matchesTarget(target, identity)) {
      // During initial navigation the now-playing surface may still show the
      // previous document. Only enforce after this generation started once.
      if (!state.startPosted) return 'unknown';
      stopHeartbeatIfAvailable();
      state.started = false;
      state.targetMedia = null;
      state.heartbeatTime = -1;
      state.heartbeatMisses = 0;
      state.lastIdentityCheckTime = -1;
      if (!state.recoveryPosted) {
        state.recoveryPosted = true;
        post('spotify:not-playing');
      }
      return 'wrong';
    }

    if (media.paused) {
      stopHeartbeatIfAvailable();
      return 'target';
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    if (!state.started || state.targetMedia !== media) {
      state.heartbeatTime = Number(media.currentTime) || 0;
      state.heartbeatMisses = 0;
      state.lastIdentityCheckTime = -1;
    }
    state.started = true;
    state.recoveryPosted = false;
    state.targetMedia = media;
    if (!state.startPosted) {
      state.startPosted = true;
      post('spotify:timed-started');
    }
    startHeartbeatIfAvailable();
    return 'playing';
  };

  const requestRecovery = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || state.endedPosted ||
        !isMedia(media) || media.ended) {
      return false;
    }
    if (enforceTarget(media) === 'wrong') return true;
    if (state.recoveryPosted || !state.started || state.targetMedia !== media) {
      return false;
    }
    state.recoveryPosted = true;
    stopHeartbeatIfAvailable();
    post('spotify:not-playing');
    return true;
  };

  const scheduleTargetChecks = media => {
    [0, 250, 1000, 2500, 5000].forEach(delay => {
      setTimeout(() => enforceTarget(media), delay);
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
    enforceTarget,
    requestRecovery,
    scheduleTargetChecks,
    scheduleRecovery,
    eventsInstalled: false,
    heartbeatTimer: 0,
    startHeartbeat: null,
    stopHeartbeat: null
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
