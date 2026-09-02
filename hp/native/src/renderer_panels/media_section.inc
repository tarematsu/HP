namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMediaYoutubeUrl[] =
    L"https://www.youtube.com/playlist?list=PLMWqSdpIVl30";
constexpr wchar_t kNativeMediaTverUrl[] =
    L"https://tver.jp/series/srx97ftk3w";
constexpr UINT_PTR kNativeMediaPhaseTimer = 0x4D560001;
constexpr UINT_PTR kNativeMediaPlayAllTimer = 0x4D560002;
constexpr UINT_PTR kNativeMediaPlaybackHealthTimer = 0x4D560004;
constexpr UINT_PTR kNativeMediaNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;
constexpr UINT kNativeMediaPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaPlayAllRetryMs = 500U;
constexpr UINT kNativeMediaPlaybackHealthMs = 10U * 1000U;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogMs = 1000U;
constexpr int kNativeMediaPlayAllRetryLimit = 20;
constexpr int kNativeMediaFallbackPlayAllXTenThousandths = 5850;
constexpr int kNativeMediaFallbackPlayAllYTenThousandths = 4250;

constexpr wchar_t kNativeMediaPlayAllScript[] = LR"JS(
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
      ytd-watch-flexy #below,
      ytd-watch-flexy #secondary {
        content-visibility: hidden !important;
        contain-intrinsic-size: 1px 1px !important;
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
  return [
    Math.max(0, Math.min(10000, Math.round(
        ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
    Math.max(0, Math.min(10000, Math.round(
        ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
  ];
})()
)JS";

constexpr wchar_t kNativeMediaYoutubeWatchdogScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (!player || window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  const isClickable = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const selectors = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button'
  ];
  let target = Array.from(player.querySelectorAll(selectors.join(',')))
      .find(isClickable) || null;
  if (!target) {
    const fullscreen = document.fullscreenElement ||
        player.classList.contains('ytp-fullscreen');
    if (fullscreen) return null;
    target = player.querySelector('.ytp-fullscreen-button');
    if (!isClickable(target)) return null;
  }

  const rect = target.getBoundingClientRect();
  return [
    Math.max(0, Math.min(10000, Math.round(
        ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
    Math.max(0, Math.min(10000, Math.round(
        ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
  ];
})()
)JS";

constexpr wchar_t kNativeMediaYoutubeHealthScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (player) {
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('large', 'large');
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality('large');
      }
    } catch (_) {
    }
  }
  const video = document.querySelector('video');
  if (video && video.error) return true;
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

constexpr wchar_t kNativeMediaTverLoopScript[] = LR"JS(
(() => {
  if (window.__homePanelSakuraMeetsLoopTimer) return;
  const seriesUrl = 'https://tver.jp/series/srx97ftk3w';
  const playbackRate = 1.75;
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const isDisplayed = element => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.textContent || ''));

  const openLatestEpisode = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/episodes/"]'))
        .filter(link => link.href && isDisplayed(link));
    if (!links.length) return;
    const latest = links.find(link => /最新話|最新回/.test(labelOf(link))) ||
        links.find(link => !/(放課後トーク|予告|\bPR\b)/i.test(labelOf(link))) ||
        links[0];
    if (latest && latest.href) location.replace(latest.href);
  };

  const ensureEpisodePlayback = () => {
    const path = location.pathname;
    let state = window.__homePanelSakuraMeetsState;
    if (!state || state.path !== path) {
      state = { path, maxDuration: 0, maxTime: 0 };
      window.__homePanelSakuraMeetsState = state;
    }
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(isDisplayed) || videos[0] || null;
    if (video) {
      video.defaultPlaybackRate = playbackRate;
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
      if (Number.isFinite(video.duration)) {
        state.maxDuration = Math.max(state.maxDuration, video.duration);
      }
      if (Number.isFinite(video.currentTime)) {
        state.maxTime = Math.max(state.maxTime, video.currentTime);
      }
      if (video.ended && state.maxDuration >= 600 && state.maxTime >= 300) {
        location.replace(seriesUrl);
        return;
      }
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
    }

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(isDisplayed);
    const playButton = buttons.find(button => {
      const label = labelOf(button).toLowerCase();
      return label === '再生' || label === '再生する' ||
             label === '動画を再生' || label === 'play' ||
             label === 'play video';
    });
    if (video && video.paused && !video.ended) {
      if (playButton) playButton.click();
      try {
        const promise = video.play();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => { if (playButton) playButton.click(); });
        }
      } catch (_) {
        if (playButton) playButton.click();
      }
    } else if (!video && playButton) {
      playButton.click();
    }
  };

  const ensure = () => {
    try {
      if (location.hostname !== 'tver.jp') {
        location.replace(seriesUrl);
      } else if (location.pathname.startsWith('/series/')) {
        openLatestEpisode();
      } else if (location.pathname.startsWith('/episodes/')) {
        ensureEpisodePlayback();
      } else {
        location.replace(seriesUrl);
      }
    } catch (_) {
    }
  };
  ensure();
  window.__homePanelSakuraMeetsLoopTimer = window.setInterval(ensure, 2000);
})()
)JS";

LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

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
            const auto ready =
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
                        controller_->Close();
                        controller_.Reset();
                        Fail();
                        return S_OK;
                      }
                      Configure();
                      return S_OK;
                    });
            if (FAILED(environment_->CreateCoreWebView2Controller(
                    hostWindow_, ready.Get()))) {
              Fail();
            }
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
    if (timerId == kNativeMediaPlaybackHealthTimer) {
      ProbeYoutubeHealth();
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
    StopYoutubeMonitors();
    StopNavigationRetry();
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaPhaseTimer);
    }
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
    environment_.Reset();
    hostWindow_ = nullptr;
  }

 private:
  enum class Phase { YouTube, Tver };

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
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                failed_ = false;
                StopNavigationRetry();
                if (phase_ == Phase::Tver && IsTverPage()) {
                  StopYoutubeMonitors();
                  webview_->ExecuteScript(kNativeMediaTverLoopScript, nullptr);
                } else if (phase_ == Phase::YouTube && IsYoutubePlaylistPage()) {
                  StopYoutubePlaybackMonitors();
                  BeginPlayAllProbe();
                } else if (phase_ == Phase::YouTube && IsYoutubeWatchPage()) {
                  StopPlayAllProbe();
                  BeginYoutubePlaybackMonitors();
                } else {
                  StopYoutubeMonitors();
                }
                return S_OK;
              }).Get(),
          &navigationCompletedToken_);

      Resize();
      controller_->put_IsVisible(TRUE);
      SwitchToYouTube();
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
    failed_ = false;
    StopYoutubeMonitors();
    StopNavigationRetry();
    if (!webview_ || FAILED(webview_->Navigate(kNativeMediaYoutubeUrl))) {
      ScheduleNavigationRetry();
    }
    ArmPhaseTimer();
  }

  void SwitchToTver() noexcept {
    phase_ = Phase::Tver;
    failed_ = false;
    StopYoutubeMonitors();
    StopNavigationRetry();
    if (!webview_ || FAILED(webview_->Navigate(kNativeMediaTverUrl))) {
      ScheduleNavigationRetry();
    }
    ArmPhaseTimer();
  }

  void NavigateCurrentPhase() noexcept {
    if (!webview_) {
      Fail();
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

  void BeginYoutubePlaybackMonitors() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    playbackHealthProbeInFlight_ = false;
    youtubeWatchdogInFlight_ = false;
    KillTimer(hostWindow_, kNativeMediaPlaybackHealthTimer);
    KillTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer);
    SetTimer(hostWindow_, kNativeMediaPlaybackHealthTimer,
             kNativeMediaPlaybackHealthMs, nullptr);
    SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
             kNativeMediaYoutubeWatchdogMs, nullptr);
    ProbeYoutubeHealth();
    ProbeYoutubeWatchdog();
  }

  void StopYoutubePlaybackMonitors() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaPlaybackHealthTimer);
      KillTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer);
    }
    playbackHealthProbeInFlight_ = false;
    youtubeWatchdogInFlight_ = false;
  }

  void StopYoutubeMonitors() noexcept {
    StopPlayAllProbe();
    StopYoutubePlaybackMonitors();
  }

  static bool ParseNormalizedPoint(LPCWSTR json, int* x, int* y) noexcept {
    if (!json || !x || !y) return false;
    try {
      const std::wstring value(json);
      if (value.size() < 5 || value.front() != L'[') return false;
      const size_t comma = value.find(L',');
      const size_t close = value.find(L']', comma == std::wstring::npos
                                               ? 0 : comma + 1);
      if (comma == std::wstring::npos || close == std::wstring::npos) return false;
      const int parsedX = std::stoi(value.substr(1, comma - 1));
      const int parsedY = std::stoi(
          value.substr(comma + 1, close - comma - 1));
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

  void ProbeYoutubeHealth() noexcept {
    if (phase_ != Phase::YouTube || !webview_ ||
        playbackHealthProbeInFlight_) return;
    playbackHealthProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMediaYoutubeHealthScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              playbackHealthProbeInFlight_ = false;
              if (phase_ == Phase::YouTube && SUCCEEDED(result) && json &&
                  std::wstring_view(json) == L"true") {
                ReloadYoutubePlaylist();
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) playbackHealthProbeInFlight_ = false;
  }

  void ProbeYoutubeWatchdog() noexcept {
    if (phase_ != Phase::YouTube || !webview_ || youtubeWatchdogInFlight_ ||
        !IsYoutubeWatchPage()) return;
    youtubeWatchdogInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMediaYoutubeWatchdogScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              youtubeWatchdogInFlight_ = false;
              if (phase_ != Phase::YouTube || !IsYoutubeWatchPage()) return S_OK;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                ClickNormalizedPoint(x, y);
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) youtubeWatchdogInFlight_ = false;
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
    if (phase_ != Phase::YouTube || !hostWindow_ || !IsWindow(hostWindow_)) return;
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
    StopYoutubeMonitors();
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
  int playAllProbeAttempts_ = 0;
  bool playAllProbeInFlight_ = false;
  bool playbackHealthProbeInFlight_ = false;
  bool youtubeWatchdogInFlight_ = false;
  bool failed_ = false;
};

LRESULT CALLBACK NativeMediaPanelWndProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  NativeMediaPanelHost* host = reinterpret_cast<NativeMediaPanelHost*>(
      GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    host = static_cast<NativeMediaPanelHost*>(create->lpCreateParams);
    if (host) {
      host->Attach(hwnd);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(host));
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
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) return false;
  static std::once_flag once;
  static bool registered = false;
  std::call_once(once, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = NativeMediaPanelWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kNativeMvPanelHostClass;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    SetLastError(ERROR_SUCCESS);
    registered = RegisterClassW(&windowClass) != 0 ||
                 GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!registered) return false;

  HWND host = FindWindowExW(
      parentWindow, nullptr, kNativeMvPanelHostClass, nullptr);
  if (!host) {
    auto* state = new (std::nothrow) NativeMediaPanelHost(dataDir);
    if (!state) return false;
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
    RECT mediaBounds{};
    GetClientRect(nativeRadarWindow_, &mediaBounds);
    if (mediaBounds.right > mediaBounds.left && mediaBounds.bottom > mediaBounds.top) {
      EnsureNativeMvPanel(nativeRadarWindow_, dataDir_, mediaBounds);
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
}
