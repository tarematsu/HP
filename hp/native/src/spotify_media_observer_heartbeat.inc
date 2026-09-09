namespace hp {
namespace {

// Detects silent stalls where Spotify still presents a playing UI but the media
// clock no longer advances. Event handling remains independent of this watchdog.
constexpr wchar_t kSpotifyMediaObserverHeartbeatScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.heartbeatTimer) return true;

  runtime.heartbeatTimer = setInterval(() => {
    const { state, syncTarget, isMedia, requestRecovery } = runtime;
    const target = syncTarget();
    const media = state.targetMedia;
    if (!target || target.kind !== 'music' || !state.started ||
        state.endedPosted || state.recoveryPosted || !isMedia(media) ||
        media.ended) {
      return;
    }
    if (media.paused) {
      requestRecovery(media);
      return;
    }

    const currentTime = Number(media.currentTime) || 0;
    if (state.heartbeatTime < 0 ||
        currentTime > state.heartbeatTime + 0.05) {
      state.heartbeatTime = currentTime;
      state.heartbeatMisses = 0;
      return;
    }
    ++state.heartbeatMisses;
    if (state.heartbeatMisses >= 2) requestRecovery(media);
  }, 10000);
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
