// TVer episode-page policy. This script owns dismissing blocking survey UI on
// an episode page, recovering program playback without toggle races, restart
// signaling, and fullscreen entry. During ads it only exposes Skip and
// fullscreen actions; all other media/UI mutations are left to TVer.
namespace {
constexpr wchar_t kNativeMediaTverPlaybackWatchdogPolicyScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;

  const seriesPathKey = '__homePanelTverSeriesPath';
  const episodeQueueKey = seriesPath => '__homePanelTverEpisodeQueue:' + seriesPath;
  const pendingEpisodeKey = seriesPath =>
      '__homePanelTverAcceptNextEpisode:' + seriesPath;
  const guardedEpisodePathKey = '__homePanelTverGuardedEpisodePath';
  const guardRestartKey = '__homePanelTverGuardRestart';
  const launcherParam = 'homepanel_launch';
  const directLaunch = new URLSearchParams(location.search).get(launcherParam) === '1';
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
    } catch (_) {
    }
  };
  const guardSeriesEpisode = () => {
    if (window[guardedEpisodePathKey] === location.pathname) return true;

    let seriesPath = '';
    try { seriesPath = sessionStorage.getItem(seriesPathKey) || ''; }
    catch (_) {}
    if (!/^\/series\/[a-zA-Z0-9]+$/.test(seriesPath)) {
      if (!directLaunch) return requestRestart();
      seriesPath = '/series/srx97ftk3w';
      try { sessionStorage.setItem(seriesPathKey, seriesPath); }
      catch (_) { return requestRestart(); }
    }

    const key = episodeQueueKey(seriesPath);
    const pendingKey = pendingEpisodeKey(seriesPath);
    let queue = null;
    try { queue = JSON.parse(sessionStorage.getItem(key) || 'null'); }
    catch (_) {}
    const hrefs = queue && Array.isArray(queue.hrefs)
        ? queue.hrefs.map(normalizeEpisodeHref).filter(Boolean)
        : [];
    if (hrefs.length) {
      const currentAllowed = hrefs.some(href => {
        try { return new URL(href).pathname === location.pathname; }
        catch (_) { return false; }
      });
      if (currentAllowed) {
        try { sessionStorage.removeItem(pendingKey); } catch (_) {}
        clearLauncherMarker();
        window[guardRestartKey] = false;
        window[guardedEpisodePathKey] = location.pathname;
        return true;
      }
      if (!directLaunch) return requestRestart();
    }

    let acceptNextEpisode = false;
    try {
      acceptNextEpisode = sessionStorage.getItem(pendingKey) === '1';
      sessionStorage.removeItem(pendingKey);
    } catch (_) {
    }
    if (!directLaunch && !acceptNextEpisode) return requestRestart();

    clearLauncherMarker();
    const currentHref = normalizeEpisodeHref(location.href);
    if (!currentHref) return requestRestart();
    try {
      sessionStorage.setItem(
          key, JSON.stringify({ hrefs: [currentHref], index: 0 }));
    } catch (_) {
      return requestRestart();
    }
    window[guardRestartKey] = false;
    window[guardedEpisodePathKey] = location.pathname;
    return true;
  };
  if (!guardSeriesEpisode()) {
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
    if (!media) return document.body || document.documentElement;
    let root = media.parentElement;
    let best = root || media;
    for (let depth = 0; root && root !== document.body && depth < 5; ++depth) {
      best = root;
      root = root.parentElement;
    }
    return best || document.body || document.documentElement;
  };

  const state = window.__homePanelSakuraMeetsState;
  const adActive = (state && state.adActive) || window.__homePanelTverAdActive;
  if (adActive) {
    // During ads the watchdog may only click Skip or the fullscreen control.
    // Keep lookup inside the active player; if no media exists, do nothing.
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

  const surveyRoots = Array.from(document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [data-testid*="survey" i], '
      + '[class*="survey" i], [class*="questionnaire" i]'));
  const surveyClose = (() => {
    for (const root of surveyRoots) {
      if (!/(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
          normalize(root.textContent))) continue;
      const candidates = root.querySelectorAll(
          'button, [role="button"], a, [aria-label], [title]');
      for (const element of candidates) {
        if (!visible(element)) continue;
        if (/(?:閉じる|とじる|close|dismiss)/i.test(labelOf(element))) {
          return element;
        }
      }
    }
    return null;
  })();
  if (surveyClose) return point(surveyClose);

  if (state && state.restartRequested) return 'restart';

  if (video) {
    try {
      if (video.muted) video.muted = false;
      if (video.volume !== 1.0) video.volume = 1.0;
    } catch (_) {
    }
  }

  let cachedPlayerControls = null;
  const playerControls = () => {
    if (cachedPlayerControls) return cachedPlayerControls;
    const root = playerRootFor(video);
    cachedPlayerControls = Array.from(root.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]'));
    return cachedPlayerControls;
  };
  const findPlayButton = () => playerControls().find(element => {
    if (!visible(element) || !element.matches('button, [role="button"]')) return false;
    const label = labelOf(element).toLowerCase();
    if (/(?:一時停止|pause)/i.test(label)) return false;
    return /(?:^|\s)(?:動画を)?再生(?:する)?(?:\s|$)/.test(label) ||
           /(?:^|\s)play(?: video)?(?:\s|$)/i.test(label);
  }) || null;
)JS"
LR"JS(

  if (!video) {
    const playButton = findPlayButton();
    return playButton ? point(playButton) : null;
  }
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
        } catch (_) {
        }
      }
    } catch (_) {
    }
  }, 180);
})()
)JS";
}  // namespace
