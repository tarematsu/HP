#pragma once

#include "common.h"
#include "logger.h"

namespace hp {

class StationheadLeaderboardCollector {
 public:
  StationheadLeaderboardCollector(HWND window, fs::path userDataFolder,
                                  std::wstring profileName, Logger& log);
  StationheadLeaderboardCollector(const StationheadLeaderboardCollector&) = delete;
  StationheadLeaderboardCollector& operator=(const StationheadLeaderboardCollector&) = delete;
  ~StationheadLeaderboardCollector();

  void Start(int64_t nowMs);
  void Stop();
  void Tick(int64_t nowMs);
  [[nodiscard]] int64_t NextWakeAt() const noexcept { return nextWakeAt_; }

 private:
  void BeginCapture(int64_t nowMs);
  void CreateController(uint64_t generation);
  void ConfigureAndNavigate(uint64_t generation);
  void NavigateCurrent(uint64_t generation);
  void CaptureSnapshot(int64_t nowMs, uint64_t generation);
  void CompleteCapture(int64_t nowMs, bool signedIn);
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
  std::shared_ptr<std::atomic<bool>> alive_{
      std::make_shared<std::atomic<bool>>(false)};
  uint64_t generation_ = 0;
  int64_t nextCaptureAt_ = 0;
  int64_t captureDueAt_ = 0;
  int64_t timeoutAt_ = 0;
  int64_t nextWakeAt_ = 0;
  bool started_ = false;
  bool creating_ = false;
  bool captureInFlight_ = false;
};

}  // namespace hp