#pragma once

#include "common.h"
#include "logger.h"

namespace hp {

class SpotifyArtistChartCollector {
 public:
  SpotifyArtistChartCollector(HWND window, fs::path userDataFolder,
                              std::wstring profileName, Logger& log);
  SpotifyArtistChartCollector(const SpotifyArtistChartCollector&) = delete;
  SpotifyArtistChartCollector& operator=(const SpotifyArtistChartCollector&) = delete;
  ~SpotifyArtistChartCollector();

  void Start(int64_t nowMs);
  void Stop();
  void Tick(int64_t nowMs);
  [[nodiscard]] int64_t NextWakeAt() const noexcept { return nextWakeAt_; }

 private:
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
  fs::path userDataFolder_;
  std::wstring profileName_;
  Logger& log_;
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
  bool started_ = false;
  bool creating_ = false;
  bool captureInFlight_ = false;
  bool contentInFlight_ = false;
  bool responseHandlerRegistered_ = false;
};

}  // namespace hp
