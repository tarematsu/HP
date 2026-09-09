// TVer episode-page policy. This script owns dismissing blocking survey UI on
// an episode page, recovering playback without toggle races, restart signaling,
// and fullscreen entry. Series navigation lives in media_tver_series_policy.inc.
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
  const guardSeriesEpisode = () => {
    // A successful guard is document-local. The queue cannot legitimately drop
    // the current episode without a navigation, so avoid reparsing JSON every
    // four-second watchdog pass on the steady path.
    if (window[guardedEpisodePathKey] === location.pathname) return true;

    let seriesPath = '';
    try { seriesPath = sessionStorage.getItem(seriesPathKey) || ''; }
    catch (_) {}
    if (!/^\/series\/[a-zA-Z0-9]+$/.test(seriesPath)) {
      location.replace('https://tver.jp/series/srx97ftk3w');
      return false;
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
      try { sessionStorage.removeItem(pendingKey); } catch (_) {}
      const currentAllowed = hrefs.some(href => {
        try { return new URL(href).pathname === location.pathname; }
        catch (_) { return false; }
      });
      if (currentAllowed) {
        window[guardedEpisodePathKey] = location.pathname;
        return true;
      }
      location.replace('https://tver.jp' + seriesPath);
      return false;
    }

    let acceptNextEpisode = false;
    try {
      acceptNextEpisode = sessionStorage.getItem(pendingKey) === '1';
      sessionStorage.removeItem(pendingKey);
    } catch (_) {
    }
    const currentHref = normalizeEpisodeHref(location.href);
    if (acceptNextEpisode && currentHref) {
      try {
        sessionStorage.setItem(
            key, JSON.stringify({ hrefs: [currentHref], index: 0 }));
      } catch (_) {
      }
      window[guardedEpisodePathKey] = location.pathname;
      return true;
    }

    location.replace('https://tver.jp' + seriesPath);
    return false;
  };
  if (!guardSeriesEpisode()) return null;

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

  // Survey detection is intentionally bounded to modal/survey roots. The old
  // policy enumerated every button/link on the TVer document every four seconds,
  // which produced visible CPU peaks on low-end devices.
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

  const state = window.__homePanelSakuraMeetsState;
  if (state && state.restartRequested) return 'restart';
  if ((state && state.adActive) || window.__homePanelTverAdActive) return null;

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

  // Recovery is idempotent first: play() can only move a paused video toward
  // playback. Only build the player-control list after a rejected play() or when
  // no video exists, keeping the common healthy pass small.
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

  // Playback recovery takes precedence over fullscreen. Once stable playback is
  // confirmed, a clean fullscreen state exits before any player-control scan.
  if (state && state.fullscreenDirty === false) return null;
  const browserFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement || document.msFullscreenElement;
  if (browserFullscreen) {
    if (state) state.fullscreenDirty = false;
    return null;
  }

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
  return fullscreenButton ? point(fullscreenButton) : null;
})()
)JS";
}  // namespace
