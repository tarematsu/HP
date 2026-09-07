// WebView2 pointer input used while the dashboard HWND is hidden by power saving.
// The native media panel stays alive, so input is dispatched directly to WebView2
// without moving the real Windows cursor or depending on a visible top-level HWND.
namespace {
constexpr UINT kNativeMediaTrustedWakeIntervalMs = 350U;
constexpr UINT kNativeMediaTrustedWakeAttempts = 10U;
HWND gNativeMediaTrustedWakeWindow = nullptr;
ComPtr<ICoreWebView2> gNativeMediaTrustedWakeWebView;
ComPtr<ICoreWebView2Controller> gNativeMediaTrustedWakeController;
UINT gNativeMediaTrustedWakeCount = 0;
UINT gNativeMediaTrustedSteadyIntervalMs = 4000U;

std::wstring NativeMediaTrustedMouseParams(
    const wchar_t* type, double x, double y, bool pressed) {
  std::wstring params = L"{\"type\":\"";
  params += type;
  params += L"\",\"x\":" + std::to_wstring(x) +
            L",\"y\":" + std::to_wstring(y);
  if (pressed) {
    params += L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1";
  } else if (std::wstring_view(type) == L"mouseReleased") {
    params += L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1";
  }
  params += L"}";
  return params;
}

double NativeMediaTrustedCssScale(
    ICoreWebView2Controller* controller, HWND hostWindow) noexcept {
  double rasterizationScale = 1.0;
  bool haveRasterizationScale = false;
  try {
    ComPtr<ICoreWebView2Controller> controllerView = controller;
    ComPtr<ICoreWebView2Controller3> controller3;
    if (controllerView && SUCCEEDED(controllerView.As(&controller3)) &&
        controller3) {
      double candidate = 1.0;
      if (SUCCEEDED(controller3->get_RasterizationScale(&candidate)) &&
          candidate > 0.01) {
        rasterizationScale = candidate;
        haveRasterizationScale = true;
      }
    }
  } catch (...) {
  }
  if (!haveRasterizationScale && hostWindow && IsWindow(hostWindow)) {
    const UINT dpi = GetDpiForWindow(hostWindow);
    if (dpi > 0) rasterizationScale = static_cast<double>(dpi) / 96.0;
  }

  double zoomFactor = 1.0;
  try {
    if (controller) {
      double candidate = 1.0;
      if (SUCCEEDED(controller->get_ZoomFactor(&candidate)) && candidate > 0.01) {
        zoomFactor = candidate;
      }
    }
  } catch (...) {
  }
  return std::max(0.01, rasterizationScale * zoomFactor);
}

void NativeMediaDispatchTrustedMove(
    ICoreWebView2* webview, double x, double y) noexcept {
  if (!webview) return;
  try {
    const std::wstring moved =
        NativeMediaTrustedMouseParams(L"mouseMoved", x, y, false);
    webview->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(), nullptr);
  } catch (...) {
  }
}

bool NativeMediaDecodeAbsolutePoint(
    HWND hostWindow, UINT count, LPINPUT inputs, POINT* point) noexcept {
  if (!hostWindow || !IsWindow(hostWindow) || !inputs || !point || count < 1 ||
      inputs[0].type != INPUT_MOUSE ||
      (inputs[0].mi.dwFlags & MOUSEEVENTF_ABSOLUTE) == 0) {
    return false;
  }
  const int virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (virtualWidth <= 1 || virtualHeight <= 1) return false;
  POINT target{
      virtualLeft + static_cast<LONG>(
          (static_cast<long long>(inputs[0].mi.dx) * (virtualWidth - 1)) /
          65535LL),
      virtualTop + static_cast<LONG>(
          (static_cast<long long>(inputs[0].mi.dy) * (virtualHeight - 1)) /
          65535LL)};
  if (!ScreenToClient(hostWindow, &target)) return false;
  RECT client{};
  if (!GetClientRect(hostWindow, &client) || client.right <= client.left ||
      client.bottom <= client.top) {
    return false;
  }
  target.x = std::max(client.left, std::min(client.right - 1, target.x));
  target.y = std::max(client.top, std::min(client.bottom - 1, target.y));
  *point = target;
  return true;
}

