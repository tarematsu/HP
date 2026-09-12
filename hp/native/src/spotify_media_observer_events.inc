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
          scheduleTargetChecks, scheduleRecovery } = runtime;
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

    // Do not depend on Spotify emitting `ended`. Once the requested track enters
    // the final 1.5 seconds, hand ownership to native and stop the old generation
    // so autoplay/repeat cannot win the transition race.
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

    // Fallback for a heavily throttled WebView that skips the near-end
    // timeupdate entirely and rewinds the same media element to zero.
    const wrapped = previousTime >= Math.max(0, duration - 3) &&
        currentTime <= 1.5 && previousTime - currentTime >= 2;
    if (!wrapped || !finishTarget(media)) return false;

    quarantineMedia(media);
    return true;
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
    enforceTarget(event.target);
  }, true);

  // Spotify can reuse one media element while changing its internal queue. A
  // recommended/autoplay track therefore does not always emit a fresh play or
  // playing event. durationchange gives us an early transition signal. The
  // browser's timeupdate event remains a fallback, but DOM identity checks are
  // limited to roughly once per playback second per slot.
  for (const eventName of ['loadedmetadata', 'durationchange']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target) || event.target.ended) return;
      if (quarantineCompletedGeneration(event.target)) return;
      state.lastIdentityCheckTime = -1;
      scheduleTargetChecks(event.target);
    }, true);
  }

  // A repeat rewind normally emits seeking before the first replayed audio
  // frame. Detect it here for the fastest fallback handoff.
  document.addEventListener('seeking', event => {
    if (!isMedia(event.target) || event.target.ended) return;
    if (quarantineCompletedGeneration(event.target)) return;
    detectRepeatWrap(event.target);
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
    stopHeartbeat();
    scheduleRecovery(event.target, 600, true);
  }, true);

  for (const eventName of ['waiting', 'stalled']) {
    document.addEventListener(eventName, event => {
      if (!isMedia(event.target)) return;
      scheduleRecovery(event.target, 2500, false);
    }, true);
  }

  // `ended` remains a fallback when the browser reports natural completion
  // before the near-end timeupdate path gets a chance to run.
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
