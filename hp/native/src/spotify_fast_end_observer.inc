namespace hp {
namespace {

// One delegated observer per Spotify document covers media created after
// navigation. It prefers the direct /track/ identity from the actual player UI,
// falls back to MediaSession title only while that identity is unavailable, and
// tags every native event with the current target generation.
constexpr wchar_t kSpotifyFastEndObserverScript[] = LR"JS(
(() => {
  if (window.__homePanelSpotifyMediaObserverInstalled) return true;
  window.__homePanelSpotifyMediaObserverInstalled = true;
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
    stallTimer: 0
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
      ? [
          target.pagePath,
          target.trackPath,
          normalize(target.title),
          target.kind,
          generation()
        ].join('|')
      : '';
  const syncTarget = () => {
    const target = window.__homePanelSpotifyNativeTarget;
    const key = targetKey(target);
    if (state.key !== key) {
      clearTimeout(state.stallTimer);
      state.key = key;
      state.started = false;
      state.startPosted = false;
      state.endedPosted = false;
      state.recoveryPosted = false;
      state.targetMedia = null;
      state.stallTimer = 0;
    }
    return target;
  };

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:generation') {
        window.__homePanelSpotifyGeneration = fields[1] || '0';
        syncTarget();
      } else if (fields[0] === 'spotify:target') {
        // The page bootstrap is registered before this observer and has already
        // replaced __homePanelSpotifyNativeTarget when this listener runs.
        syncTarget();
      }
    });
  }

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
    return {
      path: '',
      title: normalize(metadata && metadata.title)
    };
  };
  const matchesTarget = (target, track) => {
    if (!target) return false;
    if (target.trackPath && track.path) {
      return sameTrackPath(track.path, target.trackPath);
    }
    return !!target.title && track.title === normalize(target.title);
  };
  const isMedia = value => value instanceof HTMLMediaElement;

  const confirmStarted = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !target.pagePath ||
        state.endedPosted || media.paused || media.ended) {
      return false;
    }
    if (!matchesTarget(target, currentTrack())) {
      state.started = false;
      state.targetMedia = null;
      return false;
    }

    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.started = true;
    state.recoveryPosted = false;
    state.targetMedia = media;
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
      if (requirePaused ? !media.paused
                        : (Number(media.currentTime) || 0) > startTime + 0.05) {
        return;
      }
      const identity = currentTrack();
      if ((identity.path || identity.title) &&
          !matchesTarget(currentTarget, identity)) {
        return;
      }
      state.recoveryPosted = true;
      post('spotify:not-playing');
    }, delay);
  };

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    const target = syncTarget();
    if (target && target.kind === 'music' && state.endedPosted) {
      // Spotify can start the previous context's queued next song after ended.
      // Keep it stopped until native publishes the next target/generation.
      try { event.target.pause(); } catch (_) {}
      return;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    scheduleStartChecks(event.target);
  }, true);
  document.addEventListener('playing', event => {
    if (!isMedia(event.target)) return;
    confirmStarted(event.target);
  }, true);
  document.addEventListener('pause', event => {
    if (!isMedia(event.target)) return;
    scheduleRecovery(event.target, 600, true);
  }, true);
  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      scheduleRecovery(event.target, 2500, false);
    }, true);
  }
  document.addEventListener('ended', event => {
    const media = event.target;
    syncTarget();
    if (!isMedia(media) || !state.started || state.endedPosted ||
        state.targetMedia !== media) {
      return;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.endedPosted = true;
    document.querySelectorAll('audio, video').forEach(candidate => {
      try { candidate.pause(); } catch (_) {}
    });
    post('spotify:timed-ended');
  }, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleStartChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
