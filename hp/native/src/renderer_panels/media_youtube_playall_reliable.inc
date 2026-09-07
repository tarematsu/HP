// Reliable YouTube playlist startup. The visible Play all control is not a
// stable API and can be delayed or reshaped by YouTube experiments, so startup
// navigates the first item while preserving the playlist context. Returning
// null intentionally keeps the native 500 ms probe alive until navigation to
// /watch completes.
namespace {
constexpr wchar_t kNativeMediaYoutubeReliablePlayAllScript[] = LR"JS(
(() => {
  if (location.hostname !== 'www.youtube.com' &&
      location.hostname !== 'youtube.com') return null;
  if (!location.pathname.startsWith('/playlist')) return null;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const playlistId = new URL(location.href).searchParams.get('list') || '';
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
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

  // The playlist item link is materially more stable than the Play all button.
  // Starting item 1 with the same list parameter has the same playback result.
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

  // During very early rendering the item list may not exist yet. Nudge the
  // semantic Play all control if it is already present, but never treat finding
  // its coordinates as success; the native probe keeps retrying until /watch.
  const textOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent
  ].filter(Boolean).join(' '));
  const playAll = Array.from(document.querySelectorAll(
      'button, a, tp-yt-paper-button, yt-button-shape button, [role="button"]'))
      .find(element => {
        if (!visible(element)) return false;
        const text = textOf(element);
        return /(?:^|\s)(?:すべて再生(?:する)?|全て再生(?:する)?)(?:\s|$|[:：])/i
                   .test(text) ||
               /(?:^|\s)play all(?:\s|$|[:：])/i.test(text);
      }) || null;
  if (playAll) {
    try { playAll.click(); } catch (_) {}
  }
  return null;
})()
)JS";
}  // namespace
