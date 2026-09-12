LR"JS(

  const explicitAdMarker = video => {
    const root = playerRootFor(video);
    const videoRect = visibleRect(video);
    if (!root || !videoRect) return false;
    const selectors = [
      '[aria-label*="広告"]', '[title*="広告"]',
      '[aria-label*="CM"]', '[title*="CM"]',
      '[data-testid*="ad" i]', '[class*="advert" i]',
      '[class*="commercial" i]', '[id*="advert" i]',
      '[id*="commercial" i]'
    ];
    for (const element of root.querySelectorAll(selectors.join(','))) {
      const rect = visibleRect(element);
      if (!rect || rect.right <= videoRect.left || rect.left >= videoRect.right ||
          rect.bottom <= videoRect.top || rect.top >= videoRect.bottom) continue;
      const text = labelOf(element);
      if (text.length <= 160 &&
          /広告|(?:^|\s)CM(?:\s|$|[:：\d])|Advertisement|Ad break/i.test(text)) {
        return true;
      }
    }
    return false;
  };

  const detectAd = (video, state) => {
    if (!video) return false;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shortAdLength = duration >= 5 && duration <= 65;
    const identity = mediaIdentity(video);
    if (state.adActive) {
      const mediaChanged = state.adVideo !== video ||
          (state.adIdentity && identity && state.adIdentity !== identity);
      if (mediaChanged) {
        if (!duration || shortAdLength) return true;
        return explicitAdMarker(video);
      }
      if (shortAdLength && !video.ended) return true;
      if (video.ended) {
        if (!state.adEndedAt) state.adEndedAt = Date.now();
        if (Date.now() - state.adEndedAt < 4000) return true;
      }
      return explicitAdMarker(video);
    }
    const replacementVideo = state.video && state.video !== video &&
        state.maxTime >= 5 && shortAdLength;
    const sameVideoReset = state.video === video && state.maxTime >= 10 &&
        shortAdLength && currentTime < 5 && video.playbackRate <= 1.05;
    if (replacementVideo || sameVideoReset) return true;
    return explicitAdMarker(video);
  };

  let ensureTimer = 0;
  const scheduleEnsure = (delay = 100) => {
    if (ensureTimer) return;
    ensureTimer = window.setTimeout(() => {
      ensureTimer = 0;
      ensure();
    }, delay);
  };
)JS"