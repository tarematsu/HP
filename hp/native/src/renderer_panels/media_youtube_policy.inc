// Static presentation-only policy for the dedicated YouTube player.
namespace {
constexpr wchar_t kNativeMediaYoutubeCleanPlayerScript[] = LR"JS(
(() => {
  if (!/^(www\.)?youtube\.com$/.test(location.hostname)) return false;
  const mount = () => {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById('homepanel-youtube-clean-player')) return;
    const style = document.createElement('style');
    style.id = 'homepanel-youtube-clean-player';
    style.textContent = `
      ytd-watch-flexy #secondary,
      ytd-watch-flexy #below,
      ytd-watch-flexy #chat-container,
      ytd-watch-flexy #panels,
      ytd-watch-flexy #related,
      ytd-watch-flexy ytd-comments,
      ytd-masthead,
      ytd-mini-guide-renderer,
      ytd-guide-renderer {
        display:none !important;
      }

      #movie_player:not(.ad-showing):not(.ad-interrupting) > :not(.html5-video-container),
      #movie_player .html5-video-container > :not(video),
      #movie_player :is(.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom) {
        opacity:0 !important;
        transition:none !important;
        animation:none !important;
      }

      #movie_player :is(.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,
        .videoAdUiSkipButton,[class*="ytp-ad-skip"],[aria-label*="Skip ad" i],
        [aria-label*="広告をスキップ"],[aria-label*="広告を飛ばす"]) {
        opacity:1 !important;
        visibility:visible !important;
        pointer-events:auto !important;
      }

      #movie_player :is(.ytp-share-button,[aria-label="共有"],[aria-label^="Share" i]),
      ytd-unified-share-panel-renderer,
      tp-yt-paper-dialog:has(ytd-unified-share-panel-renderer) {
        display:none !important;
      }
    `;
    root.appendChild(style);
  };
  mount();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
  return true;
})()
)JS";
}  // namespace
