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
    for (const timer of [eventTimer, authReadyTimer, blankTimer, blankConfirmTimer]) {
      if (timer) nativeClearTimeout(timer);
    }
    eventTimer = authReadyTimer = blankTimer = blankConfirmTimer = 0;
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    zoomOut();
    run();
    armBlankRecovery();
  }, true);

  zoomOut();
  run();
  armBlankRecovery();
})()
)JS";
  return kFragment;
}

}  // namespace hp
