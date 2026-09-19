namespace hp {
namespace {

// Wrap the ordinary Spotify reconcile probe with a second, fail-closed startup
// gate. The base probe still owns Play/Pause discovery and zero-second repair;
// this layer only lets a successful probe reach native-audio verification when
// the Web Player's now-playing identity matches the requested target and that
// target's active media clock advances across two separate scheduler samples.
//
// A progressing non-track item is intentionally treated as an interstitial.
// Spotify advertisements normally do not expose a /track/ identity, so startup
// waits for the player to return to a track instead of pausing/restarting the ad.
// Explicitly wrong /track/ identities get one bounded restart attempt per page
// lifetime; a persistent mismatch then escalates through the native bounded
// Reload -> Rebuild -> Skip recovery ladder instead of forming a restart loop.
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

  const playbackProbeMs = 2000;
  const normalize = value =>
      String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sameTrackPath = value => !!value &&
      (value === targetPath ||
       (targetPath.startsWith('/track/') && value.endsWith(targetPath)));
  const nowPlayingTrackPath = () => {
    for (const selector of [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="now-playing-bar"] [data-testid="context-item-link"][href*="/track/"]',
      'footer [data-testid="context-item-link"][href*="/track/"]'
    ]) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (path.includes('/track/')) return path;
      } catch (_) {}
    }
    return '';
  };
  const metadataMatchesTarget = () => {
    const targetTitle = normalize(target && target.title);
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const metadataTitle = normalize(metadata && metadata.title);
    return !!targetTitle && !!metadataTitle && metadataTitle === targetTitle;
  };
  const currentTrackMatchesTarget = observedTrackPath =>
      observedTrackPath ? sameTrackPath(observedTrackPath) : metadataMatchesTarget();
  const advertisementVisible = () => {
    for (const selector of [
      '[data-testid="ad-banner"]',
      '[data-testid*="advertisement" i]',
      '[data-testid*="sponsored" i]',
      '[aria-label*="advertisement" i]',
      '[aria-label="広告"]',
      'a[href*="/ad/"]'
    ]) {
      const element = document.querySelector(selector);
      if (element && element.isConnected !== false) return true;
    }
    return false;
  };

  const clearStrictProbe = () => {
    window.__homePanelSpotifyStrictStartProbe = null;
  };
  const clearWrongTrackRecovery = () => {
    window.__homePanelSpotifyWrongTrackRecovery = null;
  };
  const pagePause = Array.from(
      document.querySelectorAll('button[data-testid="play-button"]')).find(button => {
        if (!button || button.isConnected === false) return false;
        const label = normalize(
            button.getAttribute('aria-label') || button.getAttribute('title'));
        return label.includes('pause') || label.includes('一時停止');
      }) || null;

  const observedTrackPath = nowPlayingTrackPath();
  const metadataTargetMatch = metadataMatchesTarget();

  // Ads and other progressing interstitials generally have no /track/ identity.
  // The base probe reached true only after media progress was observed, so do
  // not interrupt that audio. This also tolerates the short identity gap while
  // Spotify swaps from an ad/interstitial back to the requested track.
  if (advertisementVisible() || (!observedTrackPath && !metadataTargetMatch)) {
    clearStrictProbe();
    clearWrongTrackRecovery();
    return playbackProbeMs;
  }

  if (!currentTrackMatchesTarget(observedTrackPath)) {
    clearStrictProbe();
    const recovery = window.__homePanelSpotifyWrongTrackRecovery ||
        (window.__homePanelSpotifyWrongTrackRecovery = {
          path: '', observedPath: '', samples: 0, restarts: 0
        });
    if (recovery.path !== targetPath) {
      recovery.path = targetPath;
      recovery.observedPath = '';
      recovery.samples = 0;
      recovery.restarts = 0;
    }
    if (recovery.observedPath !== observedTrackPath) {
      recovery.observedPath = observedTrackPath;
      recovery.samples = 1;
      return playbackProbeMs;
    }

    recovery.samples = Number(recovery.samples || 0) + 1;
    if (recovery.samples < 2) return playbackProbeMs;

    // One trusted restart opportunity is enough. A persistent explicit wrong
    // track after that is a real startup failure, not permission to toggle the
    // player forever. Native code will continue with bounded escalation.
    if (pagePause && Number(recovery.restarts || 0) < 1) {
      recovery.restarts = Number(recovery.restarts || 0) + 1;
      recovery.samples = 0;
      try { pagePause.click(); } catch (_) {}
      window.__homePanelSpotifyZeroSecondRestartPath = targetPath;
      return 'restart';
    }
    return 'startup-failure';
  }

  clearWrongTrackRecovery();

  const media = Array.from(document.querySelectorAll('audio, video')).filter(candidate => {
    if (!candidate || candidate.isConnected === false || candidate.ended ||
        candidate.paused) return false;
    const current = Number(candidate.currentTime);
    return Number.isFinite(current) && current >= 0;
  });
  const activeMedia = media[0] || null;
  if (!activeMedia) {
    clearStrictProbe();
    return playbackProbeMs;
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
    return playbackProbeMs;
  }
  if (current <= Number(previous.currentTime) + 0.05) return playbackProbeMs;

  clearStrictProbe();
  return true;
})()
)JS";

const wchar_t* const kSpotifyStrictScopedTrackReconcileScript =
    kSpotifyStrictScopedTrackReconcileScriptStorage.c_str();

}  // namespace
}  // namespace hp
