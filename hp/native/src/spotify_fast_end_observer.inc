namespace hp {
namespace {

// Fixed event observer for timed Spotify music. It deliberately keeps no
// permanent polling loop: the media element that actually starts the requested
// target becomes the completion source. A non-target play on the same element
// clears that ownership so an advertisement cannot complete the song.
constexpr wchar_t kSpotifyFastEndObserverScript[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  if (!target || target.kind !== 'music' || !target.pagePath) return null;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const targetTitle = normalize(target.title);
  const key = [target.pagePath, target.trackPath, targetTitle].join('|');
  const post = message => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
      }
    } catch (_) {}
  };
  const currentTrack = () => {
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const mediaTitle = normalize(metadata && metadata.title);
    if (mediaTitle) return { path: '', title: mediaTitle };

    const selectors = [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="context-item-link"][href*="/track/"]'
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (!path.startsWith('/track/')) continue;
        return { path, title: normalize(link.textContent) };
      } catch (_) {}
    }
    return { path: '', title: '' };
  };
  const matchesTarget = track =>
      (!!target.trackPath && track.path === target.trackPath) ||
      (!!targetTitle && track.title === targetTitle);

  const previous = window.__homePanelSpotifyFastEndObserver;
  if (previous && previous.key === key) {
    if (previous.bind) previous.bind();
    return true;
  }

  const state = {
    key,
    started: false,
    endedPosted: false,
    targetMedia: null,
    media: new WeakSet(),
    bind: null
  };
  const isCurrent = () => window.__homePanelSpotifyFastEndObserver === state;

  state.bind = () => {
    document.querySelectorAll('audio, video').forEach(media => {
      if (state.media.has(media)) return;
      state.media.add(media);

      media.addEventListener('play', () => {
        if (!isCurrent() || state.endedPosted) return;
        if (matchesTarget(currentTrack())) {
          state.started = true;
          state.targetMedia = media;
          return;
        }
        if (state.targetMedia === media) {
          state.started = false;
          state.targetMedia = null;
        }
      }, { passive: true });

      media.addEventListener('pause', () => {
        if (!isCurrent() || !state.started || state.endedPosted ||
            state.targetMedia !== media || media.ended) return;
        setTimeout(() => {
          if (!isCurrent() || !state.started || state.endedPosted ||
              state.targetMedia !== media || media.ended || !media.paused) return;
          const anotherPlaying = Array.from(document.querySelectorAll('audio, video'))
              .some(candidate => candidate !== media &&
                  !candidate.paused && !candidate.ended);
          if (anotherPlaying) return;
          const identity = currentTrack();
          if ((identity.path || identity.title) && !matchesTarget(identity)) return;
          post('spotify:not-playing');
        }, 600);
      }, { passive: true });

      media.addEventListener('ended', () => {
        if (!isCurrent() || !state.started || state.endedPosted ||
            state.targetMedia !== media) return;
        state.endedPosted = true;
        post('spotify:timed-ended');
      }, { passive: true });
    });
  };

  state.bind();
  window.__homePanelSpotifyFastEndObserver = state;

  const playing = Array.from(document.querySelectorAll('audio, video'))
      .find(media => !media.paused && !media.ended) || null;
  if (playing && matchesTarget(currentTrack())) {
    state.started = true;
    state.targetMedia = playing;
  }
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
