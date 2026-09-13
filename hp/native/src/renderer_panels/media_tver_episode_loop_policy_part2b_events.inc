LR"JS(

  const bindVideoEvents = (video, state) => {
    if (!video || video.__homePanelTverEventState === state) return;
    video.__homePanelTverEventState = state;

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

    video.addEventListener('timeupdate', () => {
      if (window.__homePanelSakuraMeetsState !== state) return;
      sampleProgress(video, state);
    }, { passive: true });
    // playbackRate is initialized once when this video becomes current. Do not
    // watch ratechange and rewrite it repeatedly during the same media item.
    video.addEventListener('volumechange', () => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive ||
          window.__homePanelTverAdActive) return;
      enforceVolume(video);
    });
    video.addEventListener('ended', () => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive) return;
      sampleProgress(video, state, true);
      clearRecovery();
      state.endCandidateAt = Date.now();
      window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
    }, { passive: true });
    for (const eventName of ['waiting', 'stalled']) {
      video.addEventListener(eventName, () => {
        startRecovery(eventName);
        scheduleEnsure(40);
      }, { passive: true });
    }
    video.addEventListener('pause', () => {
      if (!video.ended) startRecovery('pause');
      scheduleEnsure(40);
    }, { passive: true });
    video.addEventListener('play', () => scheduleEnsure(40), { passive: true });
    video.addEventListener('playing', () => {
      clearRecovery();
      scheduleEnsure(40);
    }, { passive: true });
    video.addEventListener('emptied', () => {
      clearRecovery();
      scheduleEnsure(40);
    }, { passive: true });
    for (const eventName of ['loadedmetadata', 'durationchange']) {
      video.addEventListener(eventName, () => {
        sampleProgress(video, state, true);
        scheduleEnsure(40);
      }, { passive: true });
    }
  };
)JS"