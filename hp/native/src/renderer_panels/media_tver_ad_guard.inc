// Static TVer playback scripts. These are compiled as fixed string literals;
// no runtime string matching, insertion, replacement, or script generation is used.
namespace {
constexpr wchar_t kNativeMediaTverLoopStaticScript[] =
    LR"JS(
(() => {
  if (window.__homePanelSakuraMeetsLoopTimer) return;
  const sakuraSeriesPath = '/series/srx97ftk3w';
  const deathGameSeriesPath = '/series/srkzm5wbvp';
  const seriesPathKey = '__homePanelTverSeriesPath';
  const playbackRate = 1.75;
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const isDisplayed = element => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.textContent || ''));
  const qualityName = element => labelOf(element)
      .replace(/[（(](?:選択中|設定中)[）)]/g, '')
      .replace(/画質$/, '')
      .trim();

  const storedSeriesPath = () => {
    try {
      const stored = sessionStorage.getItem(seriesPathKey);
      if (stored === sakuraSeriesPath || stored === deathGameSeriesPath) return stored;
    } catch (_) {
    }
    return sakuraSeriesPath;
  };
  const rememberSeriesPath = path => {
    if (path !== sakuraSeriesPath && path !== deathGameSeriesPath) return;
    try { sessionStorage.setItem(seriesPathKey, path); } catch (_) {}
  };
  const episodeQueueKey = seriesPath => '__homePanelTverEpisodeQueue:' + seriesPath;
  const normalizeEpisodeHref = href => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin ||
          !url.pathname.startsWith('/episodes/')) return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  };
  const readEpisodeQueue = seriesPath => {
    try {
      const value = JSON.parse(
          sessionStorage.getItem(episodeQueueKey(seriesPath)) || 'null');
      if (!value || !Array.isArray(value.hrefs)) return { hrefs: [], index: -1 };
      return {
        hrefs: value.hrefs.filter(href => typeof href === 'string'),
        index: Number.isInteger(value.index) ? value.index : -1,
      };
    } catch (_) {
      return { hrefs: [], index: -1 };
    }
  };
  const writeEpisodeQueue = (seriesPath, hrefs, index) => {
    try {
      sessionStorage.setItem(
          episodeQueueKey(seriesPath), JSON.stringify({ hrefs, index }));
    } catch (_) {
    }
  };
  const clearEpisodeQueue = seriesPath => {
    try { sessionStorage.removeItem(episodeQueueKey(seriesPath)); } catch (_) {}
  };

  const findSeriesEpisodeContainer = () => {
    const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
    const headings = Array.from(document.querySelectorAll(headingSelector));
    const episodeHeading = headings.find(element =>
      /^(?:配信中の)?エピソード(?:一覧)?(?:\s*\(\d+\)|\s*\d+件)?$/.test(
          normalize(element.textContent)));
    if (!episodeHeading) return null;
    const foreignSectionHeading =
        /^(?:あなたにおすすめ|おすすめ|関連番組|関連動画|ランキング)$/;
    let container = episodeHeading.parentElement;
    while (container && container !== document.body) {
      const links = Array.from(
          container.querySelectorAll('a[href*="/episodes/"]')).filter(link => link.href);
      if (links.length) {
        const foreign = Array.from(container.querySelectorAll(headingSelector)).some(
            element => element !== episodeHeading &&
                foreignSectionHeading.test(normalize(element.textContent)));
        if (!foreign) return container;
      }
      container = container.parentElement;
    }
    return null;
  };
  const openPreferredEpisode = () => {
    const seriesPath = location.pathname;
    rememberSeriesPath(seriesPath);
    const container = findSeriesEpisodeContainer();
    if (!container) return;
    const hrefs = Array.from(new Set(Array.from(
        container.querySelectorAll('a[href*="/episodes/"]'))
        .map(link => normalizeEpisodeHref(link.href)).filter(Boolean)));
    if (!hrefs.length) return;
    writeEpisodeQueue(seriesPath, hrefs, 0);
    location.replace(hrefs[0]);
  };
  const advanceEpisodeOrSeries = () => {
    const seriesPath = storedSeriesPath();
    const queue = readEpisodeQueue(seriesPath);
    if (!queue.hrefs.length) return false;
    const currentIndex = queue.hrefs.findIndex(href => {
      try { return new URL(href, location.href).pathname === location.pathname; }
      catch (_) { return false; }
    });
    const nextIndex = (currentIndex >= 0 ? currentIndex : queue.index) + 1;
    if (nextIndex >= 0 && nextIndex < queue.hrefs.length) {
      writeEpisodeQueue(seriesPath, queue.hrefs, nextIndex);
      window.__homePanelSakuraMeetsState = null;
      location.replace(queue.hrefs[nextIndex]);
      return true;
    }
    clearEpisodeQueue(seriesPath);
    return false;
  };
)JS"
    LR"JS(

  const mediaIdentity = video => {
    if (!video) return '';
    const source = normalize(video.currentSrc || video.src || '');
    const duration = Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 10) / 10 : 0;
    if (source) return source + '|' + duration;
    return duration > 0 ? 'duration:' + duration : '';
  };
  const isTverAdvertisementActive = (video, state) => {
    const overlapsVideo = element => {
      if (!video || !isDisplayed(element)) return false;
      const markerRect = element.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      return markerRect.right > videoRect.left && markerRect.left < videoRect.right &&
             markerRect.bottom > videoRect.top && markerRect.top < videoRect.bottom;
    };
    const selectors = [
      '[aria-label*="広告"]', '[title*="広告"]',
      '[aria-label*="CM"]', '[title*="CM"]',
      '[data-testid*="ad"]', '[data-testid*="Ad"]',
      '[class*="advert"]', '[class*="Advert"]',
      '[class*="commercial"]', '[class*="Commercial"]',
      '[class*="ad-"]', '[class*="ad_"]', '[class*="Ad-"]',
      '[id*="advert"]', '[id*="Advert"]',
      '[id*="commercial"]', '[id*="Commercial"]'
    ];
    const explicitMarker = Array.from(
        document.querySelectorAll(selectors.join(','))).some(element => {
      if (!overlapsVideo(element)) return false;
      const text = labelOf(element);
      if (!text || text.length > 160) return false;
      return /広告|(?:^|\s)CM(?:\s|$|[:：\d])|Advertisement|Ad break/i.test(text);
    });
    if (explicitMarker) return true;
    if (!video || !state) return false;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shortAdLength = duration >= 5 && duration <= 65;
    const identity = mediaIdentity(video);
    if (state.adActive) {
      if (state.adVideo !== video) return false;
      if (state.adIdentity && identity && state.adIdentity !== identity) return false;
      if (shortAdLength && !video.ended) return true;
      if (video.ended) {
        if (!state.adEndedAt) state.adEndedAt = Date.now();
        if (Date.now() - state.adEndedAt < 4000) return true;
      }
      return false;
    }

    const replacementVideo = state.video && state.video !== video &&
        state.maxTime >= 5 && shortAdLength;
    const sameVideoReset = state.video === video && state.maxTime >= 10 &&
        shortAdLength && currentTime < 5 && video.playbackRate <= 1.05;
    return replacementVideo || sameVideoReset;
  };

  const ensureEpisodePlayback = () => {
    const path = location.pathname;
    let state = window.__homePanelSakuraMeetsState;
    if (!state || state.path !== path) {
      state = {
        path,
        video: null,
        maxDuration: 0,
        maxTime: 0,
        endCandidateAt: 0,
        lowQualitySet: false,
        playbackSettingsApplied: false,
        fullscreenDirty: true,
        restartRequested: false,
        adActive: false,
        adVideo: null,
        adIdentity: '',
        adEndedAt: 0,
      };
      window.__homePanelSakuraMeetsState = state;
    }

    if (!window.__homePanelTverFullscreenTrackerBound) {
      const markFullscreenState = () => {
        const activeState = window.__homePanelSakuraMeetsState;
        if (!activeState) return;
        const fullscreen = document.fullscreenElement ||
            document.webkitFullscreenElement || document.msFullscreenElement;
        activeState.fullscreenDirty = !fullscreen;
      };
      document.addEventListener('fullscreenchange', markFullscreenState);
      document.addEventListener('webkitfullscreenchange', markFullscreenState);
      window.__homePanelTverFullscreenTrackerBound = true;
    }

    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(isDisplayed) || videos[0] || null;
    const advertisementActive = isTverAdvertisementActive(video, state);
    if (advertisementActive) {
      const identity = mediaIdentity(video);
      const adMediaChanged = state.adVideo !== video || state.adIdentity !== identity;
      if (!state.adActive || adMediaChanged) {
        state.adActive = true;
        state.adVideo = video || null;
        state.adIdentity = identity;
        state.adEndedAt = 0;
        state.endCandidateAt = 0;
        state.lowQualitySet = false;
        state.playbackSettingsApplied = false;
        state.restartRequested = false;
        window.__homePanelTverAdActive = true;
        if (video) {
          try {
            video.defaultPlaybackRate = 1.0;
            if (video.playbackRate !== 1.0) video.playbackRate = 1.0;
          } catch (_) {
          }
        }
        try {
          const fullscreen = document.fullscreenElement ||
              document.webkitFullscreenElement || document.msFullscreenElement;
          const exitFullscreen = document.exitFullscreen ||
              document.webkitExitFullscreen || document.msExitFullscreen;
          if (fullscreen && typeof exitFullscreen === 'function') {
            const result = exitFullscreen.call(document);
            if (result && typeof result.catch === 'function') result.catch(() => {});
          }
        } catch (_) {
        }
      }
      window.__homePanelTverAdActive = true;
      return;
    }

    if (state.adActive) {
      state.adActive = false;
      state.adVideo = null;
      state.adIdentity = '';
      state.adEndedAt = 0;
      state.video = null;
      state.maxDuration = 0;
      state.maxTime = 0;
      state.endCandidateAt = 0;
      state.lowQualitySet = false;
      state.playbackSettingsApplied = false;
      state.fullscreenDirty = true;
      state.restartRequested = false;
    }
    window.__homePanelTverAdActive = false;

    if (state.video !== video) {
      state.video = video;
      state.lowQualitySet = false;
      state.playbackSettingsApplied = false;
      state.fullscreenDirty = true;
    }
    if (video && video.__homePanelTverRateGuardState !== state) {
      video.__homePanelTverRateGuardState = state;
      video.addEventListener('ratechange', () => {
        const activeState = window.__homePanelSakuraMeetsState;
        if (activeState !== state || activeState.adActive ||
            window.__homePanelTverAdActive) return;
        if (video.playbackRate !== playbackRate) {
          try {
            video.defaultPlaybackRate = playbackRate;
            video.playbackRate = playbackRate;
          } catch (_) {
          }
        }
      });
    }
)JS"
    LR"JS(

    if (video) {
      if (!state.playbackSettingsApplied) {
        try {
          video.defaultPlaybackRate = playbackRate;
          if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
          video.muted = false;
          if (video.volume === 0) video.volume = 1;
        } catch (_) {
        }
        state.playbackSettingsApplied = true;
      }
      if (Number.isFinite(video.duration)) {
        state.maxDuration = Math.max(state.maxDuration, video.duration);
      }
      if (Number.isFinite(video.currentTime)) {
        state.maxTime = Math.max(state.maxTime, video.currentTime);
      }
      if (video.__homePanelTverEndState !== state) {
        video.__homePanelTverEndState = state;
        video.addEventListener('ended', () => {
          if (window.__homePanelSakuraMeetsState === state && !state.adActive) {
            state.endCandidateAt = Date.now();
          }
        });
      }
      if (video.ended && !state.endCandidateAt) state.endCandidateAt = Date.now();
      if (state.endCandidateAt && !video.ended && !video.paused &&
          Number.isFinite(video.currentTime) && video.currentTime < 3) {
        state.endCandidateAt = 0;
      }
      const completedItem = state.maxDuration >= 5 &&
          state.maxTime >= Math.max(3, state.maxDuration - 10);
      const stableEndDelayMs = state.maxDuration < 600 ? 8000 : 2500;
      const stableEnd = state.endCandidateAt > 0 &&
          Date.now() - state.endCandidateAt >= stableEndDelayMs;
      if (stableEnd && completedItem) {
        if (advanceEpisodeOrSeries()) return;
        state.restartRequested = true;
        return;
      }
    }

    const stablePlayback = video && !video.paused && !video.ended &&
        state.lowQualitySet;
    if (stablePlayback) return;

    const controls = Array.from(document.querySelectorAll(
        'button, [role="button"], [role="menuitem"], [role="radio"], '
        + '[role="option"], li')).filter(isDisplayed);
    const qualityChoices = controls.filter(element =>
        /^(自動|高|中|低)$/.test(qualityName(element)));
    const qualityLabels = new Set(qualityChoices.map(qualityName));
    const lowOption = qualityChoices.find(element => qualityName(element) === '低') || null;
    const lowSelected = lowOption && (
        lowOption.getAttribute('aria-checked') === 'true' ||
        lowOption.getAttribute('aria-selected') === 'true' ||
        lowOption.getAttribute('data-state') === 'checked' ||
        /選択中|設定中/.test(labelOf(lowOption)));
    if (qualityLabels.size >= 3 && lowOption) {
      if (!lowSelected) {
        try { lowOption.click(); } catch (_) {}
      }
      state.lowQualitySet = true;
    } else {
      const currentQuality = qualityChoices.find(element =>
          /^(自動|高|中)$/.test(qualityName(element))) || null;
      if (currentQuality) {
        state.lowQualitySet = false;
        try { currentQuality.click(); } catch (_) {}
      } else if (lowOption) {
        state.lowQualitySet = true;
      }
    }

    const buttons = controls.filter(element =>
        element.matches('button, [role="button"]'));
    const playButton = buttons.find(button => {
      const label = labelOf(button).toLowerCase();
      return label === '再生' || label === '再生する' ||
             label === '動画を再生' || label === 'play' || label === 'play video';
    });
    if (video && video.paused && !video.ended) {
      if (playButton) playButton.click();
      try {
        const promise = video.play();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => { if (playButton) playButton.click(); });
        }
      } catch (_) {
        if (playButton) playButton.click();
      }
    } else if (!video && playButton) {
      playButton.click();
    }
  };

  const ensure = () => {
    try {
      if (location.hostname !== 'tver.jp') {
        location.replace('https://tver.jp' + storedSeriesPath());
      } else if (location.pathname.startsWith('/series/')) {
        openPreferredEpisode();
      } else if (location.pathname.startsWith('/episodes/')) {
        ensureEpisodePlayback();
      } else {
        location.replace('https://tver.jp' + storedSeriesPath());
      }
    } catch (_) {
    }
  };
  ensure();
  window.__homePanelSakuraMeetsLoopTimer = window.setInterval(ensure, 4000);
})()
)JS";

