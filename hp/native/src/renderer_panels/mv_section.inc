namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMvPanelPageUrl[] =
    L"https://www.youtube.com/playlist?list=PLMWqSdpIVl30";

LRESULT CALLBACK NativeMvPanelWndProc(HWND hwnd, UINT message, WPARAM wparam,
                                      LPARAM lparam);

class NativeMvPanelHost {
 public:
  explicit NativeMvPanelHost(const fs::path& dataDir)
      : userDataFolder_(dataDir / L"webview2-youtube-mv"),
        alive_(std::make_shared<std::atomic<bool>>(true)) {}

  void Attach(HWND hwnd) noexcept { hostWindow_ = hwnd; }

  void Start() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) {
      failed_ = true;
      if (hostWindow_ && IsWindow(hostWindow_)) {
        InvalidateRect(hostWindow_, nullptr, FALSE);
      }
      return;
    }

    const auto alive = alive_;
    try {
      // This is now the normal YouTube playlist page rather than a video-only
      // iframe, so keep images and downloadable fonts enabled.
      SharedWebViewEnvironment::Instance().Acquire(
          userDataFolder_, false, false,
          [this, alive](HRESULT result, ICoreWebView2Environment* environment) {
            if (!alive->load(std::memory_order_acquire)) return;
            if (FAILED(result) || !environment || !hostWindow_ ||
                !IsWindow(hostWindow_)) {
              Fail();
              return;
            }
            environment_ = environment;
            const auto controllerReady =
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [this, alive](HRESULT controllerResult,
                                  ICoreWebView2Controller* controller) -> HRESULT {
                      if (!alive->load(std::memory_order_acquire)) {
                        if (controller) controller->Close();
                        return S_OK;
                      }
                      if (FAILED(controllerResult) || !controller) {
                        if (controller) controller->Close();
                        Fail();
                        return S_OK;
                      }
                      controller_ = controller;
                      controller_->get_CoreWebView2(&webview_);
                      if (!webview_) {
                        Fail();
                        return S_OK;
                      }
                      Configure();
                      return S_OK;
                    });
            const HRESULT started = environment_->CreateCoreWebView2Controller(
                hostWindow_, controllerReady.Get());
            if (FAILED(started)) Fail();
          });
    } catch (...) {
      Fail();
    }
  }

  void Resize() noexcept {
    if (!hostWindow_ || !controller_) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    if (client.right <= client.left || client.bottom <= client.top) return;
    controller_->put_Bounds(client);
  }

  void Paint() noexcept {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(hostWindow_, &paint);
    if (!dc) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    FillRect(dc, &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    if (failed_) {
      SetBkMode(dc, TRANSPARENT);
      SetTextColor(dc, RGB(220, 225, 232));
      DrawTextW(dc, L"動画を読み込めません", -1, &client,
                DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    }
    EndPaint(hostWindow_, &paint);
  }

  void Shutdown() noexcept {
    alive_->store(false, std::memory_order_release);
    if (webview_ && newWindowToken_.value != 0) {
      webview_->remove_NewWindowRequested(newWindowToken_);
      newWindowToken_ = {};
    }
    if (controller_) {
      controller_->put_IsVisible(FALSE);
      controller_->Close();
    }
    webview_.Reset();
    controller_.Reset();
    environment_.Reset();
    hostWindow_ = nullptr;
  }

 private:
  void Configure() noexcept {
    try {
      ComPtr<ICoreWebView2Controller2> controller2;
      if (SUCCEEDED(controller_.As(&controller2)) && controller2) {
        COREWEBVIEW2_COLOR background{255, 0, 0, 0};
        controller2->put_DefaultBackgroundColor(background);
      }

      ComPtr<ICoreWebView2Settings> settings;
      if (SUCCEEDED(webview_->get_Settings(&settings)) && settings) {
        settings->put_IsScriptEnabled(TRUE);
        settings->put_IsWebMessageEnabled(FALSE);
        settings->put_AreDefaultScriptDialogsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreHostObjectsAllowed(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        settings->put_IsBuiltInErrorPageEnabled(TRUE);

        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3)) && settings3) {
          settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
        }
      }

      const HRESULT newWindowResult = webview_->add_NewWindowRequested(
          Callback<ICoreWebView2NewWindowRequestedEventHandler>(
              [](ICoreWebView2*,
                 ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                if (args) args->put_Handled(TRUE);
                return S_OK;
              }).Get(),
          &newWindowToken_);
      if (FAILED(newWindowResult)) newWindowToken_ = {};

      Resize();
      controller_->put_IsVisible(TRUE);
      if (FAILED(webview_->Navigate(kNativeMvPanelPageUrl))) {
        Fail();
        return;
      }
    } catch (...) {
      Fail();
    }
  }

  void Fail() noexcept {
    failed_ = true;
    if (controller_) controller_->put_IsVisible(FALSE);
    if (hostWindow_ && IsWindow(hostWindow_)) {
      InvalidateRect(hostWindow_, nullptr, FALSE);
    }
  }

  HWND hostWindow_ = nullptr;
  fs::path userDataFolder_;
  std::shared_ptr<std::atomic<bool>> alive_;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  EventRegistrationToken newWindowToken_{};
  bool failed_ = false;
};

