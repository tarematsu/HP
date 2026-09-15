namespace hp {
namespace {

// Minimal playback start path for the already-selected Spotify track page:
// 1) if AUDIO is playing, wait for the observer;
// 2) otherwise call AUDIO.play() once per target generation;
// 3) if playback still has not started on the next reconcile, return the
//    center of Spotify's native Play control for one trusted CDP click.
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

  const audio = document.querySelector('audio');
  if (audio && !audio.paused && !audio.ended) return true;

  const generation = String(window.__homePanelSpotifyGeneration || '0');
  if (audio && typeof audio.play === 'function' &&
      window.__homePanelSpotifyDirectPlayGeneration !== generation) {
    window.__homePanelSpotifyDirectPlayGeneration = generation;
    const runtime = window.__homePanelSpotifyMediaObserverRuntime;
    if (runtime && typeof runtime.armTrustedStart === 'function') {
      runtime.armTrustedStart(generation);
    }
    try {
      const result = audio.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return 'direct-play';
    } catch (_) {
      // Synchronous rejection falls through to the trusted Spotify Play button.
    }
  }

  const button = Array.from(document.querySelectorAll(
      'button[data-testid="play-button"], '
      + 'button[data-testid="control-button-playpause"]'))
      .find(visible) || null;
  return point(button);
})()
)JS";

}  // namespace
}  // namespace hp
