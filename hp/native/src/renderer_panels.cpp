// Kept as one translation unit so cached GDI primitives remain shared.
// Fragment boundaries follow complete responsibilities and never split functions.
#if 0  // Stationhead renderer helpers are intentionally disabled.
#include "stationhead_native_stats.h"
#include "stationhead_play_summary.h"
#endif
#include "shared_webview_environment.h"
#include "spotify_webviews.h"
#include "version.h"
#include "winhttp_helpers.h"
#include "renderer_panels/primitives.inc"
#include "renderer_panels/layout_overrides.inc"
#include "renderer_panels/waste_calendar_section.inc"

#define SplitSidebarSections SplitRearrangedSidebarSections
#define SplitMainSections SplitRearrangedMainSections
#define ClockTimeRectFromCard RearrangedClockTimeRectFromCard
#define DrawClockSection HP_DRAW_CLOCK_WITH_STATUS
#define DrawControlsSection DrawAirSection
#include "renderer_panels/windows.inc"
#undef DrawControlsSection
#undef DrawClockSection
#undef ClockTimeRectFromCard
#undef SplitMainSections
#undef SplitSidebarSections

#include "renderer_panels/environment_sections.inc"

namespace {
constexpr UINT_PTR kNativeMvRandomActionTimerForSpotify = 0x4D560001;
constexpr UINT kNativeMvResumeDelayFloorMsForSpotify = 60U * 60U * 1000U;
// The same phase boundary now drives the complete YouTube -> Spotify -> TVer
// cycle. Keep both names explicit so the established Spotify contract remains
// readable while the expanded media-cycle contract is independently testable.
constexpr UINT_PTR kNativeMvRandomActionTimerForMediaCycle = 0x4D560001;
constexpr UINT kNativeMvResumeDelayFloorMsForMediaCycle = 60U * 60U * 1000U;
static_assert(kNativeMvRandomActionTimerForMediaCycle ==
              kNativeMvRandomActionTimerForSpotify);
static_assert(kNativeMvResumeDelayFloorMsForMediaCycle ==
              kNativeMvResumeDelayFloorMsForSpotify);
constexpr UINT_PTR kSakuraMeetsTverStartTimer = 0x4D560101;
constexpr UINT_PTR kSakuraMeetsTverStopTimer = 0x4D560102;
constexpr UINT_PTR kSakuraMeetsTverMaintenanceTimer = 0x4D560103;
constexpr UINT kMediaCycleHourMs = 60U * 60U * 1000U;
constexpr UINT kNativeMvPodcastAndTverPauseMs = 2U * 60U * 60U * 1000U;
constexpr UINT kSakuraMeetsTverMaintenanceMs = 5U * 1000U;
constexpr wchar_t kSakuraMeetsTverSeriesUrl[] =
    L"https://tver.jp/series/srx97ftk3w";

constexpr wchar_t kSakuraMeetsTverLoopScript[] = LR"JS(
(() => {
  if (window.__homePanelSakuraMeetsLoopTimer) return;

  const seriesUrl = 'https://tver.jp/series/srx97ftk3w';
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
    const links = Array.from(
        document.querySelectorAll('a[href*="/episodes/"]'))
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
      if (Number.isFinite(video.duration)) {
        state.maxDuration = Math.max(state.maxDuration, video.duration);
      }
      if (Number.isFinite(video.currentTime)) {
        state.maxTime = Math.max(state.maxTime, video.currentTime);
      }

      // Do not treat short pre-roll/post-roll advertisements as the episode end.
      // Sakura Meets itself is long enough to cross both thresholds.
      if (video.ended && state.maxDuration >= 600 && state.maxTime >= 300) {
        location.replace(seriesUrl);
        return;
      }

      video.muted = false;
      if (video.volume === 0) video.volume = 1;
    }

    const buttons = Array.from(
        document.querySelectorAll('button, [role="button"]'))
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
          promise.catch(() => {
            if (playButton) playButton.click();
          });
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
        return;
      }
      if (location.pathname.startsWith('/series/')) {
        openLatestEpisode();
        return;
      }
      if (location.pathname.startsWith('/episodes/')) {
        ensureEpisodePlayback();
        return;
      }
      location.replace(seriesUrl);
    } catch (_) {
    }
  };

  ensure();
  window.__homePanelSakuraMeetsLoopTimer = window.setInterval(ensure, 2000);
})()
)JS";

