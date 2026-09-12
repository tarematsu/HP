// Exceptional fallback for YouTube playlist startup. Normal startup is resolved
// in the cloud and lands directly on /watch. If the cloud cannot resolve the
// playlist, this page-local fallback navigates item 1 without clicking Play all.
namespace {
constexpr wchar_t kNativeMediaYoutubeReliablePlayAllScript[] = LR"JS(
(() => {
  if (location.hostname !== 'www.youtube.com' &&
      location.hostname !== 'youtube.com') return null;
  if (!location.pathname.startsWith('/playlist')) return null;

  const playlistId = new URL(location.href).searchParams.get('list') || '';
  const startupState = window.__homePanelYoutubePlaylistStartupState ||
      (window.__homePanelYoutubePlaylistStartupState = {
        since: Date.now(),
        initialDataScanAt: 0,
      });
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
      location.assign(url.href);
      return true;
    } catch (_) {
      return false;
    }
  };

  const firstItem = Array.from(document.querySelectorAll(
      'ytd-playlist-video-renderer a#thumbnail[href*="/watch"], '
      + 'ytd-playlist-video-renderer a#video-title[href*="/watch"], '
      + 'ytd-playlist-video-renderer a[href*="/watch"]'))
      .find(element => normalizeWatchHref(element.href));
  if (firstItem) {
    const href = normalizeWatchHref(firstItem.href);
    if (href) {
      location.assign(href);
      return null;
    }
  }

  const now = Date.now();
  if (window.ytInitialData &&
      now - Number(startupState.initialDataScanAt || 0) >= 1500) {
    startupState.initialDataScanAt = now;
    try {
      const stack = [window.ytInitialData];
      let visited = 0;
      while (stack.length && visited < 5000) {
        const node = stack.pop();
        ++visited;
        if (!node || typeof node !== 'object') continue;
        const renderer = node.playlistVideoRenderer ||
            node.playlistPanelVideoRenderer || null;
        if (renderer && navigateVideoId(renderer.videoId)) return null;
        const values = Object.values(node);
        for (let index = values.length - 1; index >= 0; --index) {
          const value = values[index];
          if (value && typeof value === 'object') stack.push(value);
        }
      }
    } catch (_) {}
  }

  // Never press a layout-dependent Play all control. If this exceptional
  // fallback page cannot expose item 1, return to the cloud resolver before the
  // native fixed-coordinate legacy backstop can fire.
  if (now - Number(startupState.since || now) >= 7000) {
    location.assign(
        'https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start');
  }
  return null;
})()
)JS";
}  // namespace
