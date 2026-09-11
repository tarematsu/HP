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
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const repeatState = button => {
    if (!button) return 'unknown';
    const checked = button.getAttribute('aria-checked');
    if (checked === 'false') return 'off';
    if (checked === 'true') return 'context';
    if (checked === 'mixed') return 'one';
    const label = labelOf(button);
    if (label.includes('enable repeat') || label.includes('リピートを有効')) {
      return 'off';
    }
    if (label.includes('disable repeat') || label.includes('リピートを無効')) {
      return 'one';
    }
    return 'unknown';
  };
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === 'pause' ||
                 label === '再生' || label === '一時停止';
        }) || null;
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
          const label = labelOf(candidate);
          return label === 'play' || label === 'pause' ||
                 label === '再生' || label === '一時停止' ||
                 (!!target.title && label.includes(target.title));
        });
        if (button) return button;
      }
    }

    // A direct track page can render its main play control without a target
    // track link. Only permit this fallback while the document itself is the
    // requested track; never choose the first play button from an arbitrary page.
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

  if (location.hostname !== 'open.spotify.com' || !onTargetPage()) {
    report(false);
    return null;
  }

  const current = currentTrack();
  const control = playerControl();
  const button = targetPlayButton();

  // Keep Spotify's own queue in repeat-one while music is active. The media
  // observer still cuts the requested track two seconds before its natural end,
  // but repeat-one is a fail-safe for background/event throttling: if that end
  // guard is ever missed, Spotify repeats the requested song instead of starting
  // an autoplay recommendation. Use the existing native trusted-click path and
  // advance Off -> Context -> One over successive reconcile passes.
  const repeat = document.querySelector(
      'button[data-testid="control-button-repeat"]');
  const repeatMode = repeatState(repeat);
  if (visible(repeat) && repeatMode !== 'one' && repeatMode !== 'unknown') {
    report(false);
    return point(repeat);
  }

  if ((targetMatches(current) && buttonShowsPlaying(control)) ||
      buttonShowsPlaying(button)) {
    report(true);
    return true;
  }

  report(false);
  if (targetMatches(current) && visible(control)) return point(control);
  return point(button);
})()
)JS";

}  // namespace
}  // namespace hp
