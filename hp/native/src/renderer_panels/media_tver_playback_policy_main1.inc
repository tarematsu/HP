LR"JS(

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visibleRect = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return null;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' ||
        style.pointerEvents === 'none') return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const visible = element => !!visibleRect(element);
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.getAttribute('data-testid') || '') + ' ' +
      (element.textContent || ''));
  const point = element => {
    if (window.innerWidth <= 0 || window.innerHeight <= 0) return null;
    const rect = visibleRect(element);
    if (!rect) return null;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [
      Math.max(0, Math.min(10000, Math.round((centerX / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round((centerY / window.innerHeight) * 10000)))
    ];
  };

  let video = null;
  for (const candidate of document.querySelectorAll('video')) {
    if (visible(candidate)) {
      video = candidate;
      break;
    }
    if (!video) video = candidate;
  }
  const playerRootFor = media => {
    if (!media) return null;
    let root = media.parentElement;
    let best = root || media;
    for (let depth = 0; root && root !== document.body && depth < 5; ++depth) {
      best = root;
      root = root.parentElement;
    }
    return best;
  };

  const state = window.__homePanelSakuraMeetsState;
  const adActive = (state && state.adActive) || window.__homePanelTverAdActive;

  // Once playback and fullscreen have been configured for the current video,
  // healthy watchdog passes do not verify or reapply those settings.
  const trackedVideo = state && state.video;
  if (state && !adActive &&
      state.playbackSettingsApplied && state.fullscreenDirty === false &&
      trackedVideo instanceof HTMLMediaElement &&
      !trackedVideo.paused && !trackedVideo.ended && !trackedVideo.error &&
      !trackedVideo.muted && trackedVideo.volume === 1.0) {
    return null;
  }

  if (adActive) {
    // During ads the watchdog may only click Skip or the fullscreen control.
    const adRoot = video ? playerRootFor(video) : null;
    const adControls = adRoot ? Array.from(adRoot.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]')) : [];
    const skipButton = adControls.find(element => {
      if (!visible(element)) return false;
      const label = labelOf(element);
      return /(?:広告|CM).{0,12}スキップ|^スキップ$|skip\s+(?:this\s+)?ads?/i.test(label);
    }) || null;
    if (skipButton) return point(skipButton);

    const browserFullscreen = document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement;
    if (browserFullscreen) {
      if (state) state.fullscreenDirty = false;
      return null;
    }
    if (state && state.fullscreenDirty === false) return null;
    const fullscreenButton = adControls.find(element => {
      if (!visible(element)) return false;
      const label = labelOf(element).toLowerCase();
      if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
      return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
    }) || null;
    if (fullscreenButton && state) state.fullscreenDirty = false;
    return fullscreenButton ? point(fullscreenButton) : null;
  }
)JS"