// Exceptional playlist-page fallback. Normal startup already resolves item 1 in
// the cloud; this path waits briefly for one rendered watch target, then returns
// to the cloud resolver.
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

  const go = href => {
    if (!href || done) return false;
    try {
      const url = new URL(href, location.href);
      if (!/^(www\.)?youtube\.com$/.test(url.hostname) ||
          url.pathname !== '/watch' || !url.searchParams.get('v')) return false;
      if (list) url.searchParams.set('list', list);
      done = true;
      location.assign(url.href);
      return true;
    } catch (_) { return false; }
  };
  const resolve = () => {
    if (done) return;
    const link = document.querySelector(
        'ytd-playlist-video-renderer a#thumbnail[href*="/watch"],'
        + 'ytd-playlist-video-renderer a#video-title[href*="/watch"]');
    go(link?.href);
  };

  document.addEventListener('yt-page-data-updated', resolve);
  document.addEventListener('yt-navigate-finish', resolve);
  resolve();
  setTimeout(() => {
    if (!done) location.assign(cloud);
  }, 7000);
  return true;
})()
)JS";
}  // namespace
