namespace hp {
namespace {

// Owns current-track identity and emits start/interruption/resume timing for the
// native one-shot deadline. Recovery and navigation remain native-owned.
constexpr wchar_t kSpotifyMediaObserverRuntimeScript[] = LR"JS(
(() => {
  if (window.__homePanelSpotifyMediaObserverRuntime) return true;

  window.__homePanelSpotifyGeneration =
      window.__homePanelSpotifyGeneration || '0';
  const displayText = value =>
      String(value || '').replace(/\s+/g, ' ').trim();
  const normalize = value => displayText(value).toLowerCase();
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
    interrupted: false,
    // Status identity is separate from the managed target. These fields are
    // populated only after an actual HTMLMediaElement is confirmed playing.
    actualTrackTitle: '',
    actualTrackPath: ''
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
  const clearActualTrack = () => {
    state.actualTrackTitle = '';
    state.actualTrackPath = '';
  };
  const resetState = key => {
    state.key = key;
    state.startPosted = false;
    state.targetMedia = null;
    clearTrustedStart();
    state.interrupted = false;
    // A new managed target is not yet an actually playing track. Clear the
    // previous confirmed identity instead of ever copying the planned title.
    clearActualTrack();
  };
  const syncTarget = () => {
    const target = window.__homePanelSpotifyNativeTarget;
    const key = targetKey(target);
    if (state.key !== key) resetState(key);
    return target;
  };

  const nowPlayingRoots = () => {
    const roots = [];
    const add = root => {
      if (root && !roots.includes(root)) roots.push(root);
    };
    add(document.querySelector('[data-testid="now-playing-widget"]'));
    add(document.querySelector('[data-testid="now-playing-bar"]'));
    add(document.querySelector('[data-testid="main-view-player-bar"]'));
    add(document.querySelector('[data-testid="bottom-bar"]'));
    add(document.querySelector('footer[class*="now-playing"]'));
    add(document.querySelector('footer'));
    return roots;
  };
  const stripNowPlayingPrefix = value => displayText(value)
      .replace(/^(?:now playing|currently playing|再生中)\s*[:：-]?\s*/i, '');
  const titleFromElement = element => {
    if (!element) return '';
    const values = [
      element.textContent,
      element.getAttribute?.('title'),
      element.getAttribute?.('aria-label')
    ];
    for (const value of values) {
      const title = stripNowPlayingPrefix(value);
      if (title) return title;
    }
    return '';
  };
  const titleFromRoot = root => {
    if (!root) return '';
    for (const selector of [
      '[data-testid="context-item-info-title"]',
      '[data-testid="nowplaying-track-link"]',
      '[data-testid="now-playing-widget-title"] a',
      '.track-info__name a',
      'a[aria-label*="Now playing:" i]',
      '.now-playing .track-name',
      '[class*="track-name"]',
      '.player-track-info__name'
    ]) {
      let element = null;
      try { element = root.querySelector(selector); } catch (_) {}
      const title = titleFromElement(element);
      if (title) return title;
    }
    return '';
  };
  const currentTrack = () => {
    for (const root of nowPlayingRoots()) {
      const links = [];
      // Some lightweight/test DOMs can resolve a now-playing selector directly
      // to the track anchor. Treat that as an ordinary candidate too.
      try {
        const rootHref = typeof root.href === 'string' ? root.href : '';
        if (rootHref.includes('/track/')) links.push(root);
      } catch (_) {}
      for (const selector of [
        'a[data-testid="context-item-link"][href*="/track/"]',
        'a[href*="/track/"]'
      ]) {
        try {
          root.querySelectorAll(selector).forEach(link => links.push(link));
        } catch (_) {}
      }
      for (const link of links) {
        try {
          const path = new URL(link.href, location.href).pathname;
          if (!path.includes('/track/')) continue;
          const displayTitle = titleFromElement(link) || titleFromRoot(root);
          return {
            path,
            title: normalize(displayTitle),
            displayTitle,
            source: 'now-playing-dom'
          };
        } catch (_) {}
      }

      const displayTitle = titleFromRoot(root);
      if (displayTitle) {
        return {
          path: '',
          title: normalize(displayTitle),
          displayTitle,
          source: 'now-playing-dom'
        };
      }
    }

    // MediaSession remains identity-only fallback for target validation. It is
    // deliberately never promoted into status because it can be stale.
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    return {
      path: '',
      title: normalize(metadata && metadata.title),
      displayTitle: '',
      source: 'media-session'
    };
  };
)JS"
LR"JS(
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
        clearActualTrack();
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

    // Only a Now Playing DOM identity observed while the media element is
    // actually advancing is eligible for status. Never copy target.title.
    if (identity.source === 'now-playing-dom' && identity.displayTitle) {
      state.actualTrackTitle = identity.displayTitle;
      state.actualTrackPath = identity.path || '';
    }

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
    currentTrack,
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
