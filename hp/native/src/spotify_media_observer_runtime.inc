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
  const targetKey = target => target
      ? [target.pagePath, target.trackPath, normalize(target.title),
         target.kind, generation()].join('|')
      : '';
  const resetState = key => {
    state.key = key;
    state.started = false;
    state.startPosted = false;
    state.endedPosted = false;
    state.targetMedia = null;
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

  // Identity validation never attempts to repair playback. A mismatch simply
  // disarms completion tracking for the current media element; navigation owns
  // target changes and the next generation will establish a new target.
  const enforceTarget = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !target.pagePath ||
        state.endedPosted || !isMedia(media) || media.ended) {
      return 'ignore';
    }

    const identity = currentTrack();
    if (!identity.path && !identity.title) return 'unknown';
    if (!matchesTarget(target, identity)) {
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

  const scheduleTargetChecks = media => {
    [0, 250, 1000, 2500, 5000].forEach(delay => {
      setTimeout(() => enforceTarget(media), delay);
    });
  };

  const runtime = {
    state,
    post,
    syncTarget,
    isMedia,
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
