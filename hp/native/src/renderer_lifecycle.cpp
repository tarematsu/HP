#include "web_renderer.h"
#include "spotify_webviews.h"
#include "spotify_webviews.inc"

namespace hp {
bool InstallRuntimeAssets() noexcept;

namespace {
constexpr UINT_PTR kNativePanelTickTimer = 1;
constexpr UINT kNativePanelTickMs = 1'000;
constexpr ULONG kNativePanelTimerToleranceMs = 100;
std::unique_ptr<SpotifyWebViews> gSpotifyWebViews;

HBRUSH DashboardBackgroundBrush() noexcept {
  static HBRUSH background = CreateSolidBrush(kNativeDashboardBackground);
  return background;
}

void PrepareParentWindow(HWND window) {
  SetClassLongPtrW(window, GCLP_HBRBACKGROUND,
                   reinterpret_cast<LONG_PTR>(DashboardBackgroundBrush()));
  const LONG_PTR style = GetWindowLongPtrW(window, GWL_EXSTYLE);
  if ((style & WS_EX_NOREDIRECTIONBITMAP) != 0) {
    SetWindowLongPtrW(window, GWL_EXSTYLE, style & ~WS_EX_NOREDIRECTIONBITMAP);
    SetWindowPos(window, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                     SWP_FRAMECHANGED);
  }
}
}  // namespace

void SetSpotifyMediaPhase(bool tverPhase) noexcept {
  // YouTube starts the Spotify master cycle. Switching to TVer only disables
  // the YouTube-only prelude/podcast mode; an A-B-C-D rotation already running
  // keeps advancing from real track completions and is not reset or stopped.
  if (gSpotifyWebViews) gSpotifyWebViews->SetPodcastMode(!tverPhase);
}

Renderer::Renderer(HWND window, int width, int height)
    : window_(window), width_(width), height_(height) {
  current_ = this;
  powerSavingMode_ = globalPowerSavingMode_;
  nativeDashboardVisible_ = requestedDashboardVisible_ && !powerSavingMode_;
  wchar_t executable[MAX_PATH * 4]{};
  GetModuleFileNameW(nullptr, executable, _countof(executable));
  rootDir_ = fs::path(executable).parent_path();
  dataDir_ = rootDir_ / L"data";
  bounds_ = RECT{0, 0, width_, height_};
}

Renderer::~Renderer() {
  shuttingDown_ = true;
  if (gSpotifyWebViews) {
    gSpotifyWebViews->Shutdown();
    gSpotifyWebViews.reset();
  }
#if 0  // Stationhead playback bridge disabled for the MV panel build.
  StopNativePlaybackBridge();
#endif
  StopRadarCompose();
  DestroyNativeStaticWindows();
  if (current_ == this) current_ = nullptr;
}

void Renderer::SetGlobalPowerSavingMode(bool enabled) {
  globalPowerSavingMode_ = enabled;
  if (current_) current_->SetPowerSavingMode(enabled);
}

void Renderer::Initialize() {
  if (!InstallRuntimeAssets()) {
    throw std::runtime_error("runtime dashboard asset installation failed");
  }

  try {
    PrepareParentWindow(window_);
    if (!EnsureNativeStaticWindows()) {
      throw std::runtime_error("native dashboard window initialization failed");
    }
    if (powerSavingMode_) {
      // EnsureNativeStaticWindows normally defers MV creation while the native
      // dashboard is hidden. Create the MV child once against the already-hidden
      // radar host so YouTube playback remains alive during power saving too.
      const bool savedVisibility = nativeDashboardVisible_;
      nativeDashboardVisible_ = true;
      const bool mvReady = EnsureNativeStaticWindows();
      nativeDashboardVisible_ = savedVisibility;
      if (!mvReady) {
        throw std::runtime_error("native MV initialization failed");
      }
    }
    if (!gSpotifyWebViews) {
      gSpotifyWebViews = std::make_unique<SpotifyWebViews>(window_, dataDir_);
    }
    // Spotify remains active in power-saving mode. The media panel starts in
    // YouTube, so false (not TVer) starts one TALKABOUT pass immediately.
    gSpotifyWebViews->Start();
    SetSpotifyMediaPhase(false);
#if 0  // Stationhead dashboard queue/status polling is no longer started.
    StartNativePlaybackBridge();
#endif
    if (nativeDashboardVisible_) StartRadarCompose();
  } catch (...) {
    StopRadarCompose();
    if (gSpotifyWebViews) {
      gSpotifyWebViews->Shutdown();
      gSpotifyWebViews.reset();
    }
#if 0  // Stationhead playback bridge disabled.
    StopNativePlaybackBridge();
#endif
    DestroyNativeStaticWindows();
    throw;
  }
}

void Renderer::Resize(int width, int height) {
  const int nextWidth = std::max(1, width);
  const int nextHeight = std::max(1, height);
  if (width_ == nextWidth && height_ == nextHeight) return;
  width_ = nextWidth;
  height_ = nextHeight;
  ++nativeLayoutRevision_;
  bounds_.right = std::max(bounds_.left + 1L, bounds_.left + width_);
  bounds_.bottom = std::max(bounds_.top + 1L, bounds_.top + height_);
  ApplyNativeStaticBounds();
  if (gSpotifyWebViews) gSpotifyWebViews->Resize();
}

void Renderer::SetBounds(const RECT& bounds) {
  if (EqualRect(&bounds_, &bounds)) return;
  bounds_ = bounds;
  ++nativeLayoutRevision_;
  width_ = std::max(1L, bounds.right - bounds.left);
  height_ = std::max(1L, bounds.bottom - bounds.top);
  ApplyNativeStaticBounds();
  if (gSpotifyWebViews) gSpotifyWebViews->Resize();
}

void Renderer::SetVisible(bool visible) {
  requestedDashboardVisible_ = visible;
  ApplyDashboardVisibility();
}

void Renderer::SetPowerSavingMode(bool enabled) {
  if (powerSavingMode_ == enabled) return;
  powerSavingMode_ = enabled;
  // MV and Spotify playback intentionally ignore power-saving mode. Only the
  // dashboard/radar rendering workload is suspended below.
  ApplyDashboardVisibility();
}

void Renderer::ApplyDashboardVisibility() {
  const bool visible = requestedDashboardVisible_ && !powerSavingMode_;
  const bool visibilityChanged = nativeDashboardVisible_ != visible;
  nativeDashboardVisible_ = visible;
  if (visibilityChanged) ApplyNativeStaticBounds();

  if (nativeMainWindow_ && IsWindow(nativeMainWindow_)) {
    if (visible) {
      if (!nativePanelTimerActive_) {
        const UINT_PTR coalesced = SetCoalescableTimer(
            nativeMainWindow_, kNativePanelTickTimer, kNativePanelTickMs,
            nullptr, kNativePanelTimerToleranceMs);
        nativePanelTimerActive_ = coalesced != 0 ||
            SetTimer(nativeMainWindow_, kNativePanelTickTimer,
                     kNativePanelTickMs, nullptr) != 0;
      }
    } else if (nativePanelTimerActive_) {
      KillTimer(nativeMainWindow_, kNativePanelTickTimer);
      nativePanelTimerActive_ = false;
    }
  } else {
    nativePanelTimerActive_ = false;
  }

  if (!visibilityChanged) return;
  if (visible) {
    RebuildNativeAirGraph(UnixMillis());
    StartRadarCompose();
    NotifyRadarUpdated();
    InvalidateAllNativePanels();
    return;
  }

  StopRadarCompose();
  {
    std::lock_guard lock(radarFrameMutex_);
    if (radarFrameBitmap_) DeleteObject(radarFrameBitmap_);
    radarFrameBitmap_ = nullptr;
    radarTimeText_ = L"--:--";
    radarSignature_.clear();
  }
  radarFailedTiles_.clear();
  ResetNativeBitmapCaches();
  nativeAirGraph_ = {};
}

void Renderer::QueueAction(UiAction action) {
  PostMessageW(window_, kRendererActionMessage, static_cast<WPARAM>(action), 0);
}

UiAction Renderer::TakePendingAction() {
  std::lock_guard lock(actionMutex_);
  const UiAction action = pendingAction_;
  pendingAction_ = UiAction::None;
  return action;
}

void Renderer::UpdateState(const RenderState& state) {
  UpdateNativeStaticPanels(state);
}

void Renderer::Render() {
  if (!window_ || !nativeDashboardVisible_) return;
  HDC dc = GetDC(window_);
  if (!dc) return;
  RECT bounds{};
  GetClientRect(window_, &bounds);
  FillRect(dc, &bounds, DashboardBackgroundBrush());
  ReleaseDC(window_, dc);
}

}  // namespace hp