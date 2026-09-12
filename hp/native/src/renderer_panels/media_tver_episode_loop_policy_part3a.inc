LR"JS(

  const ensure = () => {
    try {
      if (!location.pathname.startsWith('/episodes/')) return;
      let state = window.__homePanelSakuraMeetsState;
      if (!state || state.path !== location.pathname) {
        state = {
          path: location.pathname,
          video: null,
          nativeWakeVideo: null,
          nativeWakeSource: '',
          maxDuration: 0,
          maxTime: 0,
          progressSampleAt: 0,
          endCandidateAt: 0,
          lowQualitySet: false,
          playbackSettingsApplied: false,
          fullscreenDirty: true,
          restartRequested: false,
          adActive: false,
          adVideo: null,
          adIdentity: '',
          adEndedAt: 0,
          postrollAfterProgram: false,
        };
        window.__homePanelSakuraMeetsState = state;
      }

      const video = currentVideo();
      requestNativeMediaInit(video, state);
      bindVideoEvents(video, state);
      bindPlayerObserver(video);
      const advertisementActive = detectAd(video, state);
      if (advertisementActive) {
        const identity = mediaIdentity(video);
        const adMediaChanged = state.adVideo !== video || state.adIdentity !== identity;
        if (!state.adActive || adMediaChanged) {
          const completedProgram = state.endCandidateAt > 0 &&
              state.maxDuration >= 5 &&
              state.maxTime >= Math.max(3, state.maxDuration - 10);
          if (!state.adActive) state.postrollAfterProgram = completedProgram;
          state.adActive = true;
          state.adVideo = video || null;
          state.adIdentity = identity;
          state.adEndedAt = 0;
          state.endCandidateAt = 0;
          state.maxDuration = 0;
          state.maxTime = 0;
          state.progressSampleAt = 0;
          state.lowQualitySet = false;
          state.playbackSettingsApplied = false;
          state.fullscreenDirty = true;
          state.restartRequested = false;
        }
        window.__homePanelTverAdActive = true;
        const adFullscreen = !!(document.fullscreenElement ||
            document.webkitFullscreenElement || document.msFullscreenElement);
        wakeNative('ad:' + identity + ':' + (adFullscreen ? 'fs' : 'window'));
        return;
      }

      if (state.adActive) {
        const completedPostroll = state.postrollAfterProgram;
        state.adActive = false;
        state.adVideo = null;
        state.adIdentity = '';
        state.adEndedAt = 0;
        state.video = null;
        state.maxDuration = 0;
        state.maxTime = 0;
        state.progressSampleAt = 0;
        state.endCandidateAt = 0;
        state.lowQualitySet = false;
        state.playbackSettingsApplied = false;
        state.fullscreenDirty = true;
        state.restartRequested = false;
        state.postrollAfterProgram = false;
        window.__homePanelTverAdActive = false;
        if (completedPostroll) {
          if (advanceEpisode()) return;
          state.restartRequested = true;
          wakeNative('restart:' + location.pathname, true);
          return;
        }
      } else {
        window.__homePanelTverAdActive = false;
      }

      if (state.video !== video) {
        state.video = video;
        state.progressSampleAt = 0;
        state.lowQualitySet = false;
        state.playbackSettingsApplied = false;
        state.fullscreenDirty = true;
      }
      if (!video) return;
      bindVideoEvents(video, state);
      bindPlayerObserver(video);
      enforceVolume(video);

      // Playback rate is initialized exactly once for the current video.
      if (!state.playbackSettingsApplied) {
        try {
          video.defaultPlaybackRate = playbackRate;
          if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
        } catch (_) {}
        enforceVolume(video);
        state.playbackSettingsApplied = true;
      }
      sampleProgress(video, state, true);

      if (video.ended && !state.endCandidateAt) {
        state.endCandidateAt = Date.now();
        window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
      }
      const completedItem = state.maxDuration >= 5 &&
          state.maxTime >= Math.max(3, state.maxDuration - 10);
      const stableEnd = state.endCandidateAt > 0 &&
          Date.now() - state.endCandidateAt >= postrollGraceMs;
      if (stableEnd && completedItem) {
        if (advanceEpisode()) return;
        state.restartRequested = true;
        wakeNative('restart:' + location.pathname, true);
        return;
      }
)JS"