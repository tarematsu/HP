LR"JS(

  const bindVideoEvents = (video, state) => {
    if (!video || video.__homePanelTverEventState === state) return;
    video.__homePanelTverEventState = state;
    const clearStall = () => { state.stalledAt = 0; };
    video.addEventListener('timeupdate', () => {
      if (window.__homePanelSakuraMeetsState !== state) return;
      sampleProgress(video, state);
      clearStall();
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
      clearStall();
      state.endCandidateAt = Date.now();
      window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
    }, { passive: true });
    for (const eventName of ['waiting', 'stalled']) {
      video.addEventListener(eventName, () => {
        if (window.__homePanelSakuraMeetsState !== state || state.adActive) return;
        if (!state.stalledAt) state.stalledAt = Date.now();
        wakeNative('recovery:' + eventName + ':' + mediaIdentity(video), true);
        scheduleEnsure(40);
      }, { passive: true });
    }
    for (const eventName of ['play', 'playing']) {
      video.addEventListener(eventName, () => {
        if (window.__homePanelSakuraMeetsState !== state) return;
        clearStall();
        scheduleEnsure(40);
      }, { passive: true });
    }
    for (const eventName of ['pause', 'emptied']) {
      video.addEventListener(eventName, () => scheduleEnsure(40), { passive: true });
    }
    for (const eventName of ['loadedmetadata', 'durationchange']) {
      video.addEventListener(eventName, () => {
        clearStall();
        sampleProgress(video, state, true);
        scheduleEnsure(40);
      }, { passive: true });
    }
  };
)JS"