#pragma once
#include "app_stationhead_handles.h"
#include "cloud_client.h"
#include "config.h"
#include "logger.h"
#include "render_state.h"
#include "sensors.h"
#include "update_client.h"

namespace hp {

class Renderer;

inline int64_t operator+(
    const MonotonicElapsedTimestamp& timestamp, int intervalMs) noexcept {
  return timestamp + static_cast<int64_t>(intervalMs);
}

class StationheadFallbackRevisionGate {
 public:
  StationheadFallbackRevisionGate& operator=(uint64_t healthyRevision) noexcept {
    if (healthyRevision == 0) {
      Reset();
    } else {
      Arm(healthyRevision);
    }
    return *this;
  }

  friend bool operator>(
      uint64_t healthyRevision,
      const StationheadFallbackRevisionGate& gate) noexcept {
    return gate.CanRelease(healthyRevision);
  }

  void Arm(uint64_t healthyRevision) noexcept {
    baselineHealthyRevision_ = healthyRevision;
    startedAt_ = UnixMillis();
  }

  void Reset() noexcept {
    baselineHealthyRevision_ = 0;
    startedAt_ = 0;
  }

  [[nodiscard]] bool CanRelease(uint64_t healthyRevision) const noexcept {
    return startedAt_.Active() && healthyRevision != 0 &&
        startedAt_.ElapsedMilliseconds() >=
            kStationheadFallbackMinimumDwellMs &&
        healthyRevision > baselineHealthyRevision_;
  }

 private:
  uint64_t baselineHealthyRevision_ = 0;
  MonotonicElapsedTimestamp startedAt_;
};

class App {
 public:
  explicit App(HINSTANCE instance);
  ~App();
  int Run(int showCommand);
  static App* Current();
  void LogUnhandled(DWORD code, void* address);
  void NotifyStationheadPlaybackFallbackStarted();

 private:
  struct HistoryFlushGuard {
    App* owner = nullptr;
    ~HistoryFlushGuard();
  };

  static constexpr UINT_PTR kCentralTimer = 1;
  static constexpr UINT kUpdateResultMessage = WM_APP + 20;
  static constexpr int kRestartExitCode = 42;
  static constexpr uint32_t kStationheadStateWakeMs = 2'000;
  static constexpr int64_t kMediaStartupStageDelayMs = 30'000;
  static LRESULT CALLBACK WindowProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);
  LRESULT HandleMessage(UINT message, WPARAM wParam, LPARAM lParam);
  void InitializePaths();
  void CreateMainWindow(int showCommand);
  void StartServices();
  void StartDeferredServices(int64_t now);
  void HandleStartupUpdateWake();
  void StopServices();
  void Tick();
  void Draw();
  void ShowToast(std::wstring message, int64_t durationMs, bool invalidate = true);
  void ScheduleNextTick(uint32_t milliseconds);
  void InvalidateAll();
  void LoadAirHistory();
  bool SaveAirHistory() const;
  void UpdateAirHistory(const SensorSnapshot& sensors);
  void HandleAction(UiAction action);
  void LayoutWorkspace();
  void ApplyStationheadWindowPlacement(const StationheadStatus& status);
  void MarkStationheadPlacementDirty() noexcept {
    stationheadPlacementDirty_ = true;
    ScheduleNextTick(kStationheadStateWakeMs);
  }
  void ProcessRemoteCommands();
  void SendTelemetryAsync();
  void ClearDisplayCache();
  void CheckForUpdateAsync(bool explicitLocalRequest);
  void CheckForUpdateAsync(bool install, bool allowSameVersionRepair);
  bool LaunchVerifiedUpdater(
      const std::wstring& version, const std::string& manifestJson);

  HINSTANCE instance_{};
  HWND window_{};
  HANDLE mutex_{};
  fs::path rootDir_;
  fs::path dataDir_;
  AppConfig config_;
  std::unique_ptr<Logger> logger_;
  std::unique_ptr<Renderer> renderer_;
  std::unique_ptr<CloudClient> cloud_;
  std::unique_ptr<SensorHub> sensors_;
  AppStationheadHandle stationhead_;
  std::vector<AirHistorySample> airHistory_;
  std::wstring toastText_;
  std::atomic<bool> telemetryBusy_{false};
  std::atomic<bool> updateBusy_{false};
  std::thread telemetryThread_;
  std::thread updateThread_;
  int exitCode_ = 0;
  int startupShowCommand_ = SW_SHOW;
  MonotonicElapsedTimestamp startupAt_;
  bool rendererStarted_ = false;
  bool stationheadStarted_ = false;
  bool spotifyStarted_ = false;
  bool cloudStarted_ = false;
  bool startupUpdateScheduled_ = false;
  bool stationheadPlaybackFallbackActive_ = false;
  bool stationheadPlaybackNoNextTrackObserved_ = false;
  StationheadFallbackRevisionGate stationheadPlaybackFallbackRevision_;
  int64_t lastTelemetryAt_ = 0;
  int64_t lastAirHistorySavedAt_ = 0;
  int64_t toastUntil_ = 0;
  int64_t nextAppTickAt_ = 0;
  bool airHistoryDirty_ = false;
  bool stationheadPlacementDirty_ = true;
  bool placedPrimaryPending_ = false;
  RECT placedBounds_{};
  // Fail closed until the audio-routing controller explicitly selects SH.
  bool stationheadAudioMuted_ = true;
  WorkspaceTab selectedTab_ = WorkspaceTab::Main;
  RECT workspaceBounds_{0, 0, 1, 1};
  HistoryFlushGuard historyFlushGuard_{this};
  inline static App* current_ = nullptr;
};

}  // namespace hp
