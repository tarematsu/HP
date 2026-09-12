namespace hp {
namespace {

// Keeps completion-deadline planning separate from target identity/recovery so
// each embedded JavaScript literal stays comfortably below MSVC's size limit.
constexpr wchar_t kSpotifyMediaObserverCompletionScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.completionInstalled) return true;
  runtime.completionInstalled = true;

  const { state, syncTarget, isMedia, post } = runtime;
  const generation = () => String(window.__homePanelSpotifyGeneration || '0');
  const resetPlanState = () => {
    state.lastCompletionPlanTime = -1;
    state.lastCompletionPlanDuration = -1;
    state.lastCompletionPlanRate = -1;
    state.lastCompletionPlanDeadlineAt = -1;
  };
  const postFields = (message, ...fields) => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(
            [message, generation(), ...fields].join('\u001f'));
      }
    } catch (_) {}
  };
  const clearCompletionPlan = () => {
    if (state.lastCompletionPlanTime < 0 &&
        state.lastCompletionPlanDuration < 0) {
      return false;
    }
    resetPlanState();
    post('spotify:timed-plan-clear');
    return true;
  };
  const postCompletionPlan = (media, force = false) => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || state.endedPosted ||
        !state.started || state.targetMedia !== media || !isMedia(media) ||
        media.paused || media.ended) {
      return false;
    }

    const currentTime = Number(media.currentTime);
    const duration = Number(media.duration);
    const rawRate = Number(media.playbackRate);
    const playbackRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) ||
        duration < 10 || currentTime < 0 || currentTime > duration + 1) {
      return false;
    }
    const unchanged =
        Math.abs(state.lastCompletionPlanTime - currentTime) < 0.05 &&
        Math.abs(state.lastCompletionPlanDuration - duration) < 0.05 &&
        Math.abs(state.lastCompletionPlanRate - playbackRate) < 0.001;
    if (unchanged && !force) return true;

    state.lastCompletionPlanTime = currentTime;
    state.lastCompletionPlanDuration = duration;
    state.lastCompletionPlanRate = playbackRate;
    const remainingMs = Math.max(
        0, Math.round(((duration - currentTime) / playbackRate) * 1000));
    state.lastCompletionPlanDeadlineAt = Date.now() + remainingMs;
    postFields('spotify:timed-plan', String(remainingMs));
    return true;
  };
  const completionPlanDue = (leadMs = 0) => {
    const deadlineAt = Number(state.lastCompletionPlanDeadlineAt);
    const lead = Number(leadMs);
    return Number.isFinite(deadlineAt) && deadlineAt >= 0 &&
        Date.now() + (Number.isFinite(lead) && lead > 0 ? lead : 0) >= deadlineAt;
  };
  const completionPlanExpired = () => completionPlanDue();

  resetPlanState();
  runtime.postCompletionPlan = postCompletionPlan;
  runtime.clearCompletionPlan = clearCompletionPlan;
  runtime.completionPlanDue = completionPlanDue;
  runtime.completionPlanExpired = completionPlanExpired;
  runtime.probeCompletion = null;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:generation' || fields[0] === 'spotify:target') {
        resetPlanState();
        return;
      }
      if (fields[0] === 'spotify:completion-probe' &&
          (fields[1] || '0') === generation() &&
          typeof runtime.probeCompletion === 'function') {
        runtime.probeCompletion();
      }
    });
  }
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
