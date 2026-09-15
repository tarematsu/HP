namespace hp {
namespace {

// Minimal playback start/status probe for the already-selected Spotify track:
// 1) prefer the target page Play/Pause control over the global player control;
// 2) only trust the global player when its now-playing Track ID matches target;
// 3) Pause means native may confirm playback directly; Play returns one trusted
//    CDP click point. No observer/WebMessage acknowledgement is required.
constexpr wchar_t kSpotifyScopedTrackReconcileScript[] =
LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target &&
      (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return null;

  const sameTrackPath = value => value === targetPath ||
      (targetPath.startsWith('/track/') && value.endsWith(targetPath));
  const onTargetPage = sameTrackPath(location.pathname);
  if (!onTargetPage) return null;

  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const isPauseControl = element => {
    const label = ((element.getAttribute('aria-label') ||
                    element.getAttribute('title')) || '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    return label.includes('pause') || label.includes('一時停止');
  };
  const playerMatchesTarget = () => {
    for (const selector of [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="now-playing-bar"] [data-testid="context-item-link"][href*="/track/"]',
      'footer [data-testid="context-item-link"][href*="/track/"]'
    ]) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        if (sameTrackPath(new URL(link.href, location.href).pathname)) return true;
      } catch (_) {}
    }
    return false;
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

  const pageButton = Array.from(document.querySelectorAll(
      'button[data-testid="play-button"]')).find(visible) || null;
  if (pageButton) {
    if (isPauseControl(pageButton)) return true;
    return point(pageButton);
  }

  const playerButton = Array.from(document.querySelectorAll(
      'button[data-testid="control-button-playpause"]')).find(visible) || null;
  if (!playerButton || !playerMatchesTarget()) return null;
  if (isPauseControl(playerButton)) return true;
  return point(playerButton);
})()
)JS";

}  // namespace
}  // namespace hp
