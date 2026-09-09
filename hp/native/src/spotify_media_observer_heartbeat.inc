namespace hp {
namespace {

// Detects silent stalls and provides a low-frequency fallback for target
// identity enforcement when Spotify changes source without a useful media event.
constexpr wchar_t kSpotifyMediaObserverHeartbeatScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.heartbeatTimer) return true;

  runtime.heartbeatTimer = setInterval(() => {
    const { state, syncTarget, isMedia, rejectWrongTrack, requestRecovery } = runtime;
    const target = syncTarget();
    if (!target || target.kind !== 'music' || state.endedPosted ||
        state.recoveryPosted) {
      return;
    }

    const media = isMedia(state.targetMedia)
        ? state.targetMedia
        : Array.from(document.querySelectorAll('audio, video'))
            .find(candidate => isMedia(candidate) &&
                !candidate.paused && !candidate.ended) || null;
    if (!isMedia(media) || media.ended) return;
    if (rejectWrongTrack(media)) return;
    if (!state.started || state.targetMedia !== media) return;

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
