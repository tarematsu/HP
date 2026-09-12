namespace hp {
namespace {

// Active music reconcile script. Current-track identity is read only from the
// now-playing surface before MediaSession fallback. Track-list rows may be used
// to locate the requested target, but an unrelated global play button is never
// treated as that target.
constexpr wchar_t kSpotifyScopedTrackReconcileScript[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const report = playing => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(
            playing ? 'spotify:playing' : 'spotify:not-playing');
      }
    } catch (_) {}
  };
  if (!target || target.kind !== 'music' || !target.pagePath) {
    report(false);
    return null;
  }

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const sameTrackPath = (value, expected) => {
    if (!value || !expected) return false;
    return value === expected ||
        (expected.startsWith('/track/') && value.endsWith(expected));
  };
  const onTargetPage = () =>
      location.pathname === target.pagePath ||
      (target.pagePath.startsWith('/track/') &&
       location.pathname.endsWith(target.pagePath));
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element && (element.getAttribute('aria-label') ||
                   element.getAttribute('title'))) || '').toLowerCase();
  const buttonIntent = button => {
    const label = labelOf(button);
    if (!label) return 'unknown';
    if (label.includes('pause') || label.includes('一時停止')) return 'pause';
    if (label === 'play' || label === '再生' ||
        label.startsWith('play ') || label.endsWith('を再生')) {
      return 'play';
    }
    return 'unknown';
  };
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => visible(button) && buttonIntent(button) !== 'unknown') ||
        null;
  };
  const currentTrack = () => {
    const selectors = [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="now-playing-bar"] [data-testid="context-item-link"][href*="/track/"]',
      'footer [data-testid="context-item-link"][href*="/track/"]'
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (!path.includes('/track/')) continue;
        return {
          path,
          title: normalize(link.textContent).toLowerCase()
        };
      } catch (_) {}
    }
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    return {
      path: '',
      title: normalize(metadata && metadata.title).toLowerCase()
    };
  };
  const targetMatches = track => {
    if (target.trackPath && track.path) {
      return sameTrackPath(track.path, target.trackPath);
    }
    return !!target.title && track.title === target.title;
  };
  const targetLink = () => Array.from(
      document.querySelectorAll('a[href*="/track/"]')).find(link => {
        try {
          const path = new URL(link.href, location.href).pathname;
          if (target.trackPath && sameTrackPath(path, target.trackPath)) return true;
          return !target.trackPath && !!target.title &&
              normalize(link.textContent).toLowerCase() === target.title;
        } catch (_) { return false; }
      }) || null;
  const targetPlayButton = () => {
    const link = targetLink();
    if (link) {
      try { link.scrollIntoView({ block: 'center', inline: 'nearest' }); }
      catch (_) {}
      const row = link.closest(
          '[data-testid="tracklist-row"], [role="row"], li, [aria-rowindex]') ||
          link.parentElement?.parentElement;
      if (row) {
        const buttons = Array.from(row.querySelectorAll(
            'button[data-testid="play-button"], button, [role="button"]'));
        const button = buttons.find(candidate => {
          if (!visible(candidate)) return false;
          const intent = buttonIntent(candidate);
          if (intent !== 'unknown') return true;
          const label = labelOf(candidate);
          return !!target.title && label.includes(target.title);
        });
        if (button) return button;
      }
    }

    if (target.trackPath && onTargetPage()) {
      return Array.from(document.querySelectorAll(
          'button[data-testid="play-button"]')).find(visible) || null;
    }
    return null;
  };
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    catch (_) {}
    if (!element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [
      Math.max(0, Math.min(10000, Math.round(
          (centerX / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          (centerY / window.innerHeight) * 10000)))
    ];
  };
  const mediaPlaybackState = () => {
    const media = Array.from(document.querySelectorAll('audio, video'));
    const active = media.find(candidate => !candidate.ended && !candidate.paused);
    if (active) {
      return {
        known: true,
        playing: true,
        currentTime: Number(active.currentTime) || 0,
        media: active
      };
    }
    const pending = media.find(candidate => !candidate.ended) || null;
    if (pending) {
      return {
        known: true,
        playing: false,
        currentTime: Number(pending.currentTime) || 0,
        media: pending
      };
    }
    return { known: false, playing: false, currentTime: 0, media: null };
  };
  const requestMediaStart = media => {
    if (!media || media.ended || !media.paused) return false;
    const now = Date.now();
    const last = Number(media.__homePanelSpotifyPlayRequestAt) || 0;
    if (now - last < 3000) return true;
    media.__homePanelSpotifyPlayRequestAt = now;
    try {
      const promise = media.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  };

  if (location.hostname !== 'open.spotify.com' || !onTargetPage()) {
    report(false);
    return null;
  }

  const current = currentTrack();
  const currentMatchesTarget = targetMatches(current);
  const currentIdentified = !!current.path || !!current.title;
  const control = playerControl();
  const button = targetPlayButton();
  const controlIntent = buttonIntent(control);
  const buttonIntentValue = buttonIntent(button);
  const mediaState = mediaPlaybackState();

  if (currentMatchesTarget && mediaState.known && mediaState.playing) {
    report(true);
    return true;
  }

  if (mediaState.known && mediaState.playing && currentIdentified &&
      !currentMatchesTarget) {
    report(false);
    return 'wrong';
  }

  // Once Spotify has loaded the requested media element, the element itself is
  // the least ambiguous start actuator. This covers the failure mode where the
  // UI already flips to Pause while the actual media clock remains at 0. Native
  // WebView autoplay policy allows this play() request; observer 'playing' is
  // still the only authority that promotes the slot to Playing.
  if (currentMatchesTarget && mediaState.known && !mediaState.playing &&
      requestMediaStart(mediaState.media)) {
    report(false);
    return 'starting';
  }

  if (controlIntent === 'pause' || buttonIntentValue === 'pause') {
    report(false);
    return 'settling';
  }

  report(false);
  if (buttonIntentValue === 'play') return point(button);
  if (currentMatchesTarget && controlIntent === 'play') return point(control);
  if (currentMatchesTarget || mediaState.known) return 'settling';
  return null;
})()
)JS";

}  // namespace
}  // namespace hp
