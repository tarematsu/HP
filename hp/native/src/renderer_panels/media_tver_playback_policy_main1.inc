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
  const isEnterFullscreenControl = element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) ||
        /(?:^|[-_ ])full[-_ ]?screen(?:$|[-_ ])/i.test(label);
  };
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
  const revealPlayerControls = media => {
    const rect = visibleRect(media);
    if (!rect) return;
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.bottom - Math.min(24, Math.max(8, rect.height / 8));
    try {
      media.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX, clientY,
      }));
    } catch (_) {}
  };
  const fullscreenControlPoint = media => {
    const root = playerRootFor(media);
    if (!root) return null;
    revealPlayerControls(media);
    const selector =
        'button, [role="button"], [aria-label], [title], [data-testid]';
    const scopedControls = Array.from(root.querySelectorAll(selector));
    const scopedButton = scopedControls.find(isEnterFullscreenControl) || null;
    if (scopedButton) return point(scopedButton);

    // TVer can render player controls outside the video's nearest container.
    // Fall back to the document only for a specifically labelled fullscreen
    // control; point() still verifies that the element is the actual hit target.
    const documentButton = Array.from(document.querySelectorAll(selector))
        .find(isEnterFullscreenControl) || null;
    return documentButton ? point(documentButton) : null;
  };

  const state = window.__homePanelSakuraMeetsState;
  const fullscreenRecovery = window.__homePanelTverFullscreenRecovery ||
      (window.__homePanelTverFullscreenRecovery = {
        video: null, requestedAt: 0, attempts: 0
      });
  if (fullscreenRecovery.video !== video) {
    fullscreenRecovery.video = video;
    fullscreenRecovery.requestedAt = 0;
    fullscreenRecovery.attempts = 0;
  }
  const resetFullscreenRecovery = () => {
    fullscreenRecovery.requestedAt = 0;
    fullscreenRecovery.attempts = 0;
  };

  const adActive = (state && state.adActive) || window.__homePanelTverAdActive;
  let viewportFullscreen = false;
  if (video && typeof window.__homePanelTverEnsureViewportFullscreen === 'function') {
    try {
      viewportFullscreen =
          !!window.__homePanelTverEnsureViewportFullscreen(video);
    } catch (_) {}
  }
  const browserFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement || document.msFullscreenElement;
  if (browserFullscreen || viewportFullscreen) {
    if (state) state.fullscreenDirty = false;
    resetFullscreenRecovery();
  } else if (video) {
    if (state) state.fullscreenDirty = true;
    if (window.__homePanelTverFullscreenPending) return null;

    const requestedAt = Number(fullscreenRecovery.requestedAt || 0);
    const attempts = Number(fullscreenRecovery.attempts || 0);
    const controlPoint = fullscreenControlPoint(video);
    if (controlPoint && attempts < 3) {
      fullscreenRecovery.requestedAt = Date.now();
      fullscreenRecovery.attempts = attempts + 1;
      return controlPoint;
    }

    // TVer's real fullscreen button is the preferred trusted action. F is only
    // a fallback when the control cannot be located or repeated clicks failed.
    const keyRetryDue = requestedAt === 0 || Date.now() - requestedAt >= 1000;
    if (keyRetryDue && attempts < 7) {
      fullscreenRecovery.requestedAt = Date.now();
      fullscreenRecovery.attempts = attempts + 1;
      try { window.chrome?.webview?.postMessage('homepanel:tver-fullscreen-key'); }
      catch (_) {}
      return null;
    }
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