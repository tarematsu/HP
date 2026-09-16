namespace hp {
namespace {

constexpr wchar_t kSpotifyLightweightCssScript[] = LR"JS(
(() => {
  if (location.hostname !== 'open.spotify.com') return false;
  const styleId = 'homepanel-spotify-lightweight';
  if (document.getElementById(styleId)) return true;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    html, body {
      scroll-behavior: auto !important;
    }

    body {
      background: #000 !important;
    }

    *, *::before, *::after {
      animation: none !important;
      animation-play-state: paused !important;
      transition: none !important;
      scroll-behavior: auto !important;
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      text-shadow: none !important;
      will-change: auto !important;
      view-transition-name: none !important;
    }

    [data-testid="global-nav-bar"],
    [data-testid="left-sidebar"],
    [data-testid="right-sidebar"],
    [data-testid="buddy-feed"],
    [data-testid="download-app"],
    [data-testid="upgrade-button"],
    [data-testid="topbar"],
    [data-testid="breadcrumbs"],
    [data-testid="user-widget-link"],
    [data-testid="context-menu"],
    [data-testid="popover"],
    [role="tooltip"],
    picture,
    img,
    canvas,
    [data-testid="tracklist-row"],
    [data-testid*="recommendation" i],
    [data-testid*="related" i],
    [data-testid*="promo" i],
    [data-testid*="banner" i],
    [data-testid*="skeleton" i],
    [class*="Skeleton"],
    [class*="skeleton"],
    [class*="shimmer"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      content-visibility: hidden !important;
      contain: strict !important;
    }

    [data-testid="main-view-container"] {
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
    }

    ::-webkit-scrollbar {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  return true;
})()
)JS";

void ApplySpotifyLightweightCss(ICoreWebView2* webview) noexcept {
  if (!webview) return;
  (void)webview->ExecuteScript(kSpotifyLightweightCssScript, nullptr);
}

}  // namespace
}  // namespace hp