LRESULT CALLBACK NativeMvPanelWndProc(HWND hwnd, UINT message, WPARAM wparam,
                                      LPARAM lparam) {
  NativeMvPanelHost* host = reinterpret_cast<NativeMvPanelHost*>(
      GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    host = static_cast<NativeMvPanelHost*>(create->lpCreateParams);
    if (host) {
      host->Attach(hwnd);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(host));
    }
  }

  if (host) {
    switch (message) {
      case WM_SIZE:
        host->Resize();
        return 0;
      case WM_ERASEBKGND:
        return 1;
      case WM_PAINT:
        host->Paint();
        return 0;
      case WM_NCDESTROY:
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        host->Shutdown();
        delete host;
        return DefWindowProcW(hwnd, message, wparam, lparam);
      default:
        break;
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

bool EnsureNativeMvPanel(HWND parentWindow, const fs::path& dataDir,
                         const RECT& bounds) noexcept {
  if (!parentWindow || !IsWindow(parentWindow) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return false;
  }

  static std::once_flag classOnce;
  static bool classReady = false;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = NativeMvPanelWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kNativeMvPanelHostClass;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground =
        static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    SetLastError(ERROR_SUCCESS);
    classReady = RegisterClassW(&windowClass) != 0 ||
                 GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!classReady) return false;

  HWND host =
      FindWindowExW(parentWindow, nullptr, kNativeMvPanelHostClass, nullptr);
  if (!host) {
    NativeMvPanelHost* state = nullptr;
    try {
      state = new NativeMvPanelHost(dataDir);
    } catch (...) {
      return false;
    }
    host = CreateWindowExW(
        0, kNativeMvPanelHostClass, L"",
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_VISIBLE,
        bounds.left, bounds.top, std::max(1L, bounds.right - bounds.left),
        std::max(1L, bounds.bottom - bounds.top), parentWindow, nullptr,
        GetModuleHandleW(nullptr), state);
    if (!host) {
      delete state;
      return false;
    }
    state->Start();
    return true;
  }

  RECT current{};
  GetWindowRect(host, &current);
  MapWindowPoints(nullptr, parentWindow, reinterpret_cast<POINT*>(&current), 2);
  if (!EqualRect(&current, &bounds)) {
    SetWindowPos(host, HWND_TOP, bounds.left, bounds.top,
                 std::max(1L, bounds.right - bounds.left),
                 std::max(1L, bounds.bottom - bounds.top),
                 SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_SHOWWINDOW);
  }
  return true;
}
}  // namespace

void Renderer::DrawMusicSection(HDC dc, const RECT& card) {
  if (nativeRadarWindow_ && IsWindow(nativeRadarWindow_)) {
    RECT mvBounds{};
    GetClientRect(nativeRadarWindow_, &mvBounds);
    if (mvBounds.right > mvBounds.left && mvBounds.bottom > mvBounds.top) {
      EnsureNativeMvPanel(nativeRadarWindow_, dataDir_, mvBounds);
    }
  }

  const RECT& bounds = card;
  const int radius = CardRadius(bounds);
  HRGN rounded = CreateRoundRectRgn(bounds.left, bounds.top, bounds.right + 1,
                                    bounds.bottom + 1, radius, radius);
  ExtSelectClipRgn(dc, rounded, RGN_AND);
  DeleteObject(rounded);

  bool hasFrame = false;
  std::wstring timeText;
  {
    std::lock_guard lock(radarFrameMutex_);
    hasFrame = radarFrameBitmap_ != nullptr;
    timeText = radarTimeText_;
    if (hasFrame) StretchRadarInto(dc, bounds, radarFrameBitmap_);
  }
  const bool noRain = hasFrame && timeText == L"しばらく雨は降りません";
  if (!hasFrame) {
    HBRUSH surface = CreateSolidBrush(kWidgetSurface);
    FillRect(dc, &bounds, surface);
    DeleteObject(surface);
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
    SetTextColor(dc, kWidgetMuted);
    DrawTextInRect(dc, L"レーダー画像を準備中", bounds,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  } else if (noRain) {
    FillRoundRectTranslucent(dc, bounds, RGB(0, 0, 0), radius, 165);
    const RECT messageBounds = NormalizeInsetRect(
        bounds, SpanX(bounds, 45), SpanY(bounds, 120),
        SpanX(bounds, 45), SpanY(bounds, 90));
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Large));
    SetTextColor(dc, kWidgetText);
    DrawTextInRect(dc, L"しばらく雨は降りません", messageBounds,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  }

  HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
  const std::wstring chipText = noRain
      ? L"雨雲レーダー"
      : L"雨雲レーダー " + (timeText.empty() ? L"--:--" : timeText);
  RECT measure{};
  DrawTextW(dc, chipText.c_str(), -1, &measure,
            DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
  const int chipPadX = std::max(8, SpanX(bounds, 8));
  const int chipPadY = std::max(4, SpanY(bounds, 8));
  const int chipMargin = std::max(10, SpanY(bounds, 25));
  const RECT chip{bounds.left + chipMargin, bounds.top + chipMargin,
                  bounds.left + chipMargin + (measure.right - measure.left) + chipPadX * 2,
                  bounds.top + chipMargin + (measure.bottom - measure.top) + chipPadY * 2};
  FillRoundRectTranslucent(dc, chip, RGB(0, 0, 0), chip.bottom - chip.top, 150);
  SetTextColor(dc, kWidgetText);
  DrawTextInRect(dc, chipText, chip, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
  SelectObject(dc, previousFont);

  SelectClipRgn(dc, nullptr);
  DrawCardOutline(dc, bounds, radius);

  static bool stationheadMuteQueued = false;
  if (!stationheadMuteQueued) {
    stationheadMuteQueued = true;
    QueueAction(UiAction::StationheadAudioMute);
  }
}