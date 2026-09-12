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
          scheduleTargetChecks, scheduleRecovery, postCompletionPlan,
          clearCompletionPlan, terminalWrapObserved,
          completionPlanDue, completionPlanExpired } = runtime;
  const completionGraceMs = 5000;

  const quarantineMedia = media => {
    try { if (isMedia(media) && !media.paused) media.pause(); } catch (_) {}
  };
  const stopHeartbeat = () => {
    if (typeof runtime.stopHeartbeat === 'function') runtime.stopHeartbeat();
  };
  const quarantineCompletedGeneration = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !state.endedPosted ||
        !isMedia(media)) {
      return false;
    }
    stopHeartbeat();
    quarantineMedia(media);
    return true;
  };
  const finishTarget = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !isMedia(media) ||
        !state.started || state.endedPosted || state.targetMedia !== media) {
      return false;
    }
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.endedPosted = true;
    clearCompletionPlan();
    stopHeartbeat();
    post('spotify:timed-ended');
    return true;
  };
  // A completion deadline is only a wake-up hint. It must never end a track
  // before Spotify/HTMLMediaElement has naturally reached its terminal state.
  // If an ended event is lost, a paused media clock pinned at the real duration
  // is an acceptable post-end fallback because no playback is interrupted.
  const finishPausedAtEnd = media => {
    if (!isMedia(media) || !media.paused || media.ended ||
        typeof completionPlanExpired !== 'function' ||
        !completionPlanExpired()) {
      return false;
    }
    const currentTime = Number(media.currentTime);
    const duration = Number(media.duration);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) ||
        duration < 10 || currentTime < Math.max(0, duration - 0.05)) {
      return false;
    }
    return finishTarget(media);
  };
  // Spotify may recycle the same media element and move its clock from the end
  // back to 0 before the projected wall-clock deadline. A generation-scoped
  // high-water witness proves that the same target was already in its terminal
  // window, so this rewind is completion even when `ended` is missing or early.
  // Deadline expiry remains a fallback for cases where the terminal witness was
  // not observed (for example, a delayed background callback).
  const finishProjectedWrap = media => {
    const currentTime = Number(media && media.currentTime);
    if (!Number.isFinite(currentTime)) return false;
    const witnessedWrap = typeof terminalWrapObserved === 'function' &&
        terminalWrapObserved(media);
    const deadlineWrap = currentTime <= 1.5 &&
        typeof completionPlanExpired === 'function' &&
        completionPlanExpired();
    if (!witnessedWrap && !deadlineWrap) return false;
    if (!finishTarget(media)) return false;
    quarantineMedia(media);
    return true;
  };
  const deferNearEndRecovery = (media, delay, requirePaused) => {
    if (typeof completionPlanDue !== 'function' ||
        !completionPlanDue(completionGraceMs)) {
      return false;
    }
    stopHeartbeat();
    scheduleRecovery(
        media, Math.max(delay, completionGraceMs + 1000), requirePaused);
    return true;
  };

  runtime.probeCompletion = () => {
    const media = state.targetMedia;
    if (!isMedia(media) || state.endedPosted) return false;
    if (media.ended) return finishTarget(media);
    if (finishPausedAtEnd(media)) return true;
    if (finishProjectedWrap(media)) return true;
    if (media.paused) {
      clearCompletionPlan();
      return false;
    }
    // Expiry alone is never completion. Re-project from the live media clock and
    // keep waiting for ended, an observed terminal rewind, or a paused-at-duration
    // terminal state.
    return postCompletionPlan(media, true);
  };

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    clearTimeout(state.stallTimer);
    state.stallTimer = 0;
    state.heartbeatTime = Number(event.target.currentTime) || 0;
    state.heartbeatMisses = 0;
    state.lastIdentityCheckTime = -1;
    scheduleTargetChecks(event.target);
  }, true);

  document.addEventListener('playing', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    if (enforceTarget(event.target) === 'playing') {
      postCompletionPlan(event.target);
    }
  }, true);

  for (const eventName of ['loadedmetadata', 'durationchange']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target) || event.target.ended) return;
      if (quarantineCompletedGeneration(event.target)) return;
      if (finishProjectedWrap(event.target)) return;
      state.lastIdentityCheckTime = -1;
      scheduleTargetChecks(event.target);
      if (!event.target.paused && state.started &&
          state.targetMedia === event.target && !state.endedPosted) {
        postCompletionPlan(event.target);
      }
    }, true);
  }

  document.addEventListener('seeking', event => {
    if (!isMedia(event.target) || event.target.ended) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    if (deferNearEndRecovery(event.target, 2500, false)) return;
    clearCompletionPlan();
  }, true);

  document.addEventListener('seeked', event => {
    if (!isMedia(event.target) || event.target.ended || event.target.paused) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    if (enforceTarget(event.target) === 'playing') {
      postCompletionPlan(event.target);
    }
  }, true);

  document.addEventListener('ratechange', event => {
    if (!isMedia(event.target) || event.target.ended || event.target.paused) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    if (enforceTarget(event.target) === 'playing') {
      postCompletionPlan(event.target);
    }
  }, true);

  document.addEventListener('timeupdate', event => {
    const media = event.target;
    if (!isMedia(media) || media.ended || media.paused) return;
    if (quarantineCompletedGeneration(media)) return;
    if (finishProjectedWrap(media)) return;
    // The completion module records only an in-process high-water mark here.
    // It does not post cross-process messages or add polling, so normal
    // timeupdate traffic stays cheap while preserving terminal evidence.
  }, true);

  document.addEventListener('pause', event => {
    if (!isMedia(event.target)) return;
    if (finishPausedAtEnd(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    if (deferNearEndRecovery(event.target, 600, true)) return;
    clearCompletionPlan();
    stopHeartbeat();
    scheduleRecovery(event.target, 600, true);
  }, true);

  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      if (finishPausedAtEnd(event.target)) return;
      if (finishProjectedWrap(event.target)) return;
      if (deferNearEndRecovery(event.target, 2500, false)) return;
      clearCompletionPlan();
      scheduleRecovery(event.target, 2500, false);
    }, true);
  }

  document.addEventListener('ended', event => {
    finishTarget(event.target);
  }, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
