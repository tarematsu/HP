namespace hp {
namespace {

// Minimal playback start/status probe for the already-selected Spotify track:
// 1) the target page remains the navigation authority;
// 2) a target-page Pause control confirms playback even when responsive layout
//    keeps that control outside the visible viewport;
// 3) if the target-page control is omitted entirely, the global Pause control
//    confirms playback only after now-playing identity matches the target;
// 4) CDP clicks are still returned only for a visible target-page Play control.
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
  const isPauseControl = element => {
    const label = normalize(
        element && (element.getAttribute('aria-label') ||
                    element.getAttribute('title')));
    return label.includes('pause') || label.includes('一時停止');
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

  const pageButtons = Array.from(document.querySelectorAll(
      'button[data-testid="play-button"]')).filter(enabled);
  const visiblePageButton = pageButtons.find(visible) || null;
  if (visiblePageButton) {
    if (isPauseControl(visiblePageButton)) return true;
    return point(visiblePageButton);
  }

  // A compact/background WebView may keep the page control in the DOM but
  // outside the rendered viewport. Its Pause state still belongs to this target
  // page and is safe to use as a confirmation signal.
  if (pageButtons.some(isPauseControl)) return true;

  // Some Spotify responsive layouts omit the target-page button entirely.
  // Never click the global player; use it only as a Pause-state confirmation
  // after an independent now-playing identity check proves the target is active.
  const playerButtons = Array.from(document.querySelectorAll(
      'button[data-testid="control-button-playpause"]')).filter(enabled);
  const playerPause = playerButtons.find(isPauseControl) || null;
  if (playerPause && currentTrackMatchesTarget()) return true;

  return null;
})()
)JS";

}  // namespace
}  // namespace hp
