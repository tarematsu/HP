namespace hp {
namespace {

// Owns target identity and observer state. Playback recovery is intentionally
// excluded: this observer only recognizes the requested target and reports
// start/completion events.
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
    targetMedia: null,
    lastIdentityCheckTime: -1,
    trustedStartKey: '',
    trustedStartUntil: 0,
    identityFallbackTimer: 0,
    identityFallbackMedia: null,
    identityFallbackKey: ''
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
  const clearIdentityFallback = () => {
    if (state.identityFallbackTimer) clearTimeout(state.identityFallbackTimer);
    state.identityFallbackTimer = 0;
    state.identityFallbackMedia = null;
    state.identityFallbackKey = '';
  };
  const resetState = key => {
    clearIdentityFallback();
    state.key = key;
    state.started = false;
    state.startPosted = false;
    state.endedPosted = false;
    state.targetMedia = null;
    state.lastIdentityCheckTime = -1;
    state.trustedStartKey = '';
    state.trustedStartUntil = 0;
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
  const armTrustedStart = requestedGeneration => {
    const target = syncTarget();
    const requested = String(requestedGeneration || '0');
    if (requested === '0' || requested !== generation() ||
        !target || target.kind !== 'music' || !target.pagePath) {
      return false;
    }
    state.trustedStartKey = targetKey(target);
    state.trustedStartUntil = Date.now() + 15000;
    return true;
  };
  const clearTrustedStart = () => {
    state.trustedStartKey = '';
    state.trustedStartUntil = 0;
  };
  const consumeTrustedStart = target => {
    if (!target || state.trustedStartKey !== targetKey(target) ||
        state.trustedStartUntil < Date.now()) {
      return false;
    }
    clearTrustedStart();
    return true;
  };

  // Identity validation normally requires the now-playing surface or
  // MediaSession metadata. Immediately after native has verified and clicked an
  // explicit Play-labelled target control, however, Spotify can begin the
  // correct audio before either identity surface is populated. That single
  // transition is accepted through a generation-scoped, short-lived trusted
  // start token. An explicitly identified wrong track is never trusted.
  const enforceTarget = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !target.pagePath ||
        state.endedPosted || !isMedia(media) || media.ended) {
      return 'ignore';
    }

    const identity = currentTrack();
    const ownsTrustedMedia = state.started && state.targetMedia === media;
    if (!identity.path && !identity.title) {
      if (!ownsTrustedMedia) {
        if (media.paused || !consumeTrustedStart(target)) return 'unknown';
      }
    } else if (!matchesTarget(target, identity)) {
      // Any concrete contradictory identity cancels the one-shot trust. This
      // prevents a stale/wrong Spotify item from later becoming trusted merely
      // because the now-playing UI disappears.
      clearTrustedStart();
      if (!state.startPosted) return 'unknown';
      state.started = false;
      state.targetMedia = null;
      state.lastIdentityCheckTime = -1;
      return 'wrong';
    }

    if (media.paused) return 'target';
    state.started = true;
    state.targetMedia = media;
    if (!state.startPosted) {
      state.startPosted = true;
      post('spotify:timed-started');
    }
    return 'playing';
  };

  const checkTarget = media => {
    const status = enforceTarget(media);
    if (status === 'playing' &&
        typeof runtime.postCompletionPlan === 'function') {
      runtime.postCompletionPlan(media);
    }
    return status;
  };
  const scheduleTargetChecks = media => {
    const status = checkTarget(media);
    if (status === 'playing' || status === 'ignore') {
      clearIdentityFallback();
      return;
    }

    // Spotify normally supplies identity from the same media lifecycle event.
    // Keep only one coalesced delayed fallback for the short window where the
    // now-playing surface and MediaSession metadata lag behind audio start.
    clearIdentityFallback();
    state.identityFallbackMedia = media;
    state.identityFallbackKey = state.key;
    state.identityFallbackTimer = setTimeout(() => {
      const expectedMedia = state.identityFallbackMedia;
      const expectedKey = state.identityFallbackKey;
      state.identityFallbackTimer = 0;
      state.identityFallbackMedia = null;
      state.identityFallbackKey = '';
      if (expectedMedia !== media || expectedKey !== state.key) return;
      checkTarget(media);
    }, 1500);
  };

  const runtime = {
    state,
    post,
    syncTarget,
    isMedia,
    armTrustedStart,
    enforceTarget,
    scheduleTargetChecks,
    postCompletionPlan: () => false,
    clearCompletionPlan: () => false,
    probeCompletion: null,
    eventsInstalled: false
  };
  window.__homePanelSpotifyMediaObserverRuntime = runtime;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:observer-sync') {
        window.__homePanelSpotifyGeneration = fields[1] || '0';
        syncTarget();
        document.querySelectorAll('audio, video').forEach(media => {
          if (!media.paused && !media.ended) scheduleTargetChecks(media);
        });
        post('spotify:observer-synced');
        return;
      }
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
