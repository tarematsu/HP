namespace hp {
namespace {

// Minimal delegated events: validate active playback and optionally shorten the
// native deadline when the owned media element reports ended.
constexpr wchar_t kSpotifyMediaObserverEventsScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.eventsInstalled) return true;
  runtime.eventsInstalled = true;

  const { isMedia, scheduleTargetChecks, syncTarget, state, post } = runtime;
  const observe = event => {
    if (!isMedia(event.target) || event.target.ended) return;
    scheduleTargetChecks(event.target);
  };
  const observeEnded = event => {
    const media = event.target;
    if (!isMedia(media) || !media.ended || !syncTarget() ||
        !state.startPosted || state.targetMedia !== media || state.interrupted) {
      return;
    }
    // Once the owned target really ended, later ad playback belongs after the
    // completion event and must not suspend the already-due native deadline.
    state.startPosted = false;
    state.targetMedia = null;
    post('spotify:timed-ended');
  };

  document.addEventListener('playing', observe, true);
  document.addEventListener('durationchange', observe, true);
  document.addEventListener('ended', observeEnded, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
