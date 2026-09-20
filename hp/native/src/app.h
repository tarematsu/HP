#pragma once
#include "app_stationhead_handles.h"
#include "cloud_client.h"
#include "config.h"
#include "logger.h"
#include "render_state.h"
#include "sensors.h"
#include "stationhead_fallback_revision_gate.h"
#include "update_client.h"

namespace hp {

class Renderer;

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
  static constexpr size_t kStationheadPeerCount = 5;
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
  void ApplyStationheadWindowPlacement();
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
  std::array<AppStationheadHandle, kStationheadPeerCount> stationheadPeers_;
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
  std::array<bool, kStationheadPeerCount> stationheadPeerStarted_{};
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
  RECT placedBounds_{};
  // Fail closed until the audio-routing controller explicitly selects SH.
  bool stationheadAudioMuted_ = true;
  WorkspaceTab selectedTab_ = WorkspaceTab::Main;
  RECT workspaceBounds_{0, 0, 1, 1};
  HistoryFlushGuard historyFlushGuard_{this};
  inline static App* current_ = nullptr;
};

}  // namespace hp
