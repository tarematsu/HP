namespace hp {
namespace {

// Bind only the events needed to discover a valid playback start. Completion is
// owned entirely by the native one-shot deadline armed from that start event.
constexpr wchar_t kSpotifyMediaObserverEventsScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.eventsInstalled) return true;
  runtime.eventsInstalled = true;

  const { isMedia, scheduleTargetChecks } = runtime;
  const observe = event => {
    if (!isMedia(event.target) || event.target.ended) return;
    scheduleTargetChecks(event.target);
  };

  document.addEventListener('play', observe, true);
  document.addEventListener('playing', observe, true);
  document.addEventListener('loadedmetadata', observe, true);
  document.addEventListener('durationchange', observe, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
