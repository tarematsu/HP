namespace hp {
namespace {

// Bind the minimal events needed to validate playback start and, when Spotify
// exposes a trustworthy ended event for the requested media element, shorten the
// native one-shot deadline. The ended event never advances rotation directly.
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
    if (!isMedia(media) || !media.ended) return;
    const target = syncTarget();
    if (!target || target.kind !== 'music' ||
        !state.started || !state.startPosted ||
        state.targetMedia !== media || state.interruptionStartedAt) {
      return;
    }
    post('spotify:timed-ended');
  };

  document.addEventListener('play', observe, true);
  document.addEventListener('playing', observe, true);
  document.addEventListener('loadedmetadata', observe, true);
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
