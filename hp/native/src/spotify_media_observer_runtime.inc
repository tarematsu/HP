namespace hp {
namespace {

// Owns current-track identity and emits start/interruption/resume timing for the
// native one-shot deadline. Recovery and navigation remain native-owned.
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
  const targetPath = target =>
      target && (target.path || target.trackPath || target.pagePath || '');
  const state = {
    key: '',
    startPosted: false,
    targetMedia: null,
    trustedStartKey: '',
    interrupted: false
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
      ? [targetPath(target), normalize(target.title), generation()].join('|')
      : '';
  const clearTrustedStart = () => {
    state.trustedStartKey = '';
  };
  const resetState = key => {
    state.key = key;
    state.startPosted = false;
    state.targetMedia = null;
    clearTrustedStart();
    state.interrupted = false;
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
    const expectedPath = targetPath(target);
    if (expectedPath && track.path) {
      return sameTrackPath(track.path, expectedPath);
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
        !targetPath(target)) {
      return false;
    }
    // Keep the token valid for this target generation until it is consumed or
    // target/navigation state changes. EcoQoS scheduling delay must not expire
    // a legitimate trusted Play transition.
    state.trustedStartKey = targetKey(target);
    return true;
  };
  const consumeTrustedStart = target => {
    if (!target || state.trustedStartKey !== targetKey(target)) {
      return false;
    }
    clearTrustedStart();
    return true;
  };

  const enforceTarget = media => {
    const target = syncTarget();
    if (!targetPath(target) || !isMedia(media) || media.ended) {
      return 'ignore';
    }

    const identity = currentTrack();
    const targetIdentityConfirmed = matchesTarget(target, identity);
    const ownsMedia = state.targetMedia === media;
    if (!identity.path && !identity.title) {
      if (!ownsMedia && (media.paused || !consumeTrustedStart(target))) {
        return 'unknown';
      }
    } else if (!targetIdentityConfirmed) {
      clearTrustedStart();
      if (!media.paused) {
        if (state.startPosted && !state.interrupted) {
          state.interrupted = true;
          post('spotify:timed-interrupted');
        }
        return 'interruption';
      }
      return 'unknown';
    }

    if (media.paused) return 'target';
    state.targetMedia = media;
    const remainingMs = remainingDurationMs(media);
    if (state.interrupted) {
      state.interrupted = false;
      if (remainingMs > 0) {
        postFields('spotify:timed-resumed', String(remainingMs));
      }
    } else if (!state.startPosted && remainingMs > 0) {
      state.startPosted = true;
      postFields('spotify:timed-started', String(remainingMs));
    }
    return 'playing';
  };

  // Identity adoption is driven by media lifecycle events. Do not depend on a
  // renderer setTimeout that can be heavily delayed while WebView2 is in EcoQoS.
  const scheduleTargetChecks = media => enforceTarget(media);

  const runtime = {
    state,
    post,
    syncTarget,
    isMedia,
    armTrustedStart,
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
