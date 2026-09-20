#pragma once

#include "common.h"
#include "config.h"
#include "logger.h"
#include "media_recovery_coordinator.h"
#include "monotonic_time.h"
#include "stationhead_types.h"

namespace hp {

// Drives one Stationhead WebView2 profile instance. App owns the six-instance
// fleet and is responsible for cross-player layout, handoff, and routing.
class StationheadPlayer {
 public:
  StationheadPlayer(HWND window, StationheadConfig config,
                    fs::path userDataFolder, Logger& log);
  StationheadPlayer(const StationheadPlayer&) = delete;
  StationheadPlayer& operator=(const StationheadPlayer&) = delete;
  ~StationheadPlayer();

  void Start();
  void Stop();
  void Tick(int64_t nowMs);
  void ReuseWebViewProfile(std::wstring profileName) {
    if (!profileName.empty()) profileName_ = std::move(profileName);
  }
  [[nodiscard]] int64_t NextWakeAt() const noexcept { return nextTickAt_; }
  void RequestImmediateTick() noexcept { nextTickAt_ = 0; }
  [[nodiscard]] bool AudioPlaying() const noexcept {
    // A controller is a valid handoff source only after playback has a stable
    // start timestamp. ScheduleRecreate() and navigation reset that timestamp
    // before the old controller is closed, preventing a stale final audio bit
    // from becoming healthy again during the teardown gap.
    const int64_t playingSince =
        audioPlayingSinceAt_.load(std::memory_order_acquire);
    return playingSince > 0 &&
           audioPlaying_.load(std::memory_order_acquire) &&
           !recreating_.load(std::memory_order_acquire);
  }
  [[nodiscard]] int64_t AudioPlayingSince() const noexcept {
    const int64_t playingSince =
        audioPlayingSinceAt_.load(std::memory_order_acquire);
    return playingSince > 0 && AudioPlaying() ? playingSince : 0;
  }
  [[nodiscard]] bool SpotifyAuthorizationActive() const {
    std::lock_guard lock(mutex_);
    return spotifyAuthorization_;
  }
  void Reconnect();
  bool RetryPendingTrackBoundaryRefresh(int64_t nowMs) {
    // A native audio-stop tick can enter the same path when the page's
    // track-ended message was lost. Existing pending requests remain retries;
    // a fresh request still has to pass the 52-minute eligibility check.
    const bool retry = trackBoundaryRefreshPending_;
    HandleTrackEnded(nowMs, retry);
    return trackBoundaryRefreshPending_ ||
           (trackBoundaryPlaybackRecoveryPending_ &&
            trackBoundaryPlaybackRecoveryAwaitingNavigation_);
  }
  void CancelPendingTrackBoundaryRefresh() noexcept {
    trackBoundaryRefreshPending_ = false;
  }
  void SetPlaybackFallback(bool active, const std::wstring& reason);
  void SetManagedPlaybackFallback(bool active, const std::wstring& reason);
  void EvaluateAudioLossRecovery(int64_t nowMs);
  void ShowForLogin();
  void ShowAfterAudioStop();
  void OpenSpotifyAuthorization(const std::wstring& url);
  void ReleaseCompletedAuth();
  void FinalizeCompletedAuth() {
    if (!SpotifyAuthorizationActive()) CloseAuthWebView();
  }
  void RecoverUnavailableAuthorization() {
    // EnsureAuthController sets authControllerStartedAt_ before the normal
    // asynchronous creation path. A pending URL with neither a controller nor
    // a start timestamp means the auth host could not be created; without this
    // guard Tick() would remain in the interactive-auth branch indefinitely.
    if (spotifyAuthorization_ && !authController_ &&
        authControllerStartedAt_ == 0 && !authPendingUrl_.empty()) {
      FinishSpotifyAuthorization(
          L"Spotify auth host unavailable; authorization can be retried");
    }
  }
  void ToggleView();
  uint32_t ConsumeChangeFlags();
  void SetMuted(bool muted) noexcept;
  bool Muted() const noexcept;
  void SetVolume(double volume) noexcept;
  double Volume() const noexcept;
  void SetBounds(const RECT& bounds);
  void SetStartupPreviewBounds(const RECT& bounds);
  void ClearStartupPreviewBounds();
  void SelectTab(StationheadTabKind tab);
  bool HasAuthTab() const;
  StationheadStatus Status() const;
  HWND ActiveHostWindowForAccountSetup() const noexcept;
  [[nodiscard]] bool SurfaceVisible() const noexcept {
    return startupPreviewActive_ || viewVisible_;
  }
  void KeepPlaybackBehindDashboard();

