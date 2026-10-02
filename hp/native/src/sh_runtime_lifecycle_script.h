#pragma once

namespace hp {

// Event wiring and document lifetime for the single Stationhead runtime. State
// detection belongs to interaction_script; blank recovery belongs to
// blank_recovery_script. This fragment schedules those owners plus a bounded
// media-progress probe, and tears their timers down with the document lifecycle.
inline std::wstring_view StationheadRuntimeLifecycleFragment() noexcept {
  static constexpr std::wstring_view kFragment = LR"JS(
  const zoomOut = () => document.documentElement?.style.setProperty('zoom', '0.5');
  const run = () => {
    if (!pageActive) return;
    publishAudio();
    publishAuth();
  };
  const schedule = (delay = 0) => {
    if (!pageActive || eventTimer) return;
    eventTimer = nativeTimeout(() => {
      eventTimer = 0;
      run();
    }, delay);
  };
  const onStateEvent = () => schedule(0);
  const onInteractiveEvent = () => schedule(150);
  let keyWaitingMedia = null;
  let progressTimer = 0;
  let progressMedia = null;
  let progressCandidateMedia = null;
  let progressTime = 0;
  let progressStalledAt = 0;
  let progressRepairTried = false;
  let progressSyntheticKeyWait = false;
  let progressConfirmed = false;
  let lastRecoverableProbeAt = 0;
  const progressProbeMs = 4000;
  const progressHealthyProbeMs = 8000;
  const recoverableHealthyProbeMs = 16000;
  const progressStallMs = 12000;

  const activeProgressMedia = media =>
    media instanceof HTMLMediaElement && media.isConnected && !media.paused &&
    !media.ended && media.readyState >= 2;
  const rememberProgressMedia = event => {
    const media = event?.target;
    if (!(media instanceof HTMLMediaElement)) return;
    if (event.type === 'ended' || event.type === 'emptied' || event.type === 'abort') {
      if (progressCandidateMedia === media) progressCandidateMedia = null;
      return;
    }
    if (event.type === 'play' || event.type === 'playing' || event.type === 'canplay') {
      progressCandidateMedia = media;
    }
  };
  const currentProgressMedia = () => {
    if (activeProgressMedia(progressCandidateMedia)) return progressCandidateMedia;
    const media = Array.from(document.querySelectorAll('audio,video')).find(
      activeProgressMedia) || null;
    progressCandidateMedia = media;
    return media;
  };

  const beginKeyWait = event => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement) || keyWaitingMedia === media) return;
    progressCandidateMedia = media;
    keyWaitingMedia = media;
    postText('drm-waiting');
  };
  const finishKeyWait = event => {
    rememberProgressMedia(event);
    if (!keyWaitingMedia || (event?.target && event.target !== keyWaitingMedia)) return;
    keyWaitingMedia = null;
    postText('drm-ready');
  };
  const clearSyntheticKeyWait = () => {
    if (!progressSyntheticKeyWait) return;
    progressSyntheticKeyWait = false;
    postText('drm-ready');
  };

  // waitingforkey and Chromium media errors are not guaranteed for every CDM
  // failure. Independently verify that a media element claiming to play keeps
  // advancing. First re-kick the element; if a second full stall window passes,
  // hand the incident to the existing native DRM wait/reload path instead of
  // reloading from page JavaScript. Explicit waitingforkey retains its existing
  // native 20-second protection window and is not interrupted by this probe.
  // A positive native playback transition is deliberately not accepted until
  // this probe has observed the same media element advance between samples.
  const probeMediaProgress = () => {
    progressTimer = 0;
    if (!pageActive) return;

    // Recoverable onboarding discovery is the most expensive part of this
    // watchdog because it intentionally inspects broad Stationhead DOM shapes.
    // Keep the previous four-second retry while playback is uncertain, but once
    // the same media clock is confirmed healthy only run that DOM scan every
    // sixteen seconds. Media progress itself is still checked every eight
    // seconds, and any stall/recovery evidence immediately restores the fast
    // onboarding cadence.
    const probeStartedAt = Date.now();
    const fastRecoverableProbe =
      !progressConfirmed || progressStalledAt !== 0 || progressRepairTried ||
      progressSyntheticKeyWait || keyWaitingMedia !== null;
    if (fastRecoverableProbe || lastRecoverableProbeAt === 0 ||
        probeStartedAt - lastRecoverableProbeAt >= recoverableHealthyProbeMs) {
      lastRecoverableProbeAt = probeStartedAt;
      publishRecoverableOnboarding();
    }

    // Cache the active media element from normal media events. Healthy playback
    // no longer walks the full document for audio/video every eight seconds; a
    // DOM lookup is only needed at startup or after the cached element stops,
    // ends, or is replaced without a matching event.
    const media = currentProgressMedia();
    if (!media) {
      progressMedia = null;
      progressTime = 0;
      progressStalledAt = 0;
      progressRepairTried = false;
      progressConfirmed = false;
      clearSyntheticKeyWait();
    } else if (keyWaitingMedia === media) {
      progressMedia = media;
      progressTime = Number(media.currentTime) || 0;
      progressStalledAt = 0;
      progressRepairTried = false;
      progressConfirmed = false;
      clearSyntheticKeyWait();
    } else {
      const current = Number(media.currentTime);
      const now = Date.now();
      if (!Number.isFinite(current) || current < 0) {
        progressMedia = null;
        progressCandidateMedia = null;
        progressTime = 0;
        progressStalledAt = 0;
        progressRepairTried = false;
        progressConfirmed = false;
        clearSyntheticKeyWait();
      } else if (progressMedia !== media) {
        // First sight of a media element is only a baseline. A stale/replaced
        // element can already have a non-zero currentTime, so never use its
        // absolute position as positive playback evidence.
        progressMedia = media;
        progressTime = current;
        progressStalledAt = 0;
        progressRepairTried = false;
        progressConfirmed = false;
        clearSyntheticKeyWait();
      } else if (current > progressTime + 0.10) {
        progressTime = current;
        progressStalledAt = 0;
        progressRepairTried = false;
        progressConfirmed = true;
        clearSyntheticKeyWait();
        // Native confirmation writes this flag true. Until then, publish every
        // real same-element advance so a lost first message cannot leave a
        // recovered lane permanently unconfirmed.
        if (window.__homepanelAudioPlaying !== true) {
          postText('media-progress');
        }
      } else if (!progressStalledAt) {
        progressStalledAt = now;
      } else if (now - progressStalledAt >= progressStallMs) {
        if (!progressRepairTried) {
          progressRepairTried = true;
          progressStalledAt = now;
          progressConfirmed = false;
          try {
            media.pause();
            const result = media.play?.();
            if (result?.catch) result.catch(() => {});
          } catch (_) {}
        } else if (!progressSyntheticKeyWait) {
          progressSyntheticKeyWait = true;
          progressStalledAt = now;
          progressConfirmed = false;
          postText('drm-waiting');
        }
      }
    }
    const healthyProgress =
      media && progressMedia === media && progressConfirmed &&
      progressStalledAt === 0 && !progressRepairTried &&
      !progressSyntheticKeyWait && keyWaitingMedia !== media &&
      window.__homepanelAudioPlaying === true;
    progressTimer = nativeTimeout(
      probeMediaProgress,
      healthyProgress ? progressHealthyProbeMs : progressProbeMs);
  };

  const onMediaStateEvent = event => {
    rememberProgressMedia(event);
    schedule(0);
  };
  for (const eventName of [
      'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error']) {
    document.addEventListener(eventName, onMediaStateEvent, true);
  }
  document.addEventListener('click', onInteractiveEvent, true);
  document.addEventListener('waitingforkey', beginKeyWait, true);
  for (const eventName of ['playing', 'emptied', 'abort', 'ended']) {
    document.addEventListener(eventName, finishKeyWait, true);
  }
  document.addEventListener('submit', onInteractiveEvent, true);
  document.addEventListener('DOMContentLoaded', () => {
    zoomOut();
    run();
    armBlankRecovery();
  }, { once: true });
  window.addEventListener('load', () => {
    zoomOut();
    run();
    armBlankRecovery();
  }, { once: true });
  window.addEventListener('focus', onStateEvent, true);
  window.addEventListener('popstate', onStateEvent, true);
  window.addEventListener('hashchange', onStateEvent, true);
  window.addEventListener('homepanel-stationhead-auth-ready', onStateEvent, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule(0);
  });
  window.addEventListener('pagehide', () => {
    pageActive = false;
    progressCandidateMedia = null;
    for (const timer of [eventTimer, authReadyTimer, blankTimer, blankConfirmTimer,
                         progressTimer]) {
      if (timer) nativeClearTimeout(timer);
    }
    eventTimer = authReadyTimer = blankTimer = blankConfirmTimer = progressTimer = 0;
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    zoomOut();
    run();
    armBlankRecovery();
    if (!progressTimer) progressTimer = nativeTimeout(probeMediaProgress, progressProbeMs);
  }, true);

  zoomOut();
  run();
  armBlankRecovery();
  progressTimer = nativeTimeout(probeMediaProgress, progressProbeMs);
})()
)JS";
  return kFragment;
}

}  // namespace hp
