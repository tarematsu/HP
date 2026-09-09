UINT SpotifyWebViews::DispatchSpotifyDevToolsClick(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  try {
    if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow)) return 0;

    constexpr ULONGLONG kSpotifyTrustedClickStaleMs = 8ULL * 1000ULL;
    const ULONGLONG now = GetTickCount64();
    if (slot.trustedClickInFlight) {
      if (slot.trustedClickStartTick != 0 &&
          now - slot.trustedClickStartTick < kSpotifyTrustedClickStaleMs) {
        return 0;
      }
      // A lost CDP callback must not permanently block recovery. The new click
      // generation below also makes every callback from this stale attempt inert.
      slot.trustedClickInFlight = false;
      slot.trustedClickStartTick = 0;
    }

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

    // Spotify reveals/replaces row play controls on hover. Keep the complete
    // move -> press -> release sequence single-flight per account so a delayed
    // CDP response cannot overlap a later recovery click and toggle playback
    // back to pause.
    const std::wstring moved =
        L"{\"type\":\"mouseMoved\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) + L"}";

    ++slot.trustedClickGeneration;
    if (slot.trustedClickGeneration == 0) ++slot.trustedClickGeneration;
    const ULONGLONG clickGeneration = slot.trustedClickGeneration;
    slot.trustedClickInFlight = true;
    slot.trustedClickStartTick = now;
    Slot* const target = &slot;
    const auto alive = alive_;
    ComPtr<ICoreWebView2> view = slot.webview;
    const HRESULT dispatched = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [alive, target, view, x, y, clickGeneration](
                HRESULT movedResult, LPCWSTR) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  target->trustedClickGeneration != clickGeneration) {
                return S_OK;
              }
              if (FAILED(movedResult) || !view) {
                target->trustedClickInFlight = false;
                target->trustedClickStartTick = 0;
                return S_OK;
              }

              const std::wstring pressed =
                  L"{\"type\":\"mousePressed\",\"x\":" +
                  std::to_wstring(x) + L",\"y\":" + std::to_wstring(y) +
                  L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";
              const HRESULT pressDispatched = view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", pressed.c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [alive, target, view, x, y, clickGeneration](
                          HRESULT pressedResult, LPCWSTR) -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) ||
                            target->trustedClickGeneration != clickGeneration) {
                          return S_OK;
                        }
                        if (FAILED(pressedResult) || !view) {
                          target->trustedClickInFlight = false;
                          target->trustedClickStartTick = 0;
                          return S_OK;
                        }
                        const std::wstring released =
                            L"{\"type\":\"mouseReleased\",\"x\":" +
                            std::to_wstring(x) + L",\"y\":" +
                            std::to_wstring(y) +
                            L",\"button\":\"left\",\"buttons\":0,"
                            L"\"clickCount\":1}";
                        const HRESULT releaseDispatched =
                            view->CallDevToolsProtocolMethod(
                                L"Input.dispatchMouseEvent", released.c_str(),
                                Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                                    [alive, target, clickGeneration](
                                        HRESULT, LPCWSTR) -> HRESULT {
                                      if (!alive->load(std::memory_order_acquire) ||
                                          target->trustedClickGeneration !=
                                              clickGeneration) {
                                        return S_OK;
                                      }
                                      target->trustedClickInFlight = false;
                                      target->trustedClickStartTick = 0;
                                      return S_OK;
                                    }).Get());
                        if (FAILED(releaseDispatched) &&
                            target->trustedClickGeneration == clickGeneration) {
                          target->trustedClickInFlight = false;
                          target->trustedClickStartTick = 0;
                        }
                        return S_OK;
                      }).Get());
              if (FAILED(pressDispatched) &&
                  target->trustedClickGeneration == clickGeneration) {
                target->trustedClickInFlight = false;
                target->trustedClickStartTick = 0;
              }
              return S_OK;
            }).Get());
    if (FAILED(dispatched)) {
      if (slot.trustedClickGeneration == clickGeneration) {
        slot.trustedClickInFlight = false;
        slot.trustedClickStartTick = 0;
      }
      return 0;
    }
    return 1U;
  } catch (...) {
    slot.trustedClickInFlight = false;
    slot.trustedClickStartTick = 0;
    return 0;
  }
}