fs::path SharedMediaUserDataFolder() noexcept {
  wchar_t executable[MAX_PATH]{};
  const DWORD length =
      GetModuleFileNameW(nullptr, executable, static_cast<DWORD>(_countof(executable)));
  if (length == 0 || length >= _countof(executable)) return {};
  return fs::path(executable).parent_path() / L"data" / L"webview2-youtube-mv";
}

void CALLBACK SakuraMeetsTverMaintenanceTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD);
void CALLBACK SakuraMeetsTverStartTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD);
void CALLBACK SakuraMeetsTverStopTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD);

class SakuraMeetsTverPlayer final {
 public:
  ~SakuraMeetsTverPlayer() { Stop(); }

  void Start(HWND hostWindow) noexcept {
    if (!hostWindow || !IsWindow(hostWindow)) return;
    Stop();
    hostWindow_ = hostWindow;
    active_ = true;
    const uint64_t generation = ++generation_;
    ArmMaintenance();

    const fs::path userDataFolder = SharedMediaUserDataFolder();
    if (userDataFolder.empty()) return;
    try {
      SharedWebViewEnvironment::Instance().Acquire(
          userDataFolder, false, false,
          [this, generation](HRESULT result,
                             ICoreWebView2Environment* environment) {
            if (!active_ || generation != generation_ ||
                FAILED(result) || !environment || !hostWindow_ ||
                !IsWindow(hostWindow_)) {
              return;
            }
            environment_ = environment;
            const auto ready =
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [this, generation](HRESULT controllerResult,
                                       ICoreWebView2Controller* controller)
                        -> HRESULT {
                      if (!active_ || generation != generation_) {
                        if (controller) controller->Close();
                        return S_OK;
                      }
                      if (FAILED(controllerResult) || !controller ||
                          !hostWindow_ || !IsWindow(hostWindow_)) {
                        if (controller) controller->Close();
                        return S_OK;
                      }
                      controller_ = controller;
                      controller_->get_CoreWebView2(&webview_);
                      if (!webview_) {
                        controller_->Close();
                        controller_.Reset();
                        return S_OK;
                      }
                      Configure(generation);
                      return S_OK;
                    });
            environment_->CreateCoreWebView2Controller(hostWindow_, ready.Get());
          });
    } catch (...) {
    }
  }

  void Stop() noexcept {
    active_ = false;
    ++generation_;
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kSakuraMeetsTverMaintenanceTimer);
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
    if (controller_) {
      controller_->put_IsVisible(FALSE);
      controller_->Close();
    }
    controller_.Reset();
    environment_.Reset();
    hostWindow_ = nullptr;
  }

  void Tick() noexcept {
    if (!active_) return;
    if (!hostWindow_ || !IsWindow(hostWindow_)) {
      Stop();
      return;
    }
    Resize();
    if (webview_) {
      webview_->ExecuteScript(kSakuraMeetsTverLoopScript, nullptr);
    }
  }

 private:
  void Configure(uint64_t generation) noexcept {
    if (!active_ || generation != generation_ || !controller_ || !webview_) return;
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

      const auto aliveGeneration = generation_;
      webview_->add_NewWindowRequested(
          Callback<ICoreWebView2NewWindowRequestedEventHandler>(
              [this, aliveGeneration](
                  ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args)
                  -> HRESULT {
                if (!active_ || aliveGeneration != generation_) return S_OK;
                if (args) args->put_Handled(TRUE);
                return S_OK;
              }).Get(),
          &newWindowToken_);

      webview_->add_NavigationCompleted(
          Callback<ICoreWebView2NavigationCompletedEventHandler>(
              [this, aliveGeneration](
                  ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args)
                  -> HRESULT {
                if (!active_ || aliveGeneration != generation_ || !args) {
                  return S_OK;
                }
                BOOL succeeded = FALSE;
                if (SUCCEEDED(args->get_IsSuccess(&succeeded)) && succeeded) {
                  Tick();
                }
                return S_OK;
              }).Get(),
          &navigationCompletedToken_);

      Resize();
      controller_->put_IsVisible(TRUE);
      webview_->Navigate(kSakuraMeetsTverSeriesUrl);
    } catch (...) {
    }
  }

  void Resize() noexcept {
    if (!controller_ || !hostWindow_ || !IsWindow(hostWindow_)) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    if (client.right <= client.left || client.bottom <= client.top) return;
    controller_->put_Bounds(client);
  }

  void ArmMaintenance() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    KillTimer(hostWindow_, kSakuraMeetsTverMaintenanceTimer);
    ::SetTimer(hostWindow_, kSakuraMeetsTverMaintenanceTimer,
               kSakuraMeetsTverMaintenanceMs,
               SakuraMeetsTverMaintenanceTimerProc);
  }

  HWND hostWindow_ = nullptr;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  EventRegistrationToken newWindowToken_{};
  EventRegistrationToken navigationCompletedToken_{};
  uint64_t generation_ = 0;
  bool active_ = false;
};

