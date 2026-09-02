#include "../wic_image.h"
#include "../winhttp_helpers.h"

namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMvPanelPageUrl[] =
    L"https://www.youtube.com/playlist?list=PLMWqSdpIVl30";
constexpr wchar_t kNativeMvPauseImageUrl[] =
    L"https://sakurazaka46.com/files/14/Sakurazaka4615th%20Single_Lonesome%20rabbit%20What%27s%20KAZOKU_AP.jpg";
constexpr UINT_PTR kNativeMvRandomActionTimer = 0x4D560001;
constexpr UINT_PTR kNativeMvPlayAllRetryTimer = 0x4D560002;
constexpr UINT_PTR kNativeMvFullscreenRetryTimer = 0x4D560003;
constexpr UINT_PTR kNativeMvPlaybackHealthTimer = 0x4D560004;
constexpr UINT_PTR kNativeMvNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMvAdSkipTimer = 0x4D560006;
constexpr UINT kNativeMvPauseImageReadyMessage = WM_APP + 0x4D5;
constexpr UINT kNativeMvPauseMinSeconds = 50U * 60U;
constexpr UINT kNativeMvPauseSpanSeconds = 10U * 60U;
constexpr UINT kNativeMvResumeMinSeconds = 60U * 60U;
constexpr UINT kNativeMvResumeSpanSeconds = 20U * 60U;
constexpr size_t kNativeMvPauseImageMaxBytes = 16U * 1024U * 1024U;
constexpr UINT kNativeMvPlayAllRetryMs = 500U;
constexpr UINT kNativeMvFullscreenRetryMs = 500U;
constexpr UINT kNativeMvPlaybackHealthMs = 10U * 1000U;
constexpr UINT kNativeMvNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMvAdSkipProbeMs = 1000U;
constexpr int kNativeMvPlayAllRetryLimit = 20;
constexpr int kNativeMvFullscreenRetryLimit = 30;
// Screenshot 709x1536: WebView ~= (213,531)-(700,804), Play all center
// ~= (498,647), which is 58.5% across and 42.5% down the WebView.
constexpr int kNativeMvFallbackPlayAllXTenThousandths = 5850;
constexpr int kNativeMvFallbackPlayAllYTenThousandths = 4250;
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
      ytd-watch-flexy #below,
      ytd-watch-flexy #secondary {
        content-visibility: hidden !important;
        contain-intrinsic-size: 1px 1px !important;
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
constexpr wchar_t kNativeMvAdSkipProbeScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (!player || window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  const selectors = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button'
  ];
  const candidates = Array.from(player.querySelectorAll(selectors.join(',')));
  const target = candidates.find(element => {
    if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  });
  if (!target) return null;
  const rect = target.getBoundingClientRect();
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

    StartPauseImageLoad();
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
    if (paused_) {
      DrawPauseScreen(dc, client);
    } else if (failed_) {
      SetBkMode(dc, TRANSPARENT);
      SetTextColor(dc, RGB(220, 225, 232));
      DrawTextW(dc, L"動画を読み込めません", -1, &client,
                DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    }
    EndPaint(hostWindow_, &paint);
  }

  bool OnTimer(UINT_PTR timerId) noexcept {
    if (timerId == kNativeMvRandomActionTimer) {
      if (paused_) {
        ResumeFromPause();
      } else {
        EnterPause();
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
    if (timerId == kNativeMvAdSkipTimer) {
      ProbeAdSkipButton();
      return true;
    }
    return false;
  }

  void OnPauseImageReady(HBITMAP bitmap) noexcept {
    pauseImageLoading_ = false;
    if (pauseBitmap_) DeleteObject(pauseBitmap_);
    pauseBitmap_ = bitmap;
    if (paused_ && hostWindow_ && IsWindow(hostWindow_)) {
      InvalidateRect(hostWindow_, nullptr, FALSE);
    }
  }

  void Shutdown() noexcept {
    alive_->store(false, std::memory_order_release);
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvRandomActionTimer);
      KillTimer(hostWindow_, kNativeMvPlayAllRetryTimer);
      KillTimer(hostWindow_, kNativeMvFullscreenRetryTimer);
      KillTimer(hostWindow_, kNativeMvPlaybackHealthTimer);
      KillTimer(hostWindow_, kNativeMvNavigationRetryTimer);
      KillTimer(hostWindow_, kNativeMvAdSkipTimer);
    }
    CloseWebView();
    environment_.Reset();
    if (pauseBitmap_) {
      DeleteObject(pauseBitmap_);
      pauseBitmap_ = nullptr;
    }
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
                if (!alive->load(std::memory_order_acquire) || paused_) return S_OK;
                BOOL succeeded = FALSE;
                if (!args || FAILED(args->get_IsSuccess(&succeeded)) ||
                    !succeeded) {
                  StopPlayAllProbe();
                  StopFullscreenProbe();
                  StopPlaybackHealthMonitor();
                  StopAdSkipMonitor();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
                StopNavigationRetry();
                if (IsPlaylistPage()) {
                  StopFullscreenProbe();
                  StopPlaybackHealthMonitor();
                  StopAdSkipMonitor();
                  BeginPlayAllProbe();
                } else if (IsWatchPage()) {
                  StopPlayAllProbe();
                  BeginFullscreenProbe();
                  BeginPlaybackHealthMonitor();
                  BeginAdSkipMonitor();
                } else {
                  StopPlayAllProbe();
                  StopFullscreenProbe();
                  StopPlaybackHealthMonitor();
                  StopAdSkipMonitor();
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

  static UINT NextRandomActionDelayMs(UINT minSeconds,
                                      UINT spanSeconds) noexcept {
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
    const UINT seconds = minSeconds +
        static_cast<UINT>(random % spanSeconds);
    return seconds * 1000U;
  }

  bool ScheduleNextRandomAction(UINT minSeconds, UINT spanSeconds) noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return false;
    return SetTimer(hostWindow_, kNativeMvRandomActionTimer,
                    NextRandomActionDelayMs(minSeconds, spanSeconds), nullptr) != 0;
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

  void StartPauseImageLoad() noexcept {
    if (pauseBitmap_ || pauseImageLoading_ || !hostWindow_ ||
        !IsWindow(hostWindow_)) {
      return;
    }
    pauseImageLoading_ = true;
    const HWND target = hostWindow_;
    const auto alive = alive_;
    try {
      std::thread([target, alive] {
        const HRESULT initialized =
            CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        std::vector<uint8_t> bytes;
        HBITMAP bitmap = nullptr;
        if (hp::WinHttpDownload(
                kNativeMvPauseImageUrl, kNativeMvPauseImageMaxBytes, &bytes,
                nullptr, nullptr, L"HomePanel/1.0",
                L"Referer: https://sakurazaka46.com/\r\n"
                L"Accept: image/jpeg,*/*;q=0.8\r\n")) {
          bitmap = hp::DecodeImageBytesToBitmap(
              bytes.data(), bytes.size(), 1600, 900);
        }
        if (SUCCEEDED(initialized)) CoUninitialize();

        if (!alive->load(std::memory_order_acquire) || !IsWindow(target) ||
            !PostMessageW(target, kNativeMvPauseImageReadyMessage, 0,
                          reinterpret_cast<LPARAM>(bitmap))) {
          if (bitmap) DeleteObject(bitmap);
        }
      }).detach();
    } catch (...) {
      pauseImageLoading_ = false;
    }
  }

  void DrawPauseScreen(HDC dc, const RECT& client) noexcept {
    if (pauseBitmap_) {
      BITMAP bitmapInfo{};
      if (GetObjectW(pauseBitmap_, sizeof(bitmapInfo), &bitmapInfo) ==
              sizeof(bitmapInfo) &&
          bitmapInfo.bmWidth > 0 && bitmapInfo.bmHeight > 0) {
        HDC sourceDc = CreateCompatibleDC(dc);
        if (sourceDc) {
          HGDIOBJ previous = SelectObject(sourceDc, pauseBitmap_);
          const int targetWidth = client.right - client.left;
          const int targetHeight = client.bottom - client.top;
          const double targetAspect = static_cast<double>(targetWidth) /
              static_cast<double>(std::max(1, targetHeight));
          const double sourceAspect = static_cast<double>(bitmapInfo.bmWidth) /
              static_cast<double>(bitmapInfo.bmHeight);
          int sourceX = 0;
          int sourceY = 0;
          int sourceWidth = bitmapInfo.bmWidth;
          int sourceHeight = bitmapInfo.bmHeight;
          if (targetAspect > sourceAspect) {
            sourceHeight = std::max(
                1, static_cast<int>(bitmapInfo.bmWidth / targetAspect));
            sourceY = (bitmapInfo.bmHeight - sourceHeight) / 2;
          } else {
            sourceWidth = std::max(
                1, static_cast<int>(bitmapInfo.bmHeight * targetAspect));
            sourceX = (bitmapInfo.bmWidth - sourceWidth) / 2;
          }
          SetStretchBltMode(dc, HALFTONE);
          StretchBlt(dc, client.left, client.top, targetWidth, targetHeight,
                     sourceDc, sourceX, sourceY, sourceWidth, sourceHeight,
                     SRCCOPY);
          SelectObject(sourceDc, previous);
          DeleteDC(sourceDc);
        }
      }
    }

    const int height =
        std::max(1, static_cast<int>(client.bottom - client.top));
    HFONT font = CreateFontW(
        -std::max(28, height / 7), 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    HGDIOBJ previousFont = font ? SelectObject(dc, font) : nullptr;
    SetBkMode(dc, TRANSPARENT);
    RECT shadow = client;
    OffsetRect(&shadow, 3, 3);
    SetTextColor(dc, RGB(0, 0, 0));
    DrawTextW(dc, L"一時停止", -1, &shadow,
              DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    SetTextColor(dc, RGB(255, 255, 255));
    DrawTextW(dc, L"一時停止", -1, const_cast<RECT*>(&client),
              DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    if (previousFont) SelectObject(dc, previousFont);
    if (font) DeleteObject(font);
  }

  void CloseWebView() noexcept {
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
  }

  void EnterPause() noexcept {
    StopPlayAllProbe();
    StopFullscreenProbe();
    StopPlaybackHealthMonitor();
    StopAdSkipMonitor();
    StopNavigationRetry();
    paused_ = true;
    failed_ = false;
    CloseWebView();
    StartPauseImageLoad();
    if (hostWindow_ && IsWindow(hostWindow_)) {
      InvalidateRect(hostWindow_, nullptr, FALSE);
    }
    if (!ScheduleNextRandomAction(kNativeMvResumeMinSeconds,
                                  kNativeMvResumeSpanSeconds)) {
      Fail();
    }
  }

  void ReopenWebView() noexcept {
    if (!environment_ || !hostWindow_ || !IsWindow(hostWindow_)) {
      Fail();
      return;
    }
    const auto alive = alive_;
    const auto controllerReady =
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this, alive](HRESULT result,
                          ICoreWebView2Controller* controller) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) {
                if (controller) controller->Close();
                return S_OK;
              }
              if (FAILED(result) || !controller) {
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
  }

  void ResumeFromPause() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvRandomActionTimer);
    }
    paused_ = false;
    failed_ = false;
    if (hostWindow_ && IsWindow(hostWindow_)) {
      InvalidateRect(hostWindow_, nullptr, FALSE);
    }
    ReopenWebView();
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
    if (paused_) return;
    StopPlayAllProbe();
    StopFullscreenProbe();
    StopPlaybackHealthMonitor();
    StopAdSkipMonitor();
    StopNavigationRetry();
    if (!webview_) {
      Fail();
      return;
    }
    if (FAILED(webview_->Navigate(kNativeMvPanelPageUrl))) {
      if (!ScheduleNavigationRetry()) Fail();
      return;
    }
    if (!ScheduleNextRandomAction(kNativeMvPauseMinSeconds,
                                  kNativeMvPauseSpanSeconds)) {
      Fail();
    }
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

  void BeginAdSkipMonitor() noexcept {
    StopAdSkipMonitor();
    adSkipProbeInFlight_ = false;
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    SetTimer(hostWindow_, kNativeMvAdSkipTimer, kNativeMvAdSkipProbeMs, nullptr);
    ProbeAdSkipButton();
  }

  void StopAdSkipMonitor() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMvAdSkipTimer);
    }
    adSkipProbeInFlight_ = false;
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
    if (!webview_ || playAllProbeInFlight_ || paused_) return;
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
              if (!alive->load(std::memory_order_acquire) || paused_) return S_OK;
              playAllProbeInFlight_ = false;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                StopPlayAllProbe();
                ClickNormalizedPoint(x, y);
                BeginFullscreenProbe();
                BeginPlaybackHealthMonitor();
                BeginAdSkipMonitor();
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
    if (!webview_ || fullscreenProbeInFlight_ || paused_) return;
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
              if (!alive->load(std::memory_order_acquire) || paused_) return S_OK;
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
    if (!webview_ || playbackHealthProbeInFlight_ || paused_) return;
    playbackHealthProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMvPlaybackHealthScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || paused_) return S_OK;
              playbackHealthProbeInFlight_ = false;
              if (SUCCEEDED(result) && json && std::wstring_view(json) == L"true") {
                ReloadPlaylist();
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) playbackHealthProbeInFlight_ = false;
  }

  void ProbeAdSkipButton() noexcept {
    if (!webview_ || adSkipProbeInFlight_ || paused_ || !IsWatchPage()) return;
    adSkipProbeInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMvAdSkipProbeScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || paused_) return S_OK;
              adSkipProbeInFlight_ = false;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && IsWatchPage() &&
                  ParseNormalizedPoint(json, &x, &y)) {
                ClickNormalizedPoint(x, y);
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) adSkipProbeInFlight_ = false;
  }

  void ClickPlayAllFallback() noexcept {
    if (paused_) return;
    ClickNormalizedPoint(kNativeMvFallbackPlayAllXTenThousandths,
                         kNativeMvFallbackPlayAllYTenThousandths);
    BeginFullscreenProbe();
    BeginPlaybackHealthMonitor();
    BeginAdSkipMonitor();
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
    if (paused_ || !hostWindow_ || !IsWindow(hostWindow_)) return;
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
    StopAdSkipMonitor();
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
  HBITMAP pauseBitmap_ = nullptr;
  int playAllProbeAttempts_ = 0;
  int fullscreenProbeAttempts_ = 0;
  bool playAllProbeInFlight_ = false;
  bool fullscreenProbeInFlight_ = false;
  bool playbackHealthProbeInFlight_ = false;
  bool adSkipProbeInFlight_ = false;
  bool pauseImageLoading_ = false;
  bool paused_ = false;
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

  if (!host && message == kNativeMvPauseImageReadyMessage) {
    HBITMAP bitmap = reinterpret_cast<HBITMAP>(lparam);
    if (bitmap) DeleteObject(bitmap);
    return 0;
  }

  if (host) {
    switch (message) {
      case WM_SIZE:
        host->Resize();
        return 0;
      case WM_TIMER:
        if (host->OnTimer(static_cast<UINT_PTR>(wparam))) return 0;
        break;
      case kNativeMvPauseImageReadyMessage:
        host->OnPauseImageReady(reinterpret_cast<HBITMAP>(lparam));
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