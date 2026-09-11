namespace hp {
namespace {

// Binds delegated media lifecycle events to the observer runtime. This script is
// idempotent and contains no periodic polling.
constexpr wchar_t kSpotifyMediaObserverEventsScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.eventsInstalled) return true;
  runtime.eventsInstalled = true;

  const { state, post, syncTarget, isMedia, enforceTarget,
          scheduleTargetChecks, scheduleRecovery } = runtime;

  const stopMedia = media => {
    try { if (isMedia(media) && !media.paused) media.pause(); } catch (_) {}
  };
  const stopAllMedia = () => {
    document.querySelectorAll('audio, video').forEach(stopMedia);
  };
  const stopHeartbeat = () => {
    if (typeof runtime.stopHeartbeat === 'function') runtime.stopHeartbeat();
  };
  const quarantineCompletedGeneration = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !state.endedPosted ||
        !isMedia(media)) {
      return false;
    }
    stopHeartbeat();
    stopMedia(media);
    return true;
  };
  const finishTarget = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !isMedia(media) ||
        !state.started || state.endedPosted || state.targetMedia !== media) {
      return false;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    // Mark completion before pausing so the resulting pause event cannot arm
    // recovery for the old generation.
    state.endedPosted = true;
    stopHeartbeat();
    stopAllMedia();
    post('spotify:timed-ended');
    return true;
  };

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.heartbeatTime = Number(event.target.currentTime) || 0;
    state.heartbeatMisses = 0;
    state.lastIdentityCheckTime = -1;
    scheduleTargetChecks(event.target);
  }, true);

  document.addEventListener('playing', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
    enforceTarget(event.target);
  }, true);

  // Spotify can reuse one media element while changing its internal queue. A
  // recommended/autoplay track therefore does not always emit a fresh play or
  // playing event. durationchange gives us an early transition signal. The
  // browser's timeupdate event remains a fallback, but DOM identity checks are
  // limited to roughly once per playback second per slot.
  for (const eventName of ['loadedmetadata', 'durationchange']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target) || event.target.ended) return;
      if (quarantineCompletedGeneration(event.target)) return;
      state.lastIdentityCheckTime = -1;
      scheduleTargetChecks(event.target);
    }, true);
  }

  document.addEventListener('timeupdate', event => {
    const media = event.target;
    if (!isMedia(media) || media.ended || media.paused) return;
    if (quarantineCompletedGeneration(media)) return;
    const currentTime = Number(media.currentTime) || 0;
    if (state.lastIdentityCheckTime >= 0 &&
        currentTime >= state.lastIdentityCheckTime &&
        currentTime - state.lastIdentityCheckTime < 1) {
      return;
    }
    state.lastIdentityCheckTime = currentTime;
    enforceTarget(media);
  }, true);

  document.addEventListener('pause', event => {
    if (!isMedia(event.target)) return;
    stopHeartbeat();
    scheduleRecovery(event.target, 600, true);
  }, true);

  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      scheduleRecovery(event.target, 2500, false);
    }, true);
  }

  // A music target advances only after the browser reports its natural end.
  document.addEventListener('ended', event => {
    finishTarget(event.target);
  }, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
