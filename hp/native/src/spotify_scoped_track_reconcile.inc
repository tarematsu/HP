namespace hp {
namespace {

// Spotify startup intentionally has one small state machine:
// target page -> one trusted Play -> target identity/media progress -> native
// audio verification. Any progressing non-target media (including ads) is left
// alone and simply rechecked later. There is no Pause/Play restart loop here.
const std::wstring kSpotifyScopedTrackReconcileScriptStorage = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target &&
      (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return null;

  const onTargetPage = location.pathname === targetPath ||
      (targetPath.startsWith('/track/') && location.pathname.endsWith(targetPath));
  if (!onTargetPage) return null;

  const playbackProbeMs = 2000;
  const failedSampleLimit = 4;
  const normalize = value =>
      String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const enabled = element => !!element && element.isConnected !== false &&
      !element.disabled && element.getAttribute('aria-disabled') !== 'true';
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

  const observedTrackPath = (() => {
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
  })();

  const targetTitle = normalize(target && target.title);
  const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
  const metadataTitle = normalize(metadata && metadata.title);
  const metadataMatchesTarget =
      !!targetTitle && !!metadataTitle && metadataTitle === targetTitle;
  const targetMatches = observedTrackPath
      ? sameTrackPath(observedTrackPath)
      : metadataMatchesTarget;

  const activeMedia = Array.from(document.querySelectorAll('audio, video')).find(candidate => {
    if (!candidate || candidate.isConnected === false || candidate.ended ||
        candidate.paused) return false;
    const current = Number(candidate.currentTime);
    return Number.isFinite(current) && current >= 0;
  }) || null;

  const advertisementVisible = (() => {
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
  })();

  let state = window.__homePanelSpotifySimpleStartState;
  if (!state || state.path !== targetPath) {
    state = { path: targetPath, playIssued: false, failedSamples: 0 };
    window.__homePanelSpotifySimpleStartState = state;
    window.__homePanelSpotifySimpleMediaProbe = null;
  }
  const wait = () => playbackProbeMs;
  const resetFailures = () => { state.failedSamples = 0; };
  const failSample = () => {
    state.failedSamples = Number(state.failedSamples || 0) + 1;
    return state.failedSamples >= failedSampleLimit
        ? 'startup-failure'
        : playbackProbeMs;
  };

  // Ads and any other actively progressing non-target item are never paused,
  // restarted, or counted as a startup failure. Wait for Spotify to return to
  // the requested track naturally.
  if (advertisementVisible || (activeMedia && !targetMatches)) {
    resetFailures();
    window.__homePanelSpotifySimpleMediaProbe = null;
    return wait();
  }

  // Once the requested track is actively playing, require the same media
  // element's clock to advance across scheduler samples before native audio
  // verification is allowed. A matching but paused target falls through to the
  // Play-control path below instead of being counted as a failure first.
  if (targetMatches && activeMedia) {
    const current = Number(activeMedia.currentTime);
    const previous = window.__homePanelSpotifySimpleMediaProbe;
    window.__homePanelSpotifySimpleMediaProbe = {
      path: targetPath,
      media: activeMedia,
      currentTime: current
    };
    if (previous && previous.path === targetPath &&
        previous.media === activeMedia &&
        Number.isFinite(Number(previous.currentTime)) &&
        current > Number(previous.currentTime) + 0.05) {
      resetFailures();
      window.__homePanelSpotifySimpleMediaProbe = null;
      return true;
    }
    return failSample();
  }
  if (!activeMedia) window.__homePanelSpotifySimpleMediaProbe = null;

  const hasErrorSurface = Array.from(document.querySelectorAll([
    '[role="alertdialog"]',
    '[data-testid*="error" i]',
    '[id*="error" i]'
  ].join(','))).some(element => element && element.isConnected !== false);
  if (hasErrorSurface && !activeMedia) return 'startup-failure';

  const pageButtons = Array.from(
      document.querySelectorAll('button[data-testid="play-button"]')).filter(enabled);
  const playerButtons = Array.from(
      document.querySelectorAll('button[data-testid="control-button-playpause"]')).filter(enabled);
  const pagePlay = pageButtons.find(isPlayControl) || null;
  const globalPlay = playerButtons.find(isPlayControl) || null;
  const clickTarget = pagePlay || (metadataMatchesTarget ? globalPlay : null);

  if (clickTarget) {
    const nativeLoadedAt = Number(window.__homePanelSpotifyNativeLoadedAt);
    if (!Number.isFinite(nativeLoadedAt) || Date.now() - nativeLoadedAt < 2000) {
      return wait();
    }
    if (state.playIssued) return failSample();

    try { clickTarget.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    catch (_) {}
    const style = window.getComputedStyle(clickTarget);
    const rect = clickTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (style.display === 'none' || style.visibility === 'hidden' ||
        style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0 ||
        window.innerWidth <= 0 || window.innerHeight <= 0 ||
        !Number.isFinite(centerX) || !Number.isFinite(centerY) ||
        centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) {
      return wait();
    }

    state.playIssued = true;
    resetFailures();
    return [centerX, centerY];
  }

  // A target that is identified but still has no progressing media and no Play
  // control is a bounded startup failure. Unknown transition states simply wait.
  if (targetMatches) return failSample();
  return wait();
})()
)JS";

const wchar_t* const kSpotifyScopedTrackReconcileScript =
    kSpotifyScopedTrackReconcileScriptStorage.c_str();

}  // namespace
}  // namespace hp
