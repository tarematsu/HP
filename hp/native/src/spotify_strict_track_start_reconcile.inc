namespace hp {
namespace {

// Wrap the ordinary Spotify reconcile probe with a second, fail-closed startup
// gate. The base probe still owns Play/Pause discovery and zero-second repair;
// this layer only lets a successful probe reach native-audio verification when
// the Web Player's now-playing identity matches the requested target and that
// target's active media clock advances across two separate scheduler samples.
const std::wstring kSpotifyStrictScopedTrackReconcileScriptStorage =
    std::wstring(LR"JS(
(() => {
  const baseResult = (
)JS") +
    kSpotifyScopedTrackReconcileScriptStorage +
    LR"JS(
  );
  if (baseResult !== true) return baseResult;

  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target &&
      (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return 2000;

  const normalize = value =>
      String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
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

  const clearStrictProbe = () => {
    window.__homePanelSpotifyStrictStartProbe = null;
  };
  const pagePause = Array.from(
      document.querySelectorAll('button[data-testid="play-button"]')).find(button => {
        if (!button || button.isConnected === false) return false;
        const label = normalize(
            button.getAttribute('aria-label') || button.getAttribute('title'));
        return label.includes('pause') || label.includes('一時停止');
      }) || null;

  if (!currentTrackMatchesTarget()) {
    clearStrictProbe();
    // A successful base probe paired with the wrong now-playing identity is the
    // stale-player case that previously produced a false startup success. Pause
    // the target-page control once so the next pass can issue a fresh trusted
    // Play click for this target instead of accepting another track's progress.
    if (pagePause) {
      try { pagePause.click(); } catch (_) {}
      window.__homePanelSpotifyZeroSecondRestartPath = targetPath;
      return 'restart';
    }
    return 2000;
  }

  const media = Array.from(document.querySelectorAll('audio, video')).filter(candidate => {
    if (!candidate || candidate.isConnected === false || candidate.ended ||
        candidate.paused) return false;
    const current = Number(candidate.currentTime);
    return Number.isFinite(current) && current >= 0;
  });
  const activeMedia = media[0] || null;
  if (!activeMedia) {
    clearStrictProbe();
    return 2000;
  }

  const current = Number(activeMedia.currentTime);
  const previous = window.__homePanelSpotifyStrictStartProbe;
  window.__homePanelSpotifyStrictStartProbe = {
    path: targetPath,
    media: activeMedia,
    currentTime: current
  };

  if (!previous || previous.path !== targetPath ||
      previous.media !== activeMedia ||
      !Number.isFinite(Number(previous.currentTime)) ||
      current + 0.05 < Number(previous.currentTime)) {
    return 2000;
  }
  if (current <= Number(previous.currentTime) + 0.05) return 2000;

  clearStrictProbe();
  return true;
})()
)JS";

const wchar_t* const kSpotifyStrictScopedTrackReconcileScript =
    kSpotifyStrictScopedTrackReconcileScriptStorage.c_str();

}  // namespace
}  // namespace hp
