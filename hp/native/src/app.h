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

class App {
 public:
  explicit App(HINSTANCE instance);
  ~App();
  int Run(int showCommand);
  static App* Current();
  void LogUnhandled(DWORD code, void* address);
  void ToggleStationheadAudio();
  void MuteStationheadAudio();

 private:
  struct HistoryFlushGuard {
    App* owner = nullptr;
    ~HistoryFlushGuard();
  };

  static constexpr UINT kUpdateResultMessage = WM_APP + 20;
  static constexpr int kRestartExitCode = 42;
  static constexpr uint32_t kStationheadStateWakeMs = 2'000;
  static void EnrichRenderStationheadState(
      StationheadStatus& state, StationheadStatus* secondaryStatus,
      const StationheadConfig& config);
  static LRESULT CALLBACK WindowProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);
  LRESULT HandleMessage(UINT message, WPARAM wParam, LPARAM lParam);
  void InitializePaths();
  void CreateMainWindow(int showCommand);
  void StartServices();
  void StartDeferredServices(int64_t now, const StationheadStatus& stationheadStatus);
  void ApplyStartupStationheadPreview();
  void ClearStartupStationheadPreview();
  void StopServices();
  void Tick();
  void ProcessPendingStationheadTrackBoundaryRefreshes(int64_t nowMs);
  void Draw();
  void MarkRenderStateDirty() noexcept { renderStateDirty_ = true; }
  void ShowToast(std::wstring message, int64_t durationMs, bool invalidate = true);
  bool UpdateRenderStationheadState(StationheadStatus nextState);
  void ScheduleNextTick(uint32_t milliseconds);
  void ApplyScheduledStationheadAudioProfile(bool primaryAudible) noexcept;
  void UpdateStationheadPlaybackFallback(int64_t nowMs);
  void PublishRenderState();
  void PublishRenderStateNow();
  void InvalidateAll();
  void LoadAirHistory();
  bool SaveAirHistory() const;
  void UpdateAirHistory(const SensorSnapshot& sensors);
  void LoadStationheadPlayHistory();
  bool SaveStationheadPlayHistory() const;
  void UpdateStationheadPlayHistory(const StationheadStatus& status);
  void HandleAction(UiAction action);
  void LayoutWorkspace();
  void ApplyStationheadWindowPlacement(
      const StationheadStatus& primaryStatus,
      const StationheadStatus& secondaryStatus);
  void MarkStationheadPlacementDirty() noexcept {
    stationheadPlacementDirty_ = true;
    ScheduleNextTick(kStationheadStateWakeMs);
  }
  void ProcessRemoteCommands();
  void SendTelemetryAsync();
  void ClearDisplayCache();
  void CheckForUpdateAsync(bool install);
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
  AppSecondaryStationheadHandle secondaryStationhead_;
  RenderState renderState_;
  std::atomic<bool> telemetryBusy_{false};
  std::atomic<bool> updateBusy_{false};
  std::thread telemetryThread_;
  std::thread updateThread_;
  int exitCode_ = 0;
  int startupShowCommand_ = SW_SHOW;
  // Startup fallbacks are elapsed-time decisions. Keep their UTC assignments
  // for existing telemetry/news timestamps, but calculate all differences from
  // GetTickCount64() so an OS clock correction cannot expose the dashboard too
  // early or postpone it indefinitely.
  MonotonicElapsedTimestamp startupAt_;
  MonotonicElapsedTimestamp dashboardAudioReadySince_;
  MonotonicElapsedTimestamp playbackReadyAt_;
  bool secondaryStarted_ = false;
  bool rendererStarted_ = false;
  bool cloudStarted_ = false;
  bool startupUpdateScheduled_ = false;
  bool stationheadPlaybackFallbackActive_ = false;
  bool stationheadPlaybackNoNextTrackObserved_ = false;
  uint64_t stationheadPlaybackFallbackRevision_ = 0;
  // Track-boundary handoff windows are operational delays. Re-project them to
  // the current civil clock only at scheduler boundaries; their actual expiry
  // remains tied to GetTickCount64().
  MonotonicProjectedDeadline primaryTrackBoundaryPendingUntil_;
  MonotonicProjectedDeadline secondaryTrackBoundaryPendingUntil_;
  MonotonicProjectedDeadline primaryTrackBoundaryHandoffReadyAt_;
  MonotonicProjectedDeadline secondaryTrackBoundaryHandoffReadyAt_;
  int64_t lastTelemetryAt_ = 0;
  int64_t lastAirHistorySavedAt_ = 0;
  int64_t lastStationheadPlayStatsUpdatedAt_ = 0;
  int64_t lastStationheadPlayHistorySavedAt_ = 0;
  int64_t toastUntil_ = 0;
  int64_t nextAppTickAt_ = 0;
  int newsIndex_ = 0;
  int newsCount_ = 0;
  int64_t lastNewsRotateAt_ = 0;
  bool airHistoryDirty_ = false;
  bool stationheadPlayHistoryDirty_ = false;
  bool renderStateDirty_ = true;
  bool stationheadPlacementDirty_ = true;
  bool placedPrimaryPending_ = false;
  bool placedSecondaryPending_ = false;
  RECT placedBounds_{};
  bool scheduledPrimaryAudioAudible_ = true;
  bool stationheadAudioMuted_ = false;
  WorkspaceTab selectedTab_ = WorkspaceTab::Main;
  RECT workspaceBounds_{0, 0, 1, 1};
  HistoryFlushGuard historyFlushGuard_{this};
  inline static App* current_ = nullptr;
};

}  // namespace hp