UINT NativeMediaDispatchTrustedInput(
    bool tver, ICoreWebView2* webview, ICoreWebView2Controller* controller,
    HWND hostWindow, UINT count, LPINPUT inputs, int inputSize) noexcept {
  if (!webview || inputSize != static_cast<int>(sizeof(INPUT))) return 0;
  POINT point{};
  if (!NativeMediaDecodeAbsolutePoint(hostWindow, count, inputs, &point)) return 0;
  try {
    ComPtr<ICoreWebView2> view = webview;
    const double cssScale = NativeMediaTrustedCssScale(controller, hostWindow);
    const double x = static_cast<double>(point.x) / cssScale;
    const double y = static_cast<double>(point.y) / cssScale;
    const std::wstring moved =
        NativeMediaTrustedMouseParams(L"mouseMoved", x, y, false);
    const HRESULT dispatched = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [view, tver, x, y](HRESULT moveResult, LPCWSTR) -> HRESULT {
              if (FAILED(moveResult) || !view) return S_OK;
              const std::wstring pressed =
                  NativeMediaTrustedMouseParams(L"mousePressed", x, y, true);
              view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", pressed.c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [view, tver, x, y](
                          HRESULT pressedResult, LPCWSTR) -> HRESULT {
                        if (FAILED(pressedResult) || !view) return S_OK;
                        const std::wstring released = NativeMediaTrustedMouseParams(
                            L"mouseReleased", x, y, false);
                        view->CallDevToolsProtocolMethod(
                            L"Input.dispatchMouseEvent", released.c_str(),
                            Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                                [view, tver](HRESULT releaseResult,
                                             LPCWSTR) -> HRESULT {
                                  if (tver && SUCCEEDED(releaseResult) && view) {
                                    view->ExecuteScript(
                                        kNativeMediaTverForceFullscreenAdSafeScript,
                                        nullptr);
                                  }
                                  return S_OK;
                                }).Get());
                        return S_OK;
                      }).Get());
              return S_OK;
            }).Get());
    return SUCCEEDED(dispatched) ? count : 0;
  } catch (...) {
    return 0;
  }
}

void NativeMediaTrustedWake(
    HWND hwnd, ICoreWebView2* webview,
    ICoreWebView2Controller* controller) noexcept {
  if (!hwnd || !IsWindow(hwnd) || !webview) return;
  RECT client{};
  if (!GetClientRect(hwnd, &client)) return;
  const LONG width = client.right - client.left;
  const LONG height = client.bottom - client.top;
  if (width <= 0 || height <= 0) return;
  const UINT attempt = gNativeMediaTrustedWakeCount++;
  const double cssScale = NativeMediaTrustedCssScale(controller, hwnd);
  const double x = static_cast<double>(width) / 2.0 / cssScale;
  const double y = static_cast<double>(height) *
      static_cast<double>(35U + (attempt % 3U) * 10U) / 100.0 / cssScale;
  NativeMediaDispatchTrustedMove(webview, x, y);
}

void CALLBACK NativeMediaTrustedWakeTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) noexcept {
  if (hwnd && IsWindow(hwnd) && gNativeMediaTrustedWakeWindow == hwnd &&
      gNativeMediaTrustedWakeWebView &&
      gNativeMediaTrustedWakeCount < kNativeMediaTrustedWakeAttempts) {
    NativeMediaTrustedWake(
        hwnd, gNativeMediaTrustedWakeWebView.Get(),
        gNativeMediaTrustedWakeController.Get());
  }
  if (!hwnd || !IsWindow(hwnd)) return;
  PostMessageW(hwnd, WM_TIMER, timerId, 0);
  if (gNativeMediaTrustedWakeCount >= kNativeMediaTrustedWakeAttempts) {
    ::SetTimer(hwnd, timerId, gNativeMediaTrustedSteadyIntervalMs, nullptr);
  }
}

UINT_PTR ArmNativeMediaTrustedWakeTimer(
    HWND hwnd, ICoreWebView2* webview, ICoreWebView2Controller* controller,
    UINT_PTR timerId, UINT steadyIntervalMs) noexcept {
  gNativeMediaTrustedWakeWindow = hwnd;
  gNativeMediaTrustedWakeWebView = webview;
  gNativeMediaTrustedWakeController = controller;
  gNativeMediaTrustedWakeCount = 0;
  gNativeMediaTrustedSteadyIntervalMs = steadyIntervalMs;
  return ::SetTimer(hwnd, timerId, kNativeMediaTrustedWakeIntervalMs,
                    NativeMediaTrustedWakeTimerProc);
}
}  // namespace
