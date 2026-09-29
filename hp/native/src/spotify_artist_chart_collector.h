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
    if (!started_ || creating_ || captureInFlight_) return;
    nextCaptureAt_ = nowMs;
    UpdateNextWake();
  }
  void ShowForDebug() noexcept;
  [[nodiscard]] int64_t NextWakeAt() const noexcept { return nextWakeAt_; }

 private:
  bool EnsureDebugHost() noexcept;
  void DestroyDebugHost() noexcept;
  void BeginCapture(int64_t nowMs);
  void CreateController(uint64_t generation);
  void ConfigureAndNavigate(uint64_t generation);
  void CompleteCapture(int64_t nowMs);
  void FailCapture(int64_t nowMs, std::wstring_view reason);
  void CloseController() noexcept;
  void UpdateNextWake() noexcept;
  HRESULT CreateProfileController(
      ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* handler) const noexcept;

  HWND window_{};
  HWND debugHostWindow_{};
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
  int64_t nextWakeAt_ = 0;
  RECT debugHostBounds_{};
  bool started_ = false;
  bool creating_ = false;
  bool captureInFlight_ = false;
  bool contentInFlight_ = false;
  bool responseHandlerRegistered_ = false;
  bool debugVisible_ = false;
};

}  // namespace hp

#include "spotify_artist_chart_collector.inl"
