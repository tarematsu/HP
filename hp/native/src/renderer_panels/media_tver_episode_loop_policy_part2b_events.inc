LR"JS(

  const bindVideoEvents = (video, state) => {
    if (!video || video.__homePanelTverEventState === state) return;
    video.__homePanelTverEventState = state;
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
      state.endCandidateAt = Date.now();
      window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
    }, { passive: true });
    for (const eventName of ['play', 'pause', 'emptied']) {
      video.addEventListener(eventName, () => scheduleEnsure(40), { passive: true });
    }
    for (const eventName of ['loadedmetadata', 'durationchange']) {
      video.addEventListener(eventName, () => {
        sampleProgress(video, state, true);
        scheduleEnsure(40);
      }, { passive: true });
    }
  };
)JS"