SakuraMeetsTverPlayer gSakuraMeetsTverPlayer;

void CALLBACK SakuraMeetsTverMaintenanceTimerProc(
    HWND, UINT, UINT_PTR, DWORD) {
  gSakuraMeetsTverPlayer.Tick();
}

void CALLBACK SakuraMeetsTverStopTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) {
  if (hwnd && IsWindow(hwnd)) KillTimer(hwnd, timerId);
  gSakuraMeetsTverPlayer.Stop();
  SetSpotifyAmazonPodcastMode(false);
}

void CALLBACK SakuraMeetsTverStartTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) {
  if (!hwnd || !IsWindow(hwnd)) return;
  KillTimer(hwnd, timerId);

  // The second hour of the MV pause belongs to TVer, so silence the podcast
  // before creating the TVer surface. Spotify's other account loops remain
  // alive and natively muted exactly as before.
  SetSpotifyAmazonPodcastMode(false);
  gSakuraMeetsTverPlayer.Start(hwnd);
  KillTimer(hwnd, kSakuraMeetsTverStopTimer);
  ::SetTimer(hwnd, kSakuraMeetsTverStopTimer, kMediaCycleHourMs,
             SakuraMeetsTverStopTimerProc);
}

UINT_PTR SetNativeMvTimerWithMediaCycle(HWND hwnd, UINT_PTR timerId,
                                        UINT elapseMs,
                                        TIMERPROC timerProc) noexcept {
  if (timerId != kNativeMvRandomActionTimerForMediaCycle) {
    return ::SetTimer(hwnd, timerId, elapseMs, timerProc);
  }

  // mv_section.inc still requests its proven random 50-60m active and 60-80m
  // pause windows. Normalize only this phase timer to the user-facing cycle:
  // YouTube 1h -> Spotify podcast 1h -> TVer Sakura Meets 1h.
  const bool enteringPause =
      elapseMs >= kNativeMvResumeDelayFloorMsForMediaCycle;
  const UINT effectiveDelay =
      enteringPause ? kNativeMvPodcastAndTverPauseMs : kMediaCycleHourMs;
  const UINT_PTR result = ::SetTimer(hwnd, timerId, effectiveDelay, timerProc);
  if (result == 0) return 0;

  if (hwnd && IsWindow(hwnd)) {
    KillTimer(hwnd, kSakuraMeetsTverStartTimer);
    KillTimer(hwnd, kSakuraMeetsTverStopTimer);
  }
  gSakuraMeetsTverPlayer.Stop();

  if (!enteringPause) {
    SetSpotifyAmazonPodcastMode(false);
    return result;
  }

  SetSpotifyAmazonPodcastMode(true);
  if (hwnd && IsWindow(hwnd)) {
    ::SetTimer(hwnd, kSakuraMeetsTverStartTimer, kMediaCycleHourMs,
               SakuraMeetsTverStartTimerProc);
  }
  return result;
}
}  // namespace

// Stationhead actions inside the retained MV fragment are compiled out while
// the legacy source remains available for a future rollback.
#define QueueAction(...) ((void)0)
#define SetTimer SetNativeMvTimerWithMediaCycle
#include "renderer_panels/media_section.inc"
#undef SetTimer
#undef QueueAction
#include "renderer_panels/data_sections.inc"