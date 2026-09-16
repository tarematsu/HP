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
    html { scroll-behavior: auto !important; }
    body { background: #000 !important; }

    [data-testid="global-nav-bar"],
    [data-testid="left-sidebar"],
    [data-testid="right-sidebar"],
    [data-testid="buddy-feed"],
    [data-testid="download-app"],
    [data-testid="upgrade-button"],
    [role="tooltip"] {
      display: none !important;
    }

    [data-testid*="skeleton"],
    [class*="Skeleton"],
    [class*="skeleton"],
    [class*="shimmer"] {
      animation: none !important;
      transition: none !important;
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
    }

    [data-testid="main-view-container"] {
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
    }

    ::-webkit-scrollbar { display: none !important; }
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
