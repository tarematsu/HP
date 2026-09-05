void SpotifyWebViews::RecomputeForegroundAndRefreshSpotifyHostLayout() noexcept {
  RecomputeForeground();
  // Global foreground state can already be true because another Spotify slot
  // is recovering. Force a per-slot layout refresh as well so the target slot
  // is expanded before a recovery click is dispatched.
  RefreshSpotifyHostLayout();
}

UINT SpotifyWebViews::DispatchSpotifyDevToolsClick(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  try {
    if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow)) return 0;

    RECT client{};
    if (!GetClientRect(slot.hostWindow, &client)) return 0;
    const int width = client.right - client.left;
    const int height = client.bottom - client.top;
    if (width <= 1 || height <= 1) return 0;

    // CDP Input.dispatchMouseEvent consumes CSS viewport coordinates. WebView2
    // ZoomFactor changes the CSS viewport size without changing the host bounds,
    // so compensate here or a 80% zoom would shift trusted clicks up/left.
    double zoom = 1.0;
    if (slot.controller) {
      double controllerZoom = 1.0;
      if (SUCCEEDED(slot.controller->get_ZoomFactor(&controllerZoom)) &&
          controllerZoom > 0.05) {
        zoom = controllerZoom;
      }
    }
    const double cssWidth = static_cast<double>(width) / zoom;
    const double cssHeight = static_cast<double>(height) / zoom;
    const double rawX = cssWidth * xTenThousandths / 10000.0;
    const double rawY = cssHeight * yTenThousandths / 10000.0;
    const double x = std::max(0.0, std::min(cssWidth - 1.0, rawX));
    const double y = std::max(0.0, std::min(cssHeight - 1.0, rawY));

    const std::wstring pressed =
        L"{\"type\":\"mousePressed\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) +
        L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";

    ComPtr<ICoreWebView2> view = slot.webview;
    const HRESULT dispatched = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", pressed.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [view, x, y](HRESULT pressedResult, LPCWSTR) -> HRESULT {
              if (FAILED(pressedResult) || !view) return S_OK;
              const std::wstring released =
                  L"{\"type\":\"mouseReleased\",\"x\":" +
                  std::to_wstring(x) + L",\"y\":" + std::to_wstring(y) +
                  L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1}";
              view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", released.c_str(), nullptr);
              return S_OK;
            }).Get());
    return SUCCEEDED(dispatched) ? 1U : 0U;
  } catch (...) {
    return 0;
  }
}
