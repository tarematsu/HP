namespace hp {
namespace {

// Owns target identity and observer state. Playback recovery and completion
// detection are intentionally excluded: this observer only recognizes the
// requested target and reports one validated start with its remaining duration.
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
  const postFields = (message, ...fields) => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(
            [message, generation(), ...fields].join('\u001f'));
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
  const remainingDurationMs = media => {
    if (!isMedia(media)) return 0;
    const duration = Number(media.duration);
    const currentTime = Number(media.currentTime);
    const playbackRate = Number(media.playbackRate);
    if (!Number.isFinite(duration) || !Number.isFinite(currentTime) ||
        !Number.isFinite(playbackRate) || duration < 10 || currentTime < 0 ||
        duration <= currentTime || playbackRate <= 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(
        ((duration - currentTime) / playbackRate) * 1000));
  };
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
        !isMedia(media) || media.ended) {
      return 'ignore';
    }

    const identity = currentTrack();
    const ownsTrustedMedia = state.started && state.targetMedia === media;
    if (!identity.path && !identity.title) {
      if (!ownsTrustedMedia) {
        if (media.paused || !consumeTrustedStart(target)) return 'unknown';
      }
    } else if (!matchesTarget(target, identity)) {
      clearTrustedStart();
      if (!state.startPosted) return 'unknown';
      return 'wrong';
    }

    if (media.paused) return 'target';
    state.started = true;
    state.targetMedia = media;
    if (!state.startPosted) {
      const remainingMs = remainingDurationMs(media);
      if (remainingMs > 0) {
        state.startPosted = true;
        postFields('spotify:timed-started', String(remainingMs));
      }
    }
    return 'playing';
  };

  const checkTarget = media => enforceTarget(media);
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
