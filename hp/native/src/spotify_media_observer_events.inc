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
  const finishLeadSeconds = 2.0;

  const stopMedia = media => {
    try { if (isMedia(media) && !media.paused) media.pause(); } catch (_) {}
  };
  const stopAllMedia = () => {
    document.querySelectorAll('audio, video').forEach(stopMedia);
  };
  const quarantineCompletedGeneration = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !state.endedPosted ||
        !isMedia(media)) {
      return false;
    }
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
    scheduleTargetChecks(event.target);
  }, true);

  document.addEventListener('playing', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
    enforceTarget(event.target);
  }, true);

  // Spotify can reuse one media element while changing its internal queue. A
  // recommended/autoplay track therefore does not always emit a fresh play or
  // playing event. durationchange gives us an early transition signal, while
  // timeupdate keeps identity enforcement tied to the browser's own playback
  // cadence instead of adding another high-frequency polling timer.
  for (const eventName of ['loadedmetadata', 'durationchange']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target) || event.target.ended) return;
      if (quarantineCompletedGeneration(event.target)) return;
      scheduleTargetChecks(event.target);
    }, true);
  }

  document.addEventListener('timeupdate', event => {
    const media = event.target;
    if (!isMedia(media) || media.ended || media.paused) return;
    if (quarantineCompletedGeneration(media)) return;
    if (enforceTarget(media) !== 'playing') return;

    // Do not let Spotify reach the natural end of a direct-track page. Cutting
    // the final two seconds prevents its autoplay queue from getting a chance
    // to start a recommendation before native navigation reaches the next
    // requested A-F target.
    const duration = Number(media.duration);
    const currentTime = Number(media.currentTime);
    if (Number.isFinite(duration) && duration > 0 &&
        Number.isFinite(currentTime) && currentTime >= 0 &&
        currentTime >= duration - finishLeadSeconds) {
      finishTarget(media);
    }
  }, true);

  document.addEventListener('pause', event => {
    if (!isMedia(event.target)) return;
    scheduleRecovery(event.target, 600, true);
  }, true);

  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      scheduleRecovery(event.target, 2500, false);
    }, true);
  }

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
