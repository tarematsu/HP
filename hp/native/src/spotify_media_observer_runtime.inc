namespace hp {
namespace {

// Owns only the current track identity, one validated start notification and
// explicit non-track interruption timing. Recovery/navigation remain native.
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
    trustedStartUntil: 0,
    identityFallbackTimer: 0,
    identityFallbackMedia: null,
    identityFallbackKey: '',
    interruptionStartedAt: 0
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
  const clearIdentityFallback = () => {
    if (state.identityFallbackTimer) clearTimeout(state.identityFallbackTimer);
    state.identityFallbackTimer = 0;
    state.identityFallbackMedia = null;
    state.identityFallbackKey = '';
  };
  const clearInterruption = () => {
    state.interruptionStartedAt = 0;
  };
  const beginInterruption = () => {
    if (state.interruptionStartedAt) return;
    state.interruptionStartedAt = Date.now();
    post('spotify:timed-interruption-started');
  };
  const cancelInterruption = () => {
    if (!state.interruptionStartedAt) return;
    clearInterruption();
    post('spotify:timed-interruption-cancelled');
  };
  const completeInterruption = () => {
    if (!state.interruptionStartedAt) return;
    const elapsedMs = Math.max(
        1, Math.ceil(Date.now() - state.interruptionStartedAt));
    clearInterruption();
    postFields('spotify:timed-interruption-ended', String(elapsedMs));
  };
  const resetState = key => {
    clearIdentityFallback();
    state.key = key;
    state.startPosted = false;
    state.targetMedia = null;
    state.trustedStartKey = '';
    state.trustedStartUntil = 0;
    clearInterruption();
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

  const enforceTarget = media => {
    const target = syncTarget();
    if (!targetPath(target) || !isMedia(media) || media.ended) {
      return 'ignore';
    }

    const identity = currentTrack();
    const targetIdentityConfirmed = matchesTarget(target, identity);
    const ownsMedia = state.targetMedia === media;
    if (!identity.path && !identity.title) {
      if (!ownsMedia) {
        if (media.paused || !consumeTrustedStart(target)) return 'unknown';
      }
    } else if (!targetIdentityConfirmed) {
      clearTrustedStart();
      if (!media.paused && !identity.path) {
        beginInterruption();
        return state.startPosted ? 'interruption' : 'unknown';
      }
      cancelInterruption();
      return state.startPosted ? 'wrong' : 'unknown';
    }

    if (media.paused) return 'target';
    if (targetIdentityConfirmed) completeInterruption();
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

  const scheduleTargetChecks = media => {
    const status = enforceTarget(media);
    if (status === 'playing' || status === 'ignore' ||
        status === 'interruption') {
      clearIdentityFallback();
      return;
    }

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
      enforceTarget(media);
    }, 1500);
  };

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
