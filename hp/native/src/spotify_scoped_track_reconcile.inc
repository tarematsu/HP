namespace hp {
namespace {

// Minimal playback start/status probe for the already-selected Spotify track:
// 1) the target page remains the navigation authority and first Play waits one
//    second after NavigationCompleted bootstrap before trusted input is sent;
// 2) Pause is confirmed only after an available media element has actually
//    advanced; a zero-second stall is toggled back to Play before retrying;
// 3) if the target-page control is omitted entirely, the global Pause control
//    is trusted only after now-playing identity matches the target;
// 4) CDP clicks normally target the visible target-page Play control. After a
//    verified zero-second stall, the matching global Play may be used as a
//    recovery-only trusted click target when Spotify omits the page control.
constexpr wchar_t kSpotifyScopedTrackReconcileScript[] =
LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target &&
      (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return null;

  const onTargetPage = location.pathname === targetPath ||
      (targetPath.startsWith('/track/') && location.pathname.endsWith(targetPath));
  if (!onTargetPage) return null;

  const normalize = value =>
      String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const enabled = element => !!element && !element.disabled &&
      element.getAttribute('aria-disabled') !== 'true';
  const visible = element => {
    if (!enabled(element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const controlLabel = element => normalize(
      element && (element.getAttribute('aria-label') ||
                  element.getAttribute('title')));
  const isPauseControl = element => {
    const label = controlLabel(element);
    return label.includes('pause') || label.includes('一時停止');
  };
  const isPlayControl = element => {
    const label = controlLabel(element);
    return !isPauseControl(element) &&
        (label === 'play' || label.includes('再生'));
  };
  const sameTrackPath = value => !!value &&
      (value === targetPath ||
       (targetPath.startsWith('/track/') && value.endsWith(targetPath)));
  const currentTrackMatchesTarget = () => {
    for (const selector of [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="now-playing-bar"] [data-testid="context-item-link"][href*="/track/"]',
      'footer [data-testid="context-item-link"][href*="/track/"]'
    ]) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (path.includes('/track/')) return sameTrackPath(path);
      } catch (_) {}
    }

    const targetTitle = normalize(target && target.title);
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const metadataTitle = normalize(metadata && metadata.title);
    return !!targetTitle && !!metadataTitle && metadataTitle === targetTitle;
  };

  const clearProgressProbe = () => {
    window.__homePanelSpotifyProgressProbe = null;
  };
  const restartPending = () =>
      window.__homePanelSpotifyZeroSecondRestartPath === targetPath;
  const clearRestartPending = () => {
    if (restartPending()) window.__homePanelSpotifyZeroSecondRestartPath = null;
  };
  const targetMedia = () => {
    const media = Array.from(document.querySelectorAll('audio, video')).filter(candidate => {
      if (!candidate || candidate.ended) return false;
      const current = Number(candidate.currentTime);
      return Number.isFinite(current) && current >= 0;
    });
    return media.find(candidate => !candidate.paused) || media[0] || null;
  };
  const verifyPauseProgress = button => {
    const media = targetMedia();
    if (!media) {
      clearProgressProbe();
      clearRestartPending();
      return 'confirmed';
    }

    const current = Number(media.currentTime);
    if (!Number.isFinite(current) || current < 0) {
      clearProgressProbe();
      clearRestartPending();
      return 'confirmed';
    }

    const now = Date.now();
    const previous = window.__homePanelSpotifyProgressProbe;
    if (!previous || previous.path !== targetPath || previous.media !== media ||
        current + 0.05 < previous.currentTime) {
      window.__homePanelSpotifyProgressProbe = {
        path: targetPath,
        media,
        currentTime: current,
        sampledAt: now
      };
      return current > 0.25 ? 'confirmed' : 'pending';
    }

    if (current > previous.currentTime + 0.05 || current > 0.25) {
      clearProgressProbe();
      clearRestartPending();
      return 'confirmed';
    }

    if (now - previous.sampledAt < 1000) return 'pending';

    clearProgressProbe();
    window.__homePanelSpotifyZeroSecondRestartPath = targetPath;
    try {
      // Pausing does not require a trusted user gesture. The subsequent Play
      // still flows through the native CDP trusted-click path.
      button.click();
    } catch (_) {}
    return 'restarted';
  };
  const confirmPause = button => {
    const result = verifyPauseProgress(button);
    return result === 'confirmed';
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
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) ||
        centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [centerX, centerY];
  };

  const nativeLoadedAt = Number(window.__homePanelSpotifyNativeLoadedAt);
  const initialPlayDelayElapsed = Number.isFinite(nativeLoadedAt) &&
      Date.now() - nativeLoadedAt >= 1000;

  const pageButtons = Array.from(document.querySelectorAll(
      'button[data-testid="play-button"]')).filter(enabled);
  const visiblePageButton = pageButtons.find(visible) || null;
  if (visiblePageButton) {
    if (isPauseControl(visiblePageButton)) {
      return confirmPause(visiblePageButton) ? true : null;
    }
    clearProgressProbe();
    if (!initialPlayDelayElapsed && !restartPending()) return null;
    return point(visiblePageButton);
  }

  // A compact/background WebView may keep the page control in the DOM but
  // outside the rendered viewport. It can still prove playback, but only after
  // the media clock actually advances. A zero-second stall is toggled back to
  // Play so the next scheduler pass can issue a fresh trusted CDP Play click.
  if (pageButtons.some(isPauseControl)) {
    const pagePause = pageButtons.find(isPauseControl) || null;
    return pagePause && confirmPause(pagePause) ? true : null;
  }

  // Some Spotify responsive layouts omit the target-page button entirely.
  // Global Pause remains confirmation-only during normal playback. A global
  // Play becomes eligible only after this target itself was proven stalled at
  // zero seconds, and only while now-playing identity still matches the target.
  const playerButtons = Array.from(document.querySelectorAll(
      'button[data-testid="control-button-playpause"]')).filter(enabled);
  const playerPause = playerButtons.find(isPauseControl) || null;
  if (playerPause && currentTrackMatchesTarget()) {
    return confirmPause(playerPause) ? true : null;
  }
  const playerPlay = playerButtons.find(button => isPlayControl(button) && visible(button)) || null;
  if (restartPending() && playerPlay && currentTrackMatchesTarget()) {
    clearProgressProbe();
    return point(playerPlay);
  }

  clearProgressProbe();
  return null;
})()
)JS";

}  // namespace
}  // namespace hp
