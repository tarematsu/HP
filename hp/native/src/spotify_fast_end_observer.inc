namespace hp {
namespace {

// Keep the injected observer in two raw literals. MSVC limits one wide string
// literal to roughly 8K characters, while ExecuteScript itself accepts the
// combined script without that source-level restriction.
constexpr wchar_t kSpotifyFastEndObserverScriptPart1[] = LR"JS(
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
      state.heartbeatTime = -1;
      state.heartbeatMisses = 0;
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
)JS";

constexpr wchar_t kSpotifyFastEndObserverScriptPart2[] = LR"JS(
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

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    const target = syncTarget();
    if (target && target.kind === 'music' && state.endedPosted) {
      try { event.target.pause(); } catch (_) {}
      return;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.heartbeatTime = Number(event.target.currentTime) || 0;
    state.heartbeatMisses = 0;
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

  // Pause chrome alone is not a health signal. Verify the target media clock
  // every 10 seconds and recover after two consecutive non-advancing samples.
  setInterval(() => {
    const target = syncTarget();
    const media = state.targetMedia;
    if (!target || target.kind !== 'music' || !state.started ||
        state.endedPosted || state.recoveryPosted || !isMedia(media) ||
        media.ended) {
      return;
    }
    if (media.paused) {
      requestRecovery(media);
      return;
    }
    const currentTime = Number(media.currentTime) || 0;
    if (state.heartbeatTime < 0 ||
        currentTime > state.heartbeatTime + 0.05) {
      state.heartbeatTime = currentTime;
      state.heartbeatMisses = 0;
      return;
    }
    ++state.heartbeatMisses;
    if (state.heartbeatMisses >= 2) requestRecovery(media);
  }, 10000);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleStartChecks(media);
  });
  return true;
})()
)JS";

std::wstring BuildSpotifyFastEndObserverScript() {
  std::wstring script(kSpotifyFastEndObserverScriptPart1);
  script.append(kSpotifyFastEndObserverScriptPart2);
  return script;
}

const std::wstring kSpotifyFastEndObserverScriptStorage =
    BuildSpotifyFastEndObserverScript();
const wchar_t* const kSpotifyFastEndObserverScript =
    kSpotifyFastEndObserverScriptStorage.c_str();

}  // namespace
}  // namespace hp
