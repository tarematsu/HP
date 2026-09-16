namespace hp {
namespace {

// Minimal delegated events: validate active playback and optionally shorten the
// native deadline when the owned media element reports ended.
constexpr wchar_t kSpotifyMediaObserverEventsScript[] = LR"JS(
(() => {
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  if (!runtime) return false;
  if (runtime.eventsInstalled) return true;
  runtime.eventsInstalled = true;

  const { isMedia, scheduleTargetChecks, syncTarget, state, post,
          armTrustedStart } = runtime;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const observe = event => {
    if (!isMedia(event.target) || event.target.ended) return;
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
  document.addEventListener('ended', observeEnded, true);

  document.querySelectorAll('audio, video').forEach(media => {
    if (!media.paused && !media.ended) scheduleTargetChecks(media);
  });
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
