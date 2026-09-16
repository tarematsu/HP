namespace hp {
namespace {

// Minimal delegated events: validate active playback and optionally shorten the
// native deadline when the owned media element reports ended. A sustained
// pause/stall after confirmed playback is promoted to the existing native
// interruption/recovery path instead of leaving the slot Healthy until its
// completion deadline.
constexpr wchar_t kSpotifyMediaObserverEventsScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.eventsInstalled) return true;
  runtime.eventsInstalled = true;

  const { isMedia, scheduleTargetChecks, syncTarget, state, post,
          armTrustedStart } = runtime;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const recoveryGraceMs = 6000;
  let recoveryTimer = 0;
  let recoveryMedia = null;
  let recoveryTime = 0;

  const clearRecoveryProbe = () => {
    if (recoveryTimer) nativeClearTimeout(recoveryTimer);
    recoveryTimer = 0;
    recoveryMedia = null;
    recoveryTime = 0;
  };
  const armRecoveryProbe = media => {
    if (!isMedia(media) || media.ended || !state.startPosted ||
        state.targetMedia !== media || state.interrupted) {
      return;
    }
    const current = Number(media.currentTime);
    if (!Number.isFinite(current) || current < 0) return;
    if (recoveryTimer && recoveryMedia === media) return;
    clearRecoveryProbe();
    recoveryMedia = media;
    recoveryTime = current;
    recoveryTimer = nativeSetTimeout(() => {
      recoveryTimer = 0;
      if (state.targetMedia !== media || !state.startPosted ||
          state.interrupted || media.ended) {
        clearRecoveryProbe();
        return;
      }
      const next = Number(media.currentTime);
      const progressed = Number.isFinite(next) && next > recoveryTime + 0.10;
      if (!media.paused && progressed) {
        clearRecoveryProbe();
        return;
      }
      state.interrupted = true;
      post('spotify:timed-interrupted');
      clearRecoveryProbe();
    }, recoveryGraceMs);
  };
  const observe = event => {
    if (!isMedia(event.target) || event.target.ended) return;
    if ((event.type === 'playing' || event.type === 'timeupdate') &&
        state.targetMedia === event.target && !event.target.paused) {
      const current = Number(event.target.currentTime);
      if (!recoveryTimer || recoveryMedia !== event.target ||
          (Number.isFinite(current) && current > recoveryTime + 0.10)) {
        clearRecoveryProbe();
      }
    }
    // timeupdate normally stops probing once playback is confirmed. Keep it
    // active only until the actual Now Playing title has also been captured;
    // this avoids a renderer-layout race immediately after trusted Play.
    if (event.type === 'timeupdate' && state.startPosted &&
        state.targetMedia === event.target && !state.interrupted &&
        state.actualTrackTitle) {
      return;
    }
    scheduleTargetChecks(event.target);
  };
  const observePlaybackProblem = event => {
    const media = event.target;
    if (!isMedia(media) || media.ended || !syncTarget() ||
        !state.startPosted || state.targetMedia !== media || state.interrupted) {
      return;
    }
    armRecoveryProbe(media);
  };
  const armManualPlay = event => {
    const raw = event && event.target;
    const button = raw && raw.closest
      ? raw.closest('button,[role="button"]')
      : null;
    if (!button || typeof armTrustedStart !== 'function') return;
    const label = normalize(
        button.getAttribute?.('aria-label') || button.getAttribute?.('title'));
    const testId = normalize(button.getAttribute?.('data-testid'));
    if (label.includes('pause') || label.includes('一時停止')) return;
    const isPlay = testId === 'play-button' ||
        testId === 'control-button-playpause' ||
        label === 'play' || label === '再生' ||
        label.startsWith('play ') || label.endsWith('を再生');
    if (!isPlay) return;
    // Native Play clicks pre-arm this token in their CDP preflight. A real user
    // click bypasses that path, so arm the same generation-fenced token here
    // before Spotify handles the click and emits the media `playing` event.
    armTrustedStart(String(window.__homePanelSpotifyGeneration || '0'));
  };
  const observeEnded = event => {
    const media = event.target;
    if (!isMedia(media) || !media.ended || !syncTarget() ||
        !state.startPosted || state.targetMedia !== media || state.interrupted) {
      return;
    }
    clearRecoveryProbe();
    // Once the owned target really ended, later ad playback belongs after the
    // completion event and must not suspend the already-due native deadline.
    state.startPosted = false;
    state.targetMedia = null;
    state.actualTrackTitle = '';
    state.actualTrackPath = '';
    post('spotify:timed-ended');
  };

  document.addEventListener('click', armManualPlay, true);
  document.addEventListener('playing', observe, true);
  document.addEventListener('durationchange', observe, true);
  document.addEventListener('loadedmetadata', observe, true);
  document.addEventListener('canplay', observe, true);
  document.addEventListener('timeupdate', observe, true);
  for (const eventName of ['pause', 'stalled', 'waiting', 'error']) {
    document.addEventListener(eventName, observePlaybackProblem, true);
  }
  document.addEventListener('ended', observeEnded, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
