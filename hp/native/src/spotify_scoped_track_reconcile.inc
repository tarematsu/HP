namespace hp {
namespace {

// Minimal playback start path for the already-selected Spotify track page:
// 1) prefer Spotify's target-page Play control over raw media state;
// 2) only the target-page control's Pause state counts as already playing;
// 3) otherwise use the player Play control or AUDIO.play() as fallbacks and
//    wait for the observer instead of treating unrelated media as success.
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
  const labelOf = element =>
      ((element && (element.getAttribute('aria-label') ||
                    element.getAttribute('title'))) || '')
          .replace(/\s+/g, ' ').trim().toLowerCase();
  const isPauseControl = element => {
    const label = labelOf(element);
    return label.includes('pause') || label.includes('一時停止');
  };
  const isPlayControl = element => {
    const label = labelOf(element);
    return label.includes('play') || label.includes('再生');
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

  const pagePlay = Array.from(document.querySelectorAll(
      'button[data-testid="play-button"]')).find(visible) || null;
  if (pagePlay) {
    if (isPauseControl(pagePlay)) return true;
    return point(pagePlay);
  }

  const playerControl = Array.from(document.querySelectorAll(
      'button[data-testid="control-button-playpause"]')).find(visible) || null;
  if (playerControl) {
    if (isPauseControl(playerControl)) return 'observing';
    if (isPlayControl(playerControl)) return point(playerControl);
  }

  const audio = document.querySelector('audio');
  if (audio && !audio.paused && !audio.ended) return 'observing';

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
    } catch (_) {}
  }
  return null;
})()
)JS";

}  // namespace
}  // namespace hp
