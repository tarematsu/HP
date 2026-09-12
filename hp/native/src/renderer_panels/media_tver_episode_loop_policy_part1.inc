LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;
  if (window.__homePanelTverEpisodePolicyInstalled) return true;
  window.__homePanelTverEpisodePolicyInstalled = true;

  const playbackRate = 1.75;
  const targetVolume = 1.0;
  const postrollGraceMs = 12000;
  const qualityProbeIntervalMs = 5000;
  const qualityProbeLimit = 4;
  const progressSteadyIntervalMs = 2000;
  const progressNearEndIntervalMs = 500;
  const progressFinalIntervalMs = 200;
  const episodeQueueKey = '__homePanelTverEpisodeQueue';
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visibleRect = element => {
    if (!element) return null;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.getAttribute('data-testid') || '') + ' ' +
      (element.textContent || ''));
  const playerRootFor = video => {
    if (!video) return null;
    let root = video.parentElement;
    let best = root || video;
    for (let depth = 0; root && root !== document.body && depth < 5; ++depth) {
      best = root;
      root = root.parentElement;
    }
    return best;
  };
  const currentVideo = () => {
    let fallback = null;
    for (const video of document.querySelectorAll('video')) {
      if (!fallback) fallback = video;
      if (visibleRect(video)) return video;
    }
    return fallback;
  };
  const mediaIdentity = video => {
    if (!video) return '';
    const source = normalize(video.currentSrc || video.src || '');
    const duration = Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 10) / 10 : 0;
    return source ? source + '|' + duration
                  : (duration > 0 ? 'duration:' + duration : '');
  };
  const enforceVolume = video => {
    if (!video) return;
    try {
      if (video.muted) video.muted = false;
      if (video.volume !== targetVolume) video.volume = targetVolume;
    } catch (_) {}
  };
  const advanceEpisode = () => {
    try {
      const queue = JSON.parse(sessionStorage.getItem(episodeQueueKey) || 'null');
      if (!queue || !Array.isArray(queue.hrefs) || !queue.hrefs.length) return false;
      const currentIndex = queue.hrefs.findIndex(href => {
        try { return new URL(href, location.href).pathname === location.pathname; }
        catch (_) { return false; }
      });
      const storedIndex = Number.isInteger(queue.index) ? queue.index : -1;
      const nextIndex = (currentIndex >= 0 ? currentIndex : storedIndex) + 1;
      if (nextIndex >= 0 && nextIndex < queue.hrefs.length) {
        sessionStorage.setItem(
            episodeQueueKey,
            JSON.stringify({ hrefs: queue.hrefs, index: nextIndex }));
        location.replace(queue.hrefs[nextIndex]);
        return true;
      }
      sessionStorage.removeItem(episodeQueueKey);
    } catch (_) {}
    return false;
  };

  let wakeAt = 0;
  let wakeTimer = 0;
  let lastWakeSignature = '';
  let pendingWakeSignature = '';
  const postWake = signature => {
    wakeAt = Date.now();
    lastWakeSignature = signature;
    pendingWakeSignature = '';
    try {
      window.chrome?.webview?.postMessage('homepanel:tver-wake');
    } catch (_) {}
  };
  const wakeNative = (signature = 'state', force = false) => {
    if (!force && signature === lastWakeSignature && !wakeTimer) return;
    pendingWakeSignature = signature;
    const delay = Math.max(0, 250 - (Date.now() - wakeAt));
    if (delay === 0) {
      if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = 0;
      }
      if (force || signature !== lastWakeSignature) postWake(signature);
      return;
    }
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = 0;
      const pending = pendingWakeSignature;
      if (pending && pending !== lastWakeSignature) postWake(pending);
    }, delay);
  };

  const progressIntervalFor = video => {
    if (!video || !Number.isFinite(video.duration) ||
        !Number.isFinite(video.currentTime) || video.duration <= 0) {
      return progressSteadyIntervalMs;
    }
    const remaining = Math.max(0, video.duration - video.currentTime);
    if (remaining <= 3) return progressFinalIntervalMs;
    if (remaining <= 15) return progressNearEndIntervalMs;
    return progressSteadyIntervalMs;
  };
  const sampleProgress = (video, state, force = false) => {
    if (!video || !state) return;
    const now = Date.now();
    const interval = progressIntervalFor(video);
    if (!force && state.progressSampleAt &&
        now - state.progressSampleAt < interval) return;
    state.progressSampleAt = now;
    if (Number.isFinite(video.currentTime)) {
      state.maxTime = Math.max(state.maxTime, video.currentTime);
    }
    if (Number.isFinite(video.duration)) {
      state.maxDuration = Math.max(state.maxDuration, video.duration);
    }
  };
)JS"