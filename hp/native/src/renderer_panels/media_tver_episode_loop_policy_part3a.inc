LR"JS(

  const ensure = () => {
    try {
      if (!location.pathname.startsWith('/episodes/')) return;
      let state = window.__homePanelSakuraMeetsState;
      if (!state || state.path !== location.pathname) {
        try { state?.clearProgressSampler?.(); } catch (_) {}
        state = {
          path: location.pathname,
          video: null,
          nativeWakeVideo: null,
          nativeWakeSource: '',
          maxDuration: 0,
          maxTime: 0,
          progressSampleAt: 0,
          progressTimer: 0,
          endCandidateAt: 0,
          endReported: false,
          lowQualitySet: false,
          lowClickPending: false,
          qualityActionCount: 0,
          qualityAttemptExhausted: false,
          playbackSettingsApplied: false,
          fullscreenDirty: true,
          adActive: false,
          adVideo: null,
          adIdentity: '',
          adEndedAt: 0,
          postrollAfterProgram: false,
          recoveryPending: false,
          recoverySince: 0,
          recoveryWakeTimer: 0,
        };
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
      // Healthy playback stays on the numeric/media-event fast path. Avoid the
      // style/layout-heavy ad marker scan until the media identity changes,
      // playback rolls back, or recovery/configuration becomes necessary.
      const advertisementActive = healthyProgram && !playbackRolledBack
          ? false : detectAd(video, state);
      if (advertisementActive) {
        const identity = mediaIdentity(video);
        const adMediaChanged = state.adVideo !== video || state.adIdentity !== identity;
        if (!state.adActive || adMediaChanged) {
          const completedProgram = state.endCandidateAt > 0 &&
              state.maxDuration >= 5 &&
              state.maxTime >= Math.max(3, state.maxDuration - 10);
          if (!state.adActive) state.postrollAfterProgram = completedProgram;
          try { state.clearRecoveryWake?.(); } catch (_) {}
          try { state.clearProgressSampler?.(); } catch (_) {}
          state.adActive = true;
          state.adVideo = video || null;
          state.adIdentity = identity;
          state.adEndedAt = 0;
          state.endCandidateAt = 0;
          state.maxDuration = 0;
          state.maxTime = 0;
          state.progressSampleAt = 0;
          state.lowQualitySet = false;
          state.lowClickPending = false;
          state.qualityActionCount = 0;
          state.qualityAttemptExhausted = false;
          state.playbackSettingsApplied = false;
          state.fullscreenDirty = true;
          state.recoveryPending = false;
          state.recoverySince = 0;
          state.recoveryWakeTimer = 0;
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
        try { state.clearRecoveryWake?.(); } catch (_) {}
        try { state.clearProgressSampler?.(); } catch (_) {}
        state.adActive = false;
        state.adVideo = null;
        state.adIdentity = '';
        state.adEndedAt = 0;
        state.video = null;
        state.maxDuration = 0;
        state.maxTime = 0;
        state.progressSampleAt = 0;
        state.progressTimer = 0;
        state.endCandidateAt = 0;
        state.lowQualitySet = false;
        state.lowClickPending = false;
        state.qualityActionCount = 0;
        state.qualityAttemptExhausted = false;
        state.playbackSettingsApplied = false;
        state.fullscreenDirty = true;
        state.postrollAfterProgram = false;
        state.recoveryPending = false;
        state.recoverySince = 0;
        state.recoveryWakeTimer = 0;
        window.__homePanelTverAdActive = false;
        if (completedPostroll) {
          if (postEpisodeEnded(state)) return;
          wakeNative('ended-post-failed:' + location.pathname, true);
          return;
        }
      } else {
        window.__homePanelTverAdActive = false;
      }

      if (state.video !== video) {
        try { state.clearRecoveryWake?.(); } catch (_) {}
        try { state.clearProgressSampler?.(); } catch (_) {}
        state.video = video;
        state.progressSampleAt = 0;
        state.progressTimer = 0;
        state.lowQualitySet = false;
        state.lowClickPending = false;
        state.qualityActionCount = 0;
        state.qualityAttemptExhausted = false;
        state.playbackSettingsApplied = false;
        state.fullscreenDirty = true;
        state.recoveryPending = false;
        state.recoverySince = 0;
        state.recoveryWakeTimer = 0;
      }
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

      // Playback settings are initialized once for the current video. Volume
      // changes after initialization are handled by the volumechange listener.
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

      if (video.ended && !state.endCandidateAt) {
        state.endCandidateAt = Date.now();
        window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
      }
      const completedItem = state.maxDuration >= 5 &&
          state.maxTime >= Math.max(3, state.maxDuration - 10);
      const stableEnd = state.endCandidateAt > 0 &&
          Date.now() - state.endCandidateAt >= postrollGraceMs;
      if (stableEnd && completedItem) {
        if (postEpisodeEnded(state)) return;
        wakeNative('ended-post-failed:' + location.pathname, true);
        return;
      }
)JS"