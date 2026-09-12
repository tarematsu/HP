// Exceptional fallback for YouTube playlist startup. Normal startup is resolved
// in the cloud and lands directly on /watch. If the cloud cannot resolve the
// playlist, install one page-local event agent that waits for item 1 without
// periodic native polling or layout-dependent clicks.
namespace {
constexpr wchar_t kNativeMediaYoutubeReliablePlayAllScript[] = LR"JS(
(() => {
  if (location.hostname !== 'www.youtube.com' &&
      location.hostname !== 'youtube.com') return null;
  if (!location.pathname.startsWith('/playlist')) return null;
  if (window.__homePanelYoutubePlaylistFallbackInstalled) return true;
  window.__homePanelYoutubePlaylistFallbackInstalled = true;

  let referrerMeta = document.querySelector('meta[name="referrer"]');
  if (!referrerMeta) {
    referrerMeta = document.createElement('meta');
    referrerMeta.name = 'referrer';
    (document.head || document.documentElement).appendChild(referrerMeta);
  }
  referrerMeta.content = 'no-referrer';

  const playlistId = new URL(location.href).searchParams.get('list') || '';
  const cloudResolver =
      'https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start';
  let finished = false;
  let observer = null;
  let fallbackTimer = 0;

  const cleanup = () => {
    try { observer?.disconnect(); } catch (_) {}
    observer = null;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = 0;
    }
    document.removeEventListener('yt-page-data-updated', onYoutubeData);
    document.removeEventListener('yt-navigate-finish', onYoutubeData);
  };
  const navigateNoReferrer = href => {
    if (!href || finished) return false;
    finished = true;
    cleanup();
    try {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.referrerPolicy = 'no-referrer';
      anchor.rel = 'noreferrer';
      anchor.style.display = 'none';
      (document.body || document.documentElement).appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch (_) {
      finished = false;
      return false;
    }
  };
  const normalizeWatchHref = href => {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      if (url.hostname !== 'www.youtube.com' && url.hostname !== 'youtube.com') {
        return '';
      }
      if (url.pathname !== '/watch' || !url.searchParams.get('v')) return '';
      if (playlistId) url.searchParams.set('list', playlistId);
      return url.href;
    } catch (_) {
      return '';
    }
  };
  const navigateVideoId = videoId => {
    if (!videoId || typeof videoId !== 'string') return false;
    try {
      const url = new URL('/watch', location.origin);
      url.searchParams.set('v', videoId);
      if (playlistId) url.searchParams.set('list', playlistId);
      return navigateNoReferrer(url.href);
    } catch (_) {
      return false;
    }
  };

  const watchSelector = [
    'ytd-playlist-video-renderer a#thumbnail[href*="/watch"]',
    'ytd-playlist-video-renderer a#video-title[href*="/watch"]',
    'ytd-playlist-video-renderer a[href*="/watch"]'
  ].join(',');
  const tryDomRoot = root => {
    if (!root || finished) return false;
    const candidates = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(watchSelector)) {
      candidates.push(root);
    }
    if (root.querySelectorAll) {
      for (const element of root.querySelectorAll(watchSelector)) {
        candidates.push(element);
      }
    }
    for (const element of candidates) {
      const href = normalizeWatchHref(element.href);
      if (href && navigateNoReferrer(href)) return true;
    }
    return false;
  };

  let lastInitialData = null;
  const tryInitialData = force => {
    if (finished || !window.ytInitialData) return false;
    if (!force && lastInitialData === window.ytInitialData) return false;
    lastInitialData = window.ytInitialData;
    try {
      const stack = [window.ytInitialData];
      let visited = 0;
      while (stack.length && visited < 5000) {
        const node = stack.pop();
        ++visited;
        if (!node || typeof node !== 'object') continue;
        const renderer = node.playlistVideoRenderer ||
            node.playlistPanelVideoRenderer || null;
        if (renderer && navigateVideoId(renderer.videoId)) return true;
        const values = Object.values(node);
        for (let index = values.length - 1; index >= 0; --index) {
          const value = values[index];
          if (value && typeof value === 'object') stack.push(value);
        }
      }
    } catch (_) {}
    return false;
  };

  const bindPlaylistObserver = () => {
    if (finished || observer || typeof MutationObserver !== 'function') return;
    const root = document.querySelector(
        'ytd-playlist-video-list-renderer, ytd-browse[page-subtype="playlist"], ytd-browse');
    if (!root) return;
    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (tryDomRoot(node)) return;
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  };

  function onYoutubeData() {
    if (finished) return;
    if (tryDomRoot(document)) return;
    if (tryInitialData(true)) return;
    bindPlaylistObserver();
  }

  document.addEventListener('yt-page-data-updated', onYoutubeData);
  document.addEventListener('yt-navigate-finish', onYoutubeData);

  // One initial pass handles an already-hydrated playlist. After this point,
  // only YouTube events / player-local DOM additions can trigger discovery.
  if (!tryDomRoot(document) && !tryInitialData(true)) {
    bindPlaylistObserver();
    fallbackTimer = window.setTimeout(() => {
      if (!finished) navigateNoReferrer(cloudResolver);
    }, 7000);
  }
  return true;
})()
)JS";
}  // namespace
