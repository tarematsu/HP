// Native WebView2 media host lifecycle, navigation and playback watchdogs.
class NativeMediaPanelHost final {
 public:
  explicit NativeMediaPanelHost(const fs::path& dataDir)
      : userDataFolder_(dataDir / L"webview2-youtube-mv"),
        alive_(std::make_shared<std::atomic<bool>>(true)) {}

  void Attach(HWND hwnd) noexcept { hostWindow_ = hwnd; }

  void SetMuted(bool muted) noexcept {
    muted_ = muted;
    if (!webview_) return;
    ComPtr<ICoreWebView2_8> audio;
    if (SUCCEEDED(webview_.As(&audio)) && audio) {
      audio->put_IsMuted(muted ? TRUE : FALSE);
    }
  }

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
    if (!GetClientRect(hostWindow_, &client)) return;
    const LONG width = client.right - client.left;
    const LONG height = client.bottom - client.top;
    if (width <= 0 || height <= 0) return;

    // Power-saving monitor routing may clip the host HWND to 1x1. Keep the
    // WebView viewport at its normal video size so responsive page layout and
    // DOM coordinates remain stable while the surface is behind the dashboard.
    if (width <= 1 || height <= 1) {
      HWND parent = GetParent(hostWindow_);
      RECT parentClient{};
      if (parent && IsWindow(parent) && GetClientRect(parent, &parentClient) &&
          parentClient.right > parentClient.left &&
          parentClient.bottom > parentClient.top) {
        LONG videoTop = parentClient.top;
        HWND status = FindWindowExW(
            parent, nullptr, L"HomePanelNativeSpotifyStatus", nullptr);
        if (status && IsWindow(status)) {
          RECT statusBounds{};
          if (GetWindowRect(status, &statusBounds) &&
              MapWindowPoints(nullptr, parent,
                              reinterpret_cast<POINT*>(&statusBounds), 2)) {
            videoTop = std::clamp<LONG>(
                statusBounds.bottom, parentClient.top, parentClient.bottom - 1);
          }
        }
        client = RECT{
            0,
            0,
            std::max<LONG>(1, parentClient.right - parentClient.left),
            std::max<LONG>(1, parentClient.bottom - videoTop)};
      }
    }
    controller_->put_Bounds(client);
  }

  bool OnTimer(UINT_PTR timerId) noexcept {
    if (timerId == kNativeMediaPhaseTimer) {
      phase_ == Phase::YouTube ? SwitchToTver() : SwitchToYouTube();
      return true;
    }
    if (timerId == kNativeMediaNavigationRetryTimer) {
      StopNavigationRetry();
      NavigateCurrentPhase();
      return true;
    }
    if (timerId == kNativeMediaYoutubeWatchdogTimer) {
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
    NativeMediaTverEndQueuePhase();
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
  enum class RecoveryState { Healthy, Suspect, Recovering, Reloading };

  static constexpr ULONGLONG kYoutubeWatchdogTimeoutMs = 5ULL * 1000ULL;
  static constexpr ULONGLONG kTverWatchdogTimeoutMs = 5ULL * 1000ULL;
  static constexpr UINT kNavigationRetryMaxMs = 30U * 1000U;
  static constexpr UINT kTverWatchdogHealthyMs = 60U * 1000U;
  static constexpr UINT kTverWatchdogRecoveryMs = 5U * 1000U;

  UINT_PTR ArmTimer(UINT_PTR timerId, UINT intervalMs) noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return 0;
    if (timerId == kNativeMediaPhaseTimer) {
      SetSpotifyMediaPhase(phase_ == Phase::Tver);
    }
    if (timerId == kNativeMediaTverWatchdogTimer) {
      return ArmNativeMediaTrustedWakeTimer(
          hostWindow_, webview_.Get(), controller_.Get(), timerId, intervalMs);
    }
    return ::SetTimer(hostWindow_, timerId, intervalMs, nullptr);
  }

  HRESULT ExecutePolicyScript(
      ICoreWebView2* view, const wchar_t* script,
      ICoreWebView2ExecuteScriptCompletedHandler* handler) noexcept {
    if (!view) return E_POINTER;
    return ExecuteNativeMediaPolicyScript(
        view, hostWindow_, alive_, script, handler);
  }

  UINT DispatchTrustedInput(
      UINT count, LPINPUT inputs, int inputSize) noexcept {
    return NativeMediaDispatchTrustedInput(
        phase_ == Phase::Tver, webview_.Get(), controller_.Get(), hostWindow_,
        count, inputs, inputSize);
  }

  const wchar_t* CurrentProfileName() const noexcept {
    return kNativeMediaProfile;
  }

  void SetRecoveryState(RecoveryState state, UINT cooldownMs = 0) noexcept {
    recoveryState_ = state;
    recoveryNotBeforeTick_ = 0;
    if (state != RecoveryState::Recovering || cooldownMs == 0) return;
    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    recoveryNotBeforeTick_ = now + cooldownMs;
  }

  bool RecoveryCoolingDown(ULONGLONG now) const noexcept {
    return recoveryState_ == RecoveryState::Recovering &&
           recoveryNotBeforeTick_ != 0 && now < recoveryNotBeforeTick_;
  }

  void ResetNavigationRetryBackoff() noexcept {
    navigationRetryMs_ = kNativeMediaNavigationRetryMs;
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
      if (webResourceRequestedToken_.value != 0) {
        webview_->remove_WebResourceRequested(webResourceRequestedToken_);
      }
    }
    navigationCompletedToken_ = {};
    newWindowToken_ = {};
    webResourceRequestedToken_ = {};
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
      SetMuted(muted_);
      ComPtr<ICoreWebView2Controller2> controller2;
      if (SUCCEEDED(controller_.As(&controller2)) && controller2) {
        COREWEBVIEW2_COLOR background{255, 0, 0, 0};
        controller2->put_DefaultBackgroundColor(background);
      }
      ApplyMediaWebViewFeaturePolicy(
          controller_.Get(), webview_.Get(), false);

      const auto alive = alive_;
      webview_->AddWebResourceRequestedFilter(
          L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
      ComPtr<ICoreWebView2Environment> requestEnvironment = environment_;
      webview_->add_WebResourceRequested(
          Callback<ICoreWebView2WebResourceRequestedEventHandler>(
              [alive, requestEnvironment](
                  ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args)
                  -> HRESULT {
                if (!alive->load(std::memory_order_acquire) || !args ||
                    !requestEnvironment) {
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
          &webResourceRequestedToken_);

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
      webview_->AddScriptToExecuteOnDocumentCreated(
          kNativeMediaCursorSuppressionScript, nullptr);

      webview_->add_NavigationCompleted(
          Callback<ICoreWebView2NavigationCompletedEventHandler>(
              [this, alive](ICoreWebView2*,
                            ICoreWebView2NavigationCompletedEventArgs* args)
                  -> HRESULT {
                if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
                BOOL succeeded = FALSE;
                if (FAILED(args->get_IsSuccess(&succeeded)) || !succeeded) {
                  SetRecoveryState(RecoveryState::Suspect);
                  StopYoutubeMonitors();
                  StopTverPlaybackMonitor();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                failed_ = false;
                StopNavigationRetry();
                ResetNavigationRetryBackoff();
                SetRecoveryState(RecoveryState::Healthy);
                if (phase_ == Phase::YouTube) {
                  ExecutePolicyScript(
                      webview_.Get(), kNativeMediaYoutubeCleanPlayerScript, nullptr);
                }
                if (phase_ == Phase::Tver && IsTverPage()) {
                  StopYoutubeMonitors();
                  ExecutePolicyScript(
                      webview_.Get(), kNativeMediaTverLoopScript, nullptr);
                  BeginTverPlaybackMonitor();
                } else if (phase_ == Phase::YouTube && IsYoutubePlaylistPage()) {
                  StopTverPlaybackMonitor();
                  StopYoutubePlaybackMonitors();
                  BeginYoutubePlaylistFallback();
                } else if (phase_ == Phase::YouTube && IsYoutubeWatchPage()) {
                  StopTverPlaybackMonitor();
                  BeginYoutubePlaybackMonitors();
                } else {
                  StopYoutubeMonitors();
                  StopTverPlaybackMonitor();
                }
                return S_OK;
              }).Get(),
          &navigationCompletedToken_);

      Resize();
      controller_->put_IsVisible(TRUE);
      ComPtr<ICoreWebView2> startupView = webview_;
      const uint64_t generation = controllerGeneration_;
      ResetWebViewStartupCaches(
          startupView.Get(),
          [this, alive, startupView, generation](HRESULT) {
            if (!alive->load(std::memory_order_acquire) ||
                generation != controllerGeneration_ ||
                webview_.Get() != startupView.Get()) {
              return;
            }
            NavigateCurrentPhase();
          });
    } catch (...) {
      Fail();
    }
  }

  void ArmPhaseTimer() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    KillTimer(hostWindow_, kNativeMediaPhaseTimer);
    if (ArmTimer(kNativeMediaPhaseTimer, kNativeMediaPhaseMs) == 0) {
      Fail();
    }
  }

  void SwitchToYouTube() noexcept {
    phase_ = Phase::YouTube;
    NativeMediaTverEndQueuePhase();
    failed_ = false;
    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    ResetNavigationRetryBackoff();
    SetRecoveryState(RecoveryState::Suspect);
    NavigateCurrentPhase();
    ArmPhaseTimer();
  }

  void SwitchToTver() noexcept {
    phase_ = Phase::Tver;
    failed_ = false;
    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    ResetNavigationRetryBackoff();
    SetRecoveryState(RecoveryState::Suspect);
    NativeMediaTverBeginQueuePhase(hostWindow_, alive_);
    NavigateCurrentPhase();
    ArmPhaseTimer();
  }

  void NavigateCurrentPhase() noexcept {
    if (!webview_) {
      CreateControllerForCurrentPhase();
      ScheduleNavigationRetry();
      return;
    }
    if (phase_ == Phase::YouTube) {
      if (FAILED(webview_->Navigate(kNativeMediaYoutubeUrl))) {
        ScheduleNavigationRetry();
      }
      return;
    }

    const std::wstring url =
        NativeMediaTverCurrentEpisodeUrl(hostWindow_, alive_);
    if (url.empty()) {
      ScheduleNavigationRetry();
      return;
    }
    if (FAILED(webview_->Navigate(url.c_str()))) {
      ScheduleNavigationRetry();
      return;
    }
    NativeMediaTverMarkNavigationStarted(url);
    if (hostWindow_ && IsWindow(hostWindow_)) {
      ArmTimer(kNativeMediaTverWatchdogTimer, kTverWatchdogRecoveryMs);
    }
  }

  void ReloadYoutubePlaylist() noexcept {
    if (phase_ != Phase::YouTube || !webview_) return;
    SetRecoveryState(RecoveryState::Reloading);
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
    if (navigationRetryArmed_) return true;
    KillTimer(hostWindow_, kNativeMediaNavigationRetryTimer);
    const UINT delayMs = navigationRetryMs_;
    if (ArmTimer(kNativeMediaNavigationRetryTimer, delayMs) == 0) return false;
    navigationRetryArmed_ = true;
    navigationRetryMs_ = std::min(kNavigationRetryMaxMs, delayMs * 2U);
    SetRecoveryState(RecoveryState::Suspect);
    return true;
  }

  void StopNavigationRetry() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaNavigationRetryTimer);
    }
    navigationRetryArmed_ = false;
  }

  void BeginYoutubePlaylistFallback() noexcept {
    if (phase_ != Phase::YouTube || !webview_ || !IsYoutubePlaylistPage()) return;
    ExecutePolicyScript(webview_.Get(), kNativeMediaPlayAllScript, nullptr);
  }

  void InvalidateYoutubeWatchdog() noexcept {
    ++youtubeWatchdogRequestGeneration_;
    if (youtubeWatchdogRequestGeneration_ == 0) {
      ++youtubeWatchdogRequestGeneration_;
    }
    youtubeWatchdogInFlight_ = false;
    youtubeWatchdogStartedTick_ = 0;
  }

  void InvalidateTverWatchdog() noexcept {
    ++tverWatchdogRequestGeneration_;
    if (tverWatchdogRequestGeneration_ == 0) {
      ++tverWatchdogRequestGeneration_;
    }
    tverWatchdogInFlight_ = false;
    tverWatchdogStartedTick_ = 0;
  }

  void BeginYoutubePlaybackMonitors() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    InvalidateYoutubeWatchdog();
    SetRecoveryState(RecoveryState::Suspect);
    KillTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer);
    ArmTimer(kNativeMediaYoutubeWatchdogTimer,
             kNativeMediaYoutubeWatchdogRecoveryMs);
    ProbeYoutubeWatchdog();
  }

  void StopYoutubePlaybackMonitors() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer);
    }
    InvalidateYoutubeWatchdog();
  }

  void StopYoutubeMonitors() noexcept {
    StopYoutubePlaybackMonitors();
  }

  void BeginTverPlaybackMonitor() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    InvalidateTverWatchdog();
    SetRecoveryState(RecoveryState::Suspect);
    KillTimer(hostWindow_, kNativeMediaTverWatchdogTimer);
    ArmTimer(kNativeMediaTverWatchdogTimer, kTverWatchdogRecoveryMs);
    ProbeTverWatchdog();
  }

  void StopTverPlaybackMonitor() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaTverWatchdogTimer);
    }
    InvalidateTverWatchdog();
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

  static bool ParseCssPoint(LPCWSTR json, double* x, double* y) noexcept {
    if (!json || !x || !y) return false;
    try {
      const std::wstring value(json);
      if (value.size() < 5 || value.front() != L'[') return false;
      const size_t comma = value.find(L',');
      const size_t close = value.find(
          L']', comma == std::wstring::npos ? 0 : comma + 1);
      if (comma == std::wstring::npos || close == std::wstring::npos) return false;
      const double parsedX = std::stod(value.substr(1, comma - 1));
      const double parsedY = std::stod(value.substr(comma + 1, close - comma - 1));
      if (!(parsedX >= 0.0 && parsedX <= 100000.0) ||
          !(parsedY >= 0.0 && parsedY <= 100000.0)) {
        return false;
      }
      *x = parsedX;
      *y = parsedY;
      return true;
    } catch (...) {
      return false;
    }
  }

  void DispatchYoutubeCssPoint(
      ICoreWebView2* webview, double cssX, double cssY) noexcept {
    if (!webview || !(cssX >= 0.0 && cssX <= 100000.0) ||
        !(cssY >= 0.0 && cssY <= 100000.0)) {
      return;
    }

    const ULONGLONG clickToken = NativeMediaAcquireTrustedClick();
    if (clickToken == 0) return;

    ComPtr<ICoreWebView2> view = webview;
    const auto alive = alive_;
    const std::wstring moved =
        NativeMediaTrustedMouseParams(L"mouseMoved", cssX, cssY, false);
    const HRESULT dispatched = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [alive, view, cssX, cssY, clickToken](
                HRESULT moveResult, LPCWSTR) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  FAILED(moveResult) || !view) {
                NativeMediaReleaseTrustedClick(clickToken);
                return S_OK;
              }
              const std::wstring pressed =
                  NativeMediaTrustedMouseParams(
                      L"mousePressed", cssX, cssY, true);
              const HRESULT pressDispatched = view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", pressed.c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [alive, view, cssX, cssY, clickToken](
                          HRESULT pressedResult, LPCWSTR) -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) ||
                            FAILED(pressedResult) || !view) {
                          NativeMediaReleaseTrustedClick(clickToken);
                          return S_OK;
                        }
                        const std::wstring released =
                            NativeMediaTrustedMouseParams(
                                L"mouseReleased", cssX, cssY, false);
                        const HRESULT releaseDispatched =
                            view->CallDevToolsProtocolMethod(
                                L"Input.dispatchMouseEvent", released.c_str(),
                                Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                                    [clickToken](HRESULT, LPCWSTR) -> HRESULT {
                                      NativeMediaReleaseTrustedClick(clickToken);
                                      return S_OK;
                                    }).Get());
                        if (FAILED(releaseDispatched)) {
                          NativeMediaReleaseTrustedClick(clickToken);
                        }
                        return S_OK;
                      }).Get());
              if (FAILED(pressDispatched)) {
                NativeMediaReleaseTrustedClick(clickToken);
              }
              return S_OK;
            }).Get());
    if (FAILED(dispatched)) {
      NativeMediaReleaseTrustedClick(clickToken);
    }
  }

  void ClickYoutubeNormalizedPoint(
      int xTenThousandths, int yTenThousandths) noexcept {
    if (phase_ != Phase::YouTube || !webview_) return;

    // The watchdog script reports a viewport-relative point. Re-project that
    // point inside the page and send the resulting CSS coordinates directly to
    // CDP. Do not route through HWND, screen coordinates, DPI or WebView zoom.
    std::wstring script = L"(() => {const w=window.innerWidth;const h=window.innerHeight;";
    script += L"if(!(w>0&&h>0))return null;return [w*" +
              std::to_wstring(xTenThousandths) + L"/10000,h*" +
              std::to_wstring(yTenThousandths) + L"/10000];})()";

    const auto alive = alive_;
    ComPtr<ICoreWebView2> requestedView = webview_;
    const HRESULT started = requestedView->ExecuteScript(
        script.c_str(),
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive, requestedView](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  phase_ != Phase::YouTube ||
                  webview_.Get() != requestedView.Get()) {
                return S_OK;
              }
              double cssX = 0.0;
              double cssY = 0.0;
              if (SUCCEEDED(result) && ParseCssPoint(json, &cssX, &cssY)) {
                DispatchYoutubeCssPoint(requestedView.Get(), cssX, cssY);
              }
              return S_OK;
            }).Get());
    (void)started;
  }

  void ProbeYoutubeWatchdog() noexcept {
    if (phase_ != Phase::YouTube || !webview_ || !IsYoutubeWatchPage()) return;

    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    if (RecoveryCoolingDown(now)) return;
    if (youtubeWatchdogInFlight_) {
      if (youtubeWatchdogStartedTick_ != 0 &&
          now - youtubeWatchdogStartedTick_ < kYoutubeWatchdogTimeoutMs) {
        return;
      }
      InvalidateYoutubeWatchdog();
      SetRecoveryState(RecoveryState::Suspect);
    }

    ++youtubeWatchdogRequestGeneration_;
    if (youtubeWatchdogRequestGeneration_ == 0) {
      ++youtubeWatchdogRequestGeneration_;
    }
    const uint64_t requestGeneration = youtubeWatchdogRequestGeneration_;
    youtubeWatchdogInFlight_ = true;
    youtubeWatchdogStartedTick_ = now;
    if (hostWindow_ && IsWindow(hostWindow_)) {
      ArmTimer(kNativeMediaYoutubeWatchdogTimer,
               static_cast<UINT>(kYoutubeWatchdogTimeoutMs));
    }
    const auto alive = alive_;
    ComPtr<ICoreWebView2> requestView = webview_;
    const HRESULT started = ExecutePolicyScript(
        requestView.Get(), kNativeMediaYoutubeWatchdogScript,
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
              if (SUCCEEDED(result) && json &&
                  std::wstring_view(json) == L"\"reload\"") {
                SetRecoveryState(RecoveryState::Reloading);
                ReloadYoutubePlaylist();
                return S_OK;
              }
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                SetRecoveryState(
                    RecoveryState::Recovering,
                    kNativeMediaYoutubeWatchdogRecoveryMs);
                ClickYoutubeNormalizedPoint(x, y);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  ArmTimer(kNativeMediaYoutubeWatchdogTimer,
                           kNativeMediaYoutubeWatchdogRecoveryMs);
                }
                return S_OK;
              }
              if (SUCCEEDED(result)) {
                SetRecoveryState(RecoveryState::Healthy);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  ArmTimer(kNativeMediaYoutubeWatchdogTimer,
                           kNativeMediaYoutubeWatchdogHealthyMs);
                }
              } else {
                SetRecoveryState(RecoveryState::Suspect);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  ArmTimer(kNativeMediaYoutubeWatchdogTimer,
                           kNativeMediaYoutubeWatchdogRecoveryMs);
                }
              }
              return S_OK;
            }).Get());
    if (FAILED(started) &&
        requestGeneration == youtubeWatchdogRequestGeneration_ &&
        webview_.Get() == requestView.Get()) {
      youtubeWatchdogInFlight_ = false;
      youtubeWatchdogStartedTick_ = 0;
      SetRecoveryState(RecoveryState::Suspect);
      if (hostWindow_ && IsWindow(hostWindow_)) {
        ArmTimer(kNativeMediaYoutubeWatchdogTimer,
                 kNativeMediaYoutubeWatchdogRecoveryMs);
      }
    }
  }

  void ProbeTverWatchdog() noexcept {
    if (phase_ != Phase::Tver || !webview_) return;

    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    if (RecoveryCoolingDown(now)) return;
    if (tverWatchdogInFlight_) {
      if (tverWatchdogStartedTick_ != 0 &&
          now - tverWatchdogStartedTick_ < kTverWatchdogTimeoutMs) {
        return;
      }
      InvalidateTverWatchdog();
      SetRecoveryState(RecoveryState::Suspect);
    }
    if (!IsTverPage()) {
      SetRecoveryState(RecoveryState::Reloading);
      NavigateCurrentPhase();
      return;
    }

    LPWSTR rawSource = nullptr;
    std::wstring source;
    if (SUCCEEDED(webview_->get_Source(&rawSource)) && rawSource) {
      source.assign(rawSource);
      CoTaskMemFree(rawSource);
    }
    if (!source.empty() && NativeMediaTverStartupExpired(source, now)) {
      SetRecoveryState(RecoveryState::Reloading);
      if (NativeMediaTverAdvanceEpisode(source)) {
        NavigateCurrentPhase();
      } else {
        ScheduleNavigationRetry();
      }
      return;
    }

    ++tverWatchdogRequestGeneration_;
    if (tverWatchdogRequestGeneration_ == 0) {
      ++tverWatchdogRequestGeneration_;
    }
    const uint64_t requestGeneration = tverWatchdogRequestGeneration_;
    tverWatchdogInFlight_ = true;
    tverWatchdogStartedTick_ = now;
    if (hostWindow_ && IsWindow(hostWindow_)) {
      ArmTimer(kNativeMediaTverWatchdogTimer,
               static_cast<UINT>(kTverWatchdogTimeoutMs));
    }
    const auto alive = alive_;
    ComPtr<ICoreWebView2> requestView = webview_;
    const HRESULT started = ExecutePolicyScript(
        requestView.Get(), kNativeMediaTverWatchdogScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive, requestView, requestGeneration](
                HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  requestGeneration != tverWatchdogRequestGeneration_ ||
                  webview_.Get() != requestView.Get()) {
                return S_OK;
              }
              tverWatchdogInFlight_ = false;
              tverWatchdogStartedTick_ = 0;
              if (phase_ != Phase::Tver || !IsTverPage()) return S_OK;
              if (SUCCEEDED(result) && json &&
                  std::wstring_view(json) == L"\"restart\"") {
                SetRecoveryState(RecoveryState::Reloading);
                NavigateCurrentPhase();
                return S_OK;
              }
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                SetRecoveryState(
                    RecoveryState::Recovering, kTverWatchdogRecoveryMs);
                ClickNormalizedPoint(x, y);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  ArmTimer(kNativeMediaTverWatchdogTimer,
                           kTverWatchdogRecoveryMs);
                }
                return S_OK;
              }
              if (SUCCEEDED(result)) {
                SetRecoveryState(RecoveryState::Healthy);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  ArmTimer(kNativeMediaTverWatchdogTimer,
                           kTverWatchdogHealthyMs);
                }
              } else {
                SetRecoveryState(RecoveryState::Suspect);
                if (hostWindow_ && IsWindow(hostWindow_)) {
                  ArmTimer(kNativeMediaTverWatchdogTimer,
                           kTverWatchdogRecoveryMs);
                }
              }
              return S_OK;
            }).Get());
    if (FAILED(started) &&
        requestGeneration == tverWatchdogRequestGeneration_ &&
        webview_.Get() == requestView.Get()) {
      tverWatchdogInFlight_ = false;
      tverWatchdogStartedTick_ = 0;
      SetRecoveryState(RecoveryState::Suspect);
      if (hostWindow_ && IsWindow(hostWindow_)) {
        ArmTimer(kNativeMediaTverWatchdogTimer,
                 kTverWatchdogRecoveryMs);
      }
    }
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
    DispatchTrustedInput(count, inputs, sizeof(INPUT));
  }

  void Fail() noexcept {
    failed_ = true;
    NativeMediaTverEndQueuePhase();
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
  EventRegistrationToken webResourceRequestedToken_{};
  Phase phase_ = Phase::YouTube;
  RecoveryState recoveryState_ = RecoveryState::Healthy;
  uint64_t controllerGeneration_ = 0;
  uint64_t youtubeWatchdogRequestGeneration_ = 0;
  uint64_t tverWatchdogRequestGeneration_ = 0;
  ULONGLONG youtubeWatchdogStartedTick_ = 0;
  ULONGLONG tverWatchdogStartedTick_ = 0;
  ULONGLONG recoveryNotBeforeTick_ = 0;
  UINT navigationRetryMs_ = kNativeMediaNavigationRetryMs;
  bool controllerCreating_ = false;
  bool navigationRetryArmed_ = false;
  bool youtubeWatchdogInFlight_ = false;
  bool tverWatchdogInFlight_ = false;
  bool muted_ = false;
  bool failed_ = false;
};