 private:
  [[nodiscard]] static constexpr const wchar_t* RoleTag() noexcept { return L"A"; }
  void ApplyMute() const noexcept;
  void ApplyVolume() const noexcept;
  void ApplyAudioPlaybackState(bool playing, const std::wstring& source);
  void HandleTrackEnded(int64_t nowMs, bool retry);
  void RecoverTrackBoundaryPlayback();
  void TryStartInitialNavigation();
  void CompletePendingAuthPopupDeferral() noexcept;
  void Create();
  HRESULT CreateProfileController(
      HWND parentWindow,
      ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* handler) const noexcept;
  void EnsureAuthController(const std::wstring& url);
  bool EnsureHostWindow();
  bool EnsureAuthHostWindow();
  void CloseWebView();
  void CloseAuthWebView();
  void PostChange(uint32_t flags = StationheadChangeNone);
  void ConfigureWebView();
  void ConfigureAuthWebView();
  void ResetNavigationRouteState();
  void PollDailyPlayStats(int64_t nowMs);
  void AttemptNativeStartClick(int64_t nowMs);
  void FinishSpotifyAuthorization(const std::wstring& detail);
  void NavigateCurrentUrl(int64_t nowMs, const std::wstring& reason);
  std::wstring CurrentStationheadUrl() const;
  void NavigateStationheadUrl(int64_t nowMs, const std::wstring& url,
                              const std::wstring& reason, bool fallbackActive);
  bool NeedsInteractiveWindow() const;
  void SetStartupBounds();
  void SetVisible(bool visible);
  void ScheduleRecreate(const std::wstring& reason, int64_t delayMs = 0);
  void LayoutControllers();
  void BeginAudioLossAuthProbe(int64_t nowMs);
  void ResetAudioLossProbe() noexcept;
  void UpdateAudioLossState(
      const std::wstring& state, const std::wstring& detail);

