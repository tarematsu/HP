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

  const { state, post, syncTarget, isMedia, confirmStarted,
          scheduleStartChecks, scheduleRecovery } = runtime;

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
    scheduleStartChecks(event.target);
  }, true);

  document.addEventListener('playing', event => {
    if (!isMedia(event.target)) return;
    confirmStarted(event.target);
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
    const media = event.target;
    syncTarget();
    if (!isMedia(media) || !state.started || state.endedPosted ||
        state.targetMedia !== media) {
      return;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.endedPosted = true;
    document.querySelectorAll('audio, video').forEach(candidate => {
      try { candidate.pause(); } catch (_) {}
    });
    post('spotify:timed-ended');
  }, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleStartChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
