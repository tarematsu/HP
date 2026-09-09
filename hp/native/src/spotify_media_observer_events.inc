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
  const kPreemptiveEndSeconds = 0.8;

  const completeTargetPlayback = media => {
    syncTarget();
    if (!isMedia(media) || !state.started || state.endedPosted ||
        state.targetMedia !== media) {
      return false;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.endedPosted = true;
    document.querySelectorAll('audio, video').forEach(candidate => {
      try { candidate.pause(); } catch (_) {}
    });
    post('spotify:timed-ended');
    return true;
  };

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    const target = syncTarget();
    if (target && target.kind === 'music' && state.endedPosted) {
      try { event.target.pause(); } catch (_) {}
      return;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.heartbeatTime = Number(event.target.currentTime) || 0;
    state.heartbeatMisses = 0;
    scheduleTargetChecks(event.target);
  }, true);

  document.addEventListener('playing', event => {
    if (!isMedia(event.target)) return;
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
      scheduleTargetChecks(event.target);
    }, true);
  }

  document.addEventListener('timeupdate', event => {
    const media = event.target;
    if (!isMedia(media) || media.ended || media.paused) return;
    if (enforceTarget(media) !== 'playing') return;
    if (state.endedPosted || !state.started || state.targetMedia !== media) return;

    const duration = Number(media.duration);
    const currentTime = Number(media.currentTime);
    if (!Number.isFinite(duration) || !Number.isFinite(currentTime) ||
        duration <= 1 || currentTime <= 0) {
      return;
    }
    const remaining = duration - currentTime;
    if (remaining >= 0 && remaining <= kPreemptiveEndSeconds) {
      completeTargetPlayback(media);
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
    completeTargetPlayback(event.target);
  }, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
