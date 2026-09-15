namespace hp {
namespace {

// Minimal playback start/status probe for the already-selected Spotify track:
// 1) prefer the target page Play/Pause control over the global player control;
// 2) if it is Play, return its exact CSS-pixel center for one trusted CDP click;
// 3) if it is already Pause, native confirms playback directly without waiting
//    for observer/WebMessage acknowledgement.
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
  const playerButton = pageButton ? null : Array.from(document.querySelectorAll(
      'button[data-testid="control-button-playpause"]')).find(visible) || null;
  const button = pageButton || playerButton;
  if (!button) return null;
  if (isPauseControl(button)) return true;
  return point(button);
})()
)JS";

}  // namespace
}  // namespace hp
