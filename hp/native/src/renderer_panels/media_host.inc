// Native WebView2 media host lifecycle, navigation and playback watchdogs.
class NativeMediaPanelHost final {
 public:
  explicit NativeMediaPanelHost(const fs::path& dataDir)
      : userDataFolder_(dataDir / L"webview2-youtube-mv"),
        alive_(std::make_shared<std::atomic<bool>>(true)) {}

  void Attach(HWND hwnd) noexcept { hostWindow_ = hwnd; }

  void Start() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    const auto alive = alive_;
    try {
      SharedWebViewEnvironment::Instance().Acquire(
          userDataFolder_, false, false,
          [this, alive](HRESULT result, ICoreWebView2Environment* environment) {
            if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
                !environment || !hostWindow_ || !IsWindow(hostWindow_)) {
              Fail();
              return;
            }
            environment_ = environment;
            phase_ = Phase::YouTube;
            CapturePhaseTimes();
            CreateControllerForCurrentPhase();
            ArmPhaseTimer();
          });
    } catch (...) {
      Fail();
    }
  }

  void Resize() noexcept {
    if (!controller_ || !hostWindow_ || !IsWindow(hostWindow_)) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    if (client.right <= client.left || client.bottom <= client.top) return;
    controller_->put_Bounds(client);
  }

  bool OnTimer(UINT_PTR timerId) noexcept {
    if (timerId == kNativeMediaPhaseTimer) {
      phase_ == Phase::YouTube ? SwitchToTver() : SwitchToYouTube();
      return true;
    }
    if (timerId == kNativeMediaPlayAllTimer) {
      ProbePlayAll();
      return true;
    }
    if (timerId == kNativeMediaNavigationRetryTimer) {
      StopNavigationRetry();
      NavigateCurrentPhase();
      return true;
    }
    if (timerId == kNativeMediaYoutubeWatchdogTimer) {
      if (hostWindow_ && IsWindow(hostWindow_)) {
        SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
                 kNativeMediaYoutubeWatchdogHealthyMs, nullptr);
      }
      ProbeYoutubeWatchdog();
      return true;
    }
    if (timerId == kNativeMediaTverWatchdogTimer) {
      ProbeTverWatchdog();
      return true;
    }
    return false;
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
    tverRestarting_ = false;
    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaPhaseTimer);
    }
    CloseController();
    environment_.Reset();
    hostWindow_ = nullptr;
  }

 private:
  enum class Phase { YouTube, Tver };
  static constexpr ULONGLONG kYoutubeWatchdogTimeoutMs = 5ULL * 1000ULL;

  void CapturePhaseTimes() noexcept {
    FILETIME startUtc{};
    GetSystemTimeAsFileTime(&startUtc);
    ULARGE_INTEGER endTicks{};
    endTicks.LowPart = startUtc.dwLowDateTime;
    endTicks.HighPart = startUtc.dwHighDateTime;
    endTicks.QuadPart += static_cast<ULONGLONG>(kNativeMediaPhaseMs) * 10000ULL;
    FILETIME endUtc{};
    endUtc.dwLowDateTime = endTicks.LowPart;
    endUtc.dwHighDateTime = endTicks.HighPart;
    phaseStartText_ = FormatNativeMediaLocalHourMinute(startUtc);
    phaseEndText_ = FormatNativeMediaLocalHourMinute(endUtc);
  }

  std::wstring BuildPhaseOverlayScript() const {
    if (phaseStartText_.empty() || phaseEndText_.empty()) return {};
    std::wstring script = LR"JS(
(() => {
  const id = '__homePanelMediaPhaseTime';
  const cursorStyleId = '__homePanelMediaCursorStyle';
  const text = ')JS";
    script += phase_ == Phase::YouTube ? L"YouTube " : L"TVer ";
    script += phaseStartText_;
    script += L"–";
    script += phaseEndText_;
    script += LR"JS(';
  const mount = () => {
    const styleRoot = document.head || document.documentElement;
    if (styleRoot && !document.getElementById(cursorStyleId)) {
      const cursorStyle = document.createElement('style');
      cursorStyle.id = cursorStyleId;
      cursorStyle.textContent = '* { cursor:none !important; }';
      styleRoot.appendChild(cursorStyle);
    }
    const player = document.querySelector('#movie_player');
    const root = player || document.body || document.documentElement;
    if (!root) return;
    let badge = document.getElementById(id);
    if (!badge) {
      badge = document.createElement('div');
      badge.id = id;
    }
    badge.textContent = text;
    badge.style.cssText =
        (player ? 'position:absolute;' : 'position:fixed;') +
        'top:8px;right:8px;z-index:2147483647;' +
        'padding:0;border:0;border-radius:0;background:transparent;' +
        'color:rgba(176,176,176,.58);font:600 12px/1.2 "Segoe UI",sans-serif;' +
        'letter-spacing:.2px;white-space:nowrap;pointer-events:none;';
    if (badge.parentElement !== root) root.appendChild(badge);
  };
  mount();
})()
)JS";
    return script;
  }

  void ShowPhaseOverlay() noexcept {
    if (!webview_) return;
    const std::wstring script = BuildPhaseOverlayScript();
    if (!script.empty()) webview_->ExecuteScript(script.c_str(), nullptr);
  }

  const wchar_t* CurrentProfileName() const noexcept {
    return kNativeMediaProfile;
  }

  void CloseController() noexcept {
    ++controllerGeneration_;
    controllerCreating_ = false;
    if (webview_) {
      if (navigationCompletedToken_.value != 0) {
        webview_->remove_NavigationCompleted(navigationCompletedToken_);
      }
      if (newWindowToken_.value != 0) {
        webview_->remove_NewWindowRequested(newWindowToken_);
      }
    }
    navigationCompletedToken_ = {};
    newWindowToken_ = {};
    webview_.Reset();
    if (controller_) controller_->Close();
    controller_.Reset();
  }

  void CreateControllerForCurrentPhase() noexcept {
    if (!environment_ || controller_ || controllerCreating_ ||
        !hostWindow_ || !IsWindow(hostWindow_)) {
      return;
    }
    controllerCreating_ = true;
    const Phase requestedPhase = phase_;
    const uint64_t generation = ++controllerGeneration_;
    const auto alive = alive_;
    try {
      ComPtr<ICoreWebView2Environment10> environment10;
      if (FAILED(environment_->QueryInterface(IID_PPV_ARGS(&environment10))) ||
          !environment10) {
        controllerCreating_ = false;
        ScheduleNavigationRetry();
        return;
      }
      ComPtr<ICoreWebView2ControllerOptions> options;
      if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
          !options ||
          FAILED(options->put_ProfileName(CurrentProfileName())) ||
          FAILED(options->put_IsInPrivateModeEnabled(FALSE))) {
        controllerCreating_ = false;
        ScheduleNavigationRetry();
        return;
      }

      const auto ready =
          Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
              [this, alive, requestedPhase, generation](
                  HRESULT controllerResult,
                  ICoreWebView2Controller* controller) -> HRESULT {
                if (!alive->load(std::memory_order_acquire) ||
                    generation != controllerGeneration_ ||
                    requestedPhase != phase_) {
                  if (controller) controller->Close();
                  return S_OK;
                }
                controllerCreating_ = false;
                if (FAILED(controllerResult) || !controller) {
                  if (controller) controller->Close();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                controller_ = controller;
                controller_->get_CoreWebView2(&webview_);
                if (!webview_) {
                  controller_->Close();
                  controller_.Reset();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                Configure();
                return S_OK;
              });
      if (FAILED(environment10->CreateCoreWebView2ControllerWithOptions(
              hostWindow_, options.Get(), ready.Get()))) {
        controllerCreating_ = false;
        ScheduleNavigationRetry();
      }
    } catch (...) {
      controllerCreating_ = false;
      ScheduleNavigationRetry();
    }
  }

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

      webview_->add_NewWindowRequested(
          Callback<ICoreWebView2NewWindowRequestedEventHandler>(
              [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args)
                  -> HRESULT {
                if (args) args->put_Handled(TRUE);
                return S_OK;
              }).Get(),
          &newWindowToken_);

      webview_->AddScriptToExecuteOnDocumentCreated(
          kNativeMediaYoutubeCleanPlayerScript, nullptr);

      const auto alive = alive_;
      webview_->add_NavigationCompleted(
          Callback<ICoreWebView2NavigationCompletedEventHandler>(
              [this, alive](ICoreWebView2*,
                            ICoreWebView2NavigationCompletedEventArgs* args)
                  -> HRESULT {
                if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
                BOOL succeeded = FALSE;
                if (FAILED(args->get_IsSuccess(&succeeded)) || !succeeded) {
                  StopYoutubeMonitors();
                  StopTverPlaybackMonitor();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                failed_ = false;
                StopNavigationRetry();
                if (phase_ == Phase::YouTube) {
                  webview_->ExecuteScript(
                      kNativeMediaYoutubeCleanPlayerScript, nullptr);
                }
                if (phase_ == Phase::Tver && IsTverPage()) {
                  StopYoutubeMonitors();
                  webview_->ExecuteScript(kNativeMediaTverLoopScript, nullptr);
                  BeginTverPlaybackMonitor();
                } else if (phase_ == Phase::YouTube && IsYoutubePlaylistPage()) {
                  StopTverPlaybackMonitor();
                  StopYoutubePlaybackMonitors();
                  BeginPlayAllProbe();
                } else if (phase_ == Phase::YouTube && IsYoutubeWatchPage()) {
                  StopTverPlaybackMonitor();
                  StopPlayAllProbe();
                  BeginYoutubePlaybackMonitors();
                } else {
                  StopYoutubeMonitors();
                  StopTverPlaybackMonitor();
                }
                ShowPhaseOverlay();
                return S_OK;
              }).Get(),
          &navigationCompletedToken_);

      Resize();
      controller_->put_IsVisible(TRUE);
      NavigateCurrentPhase();
    } catch (...) {
      Fail();
    }
  }

  void ArmPhaseTimer() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    KillTimer(hostWindow_, kNativeMediaPhaseTimer);
    if (SetTimer(hostWindow_, kNativeMediaPhaseTimer,
                 kNativeMediaPhaseMs, nullptr) == 0) {
      Fail();
    }
  }

  void SwitchToYouTube() noexcept {
    phase_ = Phase::YouTube;
    tverRestarting_ = false;
    CapturePhaseTimes();
    failed_ = false;
    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    NavigateCurrentPhase();
    ArmPhaseTimer();
  }

  void SwitchToTver() noexcept {
    phase_ = Phase::Tver;
    tverRestarting_ = false;
    CapturePhaseTimes();
    failed_ = false;
    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    NavigateCurrentPhase();
    ArmPhaseTimer();
  }

  void NavigateCurrentPhase() noexcept {
    if (!webview_) {
      CreateControllerForCurrentPhase();
      ScheduleNavigationRetry();
      return;
    }
    const wchar_t* url =
        phase_ == Phase::YouTube ? kNativeMediaYoutubeUrl : kNativeMediaTverUrl;
    if (FAILED(webview_->Navigate(url))) ScheduleNavigationRetry();
  }

  void ReloadYoutubePlaylist() noexcept {
    if (phase_ != Phase::YouTube || !webview_) return;
    StopYoutubeMonitors();
    if (FAILED(webview_->Navigate(kNativeMediaYoutubeUrl))) {
      ScheduleNavigationRetry();
    }
  }

  bool IsYoutubePlaylistPage() noexcept {
    return SourceContains(L"youtube.com/playlist") &&
           SourceContains(L"list=PLMWqSdpIVl30");
  }

  bool IsYoutubeWatchPage() noexcept {
    return SourceContains(L"youtube.com/watch") &&
           SourceContains(L"list=PLMWqSdpIVl30");
  }

  bool IsTverPage() noexcept { return SourceContains(L"tver.jp/"); }

  bool SourceContains(std::wstring_view needle) noexcept {
    if (!webview_) return false;
    LPWSTR source = nullptr;
    if (FAILED(webview_->get_Source(&source)) || !source) return false;
    const std::wstring value(source);
    CoTaskMemFree(source);
    return value.find(needle) != std::wstring::npos;
  }

  bool ScheduleNavigationRetry() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return false;
    KillTimer(hostWindow_, kNativeMediaNavigationRetryTimer);
    return SetTimer(hostWindow_, kNativeMediaNavigationRetryTimer,
                    kNativeMediaNavigationRetryMs, nullptr) != 0;
  }

  void StopNavigationRetry() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaNavigationRetryTimer);
    }
  }

  void BeginPlayAllProbe() noexcept {
    StopPlayAllProbe();
    playAllProbeAttempts_ = 0;
    playAllProbeInFlight_ = false;
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    SetTimer(hostWindow_, kNativeMediaPlayAllTimer,
             kNativeMediaPlayAllRetryMs, nullptr);
    ProbePlayAll();
  }

  void StopPlayAllProbe() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaPlayAllTimer);
    }
    playAllProbeInFlight_ = false;
  }

  void InvalidateYoutubeWatchdog() noexcept {
    ++youtubeWatchdogRequestGeneration_;
    if (youtubeWatchdogRequestGeneration_ == 0) {
      ++youtubeWatchdogRequestGeneration_;
    }
    youtubeWatchdogInFlight_ = false;
    youtubeWatchdogStartedTick_ = 0;
  }

  void BeginYoutubePlaybackMonitors() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    InvalidateYoutubeWatchdog();
    KillTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer);
    SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
             kNativeMediaYoutubeWatchdogHealthyMs, nullptr);
    ProbeYoutubeWatchdog();
  }

  void StopYoutubePlaybackMonitors() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer);
    }
    InvalidateYoutubeWatchdog();
  }

  void StopYoutubeMonitors() noexcept {
    StopPlayAllProbe();
    StopYoutubePlaybackMonitors();
  }

  void BeginTverPlaybackMonitor() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_) || tverRestarting_) return;
    tverWatchdogInFlight_ = false;
    KillTimer(hostWindow_, kNativeMediaTverWatchdogTimer);
    SetTimer(hostWindow_, kNativeMediaTverWatchdogTimer,
             kNativeMediaTverWatchdogMs, nullptr);
    ProbeTverWatchdog();
  }

  void StopTverPlaybackMonitor() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaTverWatchdogTimer);
    }
    tverWatchdogInFlight_ = false;
  }

  void CompleteTverRestart() noexcept {
    if (!tverRestarting_) return;
    tverRestarting_ = false;
    if (phase_ != Phase::Tver || !hostWindow_ || !IsWindow(hostWindow_)) return;
    StopNavigationRetry();
    NavigateCurrentPhase();
  }

  void RestartTverAfterPlayback() noexcept {
    if (phase_ != Phase::Tver || !webview_ || tverRestarting_) return;
    tverRestarting_ = true;
    StopTverPlaybackMonitor();
    AdvanceNativeMediaTverSeries();
    CompleteTverRestart();
  }

  static bool ParseNormalizedPoint(LPCWSTR json, int* x, int* y) noexcept {
    if (!json || !x || !y) return false;
    try {
      const std::wstring value(json);
      if (value.size() < 5 || value.front() != L'[') return false;
      const size_t comma = value.find(L',');
      const size_t close = value.find(
          L']', comma == std::wstring::npos ? 0 : comma + 1);
      if (comma == std::wstring::npos || close == std::wstring::npos) return false;
      const int parsedX = std::stoi(value.substr(1, comma - 1));
      const int parsedY = std::stoi(value.substr(comma + 1, close - comma - 1));
      if (parsedX < 0 || parsedX > 10000 || parsedY < 0 || parsedY > 10000) {
        return false;
      }
      *x = parsedX;
      *y = parsedY;
      return true;
    } catch (...) {
      return false;
    }
  }

  void ProbePlayAll() noexcept {
    if (phase_ != Phase::YouTube || !webview_ || playAllProbeInFlight_) return;
    if (playAllProbeAttempts_ >= kNativeMediaPlayAllRetryLimit) {
      StopPlayAllProbe();
      ClickNormalizedPoint(kNativeMediaFallbackPlayAllXTenThousandths,
                           kNativeMediaFallbackPlayAllYTenThousandths);
      BeginYoutubePlaybackMonitors();
      return;
    }
    ++playAllProbeAttempts_;
    playAllProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMediaPlayAllScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              playAllProbeInFlight_ = false;
              if (phase_ != Phase::YouTube) return S_OK;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                StopPlayAllProbe();
                ClickNormalizedPoint(x, y);
                BeginYoutubePlaybackMonitors();
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) playAllProbeInFlight_ = false;
  }

  void ProbeYoutubeWatchdog() noexcept {
    if (phase_ != Phase::YouTube || !webview_ || !IsYoutubeWatchPage()) return;

    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    if (youtubeWatchdogInFlight_) {
      if (youtubeWatchdogStartedTick_ != 0 &&
          now - youtubeWatchdogStartedTick_ < kYoutubeWatchdogTimeoutMs) {
        return;
      }
      InvalidateYoutubeWatchdog();
    }

    ++youtubeWatchdogRequestGeneration_;
    if (youtubeWatchdogRequestGeneration_ == 0) {
      ++youtubeWatchdogRequestGeneration_;
    }
    const uint64_t requestGeneration = youtubeWatchdogRequestGeneration_;
    youtubeWatchdogInFlight_ = true;
    youtubeWatchdogStartedTick_ = now;
    if (hostWindow_ && IsWindow(hostWindow_)) {
      SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
               static_cast<UINT>(kYoutubeWatchdogTimeoutMs), nullptr);
    }
    const auto alive = alive_;
    ComPtr<ICoreWebView2> requestView = webview_;
    const HRESULT started = requestView->ExecuteScript(
        kNativeMediaYoutubeWatchdogScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive, requestView, requestGeneration](
                HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  requestGeneration != youtubeWatchdogRequestGeneration_ ||
                  webview_.Get() != requestView.Get()) {
                return S_OK;
              }
              youtubeWatchdogInFlight_ = false;
              youtubeWatchdogStartedTick_ = 0;
              if (phase_ != Phase::YouTube || !IsYoutubeWatchPage()) return S_OK;
              if (hostWindow_ && IsWindow(hostWindow_)) {
                SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
                         kNativeMediaYoutubeWatchdogHealthyMs, nullptr);
              }
              if (SUCCEEDED(result) && json &&
                  std::wstring_view(json) == L"\"reload\"") {
                ReloadYoutubePlaylist();
                return S_OK;
              }
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                ClickNormalizedPoint(x, y);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
                           kNativeMediaYoutubeWatchdogRecoveryMs, nullptr);
                }
              }
              return S_OK;
            }).Get());
    if (FAILED(started) &&
        requestGeneration == youtubeWatchdogRequestGeneration_ &&
        webview_.Get() == requestView.Get()) {
      youtubeWatchdogInFlight_ = false;
      youtubeWatchdogStartedTick_ = 0;
    }
  }

  void ProbeTverWatchdog() noexcept {
    if (phase_ != Phase::Tver || !webview_ || tverWatchdogInFlight_ ||
        tverRestarting_ || !IsTverPage()) return;
    tverWatchdogInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMediaTverWatchdogScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              tverWatchdogInFlight_ = false;
              if (phase_ != Phase::Tver || !IsTverPage()) return S_OK;
              if (SUCCEEDED(result) && json &&
                  std::wstring_view(json) == L"\"restart\"") {
                RestartTverAfterPlayback();
                return S_OK;
              }
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                ClickNormalizedPoint(x, y);
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) tverWatchdogInFlight_ = false;
  }

  static LONG AbsoluteMouseCoordinate(int value, int origin, int span) noexcept {
    if (span <= 1) return 0;
    long long scaled =
        (static_cast<long long>(value - origin) * 65535LL) / (span - 1);
    scaled = std::max(0LL, std::min(65535LL, scaled));
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
        (static_cast<long long>(width) * xTenThousandths) / 10000);
    target.y = client.top + static_cast<LONG>(
        (static_cast<long long>(height) * yTenThousandths) / 10000);
    target.x = std::max(client.left, std::min(client.right - 1, target.x));
    target.y = std::max(client.top, std::min(client.bottom - 1, target.y));
    if (!ClientToScreen(hostWindow_, &target)) return;

    const int virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const int virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if (virtualWidth <= 1 || virtualHeight <= 1) return;
    auto setMove = [&](INPUT* input, const POINT& point) noexcept {
      input->type = INPUT_MOUSE;
      input->mi.dx = AbsoluteMouseCoordinate(point.x, virtualLeft, virtualWidth);
      input->mi.dy = AbsoluteMouseCoordinate(point.y, virtualTop, virtualHeight);
      input->mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE |
                          MOUSEEVENTF_VIRTUALDESK;
    };
    INPUT inputs[4]{};
    setMove(&inputs[0], target);
    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    inputs[2].type = INPUT_MOUSE;
    inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP;
    POINT previous{};
    UINT count = 3;
    if (GetCursorPos(&previous)) {
      setMove(&inputs[3], previous);
      count = 4;
    }
    SendInput(count, inputs, sizeof(INPUT));
  }

  void Fail() noexcept {
    failed_ = true;
    tverRestarting_ = false;
    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaPhaseTimer);
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
  Phase phase_ = Phase::YouTube;
  std::wstring phaseStartText_;
  std::wstring phaseEndText_;
  uint64_t controllerGeneration_ = 0;
  uint64_t youtubeWatchdogRequestGeneration_ = 0;
  ULONGLONG youtubeWatchdogStartedTick_ = 0;
  int playAllProbeAttempts_ = 0;
  bool controllerCreating_ = false;
  bool playAllProbeInFlight_ = false;
  bool youtubeWatchdogInFlight_ = false;
  bool tverWatchdogInFlight_ = false;
  bool tverRestarting_ = false;
  bool failed_ = false;
};
