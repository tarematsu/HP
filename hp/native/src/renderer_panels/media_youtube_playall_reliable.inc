// Exceptional playlist-page fallback. Normal startup already resolves item 1 in
// the cloud; this path only waits for one usable watch target and then exits.
namespace {
constexpr wchar_t kNativeMediaYoutubeReliablePlayAllScript[] = LR"JS(
(() => {
  if (!/^(www\.)?youtube\.com$/.test(location.hostname) ||
      !location.pathname.startsWith('/playlist') ||
      window.__homePanelYoutubePlaylistFallbackInstalled) return null;
  window.__homePanelYoutubePlaylistFallbackInstalled = true;

  const list = new URL(location.href).searchParams.get('list') || '';
  const cloud =
      'https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start';
  let done = false;
  let observer = null;

  let meta = document.querySelector('meta[name="referrer"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'referrer';
    (document.head || document.documentElement).appendChild(meta);
  }
  meta.content = 'no-referrer';

  const cleanup = () => {
    observer?.disconnect();
    document.removeEventListener('yt-page-data-updated', resolve);
    document.removeEventListener('yt-navigate-finish', resolve);
  };
  const go = href => {
    if (!href || done) return false;
    try {
      const url = new URL(href, location.href);
      if (!/^(www\.)?youtube\.com$/.test(url.hostname) ||
          url.pathname !== '/watch' || !url.searchParams.get('v')) return false;
      if (list) url.searchParams.set('list', list);
      done = true;
      cleanup();
      const anchor = document.createElement('a');
      anchor.href = url.href;
      anchor.referrerPolicy = 'no-referrer';
      anchor.rel = 'noreferrer';
      (document.body || document.documentElement).appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch (_) {
      return false;
    }
  };
  const firstVideoId = root => {
    const stack = [root];
    let visited = 0;
    while (stack.length && visited++ < 2500) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const renderer =
          node.playlistVideoRenderer || node.playlistPanelVideoRenderer;
      if (renderer?.videoId) return renderer.videoId;
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
    return '';
  };
  function resolve() {
    const link = document.querySelector(
        'ytd-playlist-video-renderer a#thumbnail[href*="/watch"],'
        + 'ytd-playlist-video-renderer a#video-title[href*="/watch"]');
    if (go(link?.href)) return;
    const videoId = firstVideoId(window.ytInitialData);
    if (videoId) go(`/watch?v=${encodeURIComponent(videoId)}`);
  }

  document.addEventListener('yt-page-data-updated', resolve);
  document.addEventListener('yt-navigate-finish', resolve);
  resolve();
  if (!done && typeof MutationObserver === 'function') {
    const root = document.querySelector(
        'ytd-playlist-video-list-renderer,ytd-browse[page-subtype="playlist"],ytd-browse');
    if (root) {
      observer = new MutationObserver(resolve);
      observer.observe(root, { childList: true, subtree: true });
    }
  }
  window.setTimeout(() => {
    if (!done) location.assign(cloud);
  }, 7000);
  return true;
})()
)JS";
}  // namespace
