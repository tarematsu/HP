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
          clearCompletionPlan, completionPlanExpired } = runtime;
  const finishLeadSeconds = 1.5;

  // The only direct pause retained in music playback is a narrow quarantine for
  // a completed generation while native installs the next target. Start/recovery
  // logic never pauses active playback.
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
  const finishNearEnd = media => {
    const currentTime = Number(media.currentTime);
    const duration = Number(media.duration);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) ||
        duration < 10 || currentTime < Math.max(0, duration - finishLeadSeconds)) {
      return false;
    }
    if (!finishTarget(media)) return false;
    quarantineMedia(media);
    return true;
  };
  const detectRepeatWrap = media => {
    const target = syncTarget();
    if (!target || target.kind !== 'music' || !isMedia(media) ||
        !state.started || state.endedPosted || state.targetMedia !== media) {
      return false;
    }

    const currentTime = Number(media.currentTime) || 0;
    const duration = Number(media.duration);
    const marker = media.__homePanelSpotifyPlaybackMark ||
        (media.__homePanelSpotifyPlaybackMark = { key: '', time: -1 });
    if (marker.key !== state.key) {
      marker.key = state.key;
      marker.time = currentTime;
      return false;
    }

    const previousTime = Number(marker.time);
    marker.time = currentTime;
    if (!Number.isFinite(previousTime) || !Number.isFinite(duration) ||
        duration < 10) {
      return false;
    }

    // Fallback for a heavily throttled WebView that skips the native deadline
    // probe and rewinds the same media element to zero.
    const wrapped = previousTime >= Math.max(0, duration - 3) &&
        currentTime <= 1.5 && previousTime - currentTime >= 2;
    if (!wrapped || !finishTarget(media)) return false;

    quarantineMedia(media);
    return true;
  };

  runtime.probeCompletion = () => {
    const media = state.targetMedia;
    if (!isMedia(media) || state.endedPosted) return false;
    if (media.ended) return finishTarget(media);
    if (finishNearEnd(media)) return true;
    if (media.paused) {
      clearCompletionPlan();
      return false;
    }
    // A native probe is scheduled 1.5 seconds before the projected physical end.
    // If WebView execution is throttled until after that projected end, Spotify
    // may already have rewound the same element to zero. The old implementation
    // mistook that replay for an early probe and armed another whole-track plan.
    // The generation-fenced wall deadline proves this playthrough is complete.
    if (typeof completionPlanExpired === 'function' && completionPlanExpired()) {
      if (!finishTarget(media)) return false;
      quarantineMedia(media);
      return true;
    }
    // Playback may have stalled or the native timer may have fired slightly
    // before the media clock. Always publish one fresh plan for this probe; the
    // normal dedupe path must not swallow the only native re-arm message.
    return postCompletionPlan(media, true);
  };

  document.addEventListener('play', event => {
    if (!isMedia(event.target)) return;
    if (quarantineCompletedGeneration(event.target)) return;
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
    if (enforceTarget(event.target) === 'playing') {
      postCompletionPlan(event.target);
    }
  }, true);

  // Spotify can reuse one media element while changing its internal queue. A
  // recommended/autoplay track therefore does not always emit a fresh play or
  // playing event. durationchange gives us an early transition signal. The
  // browser's timeupdate event remains an identity and opportunistic completion
  // fallback; native owns the reliable deadline path.
  for (const eventName of ['loadedmetadata', 'durationchange']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target) || event.target.ended) return;
      if (quarantineCompletedGeneration(event.target)) return;
      state.lastIdentityCheckTime = -1;
      scheduleTargetChecks(event.target);
      // Metadata can arrive while Spotify's now-playing DOM still shows the
      // previous item. Reuse the already-confirmed media for deadline planning;
      // delayed target checks own identity rejection once the UI settles.
      if (!event.target.paused && state.started &&
          state.targetMedia === event.target && !state.endedPosted) {
        postCompletionPlan(event.target);
      }
    }, true);
  }

  document.addEventListener('seeking', event => {
    if (!isMedia(event.target) || event.target.ended) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (detectRepeatWrap(event.target)) return;
    clearCompletionPlan();
  }, true);

  document.addEventListener('seeked', event => {
    if (!isMedia(event.target) || event.target.ended || event.target.paused) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (enforceTarget(event.target) === 'playing') {
      postCompletionPlan(event.target);
    }
  }, true);

  document.addEventListener('ratechange', event => {
    if (!isMedia(event.target) || event.target.ended || event.target.paused) return;
    if (quarantineCompletedGeneration(event.target)) return;
    if (enforceTarget(event.target) === 'playing') {
      postCompletionPlan(event.target);
    }
  }, true);

  document.addEventListener('timeupdate', event => {
    const media = event.target;
    if (!isMedia(media) || media.ended || media.paused) return;
    if (quarantineCompletedGeneration(media)) return;
    if (finishNearEnd(media)) return;
    if (detectRepeatWrap(media)) return;
    const currentTime = Number(media.currentTime) || 0;
    if (state.lastIdentityCheckTime >= 0 &&
        currentTime >= state.lastIdentityCheckTime &&
        currentTime - state.lastIdentityCheckTime < 1) {
      return;
    }
    state.lastIdentityCheckTime = currentTime;
    enforceTarget(media);
  }, true);

  document.addEventListener('pause', event => {
    if (!isMedia(event.target)) return;
    if (finishNearEnd(event.target)) return;
    clearCompletionPlan();
    stopHeartbeat();
    scheduleRecovery(event.target, 600, true);
  }, true);

  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      clearCompletionPlan();
      scheduleRecovery(event.target, 2500, false);
    }, true);
  }

  // Browser end remains a zero-cost fallback if it arrives before the native
  // completion probe, for example after a long timer delay under system load.
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
