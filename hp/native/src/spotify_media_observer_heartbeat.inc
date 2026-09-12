namespace hp {
namespace {

// Detects silent stalls only while a confirmed music target is actively playing.
// Idle, completed, paused, podcast, and recovery states own no interval timer.
constexpr wchar_t kSpotifyMediaObserverHeartbeatScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (typeof runtime.startHeartbeat === 'function' &&
      typeof runtime.stopHeartbeat === 'function') {
    return true;
  }

  const stopHeartbeat = () => {
    if (!runtime.heartbeatTimer) return;
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = 0;
  };

  const heartbeat = () => {
    const { state, syncTarget, isMedia, enforceTarget, requestRecovery } = runtime;
    const target = syncTarget();
    if (!target || target.kind !== 'music' || state.endedPosted ||
        state.recoveryPosted || !state.started) {
      stopHeartbeat();
      return;
    }

    const media = isMedia(state.targetMedia) ? state.targetMedia : null;
    if (!isMedia(media) || media.ended) {
      stopHeartbeat();
      return;
    }
    if (media.paused) {
      requestRecovery(media);
      stopHeartbeat();
      return;
    }
    if (enforceTarget(media) === 'wrong') {
      stopHeartbeat();
      return;
    }
    if (state.recoveryPosted || !state.started || state.targetMedia !== media) {
      stopHeartbeat();
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
  };

  const startHeartbeat = () => {
    if (runtime.heartbeatTimer) return true;
    const { state, syncTarget, isMedia } = runtime;
    const target = syncTarget();
    const media = isMedia(state.targetMedia) ? state.targetMedia : null;
    if (!target || target.kind !== 'music' || !state.started ||
        state.endedPosted || state.recoveryPosted || !isMedia(media) ||
        media.paused || media.ended) {
      return false;
    }
    // Media lifecycle events and the native completion deadline own normal
    // playback. This low-frequency heartbeat is only a silent-stall fallback.
    runtime.heartbeatTimer = setInterval(heartbeat, 30000);
    return true;
  };

  runtime.startHeartbeat = startHeartbeat;
  runtime.stopHeartbeat = stopHeartbeat;
  startHeartbeat();
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
