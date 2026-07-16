


#include "web_renderer.h"

namespace hp {
bool InstallRuntimeAssets() noexcept;

namespace {
constexpr UINT_PTR kNativePanelTickTimer = 1;
constexpr UINT kNativePanelTickMs = 1'000;

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
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  }
}
}

Renderer::Renderer(HWND window, int width, int height)
    : window_(window), width_(width), height_(height) {
  wchar_t executable[MAX_PATH * 4]{};
  GetModuleFileNameW(nullptr, executable, _countof(executable));
  rootDir_ = fs::path(executable).parent_path();
  dataDir_ = rootDir_ / L"data";
  bounds_ = RECT{0, 0, width_, height_};
}

Renderer::~Renderer() {
  shuttingDown_ = true;
  StopNativePlaybackBridge();
  StopNativeMinuteFactsBridge();
  StopRadarCompose();
  DestroyNativeStaticWindows();
}

void Renderer::Initialize() {
  if (!InstallRuntimeAssets()) {
    throw std::runtime_error("runtime dashboard asset installation failed");
  }
  PrepareParentWindow(window_);
  EnsureNativeStaticWindows();
  StartNativePlaybackBridge();
  StartNativeMinuteFactsBridge();
  StartRadarCompose();
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
}

void Renderer::SetBounds(const RECT& bounds) {
  if (EqualRect(&bounds_, &bounds)) return;
  bounds_ = bounds;
  ++nativeLayoutRevision_;
  width_ = std::max(1L, bounds.right - bounds.left);
  height_ = std::max(1L, bounds.bottom - bounds.top);
  ApplyNativeStaticBounds();
}

void Renderer::SetVisible(bool visible) {
  const bool visibilityChanged = nativeDashboardVisible_ != visible;
  nativeDashboardVisible_ = visible;
  if (visibilityChanged) ApplyNativeStaticBounds();

  if (nativeMainWindow_ && IsWindow(nativeMainWindow_)) {
    if (visible) {
      if (!nativePanelTimerActive_) {
        nativePanelTimerActive_ =
            SetTimer(nativeMainWindow_, kNativePanelTickTimer, kNativePanelTickMs, nullptr) != 0;
      }
    } else if (nativePanelTimerActive_) {
      KillTimer(nativeMainWindow_, kNativePanelTickTimer);
      nativePanelTimerActive_ = false;
    }
  } else {
    nativePanelTimerActive_ = false;
  }
}

bool Renderer::LoadDashboard(const fs::path& jsonPath, bool* changed) {
  if (changed) *changed = false;
  try {
    std::error_code error;
    const fs::path normalizedPath = jsonPath.lexically_normal();
    const std::uintmax_t sourceSize = fs::file_size(normalizedPath, error);
    if (error) return false;
    const fs::file_time_type modifiedAt = fs::last_write_time(normalizedPath, error);
    if (error) return false;
    if (dashboardSourceStampValid_ && dashboardSourcePath_ == normalizedPath &&
        dashboardSourceSize_ == sourceSize && dashboardSourceModifiedAt_ == modifiedAt) {
      return true;
    }

    std::ifstream input(normalizedPath, std::ios::binary);
    if (!input) return false;
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return false;
    if (text == dashboardUtf8_) {
      dashboardSourcePath_ = normalizedPath;
      dashboardSourceSize_ = sourceSize;
      dashboardSourceModifiedAt_ = modifiedAt;
      dashboardSourceStampValid_ = true;
      return true;
    }

    DashboardSnapshot snapshot;
    if (!ParseDashboardSnapshot(text, snapshot)) return false;
    const bool firstSnapshot = !nativeDashboard_.loaded;
    const bool weatherChanged = firstSnapshot ||
        snapshot.weatherRevision != nativeDashboard_.weatherRevision;
    const bool newsChanged = firstSnapshot ||
        snapshot.newsRevision != nativeDashboard_.newsRevision;
    const bool energyChanged = firstSnapshot ||
        snapshot.octopusRevision != nativeDashboard_.octopusRevision ||
        snapshot.switchBotRevision != nativeDashboard_.switchBotRevision;
    const bool contentChanged = weatherChanged || newsChanged || energyChanged;

    newsCount_ = snapshot.newsItemCount;
    nativeDashboard_ = std::move(snapshot);
    dashboardUtf8_ = std::move(text);
    dashboardSourcePath_ = normalizedPath;
    dashboardSourceSize_ = sourceSize;
    dashboardSourceModifiedAt_ = modifiedAt;
    dashboardSourceStampValid_ = true;
    if (weatherChanged) ++dashboardWeatherRevision_;
    if (newsChanged) ++dashboardNewsRevision_;
    if (energyChanged) ++dashboardEnergyRevision_;
    if (contentChanged) ++dashboardSourceRevision_;
    if (changed) *changed = contentChanged;
    return true;
  } catch (...) {
    return false;
  }
}

RECT Renderer::ClientBounds() const { return bounds_; }

void Renderer::QueueAction(UiAction action) {
  {
    std::lock_guard lock(actionMutex_);
    pendingAction_ = action;
  }
  PostMessageW(window_, WM_LBUTTONUP, 0, MAKELPARAM(0, 0));
}

UiAction Renderer::HitTest(POINT) {
  std::lock_guard lock(actionMutex_);
  const UiAction action = pendingAction_;
  pendingAction_ = UiAction::None;
  return action;
}

void Renderer::UpdateState(const RenderState& state) {
  UpdateNativeStaticPanels(state);
}

void Renderer::Render(const RECT& dirty, const RenderState& state) {
  (void)dirty;
  (void)state;
  if (!window_ || !nativeDashboardVisible_) return;
  HDC dc = GetDC(window_);
  if (!dc) return;
  RECT bounds{};
  GetClientRect(window_, &bounds);
  FillRect(dc, &bounds, DashboardBackgroundBrush());
  ReleaseDC(window_, dc);
}

void Renderer::NotifyRadarUpdated() {
  if (!radarComposeStarted_.load(std::memory_order_acquire)) return;
  {
    std::lock_guard lock(radarComposeWakeMutex_);
    radarComposePending_ = true;
  }
  radarComposeWake_.notify_all();
}

}