  HWND window_;
  HWND hostWindow_{};
  HWND authHostWindow_{};
  StationheadConfig config_;
  fs::path userDataFolder_;
  std::wstring profileName_;
  Logger& log_;
  mutable std::mutex mutex_;
  RECT bounds_{0, 0, 1, 1};
  StationheadTabKind selectedTab_ = StationheadTabKind::None;
  StationheadStatus status_;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  ComPtr<ICoreWebView2Controller> authController_;
  ComPtr<ICoreWebView2> authWebview_;
  ComPtr<ICoreWebView2Deferral> authPopupDeferral_;
  std::shared_ptr<std::atomic<bool>> authPopupDeferralCompleted_;
  EventRegistrationToken navigationStartingToken_{};
  EventRegistrationToken navigationToken_{};
  EventRegistrationToken newWindowToken_{};
  EventRegistrationToken webMessageToken_{};
  EventRegistrationToken processFailedToken_{};
  EventRegistrationToken resourceRequestedToken_{};
  EventRegistrationToken audioPlayingChangedToken_{};
  ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> mediaErrorReceiver_;
  EventRegistrationToken mediaErrorToken_{};
  std::weak_ptr<std::atomic<bool>> mediaErrorRecoveryLifecycle_;
  ULONGLONG mediaErrorRecoveryTick_ = 0;
  int64_t mediaKeyWaitUntil_ = 0;
  int64_t mediaNetworkRecoveryAt_ = 0;
  size_t mediaNetworkRecoveryAttempt_ = 0;
  bool mediaKeyWaitFailurePending_ = false;
  bool mediaNetworkRecoveryPending_ = false;
  std::atomic<bool> resourceBlockingArmed_{false};
  EventRegistrationToken authNavigationToken_{};
  EventRegistrationToken authMessageToken_{};
  EventRegistrationToken authProcessFailedToken_{};
  EventRegistrationToken authCloseToken_{};
  std::shared_ptr<std::atomic<bool>> createCallbackAlive_{
      std::make_shared<std::atomic<bool>>(false)};
  std::shared_ptr<std::atomic<bool>> authCallbackAlive_{
      std::make_shared<std::atomic<bool>>(false)};
  std::atomic<bool> creating_{false};
  std::atomic<bool> recreating_{false};
  std::atomic<uint64_t> activeNavigationId_{0};
  std::atomic<bool> navigationInFlight_{false};
  bool trackBoundaryRefreshPending_ = false;
  bool trackBoundaryPlaybackRecoveryPending_ = false;
  bool trackBoundaryPlaybackRecoveryAwaitingNavigation_ = false;
  MonotonicProjectedDeadline trackBoundaryPlaybackRecoveryDeadline_;
  MonotonicElapsedTimestamp creationStartedAt_;
  MonotonicDeadline recreateAt_;
  std::atomic<bool> shuttingDown_{false};
  std::atomic<bool> audioPlaying_{false};
  AtomicMonotonicElapsedTimestamp audioPlayingSinceAt_;
  std::atomic<bool> audioMuted_{false};
  std::atomic<double> audioVolume_{1.0};
  mutable std::atomic<int> appliedMuted_{-1};
  mutable std::atomic<int> appliedVolumePercent_{-1};
  std::atomic<uint32_t> pendingChangeFlags_{0};
  std::atomic<bool> changeMessagePending_{false};
  std::wstring pendingAuthorizationUrl_;
  std::wstring activeAuthorizationUrl_;
  MonotonicElapsedTimestamp createdAt_;
  MonotonicDeadline startupScriptDeadline_;
  MonotonicElapsedTimestamp authControllerStartedAt_;
  // The final PCH policy exposes this storage through a write-filtering proxy:
  // first successful navigation initializes it, then only an App-accepted
  // 52-minute refresh may advance it.
  int64_t lastReloadAtStorage_ = 0;
  MonotonicElapsedTimestamp lastDailyPlayStatsAt_;
  uint64_t statsDocumentGeneration_ = 0;
  uint64_t statsAuthGeneration_ = 0;
  uint64_t statsLastAcceptedRequestId_ = 0;
  int64_t nextAutoClickAt_ = 0;
  bool autoClickInFlight_ = false;
  bool webViewConfigured_ = false;
  bool authCaptureScriptRegistrationComplete_ = false;
  bool startupScriptRegistrationComplete_ = false;
  bool startupNavigationStarted_ = false;
  bool stationNavigationStarted_ = false;
  StartupAwareWakeDeadline nextTickAt_{
      creating_, recreating_, startupScriptDeadline_, authControllerStartedAt_,
      startupNavigationStarted_};
  std::wstring authPendingUrl_;
  bool spotifyAuthorization_ = false;
  bool loginRequired_ = false;
  bool nativeAudioTracking_ = false;
  bool viewVisible_ = false;
  bool startupPreviewActive_ = false;
  bool usingFallback_ = false;
  MonotonicElapsedTimestamp audioLossStartedAt_;
  MonotonicElapsedTimestamp managedPlaybackFallbackStartedAt_;
  bool audioLossPlaybackObserved_ = false;
  bool audioLossProbeInFlight_ = false;
  bool audioLossProbeComplete_ = false;
  bool audioLossAuthUiDetected_ = false;
  bool managedPlaybackFallbackActive_ = false;
  bool managedPlaybackReturnRequested_ = false;
  bool managedPrimaryReturnPending_ = false;
  MediaRecoveryEpisode mediaRecoveryEpisode_{};
  std::wstring audioLossState_;
};

}  // namespace hp
