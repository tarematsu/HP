namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMvPanelPageUrl[] =
    L"https://www.youtube.com/playlist?list=PLMWqSdpIVl30";
constexpr UINT_PTR kNativeMvRandomActionTimer = 0x4D560001;
constexpr UINT_PTR kNativeMvPlayAllRetryTimer = 0x4D560002;
constexpr UINT_PTR kNativeMvFullscreenRetryTimer = 0x4D560003;
constexpr UINT_PTR kNativeMvPlaybackHealthTimer = 0x4D560004;
constexpr UINT_PTR kNativeMvNavigationRetryTimer = 0x4D560005;
constexpr UINT kNativeMvRandomMinSeconds = 20U * 60U;
constexpr UINT kNativeMvRandomSpanSeconds = 20U * 60U;
constexpr UINT kNativeMvPlayAllRetryMs = 500U;
constexpr UINT kNativeMvFullscreenRetryMs = 500U;
constexpr UINT kNativeMvPlaybackHealthMs = 5U * 1000U;
constexpr UINT kNativeMvNavigationRetryMs = 3U * 1000U;
constexpr int kNativeMvPlayAllRetryLimit = 20;
constexpr int kNativeMvFullscreenRetryLimit = 30;
// Screenshot 709x1536: WebView ~= (213,531)-(700,804), Play all center
// ~= (498,647), which is 58.5% across and 42.5% down the WebView.
constexpr int kNativeMvFallbackPlayAllXTenThousandths = 5850;
constexpr int kNativeMvFallbackPlayAllYTenThousandths = 4250;
constexpr int kNativeMvCenterXTenThousandths = 5000;
constexpr int kNativeMvCenterYTenThousandths = 5000;
constexpr wchar_t kNativeMvPlayAllProbeScript[] = LR"JS(
(() => {
  const styleId = 'homepanel-youtube-clean-player';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .html5-video-player .ytp-chrome-top,
      .html5-video-player .ytp-gradient-top,
      .html5-video-player .ytp-chrome-bottom,
      .html5-video-player .ytp-gradient-bottom {
        opacity: 0 !important;
        transition: none !important;
      }
    `;
    const parent = document.head || document.documentElement;
    if (parent) parent.appendChild(style);
  }

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const candidates = Array.from(document.querySelectorAll(
      'button, a, tp-yt-paper-button, [role="button"]'));
  const target = candidates.find(element => {
    const label = normalize(element.getAttribute('aria-label'));
    const text = normalize(element.textContent);
    return label === 'すべて再生' || text === 'すべて再生' ||
           /^Play all(?:\s|$)/i.test(label) ||
           /^Play all(?:\s|$)/i.test(text);
  });
  if (!target || window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.max(0, Math.min(10000, Math.round(
      ((rect.left + rect.width / 2) / window.innerWidth) * 10000)));
  const y = Math.max(0, Math.min(10000, Math.round(
      ((rect.top + rect.height / 2) / window.innerHeight) * 10000)));
  return [x, y];
})()
)JS";
constexpr wchar_t kNativeMvFullscreenProbeScript[] = LR"JS(
(() => {
  const styleId = 'homepanel-youtube-clean-player';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .html5-video-player .ytp-chrome-top,
      .html5-video-player .ytp-gradient-top,
      .html5-video-player .ytp-chrome-bottom,
      .html5-video-player .ytp-gradient-bottom {
        opacity: 0 !important;
        transition: none !important;
      }
    `;
    const parent = document.head || document.documentElement;
    if (parent) parent.appendChild(style);
  }

  const target = document.querySelector('.ytp-fullscreen-button');
  if (!target || window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.max(0, Math.min(10000, Math.round(
      ((rect.left + rect.width / 2) / window.innerWidth) * 10000)));
  const y = Math.max(0, Math.min(10000, Math.round(
      ((rect.top + rect.height / 2) / window.innerHeight) * 10000)));
  return [x, y];
})()
)JS";
constexpr wchar_t kNativeMvPlaybackHealthScript[] = LR"JS(
(() => {
  const video = document.querySelector('video');
  if (video && video.error) return true;

  const player = document.querySelector('.html5-video-player');
  if (player && player.classList.contains('ytp-error')) return true;

  const error = document.querySelector(
      '.ytp-error, .ytp-error-content-wrap, .ytp-error-content, '
      + 'yt-player-error-message-renderer, ytd-player-error-message-renderer');
  if (!error) return false;
  const style = window.getComputedStyle(error);
  const rect = error.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' &&
         rect.width > 0 && rect.height > 0;
})()
)JS";

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

  bool OnTimer(UINT_PTR timerId) noexcept {
    if (timerId == kNativeMvRandomActionTimer) {
      if (nextRandomActionIsCenterClick_) {
        ClickNormalizedPoint(kNativeMvCenterXTenThousandths,
                             kNativeMvCenterYTenThousandths);
        nextRandomActionIsCenterClick_ = false;
        if (!failed_ && !ScheduleNextRandomAction()) Fail();
      } else {
        ReloadPlaylist();
      }
      return true;
    }
    if (timerId == kNativeMvPlayAllRetryTimer) {
      ProbePlayAllButton();
      return true;
    }
    if (timerId == kNativeMvFullscreenRetryTimer) {
      ProbeFullscreenButton();
      return true;
    }
    if (timerId == kNativeMvPlaybackHealthTimer) {
      ProbePlaybackHealth();
      return true;
    }
    if (timerId == kNativeMvNavigationRetryTimer) {
      StopNavigationRetry();
      ReloadPlaylist();
      return true;
    }
    return false;
  }

  void Shutdown() noexcept {
    alive_->store(false, std::memory_order_release);
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvRandomActionTimer);
      KillTimer(hostWindow_, kNativeMvPlayAllRetryTimer);
      KillTimer(hostWindow_, kNativeMvFullscreenRetryTimer);
      KillTimer(hostWindow_, kNativeMvPlaybackHealthTimer);
      KillTimer(hostWindow_, kNativeMvNavigationRetryTimer);
    }
    if (webview_ && navigationCompletedToken_.value != 0) {
      webview_->remove_NavigationCompleted(navigationCompletedToken_);
      navigationCompletedToken_ = {};
    }
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

      const auto alive = alive_;
      const HRESULT navigationResult = webview_->add_NavigationCompleted(
          Callback<ICoreWebView2NavigationCompletedEventHandler>(
              [this, alive](ICoreWebView2*,
                            ICoreWebView2NavigationCompletedEventArgs* args)
                  -> HRESULT {
                if (!alive->load(std::memory_order_acquire)) return S_OK;
                BOOL succeeded = FALSE;
                if (!args || FAILED(args->get_IsSuccess(&succeeded)) ||
                    !succeeded) {
                  StopPlayAllProbe();
                  StopFullscreenProbe();
                  StopPlaybackHealthMonitor();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                StopNavigationRetry();
                if (IsPlaylistPage()) {
                  StopFullscreenProbe();
                  StopPlaybackHealthMonitor();
                  BeginPlayAllProbe();
                } else if (IsWatchPage()) {
                  StopPlayAllProbe();
                  BeginFullscreenProbe();
                  BeginPlaybackHealthMonitor();
                } else {
                  StopPlayAllProbe();
                  StopFullscreenProbe();
                  StopPlaybackHealthMonitor();
                }
                return S_OK;
              }).Get(),
          &navigationCompletedToken_);
      if (FAILED(navigationResult)) {
        Fail();
        return;
      }

      Resize();
      controller_->put_IsVisible(TRUE);
      ReloadPlaylist();
    } catch (...) {
      Fail();
    }
  }

  static UINT NextRandomActionDelayMs() noexcept {
    static ULONGLONG state = 0;
    if (state == 0) {
      LARGE_INTEGER counter{};
      if (!QueryPerformanceCounter(&counter)) counter.QuadPart = 0;
      state = GetTickCount64() ^
              static_cast<ULONGLONG>(counter.QuadPart) ^
              (static_cast<ULONGLONG>(GetCurrentProcessId()) << 32) ^
              static_cast<ULONGLONG>(GetCurrentThreadId());
      if (state == 0) state = 1;
    }
    state ^= state >> 12;
    state ^= state << 25;
    state ^= state >> 27;
    const ULONGLONG random = state * 2685821657736338717ULL;
    const UINT seconds = kNativeMvRandomMinSeconds +
        static_cast<UINT>(random % kNativeMvRandomSpanSeconds);
    return seconds * 1000U;
  }

  bool ScheduleNextRandomAction() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return false;
    return SetTimer(hostWindow_, kNativeMvRandomActionTimer,
                    NextRandomActionDelayMs(), nullptr) != 0;
  }

  bool ScheduleNavigationRetry() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return false;
    KillTimer(hostWindow_, kNativeMvNavigationRetryTimer);
    return SetTimer(hostWindow_, kNativeMvNavigationRetryTimer,
                    kNativeMvNavigationRetryMs, nullptr) != 0;
  }

  void StopNavigationRetry() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvNavigationRetryTimer);
    }
  }

  bool IsPlaylistPage() noexcept {
    if (!webview_) return false;
    LPWSTR source = nullptr;
    if (FAILED(webview_->get_Source(&source)) || !source) return false;
    const std::wstring url(source);
    CoTaskMemFree(source);
    return url.find(L"youtube.com/playlist") != std::wstring::npos &&
           url.find(L"list=PLMWqSdpIVl30") != std::wstring::npos;
  }

  bool IsWatchPage() noexcept {
    if (!webview_) return false;
    LPWSTR source = nullptr;
    if (FAILED(webview_->get_Source(&source)) || !source) return false;
    const std::wstring url(source);
    CoTaskMemFree(source);
    return url.find(L"youtube.com/watch") != std::wstring::npos &&
           url.find(L"list=PLMWqSdpIVl30") != std::wstring::npos;
  }

  void ReloadPlaylist() noexcept {
    StopPlayAllProbe();
    StopFullscreenProbe();
    StopPlaybackHealthMonitor();
    StopNavigationRetry();
    nextRandomActionIsCenterClick_ = true;
    if (!webview_) {
      Fail();
      return;
    }
    if (FAILED(webview_->Navigate(kNativeMvPanelPageUrl))) {
      if (!ScheduleNavigationRetry()) Fail();
      return;
    }
    if (!ScheduleNextRandomAction()) Fail();
  }

  void BeginPlayAllProbe() noexcept {
    StopPlayAllProbe();
    playAllProbeAttempts_ = 0;
    playAllProbeInFlight_ = false;
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    SetTimer(hostWindow_, kNativeMvPlayAllRetryTimer,
             kNativeMvPlayAllRetryMs, nullptr);
    ProbePlayAllButton();
  }

  void StopPlayAllProbe() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvPlayAllRetryTimer);
    }
    playAllProbeInFlight_ = false;
  }

  void BeginFullscreenProbe() noexcept {
    StopFullscreenProbe();
    fullscreenProbeAttempts_ = 0;
    fullscreenProbeInFlight_ = false;
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    SetTimer(hostWindow_, kNativeMvFullscreenRetryTimer,
             kNativeMvFullscreenRetryMs, nullptr);
    ProbeFullscreenButton();
  }

  void StopFullscreenProbe() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvFullscreenRetryTimer);
    }
    fullscreenProbeInFlight_ = false;
  }

  void BeginPlaybackHealthMonitor() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    KillTimer(hostWindow_, kNativeMvPlaybackHealthTimer);
    playbackHealthProbeInFlight_ = false;
    SetTimer(hostWindow_, kNativeMvPlaybackHealthTimer,
             kNativeMvPlaybackHealthMs, nullptr);
  }

  void StopPlaybackHealthMonitor() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvPlaybackHealthTimer);
    }
    playbackHealthProbeInFlight_ = false;
  }

  static bool ParseNormalizedPoint(LPCWSTR json, int* x, int* y) noexcept {
    if (!json || !x || !y) return false;
    try {
      const std::wstring value(json);
      if (value.size() < 5 || value.front() != L'[') return false;
      const size_t comma = value.find(L',');
      const size_t close = value.find(L']', comma == std::wstring::npos
                                               ? 0
                                               : comma + 1);
      if (comma == std::wstring::npos || close == std::wstring::npos) {
        return false;
      }
      const int parsedX = std::stoi(value.substr(1, comma - 1));
      const int parsedY = std::stoi(value.substr(comma + 1,
                                                  close - comma - 1));
      if (parsedX < 0 || parsedX > 10000 || parsedY < 0 ||
          parsedY > 10000) {
        return false;
      }
      *x = parsedX;
      *y = parsedY;
      return true;
    } catch (...) {
      return false;
    }
  }

  void ProbePlayAllButton() noexcept {
    if (!webview_ || playAllProbeInFlight_) return;
    if (playAllProbeAttempts_ >= kNativeMvPlayAllRetryLimit) {
      StopPlayAllProbe();
      ClickPlayAllFallback();
      return;
    }

    ++playAllProbeAttempts_;
    playAllProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMvPlayAllProbeScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              playAllProbeInFlight_ = false;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                StopPlayAllProbe();
                ClickNormalizedPoint(x, y);
                BeginFullscreenProbe();
                BeginPlaybackHealthMonitor();
                return S_OK;
              }
              if (playAllProbeAttempts_ >= kNativeMvPlayAllRetryLimit) {
                StopPlayAllProbe();
                ClickPlayAllFallback();
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) {
      playAllProbeInFlight_ = false;
      if (playAllProbeAttempts_ >= kNativeMvPlayAllRetryLimit) {
        StopPlayAllProbe();
        ClickPlayAllFallback();
      }
    }
  }

  void ProbeFullscreenButton() noexcept {
    if (!webview_ || fullscreenProbeInFlight_) return;
    if (fullscreenProbeAttempts_ >= kNativeMvFullscreenRetryLimit) {
      StopFullscreenProbe();
      return;
    }

    ++fullscreenProbeAttempts_;
    fullscreenProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMvFullscreenProbeScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              fullscreenProbeInFlight_ = false;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                StopFullscreenProbe();
                ClickNormalizedPoint(x, y);
                return S_OK;
              }
              if (fullscreenProbeAttempts_ >= kNativeMvFullscreenRetryLimit) {
                StopFullscreenProbe();
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) {
      fullscreenProbeInFlight_ = false;
      if (fullscreenProbeAttempts_ >= kNativeMvFullscreenRetryLimit) {
        StopFullscreenProbe();
      }
    }
  }

  void ProbePlaybackHealth() noexcept {
    if (!webview_ || playbackHealthProbeInFlight_) return;
    playbackHealthProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMvPlaybackHealthScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              playbackHealthProbeInFlight_ = false;
              if (SUCCEEDED(result) && json && std::wstring_view(json) == L"true") {
                ReloadPlaylist();
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) playbackHealthProbeInFlight_ = false;
  }

  void ClickPlayAllFallback() noexcept {
    ClickNormalizedPoint(kNativeMvFallbackPlayAllXTenThousandths,
                         kNativeMvFallbackPlayAllYTenThousandths);
    BeginFullscreenProbe();
    BeginPlaybackHealthMonitor();
  }

  static LONG AbsoluteMouseCoordinate(int value, int origin,
                                      int span) noexcept {
    if (span <= 1) return 0;
    long long scaled =
        (static_cast<long long>(value - origin) * 65535LL) / (span - 1);
    if (scaled < 0) scaled = 0;
    if (scaled > 65535) scaled = 65535;
    return static_cast<LONG>(scaled);
  }

  void ClickNormalizedPoint(int xTenThousandths,
                            int yTenThousandths) noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    const LONG width = client.right - client.left;
    const LONG height = client.bottom - client.top;
    if (width <= 0 || height <= 0) return;

    POINT target{};
    target.x = client.left + static_cast<LONG>(
                                 (static_cast<long long>(width) *
                                  xTenThousandths) /
                                 10000);
    target.y = client.top + static_cast<LONG>(
                                (static_cast<long long>(height) *
                                 yTenThousandths) /
                                10000);
    target.x = std::max(client.left, std::min(client.right - 1, target.x));
    target.y = std::max(client.top, std::min(client.bottom - 1, target.y));
    if (!ClientToScreen(hostWindow_, &target)) return;

    const int virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const int virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if (virtualWidth <= 1 || virtualHeight <= 1) return;

    auto setAbsoluteMove = [&](INPUT* input, const POINT& point) noexcept {
      input->type = INPUT_MOUSE;
      input->mi.dx =
          AbsoluteMouseCoordinate(point.x, virtualLeft, virtualWidth);
      input->mi.dy =
          AbsoluteMouseCoordinate(point.y, virtualTop, virtualHeight);
      input->mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE |
                          MOUSEEVENTF_VIRTUALDESK;
    };

    INPUT inputs[4]{};
    setAbsoluteMove(&inputs[0], target);
    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    inputs[2].type = INPUT_MOUSE;
    inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP;

    POINT previous{};
    UINT inputCount = 3;
    if (GetCursorPos(&previous)) {
      setAbsoluteMove(&inputs[3], previous);
      inputCount = 4;
    }
    SendInput(inputCount, inputs, sizeof(INPUT));
  }

  void Fail() noexcept {
    failed_ = true;
    StopPlayAllProbe();
    StopFullscreenProbe();
    StopPlaybackHealthMonitor();
    StopNavigationRetry();
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvRandomActionTimer);
    }
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
  EventRegistrationToken navigationCompletedToken_{};
  int playAllProbeAttempts_ = 0;
  int fullscreenProbeAttempts_ = 0;
  bool playAllProbeInFlight_ = false;
  bool fullscreenProbeInFlight_ = false;
  bool playbackHealthProbeInFlight_ = false;
  bool nextRandomActionIsCenterClick_ = true;
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
      case WM_TIMER:
        if (host->OnTimer(static_cast<UINT_PTR>(wparam))) return 0;
        break;
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