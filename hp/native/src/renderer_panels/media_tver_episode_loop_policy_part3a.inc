LR"JS(

  const playbackDefaults = () => ({
    progressSampleAt: 0,
    progressTimer: 0,
    programProgressOrigin: Number.NaN,
    programPlaybackConfirmed: false,
    lowQualitySet: false,
    lowClickPending: false,
    qualityActionCount: 0,
    qualityAttemptExhausted: false,
    playbackSettingsApplied: false,
    fullscreenDirty: true,
    fullscreenKeyRequestedAt: 0,
    recoveryPending: false,
    recoverySince: 0,
    recoveryWakeTimer: 0,
  });
  const clearRuntimeTimers = state => {
    try { state.clearRecoveryWake?.(); } catch (_) {}
    try { state.clearProgressSampler?.(); } catch (_) {}
  };
  const clearEpisodeLimitTimer = state => {
    if (!state?.episodeLimitTimer) return;
    try { clearTimeout(state.episodeLimitTimer); } catch (_) {}
    state.episodeLimitTimer = 0;
  };
  const resetPlaybackSetup = (state, video = state.video) => {
    clearRuntimeTimers(state);
    Object.assign(state, playbackDefaults(), { video });
  };
  const resetMediaState = (state, video = state.video) => {
    resetPlaybackSetup(state, video);
    state.maxDuration = 0;
    state.maxTime = 0;
    state.endCandidateAt = 0;
  };
  const createEpisodeState = path => ({
    path,
    video: null,
    nativeWakeVideo: null,
    nativeWakeSource: '',
    maxDuration: 0,
    maxTime: 0,
    endCandidateAt: 0,
    endReported: false,
    episodeStartedAt: 0,
    episodeLimitTimer: 0,
    adActive: false,
    adVideo: null,
    adIdentity: '',
    adEndedAt: 0,
    postrollAfterProgram: false,
    ...playbackDefaults(),
  });

  const ensure = () => {
    try {
      if (!location.pathname.startsWith('/episodes/')) return;
      let state = window.__homePanelSakuraMeetsState;
      if (!state || state.path !== location.pathname) {
        clearRuntimeTimers(state || {});
        clearEpisodeLimitTimer(state || {});
        state = createEpisodeState(location.pathname);
        window.__homePanelSakuraMeetsState = state;
      }

      const video = currentVideo();
      requestNativeMediaInit(video, state);
      const currentTime = Number(video?.currentTime);
      const playbackRolledBack = state.video === video && state.maxTime >= 10 &&
          Number.isFinite(currentTime) && currentTime + 5 < state.maxTime;
      const healthyProgram = state.video === video && !!video && !state.adActive &&
          !state.recoveryPending && state.playbackSettingsApplied &&
          (state.lowQualitySet || state.qualityAttemptExhausted) &&
          !state.fullscreenDirty && !video.paused && !video.ended;
      const advertisementActive = healthyProgram && !playbackRolledBack
          ? false : detectAd(video, state);
      if (advertisementActive) {
        const identity = mediaIdentity(video);
        const adMediaChanged = state.adVideo !== video || state.adIdentity !== identity;
        if (!state.adActive || adMediaChanged) {
          const completedProgram = state.programPlaybackConfirmed &&
              state.endCandidateAt > 0 &&
              state.maxDuration >= 5 &&
              state.maxTime >= Math.max(3, state.maxDuration - 10);
          if (!state.adActive) state.postrollAfterProgram = completedProgram;
          resetMediaState(state);
          Object.assign(state, {
            adActive: true,
            adVideo: video || null,
            adIdentity: identity,
            adEndedAt: 0,
          });
        }
        window.__homePanelTverAdActive = true;
        if (video) bindPlayerObserver(video);
        const adFullscreen = !!(document.fullscreenElement ||
            document.webkitFullscreenElement || document.msFullscreenElement);
        wakeNative('ad:' + identity + ':' + (adFullscreen ? 'fs' : 'window'));
        return;
      }

      if (state.adActive) {
        const completedPostroll = state.postrollAfterProgram;
        resetMediaState(state, null);
        Object.assign(state, {
          adActive: false,
          adVideo: null,
          adIdentity: '',
          adEndedAt: 0,
          postrollAfterProgram: false,
        });
        window.__homePanelTverAdActive = false;
        if (completedPostroll) {
          if (postEpisodeEnded(state)) return;
          wakeNative('ended-post-failed:' + location.pathname, true);
          return;
        }
      } else {
        window.__homePanelTverAdActive = false;
      }

      if (state.video !== video) resetMediaState(state, video);
      if (!video) return;
      bindVideoEvents(video, state);
      const observerNeeded = state.adActive || state.recoveryPending ||
          !state.playbackSettingsApplied ||
          (!state.lowQualitySet && !state.qualityAttemptExhausted) ||
          state.fullscreenDirty || video.paused || video.ended;
      if (observerNeeded) bindPlayerObserver(video);
      if (video.paused && !video.ended && !state.adActive) {
        try { state.requestRecoveryWake?.('initial-pause'); } catch (_) {}
      }

      if (!state.playbackSettingsApplied) {
        try {
          video.defaultPlaybackRate = playbackRate;
          if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
        } catch (_) {}
        enforceVolume(video);
        state.playbackSettingsApplied = true;
      }
      sampleProgress(video, state, true);
      try { state.armProgressSampler?.(); } catch (_) {}

      if (state.programPlaybackConfirmed && video.ended && !state.endCandidateAt) {
        state.endCandidateAt = Date.now();
        window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
      }
      const completedItem = state.programPlaybackConfirmed &&
          state.maxDuration >= 5 &&
          state.maxTime >= Math.max(3, state.maxDuration - 10);
      const stableEnd = state.endCandidateAt > 0 &&
          Date.now() - state.endCandidateAt >= postrollGraceMs;
      if (stableEnd && completedItem) {
        if (postEpisodeEnded(state)) return;
        wakeNative('ended-post-failed:' + location.pathname, true);
        return;
      }
)JS"
