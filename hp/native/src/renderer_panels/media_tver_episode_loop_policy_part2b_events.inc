LR"JS(

  const bindVideoEvents = (video, state) => {
    if (!video || video.__homePanelTverEventState === state) return;
    video.__homePanelTverEventState = state;

    const clearProgressSampler = () => {
      if (!state.progressTimer) return;
      clearTimeout(state.progressTimer);
      state.progressTimer = 0;
    };
    const armProgressSampler = () => {
      if (state.progressTimer || state.recoveryPending || state.adActive ||
          video.paused || video.ended) return;
      const delay = progressIntervalFor(video);
      state.progressTimer = setTimeout(() => {
        state.progressTimer = 0;
        if (window.__homePanelSakuraMeetsState !== state ||
            state.video !== video || video.ended || state.recoveryPending ||
            state.adActive) return;
        const currentTime = Number(video.currentTime);
        if (Number.isFinite(currentTime) && state.maxTime >= 10 &&
            currentTime + 5 < state.maxTime) {
          scheduleEnsure(0);
        }
        sampleProgress(video, state);
        if (!video.paused) armProgressSampler();
      }, delay);
    };
    state.clearProgressSampler = clearProgressSampler;
    state.armProgressSampler = armProgressSampler;

    const clearRecovery = () => {
      state.recoveryPending = false;
      state.recoverySince = 0;
      if (state.recoveryWakeTimer) {
        clearTimeout(state.recoveryWakeTimer);
        state.recoveryWakeTimer = 0;
      }
    };
    const armRecoveryWake = () => {
      if (!state.recoveryPending || state.recoveryWakeTimer) return;
      state.recoveryWakeTimer = setTimeout(() => {
        state.recoveryWakeTimer = 0;
        if (window.__homePanelSakuraMeetsState !== state ||
            !state.recoveryPending) return;
        wakeNative('recovery:tick:' + mediaIdentity(video), true);
        armRecoveryWake();
      }, 2000);
    };
    const startRecovery = reason => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive) return;
      const enteringRecovery = !state.recoveryPending;
      if (enteringRecovery) {
        state.recoverySince = Date.now();
        state.recoveryPending = true;
        wakeNative('recovery:' + reason + ':' + mediaIdentity(video), true);
      }
      armRecoveryWake();
    };
    state.clearRecoveryWake = clearRecovery;
    state.requestRecoveryWake = startRecovery;

    // Progress sampling uses one adaptive one-shot timer rather than receiving
    // every timeupdate event. Healthy playback wakes at most every two seconds,
    // with tighter sampling only near the end of an item.
    armProgressSampler();

    // playbackRate is initialized once when this video becomes current. Do not
    // watch ratechange and rewrite it repeatedly during the same media item.
    video.addEventListener('volumechange', () => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive ||
          window.__homePanelTverAdActive) return;
      enforceVolume(video);
    });
    video.addEventListener('ended', () => {
      if (window.__homePanelSakuraMeetsState !== state) return;
      // Ad state can lag the media event by one ensure pass. Re-check the rare
      // ended event before arming episode completion so a pre-roll ending can
      // never advance the native episode queue.
      if (state.adActive || detectAd(video, state)) {
        scheduleEnsure(0);
        return;
      }
      // Ignore an ended media surface that never demonstrated forward program
      // playback after it became current. This blocks stale/replaced video
      // elements from advancing the native episode queue during player startup.
      if (!state.programPlaybackConfirmed) {
        scheduleEnsure(0);
        return;
      }
      clearProgressSampler();
      sampleProgress(video, state, true);
      clearRecovery();
      state.endCandidateAt = Date.now();
      window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
    }, { passive: true });
    for (const eventName of ['waiting', 'stalled']) {
      video.addEventListener(eventName, () => {
        clearProgressSampler();
        startRecovery(eventName);
        scheduleEnsure(40);
      }, { passive: true });
    }
    video.addEventListener('pause', () => {
      clearProgressSampler();
      if (!video.ended) startRecovery('pause');
      scheduleEnsure(40);
    }, { passive: true });
    video.addEventListener('play', () => {
      armProgressSampler();
      scheduleEnsure(40);
    }, { passive: true });
    video.addEventListener('playing', () => {
      clearRecovery();
      armProgressSampler();
      scheduleEnsure(40);
    }, { passive: true });
    video.addEventListener('emptied', () => {
      clearProgressSampler();
      clearRecovery();
      scheduleEnsure(40);
    }, { passive: true });
    for (const eventName of ['loadedmetadata', 'durationchange']) {
      video.addEventListener(eventName, () => {
        sampleProgress(video, state, true);
        clearProgressSampler();
        armProgressSampler();
        scheduleEnsure(40);
      }, { passive: true });
    }
  };
)JS"