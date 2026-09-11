// TVer episode-page watchdog. The page-local event policy owns ordinary state;
// this low-frequency fallback only performs trusted recovery actions. During ads
// it exposes Skip and fullscreen only; all other media/UI mutation is forbidden.
namespace {
constexpr wchar_t kNativeMediaTverPlaybackWatchdogPolicyScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;

  const episodeQueueKey = '__homePanelTverEpisodeQueue';
  const guardedEpisodePathKey = '__homePanelTverGuardedEpisodePath';
  const guardRestartKey = '__homePanelTverGuardRestart';
  const launcherParam = 'homepanel_launch';
  const directLaunch = new URLSearchParams(location.search).get(launcherParam) === '1';
  const normalizeEpisodeHref = href => {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'tver.jp' ||
          !/^\/episodes\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return '';
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (_) {
      return '';
    }
  };
  const requestRestart = () => {
    window[guardRestartKey] = true;
    return false;
  };
  const clearLauncherMarker = () => {
    if (!directLaunch) return;
    try {
      const url = new URL(location.href);
      url.searchParams.delete(launcherParam);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {}
  };
  const guardCloudEpisode = () => {
    if (window[guardedEpisodePathKey] === location.pathname) return true;

    let queue = null;
    try { queue = JSON.parse(sessionStorage.getItem(episodeQueueKey) || 'null'); }
    catch (_) {}
    const hrefs = queue && Array.isArray(queue.hrefs)
        ? queue.hrefs.map(normalizeEpisodeHref).filter(Boolean)
        : [];
    if (hrefs.some(href => {
      try { return new URL(href).pathname === location.pathname; }
      catch (_) { return false; }
    })) {
      clearLauncherMarker();
      window[guardRestartKey] = false;
      window[guardedEpisodePathKey] = location.pathname;
      return true;
    }

    if (!directLaunch) return requestRestart();
    const currentHref = normalizeEpisodeHref(location.href);
    if (!currentHref) return requestRestart();
    try {
      sessionStorage.setItem(
          episodeQueueKey, JSON.stringify({ hrefs: [currentHref], index: 0 }));
    } catch (_) {
      return requestRestart();
    }
    clearLauncherMarker();
    window[guardRestartKey] = false;
    window[guardedEpisodePathKey] = location.pathname;
    return true;
  };
  if (!guardCloudEpisode()) {
    return window[guardRestartKey] ? 'restart' : null;
  }
)JS"
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
    if (state) state.fullscreenDirty = true;
    const fullscreenButton = adControls.find(element => {
      if (!visible(element)) return false;
      const label = labelOf(element).toLowerCase();
      if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
      return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
    }) || null;
    return fullscreenButton ? point(fullscreenButton) : null;
  }

  if (state && state.restartRequested) return 'restart';

  // Survey discovery is relatively expensive and page-wide by necessity. Only
  // do it when playback is absent/paused; healthy playing content never scans
  // unrelated page dialogs.
  if (!video || video.paused) {
    const surveyRoots = Array.from(document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-testid*="survey" i], '
        + '[class*="survey" i], [class*="questionnaire" i]'));
    for (const root of surveyRoots) {
      if (!/(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
          normalize(root.textContent))) continue;
      const candidates = root.querySelectorAll(
          'button, [role="button"], a, [aria-label], [title]');
      for (const element of candidates) {
        if (!visible(element)) continue;
        if (/(?:閉じる|とじる|close|dismiss)/i.test(labelOf(element))) {
          return point(element);
        }
      }
    }
  }

  if (!video) return null;

  try {
    if (video.muted) video.muted = false;
    if (video.volume !== 1.0) video.volume = 1.0;
  } catch (_) {}

  let cachedPlayerControls = null;
  const playerControls = () => {
    if (cachedPlayerControls) return cachedPlayerControls;
    const root = playerRootFor(video);
    cachedPlayerControls = root ? Array.from(root.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]')) : [];
    return cachedPlayerControls;
  };
  const findPlayButton = () => playerControls().find(element => {
    if (!visible(element) || !element.matches('button, [role="button"]')) return false;
    const label = labelOf(element).toLowerCase();
    if (/(?:一時停止|pause)/i.test(label)) return false;
    return /(?:^|\s)(?:動画を)?再生(?:する)?(?:\s|$)/.test(label) ||
           /(?:^|\s)play(?: video)?(?:\s|$)/i.test(label);
  }) || null;

  if (video.paused && !video.ended) {
    if (video.__homePanelTverResumeBlocked) {
      video.__homePanelTverResumeBlocked = false;
      const playButton = findPlayButton();
      return playButton ? point(playButton) : null;
    }
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => {
          if (video.paused && !video.ended) {
            video.__homePanelTverResumeBlocked = true;
          }
        });
      }
    } catch (_) {
      video.__homePanelTverResumeBlocked = true;
    }
    return null;
  }
  video.__homePanelTverResumeBlocked = false;

  const browserFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement || document.msFullscreenElement;
  if (browserFullscreen) {
    if (state) state.fullscreenDirty = false;
    return null;
  }
  if (state) state.fullscreenDirty = true;

  const controls = playerControls();
  const exitFullscreenControl = controls.some(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    return /全画面を終了|全画面解除|フルスクリーンを終了/.test(label) ||
           label.includes('exit fullscreen');
  });
  if (exitFullscreenControl) {
    if (state) state.fullscreenDirty = false;
    return null;
  }
  const fullscreenButton = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
  });
  return fullscreenButton ? point(fullscreenButton) : point(video);
})()
)JS";

// Invoked immediately after a trusted TVer click. Ads are eligible because the
// only trusted ad clicks returned above are Skip or the fullscreen control.
constexpr wchar_t kNativeMediaTverForceFullscreenAnyMediaScript[] = LR"JS(
(() => {
  if (window.__homePanelTverFullscreenPending) return;
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(async () => {
    window.__homePanelTverFullscreenPending = false;
    try {
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
            const state = window.__homePanelSakuraMeetsState;
            if (state) state.fullscreenDirty = false;
            return;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, 180);
})()
)JS";
}  // namespace
