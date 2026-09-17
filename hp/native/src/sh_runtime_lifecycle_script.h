#pragma once

namespace hp {

// Event wiring and document lifetime for the single Stationhead runtime. State
// detection belongs to interaction_script; blank recovery belongs to
// blank_recovery_script. This fragment only schedules those owners and tears
// their timers down when the document leaves the page lifecycle.
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
  let progressTime = 0;
  let progressStalledAt = 0;
  let progressRepairTried = false;
  const progressProbeMs = 4000;
  const progressStallMs = 12000;

  const beginKeyWait = event => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement) || keyWaitingMedia === media) return;
    keyWaitingMedia = media;
    postText('drm-waiting');
  };
  const finishKeyWait = event => {
    if (!keyWaitingMedia || (event?.target && event.target !== keyWaitingMedia)) return;
    keyWaitingMedia = null;
    postText('drm-ready');
  };

  // waitingforkey and Chromium media errors are not guaranteed for every CDM
  // failure. Independently verify that a media element claiming to play keeps
  // advancing. First re-kick the element, then reload the document if another
  // full stall window passes. Explicit key acquisition keeps its existing
  // native 20-second protection window and is not interrupted by this probe.
  const probeMediaProgress = () => {
    progressTimer = 0;
    if (!pageActive) return;
    const media = Array.from(document.querySelectorAll('audio,video')).find(
      element => element instanceof HTMLMediaElement && !element.paused &&
        !element.ended && element.readyState >= 2);
    if (!media) {
      progressMedia = null;
      progressTime = 0;
      progressStalledAt = 0;
      progressRepairTried = false;
    } else if (keyWaitingMedia === media) {
      progressMedia = media;
      progressTime = Number(media.currentTime) || 0;
      progressStalledAt = 0;
      progressRepairTried = false;
    } else {
      const current = Number(media.currentTime);
      const now = Date.now();
      if (!Number.isFinite(current) || current < 0) {
        progressMedia = null;
        progressTime = 0;
        progressStalledAt = 0;
        progressRepairTried = false;
      } else if (progressMedia !== media || current > progressTime + 0.10) {
        progressMedia = media;
        progressTime = current;
        progressStalledAt = 0;
        progressRepairTried = false;
      } else if (!progressStalledAt) {
        progressStalledAt = now;
      } else if (now - progressStalledAt >= progressStallMs) {
        if (!progressRepairTried) {
          progressRepairTried = true;
          progressStalledAt = now;
          try {
            media.pause();
            const result = media.play?.();
            if (result?.catch) result.catch(() => {});
          } catch (_) {}
        } else {
          try { location.reload(); } catch (_) {}
          return;
        }
      }
    }
    progressTimer = nativeTimeout(probeMediaProgress, progressProbeMs);
  };

  for (const eventName of [
      'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error']) {
    document.addEventListener(eventName, onStateEvent, true);
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
