#pragma once

#include "common.h"

namespace hp {

class SpotifyArtistChartCollector {
 public:
  SpotifyArtistChartCollector() = default;
  SpotifyArtistChartCollector(const SpotifyArtistChartCollector&) = delete;
  SpotifyArtistChartCollector& operator=(const SpotifyArtistChartCollector&) = delete;
  ~SpotifyArtistChartCollector();

  void EnsureStarted(int64_t nowMs);
  void Start(int64_t nowMs);
  void Stop();
  void Tick(int64_t nowMs);
  void RequestCaptureNow(int64_t nowMs) noexcept {
    if (!started_ || creating_ || captureInFlight_ || teardownPending_) return;
    nextCaptureAt_ = nowMs;
    debugController_ = nullptr;
    debugVisible_ = false;
    debugBounds_ = {};
    UpdateNextWake();
  }
  void ShowForDebug() noexcept {
    if (teardownPending_ || !controller_ || !window_ || !IsWindow(window_)) {
      debugController_ = nullptr;
      debugVisible_ = false;
      debugBounds_ = {};
      return;
    }

    DWORD processId = 0;
    GetWindowThreadProcessId(window_, &processId);
    if (processId != GetCurrentProcessId()) return;

    RECT client{};
    if (!GetClientRect(window_, &client)) return;
    const LONG availableWidth = client.right - client.left;
    const LONG availableHeight = client.bottom - client.top;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    constexpr LONG kDebugWidth = 720;
    constexpr LONG kDebugHeight = 480;
    const LONG width = std::min(availableWidth, kDebugWidth);
    const LONG height = std::min(availableHeight, kDebugHeight);
    const LONG left = client.left + std::max<LONG>(0, (availableWidth - width) / 2);
    const LONG top = client.top + std::max<LONG>(0, (availableHeight - height) / 2);
    const RECT bounds{left, top, left + width, top + height};

    ICoreWebView2Controller* currentController = controller_.Get();
    const bool controllerChanged = debugController_ != currentController;
    const bool boundsChanged = !EqualRect(&debugBounds_, &bounds);
    if (controllerChanged || boundsChanged) {
      if (FAILED(controller_->put_Bounds(bounds))) return;
      debugBounds_ = bounds;
    }
    if (controllerChanged || !debugVisible_) {
      if (FAILED(controller_->put_IsVisible(TRUE))) return;
    }
    debugController_ = currentController;
    debugVisible_ = true;
  }
  [[nodiscard]] int64_t NextWakeAt() const noexcept { return nextWakeAt_; }

 private:
  void BeginCapture(int64_t nowMs);
  void CreateController(uint64_t generation);
  void ConfigureAndNavigate(uint64_t generation);
  void CompleteCapture(int64_t nowMs);
  void FailCapture(int64_t nowMs, std::wstring_view reason);
  void ScheduleControllerTeardown(int64_t nowMs) noexcept;
  void CloseController() noexcept;
  void UpdateNextWake() noexcept;
  HRESULT CreateProfileController(
      ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* handler) const noexcept;

  HWND window_{};
  fs::path userDataFolder_;
  std::wstring profileName_{L"spotify-v2-6"};
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  EventRegistrationToken navigationToken_{};
  EventRegistrationToken responseToken_{};
  std::shared_ptr<std::atomic<bool>> alive_{
      std::make_shared<std::atomic<bool>>(false)};
  uint64_t generation_ = 0;
  int64_t nextCaptureAt_ = 0;
  int64_t timeoutAt_ = 0;
  int64_t teardownAt_ = 0;
  int64_t nextWakeAt_ = 0;
  ICoreWebView2Controller* debugController_ = nullptr;
  RECT debugBounds_{};
  bool started_ = false;
  bool creating_ = false;
  bool captureInFlight_ = false;
  bool contentInFlight_ = false;
  bool responseHandlerRegistered_ = false;
  bool teardownPending_ = false;
  bool debugVisible_ = false;
};

}  // namespace hp

#include "spotify_artist_chart_collector.inl"