constexpr wchar_t kNativeMediaTverWatchdogStaticScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;
  const state = window.__homePanelSakuraMeetsState;
  if (state && state.restartRequested) return 'restart';
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.textContent || ''));
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };

  const controls = Array.from(document.querySelectorAll(
      'button, [role="button"], a'));
  const surveyClose = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (label !== '閉じる' && label !== 'close') return false;
    let scope = element;
    for (let depth = 0; scope && depth < 8;
         ++depth, scope = scope.parentElement) {
      const text = normalize(scope.textContent);
      if (/アンケート/.test(text) &&
          (/回答する/.test(text) || /誕生年|誕生月|性別/.test(text))) return true;
    }
    return false;
  });
  if (surveyClose) return point(surveyClose);

  if ((state && state.adActive) || window.__homePanelTverAdActive) return null;
  if (state && state.fullscreenDirty === false) return null;

  const video = Array.from(document.querySelectorAll('video')).find(visible) || null;
  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement || controls.some(element => {
        if (!visible(element)) return false;
        const label = labelOf(element).toLowerCase();
        return /全画面を終了|全画面解除|フルスクリーンを終了/.test(label) ||
               label.includes('exit fullscreen');
      });
  if (fullscreen) {
    if (state) state.fullscreenDirty = false;
    return null;
  }
  const fullscreenButton = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
  });
  return fullscreenButton ? point(fullscreenButton) : (video ? point(video) : null);
})()
)JS";

