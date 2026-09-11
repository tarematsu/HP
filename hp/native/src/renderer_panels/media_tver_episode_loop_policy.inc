// Low-peak TVer episode policy. Playback state is maintained from media events
// and a narrowly scoped player observer. Native trusted input is woken only when
// a state transition needs recovery; there is no page-wide polling/DOM observer.
namespace {
constexpr wchar_t kNativeMediaTverEpisodeLoopPolicyScript[] =
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
  const wakeNative = () => {
    const now = Date.now();
    if (now - wakeAt < 250) return;
    wakeAt = now;
    try {
      window.chrome?.webview?.postMessage('homepanel:tver-wake');
    } catch (_) {}
  };
)JS"
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

  let observedPlayerRoot = null;
  let playerObserver = null;
  const interestingPlayerSelector = [
    'video',
    '[aria-label*="スキップ"]', '[title*="スキップ"]',
    '[aria-label*="skip" i]', '[title*="skip" i]',
    '[aria-label*="広告"]', '[title*="広告"]',
    '[aria-label*="CM"]', '[title*="CM"]',
    '[data-testid*="ad" i]', '[class*="advert" i]',
    '[class*="commercial" i]',
    '[aria-label*="全画面"]', '[title*="全画面"]',
    '[aria-label*="fullscreen" i]', '[title*="fullscreen" i]',
    '[role="menuitem"]', '[role="radio"]', '[role="option"]',
    '[role="dialog"]', '[aria-modal="true"]'
  ].join(',');
  const bindPlayerObserver = video => {
    const root = playerRootFor(video);
    if (!root || root === observedPlayerRoot || typeof MutationObserver !== 'function') {
      return;
    }
    try { playerObserver?.disconnect(); } catch (_) {}
    observedPlayerRoot = root;
    playerObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node;
          if (element.matches?.(interestingPlayerSelector) ||
              element.querySelector?.(interestingPlayerSelector)) {
            scheduleEnsure(40);
            return;
          }
        }
      }
    });
    playerObserver.observe(root, { childList: true, subtree: true });
    window.__homePanelTverEpisodeObserver = playerObserver;
  };

  const bindVideoEvents = (video, state) => {
    if (!video || video.__homePanelTverEventState === state) return;
    video.__homePanelTverEventState = state;
    video.addEventListener('timeupdate', () => {
      if (window.__homePanelSakuraMeetsState !== state) return;
      if (Number.isFinite(video.currentTime)) {
        state.maxTime = Math.max(state.maxTime, video.currentTime);
      }
      if (Number.isFinite(video.duration)) {
        state.maxDuration = Math.max(state.maxDuration, video.duration);
      }
    }, { passive: true });
    video.addEventListener('ratechange', () => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive ||
          window.__homePanelTverAdActive) return;
      if (video.playbackRate !== playbackRate) {
        try {
          video.defaultPlaybackRate = playbackRate;
          video.playbackRate = playbackRate;
        } catch (_) {}
      }
    });
    video.addEventListener('volumechange', () => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive ||
          window.__homePanelTverAdActive) return;
      enforceVolume(video);
    });
    video.addEventListener('ended', () => {
      if (window.__homePanelSakuraMeetsState !== state || state.adActive) return;
      state.endCandidateAt = Date.now();
      window.setTimeout(scheduleEnsure, postrollGraceMs + 100);
    }, { passive: true });
    for (const eventName of [
        'play', 'pause', 'loadedmetadata', 'emptied', 'durationchange']) {
      video.addEventListener(eventName, () => scheduleEnsure(40), { passive: true });
    }
  };
)JS"
LR"JS(

  const ensure = () => {
    try {
      if (!location.pathname.startsWith('/episodes/')) return;
      let state = window.__homePanelSakuraMeetsState;
      if (!state || state.path !== location.pathname) {
        state = {
          path: location.pathname,
          video: null,
          maxDuration: 0,
          maxTime: 0,
          endCandidateAt: 0,
          lowQualitySet: false,
          qualityProbeAt: 0,
          qualityProbeAttempts: 0,
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
          state.lowQualitySet = false;
          state.qualityProbeAt = 0;
          state.qualityProbeAttempts = 0;
          state.playbackSettingsApplied = false;
          state.fullscreenDirty = true;
          state.restartRequested = false;
        }
        window.__homePanelTverAdActive = true;
        wakeNative();
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
        state.endCandidateAt = 0;
        state.lowQualitySet = false;
        state.qualityProbeAt = 0;
        state.qualityProbeAttempts = 0;
        state.playbackSettingsApplied = false;
        state.fullscreenDirty = true;
        state.restartRequested = false;
        state.postrollAfterProgram = false;
        window.__homePanelTverAdActive = false;
        if (completedPostroll) {
          if (advanceEpisode()) return;
          state.restartRequested = true;
          wakeNative();
          return;
        }
      } else {
        window.__homePanelTverAdActive = false;
      }

      if (state.video !== video) {
        state.video = video;
        state.lowQualitySet = false;
        state.qualityProbeAt = 0;
        state.qualityProbeAttempts = 0;
        state.playbackSettingsApplied = false;
        state.fullscreenDirty = true;
      }
      if (!video) return;
      bindVideoEvents(video, state);
      bindPlayerObserver(video);
      enforceVolume(video);

      if (!state.playbackSettingsApplied) {
        try {
          video.defaultPlaybackRate = playbackRate;
          if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
        } catch (_) {}
        enforceVolume(video);
        state.playbackSettingsApplied = true;
      }
      if (Number.isFinite(video.duration)) {
        state.maxDuration = Math.max(state.maxDuration, video.duration);
      }
      if (Number.isFinite(video.currentTime)) {
        state.maxTime = Math.max(state.maxTime, video.currentTime);
      }

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
        wakeNative();
        return;
      }

      // Quality discovery is bounded and rate-limited. If TVer's control is not
      // materialized, stop after a few probes instead of rescanning the player
      // on every unrelated DOM mutation for the rest of the episode.
      const now = Date.now();
      if (!state.lowQualitySet && state.qualityProbeAttempts < qualityProbeLimit &&
          now - state.qualityProbeAt >= qualityProbeIntervalMs) {
        state.qualityProbeAt = now;
        ++state.qualityProbeAttempts;
        const root = playerRootFor(video);
        if (root) {
          const qualityChoices = [];
          for (const element of root.querySelectorAll(
              'button, [role="button"], [role="menuitem"], [role="radio"], '
              + '[role="option"], li')) {
            if (!visibleRect(element)) continue;
            const name = labelOf(element)
                .replace(/[（(](?:選択中|設定中)[）)]/g, '')
                .replace(/画質$/, '').trim();
            if (/^(自動|高|中|低)$/.test(name)) qualityChoices.push([element, name]);
          }
          const labels = new Set(qualityChoices.map(([, name]) => name));
          const low = qualityChoices.find(([, name]) => name === '低');
          if (labels.size >= 3 && low) {
            const element = low[0];
            const selected = element.getAttribute('aria-checked') === 'true' ||
                element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('data-state') === 'checked' ||
                /選択中|設定中/.test(labelOf(element));
            if (!selected) {
              try { element.click(); } catch (_) {}
            }
            state.lowQualitySet = true;
          }
        }
        if (!state.lowQualitySet && state.qualityProbeAttempts < qualityProbeLimit) {
          window.setTimeout(scheduleEnsure, qualityProbeIntervalMs + 20);
        }
      }

      if (video.paused && !video.ended) wakeNative();
      const browserFullscreen = document.fullscreenElement ||
          document.webkitFullscreenElement || document.msFullscreenElement;
      if (!browserFullscreen) wakeNative();
    } catch (_) {}
  };

  // Capture media events so a newly replaced <video> can be discovered without
  // observing the whole document. Only media events schedule a state pass.
  for (const eventName of ['play', 'pause', 'loadedmetadata', 'emptied']) {
    document.addEventListener(eventName, event => {
      if (event.target instanceof HTMLMediaElement) scheduleEnsure(40);
    }, true);
  }
  document.addEventListener('fullscreenchange', () => {
    scheduleEnsure(40);
    wakeNative();
  }, true);
  document.addEventListener('webkitfullscreenchange', () => {
    scheduleEnsure(40);
    wakeNative();
  }, true);
  ensure();
  return true;
})()
)JS";
}  // namespace
