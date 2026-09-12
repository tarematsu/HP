namespace hp {
namespace {

// Binds delegated media lifecycle events to the observer runtime. This script is
// idempotent, contains no periodic polling, and never performs playback recovery.
constexpr wchar_t kSpotifyMediaObserverEventsScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.eventsInstalled) return true;
  runtime.eventsInstalled = true;

  const { state, post, syncTarget, isMedia, enforceTarget,
          scheduleTargetChecks, postCompletionPlan, clearCompletionPlan,
          terminalWrapObserved, completionPlanExpired } = runtime;

  const quarantineMedia = media => {
    try { if (isMedia(media) && !media.paused) media.pause(); } catch (_) {}
  };
  const quarantineCompletedGeneration = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !state.endedPosted ||
        !isMedia(media)) {
      return false;
    }
    quarantineMedia(media);
    return true;
  };
  const finishTarget = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !isMedia(media) ||
        !state.started || state.endedPosted || state.targetMedia !== media) {
      return false;
    }
    state.endedPosted = true;
    clearCompletionPlan();
    post('spotify:timed-ended');
    return true;
  };
  // A completion deadline is only a wake-up hint. It must never end a track
  // before Spotify/HTMLMediaElement has naturally reached its terminal state.
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
    return postCompletionPlan(media, true);
  };

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
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
    finishProjectedWrap(media);
  }, true);

  document.addEventListener('pause', event => {
    if (!isMedia(event.target)) return;
    if (finishPausedAtEnd(event.target)) return;
    if (finishProjectedWrap(event.target)) return;
    clearCompletionPlan();
  }, true);

  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      if (finishPausedAtEnd(event.target)) return;
      if (finishProjectedWrap(event.target)) return;
      clearCompletionPlan();
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
