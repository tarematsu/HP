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

    img,
    picture {
      visibility: hidden !important;
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

void ConfigureSpotifyLightweightResourcePolicy(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  if (!environment || !webview || !alive) return;

  // Block images and downloadable fonts at WebView2's request layer for the
  // entire Spotify controller lifetime, including login/navigation. This is
  // deliberately independent of the current document URL so cached or early
  // requests cannot slip through during transitions. Playback/authentication
  // scripts, stylesheets, fetch/XHR, WebSockets and media remain untouched.
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);

  ComPtr<ICoreWebView2Environment> requestEnvironment = environment;
  EventRegistrationToken ignoredToken{};
  (void)webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [alive, requestEnvironment](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!alive->load(std::memory_order_acquire) || !args ||
                !requestEnvironment) {
              return S_OK;
            }

            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            if (FAILED(args->get_ResourceContext(&context)) ||
                (context != COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE &&
                 context != COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT)) {
              return S_OK;
            }

            ComPtr<ICoreWebView2WebResourceResponse> response;
            if (SUCCEEDED(requestEnvironment->CreateWebResourceResponse(
                    nullptr, 204, L"No Content",
                    L"Cache-Control: no-store\r\n", &response)) &&
                response) {
              args->put_Response(response.Get());
            }
            return S_OK;
          }).Get(),
      &ignoredToken);
}

}  // namespace
}  // namespace hp
