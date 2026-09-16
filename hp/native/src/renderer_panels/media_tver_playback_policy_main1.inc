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
  const hasVisibleLoginPrompt = () => Array.from(document.querySelectorAll(
      'button, a, [role="button"], [role="dialog"], [aria-modal="true"], '
      + 'h1, h2, h3, [aria-label], [title]')).some(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    return label.includes('ログイン') || /\b(?:log\s*in|sign\s*in)\b/i.test(label);
  });
  const point = element => {
    if (window.innerWidth <= 0 || window.innerHeight <= 0) return null;
    const rect = visibleRect(element);
    if (!rect) return null;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    const hit = document.elementFromPoint(centerX, centerY);
    if (!hit || (hit !== element && !element.contains(hit))) return null;
    return [centerX, centerY];
  };
  const videoFullscreenPoint = media => {
    if (!(media instanceof HTMLMediaElement) ||
        media.readyState < HTMLMediaElement.HAVE_METADATA ||
        window.innerWidth <= 0 || window.innerHeight <= 0) return null;
    const rect = visibleRect(media);
    if (!rect) return null;
    const insetX = Math.min(24, Math.max(8, rect.width / 8));
    const insetY = Math.min(24, Math.max(8, rect.height / 8));
    const x = rect.right - insetX;
    const y = rect.bottom - insetY;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight)
      return null;
    return [x, y];
  };

  const videos = Array.from(document.querySelectorAll('video'));
  const video = videos.find(visible) || videos[0] || null;
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
  const browserFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement || document.msFullscreenElement;
  if (browserFullscreen) {
    if (state) state.fullscreenDirty = false;
  } else if (video && !hasVisibleLoginPrompt()) {
    if (state) state.fullscreenDirty = true;
    const fullscreenPoint = videoFullscreenPoint(video);
    if (fullscreenPoint) return fullscreenPoint;
  }

  const trackedVideo = state && state.video;
  if (state && !adActive && !state.recoveryPending &&
      state.playbackSettingsApplied &&
      (state.lowQualitySet || state.qualityAttemptExhausted) &&
      state.fullscreenDirty === false &&
      trackedVideo instanceof HTMLMediaElement &&
      !trackedVideo.paused && !trackedVideo.ended && !trackedVideo.error &&
      !trackedVideo.muted && trackedVideo.volume === 1.0) {
    return null;
  }

  if (adActive) {
    const adRoot = video ? playerRootFor(video) : null;
    const adControls = adRoot ? Array.from(adRoot.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]')) : [];
    const skipButton = adControls.find(element => {
      if (!visible(element)) return false;
      return /(?:広告|CM).{0,12}スキップ|^スキップ$|skip\s+(?:this\s+)?ads?/i
          .test(labelOf(element));
    }) || null;
    if (skipButton) return point(skipButton);
    return null;
  }
)JS"