constexpr wchar_t kNativeMediaTverForceFullscreenAdSafeScript[] = LR"JS(
(() => {
  const state = window.__homePanelSakuraMeetsState;
  if ((state && state.adActive) || window.__homePanelTverAdActive) return;
  if (window.__homePanelTverFullscreenPending) return;
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(async () => {
    window.__homePanelTverFullscreenPending = false;
    try {
      const activeState = window.__homePanelSakuraMeetsState;
      if ((activeState && activeState.adActive) || window.__homePanelTverAdActive) return;
      if (document.fullscreenElement || document.webkitFullscreenElement ||
          document.msFullscreenElement) return;
      const visible = element => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
               rect.width > 0 && rect.height > 0;
      };
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos.find(visible) || videos[0] || null;
      if (!video) return;
      const candidates = [video, video.parentElement].filter(Boolean);
      for (const target of candidates) {
        const request = target.requestFullscreen || target.webkitRequestFullscreen ||
            target.msRequestFullscreen;
        if (typeof request !== 'function') continue;
        try {
          const result = request.call(target);
          if (result && typeof result.then === 'function') await result;
          if (document.fullscreenElement || document.webkitFullscreenElement ||
              document.msFullscreenElement) {
            if (activeState) activeState.fullscreenDirty = false;
            return;
          }
        } catch (_) {
        }
      }
    } catch (_) {
    }
  }, 180);
})()
)JS";
}  // namespace
