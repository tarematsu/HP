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
  const terminalWitnessWindowSeconds = 2;
  const terminalWrapSeconds = 1.5;
  const resetDeadlineState = () => {
    state.lastCompletionPlanTime = -1;
    state.lastCompletionPlanDuration = -1;
    state.lastCompletionPlanRate = -1;
    state.lastCompletionPlanDeadlineAt = -1;
  };
  const resetCompletionWitness = () => {
    state.completionWitnessMedia = null;
    state.completionWitnessDuration = -1;
    state.completionHighWaterTime = -1;
    state.completionNearEndArmed = false;
  };
  const resetPlanState = () => {
    resetDeadlineState();
    resetCompletionWitness();
  };
  const postFields = (message, ...fields) => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(
            [message, generation(), ...fields].join('\u001f'));
      }
    } catch (_) {}
  };
  const observeCompletionProgress = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || state.endedPosted ||
        !state.started || state.targetMedia !== media || !isMedia(media)) {
      return false;
    }

    const currentTime = Number(media.currentTime);
    const duration = Number(media.duration);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) ||
        duration < 10 || currentTime < 0 || currentTime > duration + 1) {
      return false;
    }

    if (state.completionWitnessMedia !== media ||
        !Number.isFinite(state.completionWitnessDuration) ||
        Math.abs(state.completionWitnessDuration - duration) > 1) {
      resetCompletionWitness();
      state.completionWitnessMedia = media;
      state.completionWitnessDuration = duration;
    }

    state.completionWitnessDuration = duration;
    if (currentTime > state.completionHighWaterTime) {
      state.completionHighWaterTime = currentTime;
    }
    if (state.completionHighWaterTime >=
        Math.max(0, duration - terminalWitnessWindowSeconds)) {
      state.completionNearEndArmed = true;
    }
    return true;
  };
  const terminalWrapObserved = media => {
    const currentTime = Number(media && media.currentTime);
    const duration = Number(media && media.duration);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) ||
        duration < 10 || currentTime < 0 || currentTime > duration + 1) {
      return false;
    }

    const sameWitness = state.completionWitnessMedia === media &&
        Number.isFinite(state.completionWitnessDuration) &&
        Math.abs(state.completionWitnessDuration - duration) <= 1;
    const wrapped = sameWitness && state.completionNearEndArmed &&
        currentTime <= terminalWrapSeconds &&
        state.completionHighWaterTime - currentTime >= terminalWitnessWindowSeconds;
    if (!wrapped) observeCompletionProgress(media);
    return wrapped;
  };
  const clearCompletionPlan = () => {
    if (state.lastCompletionPlanTime < 0 &&
        state.lastCompletionPlanDuration < 0) {
      return false;
    }
    // Deadline invalidation must not erase terminal evidence. Spotify can rewind
    // the same media element to 0 before the projected wall-clock deadline; the
    // high-water witness survives pause/seek/stall events until generation end.
    resetDeadlineState();
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
    observeCompletionProgress(media);
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
    postFields(
        'spotify:timed-plan', String(remainingMs),
        String(state.lastCompletionPlanDeadlineAt));
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
  runtime.observeCompletionProgress = observeCompletionProgress;
  runtime.terminalWrapObserved = terminalWrapObserved;
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