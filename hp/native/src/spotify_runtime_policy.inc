namespace hp {
namespace {

constexpr LONG kSpotifyInternalViewportWidth = 720;
constexpr LONG kSpotifyInternalViewportHeight = 480;

RECT SpotifyFixedViewportBounds() noexcept {
  return RECT{0, 0, kSpotifyInternalViewportWidth,
              kSpotifyInternalViewportHeight};
}

RECT SpotifyControllerBounds(HWND hostWindow, bool authentication) noexcept {
  if (authentication && hostWindow && IsWindow(hostWindow)) {
    RECT client{};
    if (GetClientRect(hostWindow, &client) &&
        client.right > client.left && client.bottom > client.top) {
      return client;
    }
  }
  return SpotifyFixedViewportBounds();
}

void SetSpotifyMemoryUsageTarget(
    ICoreWebView2* webview,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL level) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2> baseWebView = webview;
  ComPtr<ICoreWebView2_19> webview19;
  if (SUCCEEDED(baseWebView.As(&webview19)) && webview19) {
    (void)webview19->put_MemoryUsageTargetLevel(level);
  }
}

}  // namespace
}  // namespace hp
