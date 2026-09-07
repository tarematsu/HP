namespace hp {
namespace {

// One delegated observer per Spotify document covers media elements created after
// navigation without rescanning the DOM or reinjecting observers on every retry.
constexpr wchar_t kSpotifyFastEndObserverScript[] = LR"JS(
(() => {
  if (window.__homePanelSpotifyMediaObserverInstalled) return true;
  window.__homePanelSpotifyMediaObserverInstalled = true;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const state = {
    key: '',
    started: false,
    startPosted: false,
    endedPosted: false,
    recoveryPosted: false,
    targetMedia: null,
    stallTimer: 0
  };
  const post = message => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
      }
    } catch (_) {}
  };
  const targetKey = target => target
      ? [target.pagePath, target.trackPath, normalize(target.title), target.kind].join('|')
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
  const currentTrack = () => {
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const mediaTitle = normalize(metadata && metadata.title);
    if (mediaTitle) return { path: '', title: mediaTitle };

    for (const selector of [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="context-item-link"][href*="/track/"]'
    ]) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (path.startsWith('/track/')) {
          return { path, title: normalize(link.textContent) };
        }
      } catch (_) {}
    }
    return { path: '', title: '' };
  };
  const matchesTarget = (target, track) => {
    if (target.trackPath && track.path) return track.path === target.trackPath;
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
    [0, 250, 1000, 2500].forEach(delay => {
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
      // Spotify can start the previous context's next queued song immediately
      // after ended. Hold that gap silent until native code publishes the next
      // A-D target; syncTarget then resets this latch for the intended song.
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
