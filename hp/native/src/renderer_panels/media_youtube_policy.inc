// Static YouTube presentation policy. Startup, event wakeups and recovery live
// in focused modules; this file only keeps the dedicated player visually clean.
namespace {
constexpr wchar_t kNativeMediaYoutubeCleanPlayerScript[] = LR"JS(
(() => {
  if (location.hostname !== 'www.youtube.com' &&
      location.hostname !== 'youtube.com') return false;

  const mount = () => {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById('homepanel-youtube-clean-player')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'homepanel-youtube-clean-player';
    style.textContent = `
      #movie_player:not(.ad-showing):not(.ad-interrupting) > :not(.html5-video-container),
      #movie_player .html5-video-container > :not(video),
      #movie_player .ytp-chrome-top,
      #movie_player .ytp-chrome-bottom,
      #movie_player .ytp-gradient-top,
      #movie_player .ytp-gradient-bottom,
      #movie_player .ytp-title,
      #movie_player .ytp-fullscreen-quick-actions,
      #movie_player .ytp-overlay-top-left,
      #movie_player .ytp-overlay-bottom-right,
      #movie_player yt-player-overlay-video-details-renderer,
      #movie_player .ytp-pause-overlay,
      #movie_player .ytp-ce-element,
      #movie_player .ytp-cards-button,
      #movie_player .ytp-paid-content-overlay,
      #movie_player .ytp-watermark,
      #movie_player .annotation,
      #movie_player .ytp-fullscreen-grid,
      #movie_player .ytp-fullscreen-grid-stills-container,
      #movie_player .ytp-fullscreen-grid-expand-button,
      #movie_player .ytp-caption-window-container,
      #movie_player .ytp-tooltip,
      #movie_player .ytp-tooltip-text,
      #movie_player .ytp-tooltip-bg {
        opacity: 0 !important;
        transition: none !important;
        animation: none !important;
      }

      /* Keep only the functional Skip Ad affordance visible during ads. */
      #movie_player .ytp-ad-skip-button,
      #movie_player .ytp-ad-skip-button-modern,
      #movie_player .ytp-skip-ad-button,
      #movie_player .videoAdUiSkipButton,
      #movie_player .ytp-ad-skip-button-slot,
      #movie_player .ytp-ad-skip-button-container,
      #movie_player [class*="ytp-ad-skip"],
      #movie_player [aria-label*="Skip ad" i],
      #movie_player [aria-label*="Skip ads" i],
      #movie_player [aria-label*="広告をスキップ"],
      #movie_player [aria-label*="広告を飛ばす"] {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }

      #movie_player .ytp-share-button,
      #movie_player [aria-label="共有"],
      #movie_player [title="共有"],
      #movie_player [aria-label^="Share" i],
      #movie_player [title^="Share" i],
      ytd-unified-share-panel-renderer,
      tp-yt-paper-dialog:has(ytd-unified-share-panel-renderer) {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
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
