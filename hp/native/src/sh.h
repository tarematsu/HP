#pragma once
#include "common.h"
#include "config.h"
#include "logger.h"
#include "shared_immutable_vector.h"

namespace hp {
enum class StationheadTabKind {
  None,
  Stationhead,
  Auth,
};

// Which Stationhead window this player instance backs. The two roles share
// every behavior - script injection, resource blocking, the native click
// bridge, layout/visibility rules - except for exactly two things: the
// WebView2 user-data environment and which
// periodic poll runs (Primary polls Stationhead's authenticated stats API,
// Secondary runs a lightweight local-only auth probe).
enum class StationheadRole {
  Primary,
  Secondary,
};

enum StationheadChangeFlags : uint32_t {
  StationheadChangeNone = 0,
  StationheadChangeReturnMain = 1u << 0,
  StationheadChangeReleaseAuth = 1u << 1,
  StationheadChangeShowPlayer = 1u << 2,
};

// Keep elapsed-time decisions independent of system-clock changes while still
// retaining the assigned UTC value for logging and persisted timestamps.
class MonotonicElapsedTimestamp {
 public:
  MonotonicElapsedTimestamp() noexcept = default;

  MonotonicElapsedTimestamp& operator=(int64_t wallTime) noexcept {
    wallTime_ = wallTime;
    if (wallTime <= 0) {
      startedTick_ = 0;
      initialElapsedMs_ = 0;
      return *this;
    }
    const int64_t wallNow = UnixMillis();
    initialElapsedMs_ = wallTime < wallNow
        ? static_cast<uint64_t>(wallNow - wallTime)
        : 0;
    const uint64_t nowTick = GetTickCount64();
    startedTick_ = nowTick == 0 ? 1 : nowTick;
    return *this;
  }

  [[nodiscard]] bool Active() const noexcept { return startedTick_ != 0; }
  [[nodiscard]] int64_t WallTime() const noexcept { return wallTime_; }
  [[nodiscard]] int64_t ElapsedMilliseconds() const noexcept {
    if (!Active()) return 0;
    const uint64_t nowTick = GetTickCount64();
    const uint64_t elapsedSinceAssignment =
        nowTick >= startedTick_ ? nowTick - startedTick_ : 0;
    const uint64_t elapsed = elapsedSinceAssignment > UINT64_MAX - initialElapsedMs_
        ? UINT64_MAX
        : initialElapsedMs_ + elapsedSinceAssignment;
    return elapsed > static_cast<uint64_t>(INT64_MAX)
        ? INT64_MAX
        : static_cast<int64_t>(elapsed);
  }

  operator int64_t() const noexcept { return wallTime_; }

  friend int64_t operator-(
      int64_t, const MonotonicElapsedTimestamp& timestamp) noexcept {
    return timestamp.ElapsedMilliseconds();
  }

  // Polling code expresses its next run as `lastRun + interval`. Re-project
  // that deadline from monotonic elapsed time so a civil-clock correction
  // between runs cannot turn a short remaining interval into an hour-long wait.
  friend int64_t operator+(
      const MonotonicElapsedTimestamp& timestamp, int64_t intervalMs) noexcept {
    if (!timestamp.Active()) return 0;
    const int64_t elapsed = timestamp.ElapsedMilliseconds();
    const int64_t remaining = intervalMs > elapsed ? intervalMs - elapsed : 0;
    const int64_t wallNow = UnixMillis();
    return remaining > INT64_MAX - wallNow ? INT64_MAX : wallNow + remaining;
  }

 private:
  int64_t wallTime_ = 0;
  uint64_t startedTick_ = 0;
  uint64_t initialElapsedMs_ = 0;
};

// Audio callbacks and App handoff checks share this timestamp. Preserve the
// existing atomic load/store interface, but project the returned start time from
// uptime so a system-clock correction cannot invalidate continuous-audio age.
class AtomicMonotonicElapsedTimestamp {
 public:
  AtomicMonotonicElapsedTimestamp() noexcept = default;
  AtomicMonotonicElapsedTimestamp(const AtomicMonotonicElapsedTimestamp&) = delete;
  AtomicMonotonicElapsedTimestamp& operator=(
      const AtomicMonotonicElapsedTimestamp&) = delete;

  void store(
      int64_t wallTime,
      std::memory_order order = std::memory_order_seq_cst) noexcept {
    if (wallTime <= 0) {
      wallTime_.store(0, order);
      startedTick_.store(0, std::memory_order_relaxed);
      return;
    }
    const uint64_t nowTick = GetTickCount64();
    startedTick_.store(nowTick == 0 ? 1 : nowTick, std::memory_order_relaxed);
    wallTime_.store(wallTime, order);
  }

  [[nodiscard]] int64_t load(
      std::memory_order order = std::memory_order_seq_cst) const noexcept {
    const int64_t wallTime = wallTime_.load(order);
    const uint64_t startedTick = startedTick_.load(std::memory_order_acquire);
    if (wallTime <= 0 || startedTick == 0) return 0;
    const uint64_t nowTick = GetTickCount64();
    const uint64_t elapsed = nowTick >= startedTick ? nowTick - startedTick : 0;
    const int64_t wallNow = UnixMillis();
    if (wallNow <= 1 || elapsed >= static_cast<uint64_t>(wallNow - 1)) return 1;
    return wallNow - static_cast<int64_t>(elapsed);
  }

 private:
  std::atomic<int64_t> wallTime_{0};
  std::atomic<uint64_t> startedTick_{0};
};

// Converts an assigned UTC deadline into an uptime deadline once. Subsequent
// clock corrections cannot make a startup watchdog fire early or stall.
class MonotonicDeadline {
 public:
  MonotonicDeadline() noexcept = default;

  MonotonicDeadline& operator=(int64_t wallDeadline) noexcept {
    wallDeadline_ = wallDeadline;
    if (wallDeadline <= 0) {
      deadlineTick_ = 0;
      return *this;
    }
    deadlineTick_ = TickForWallDeadline(wallDeadline);
    return *this;
  }

  [[nodiscard]] bool Active() const noexcept { return deadlineTick_ != 0; }
  [[nodiscard]] bool Reached() const noexcept {
    return Active() && GetTickCount64() >= deadlineTick_;
  }
  [[nodiscard]] int64_t RemainingMilliseconds() const noexcept {
    if (!Active()) return 0;
    const uint64_t nowTick = GetTickCount64();
    const uint64_t remaining = deadlineTick_ > nowTick ? deadlineTick_ - nowTick : 0;
    return remaining > static_cast<uint64_t>(INT64_MAX)
        ? INT64_MAX
        : static_cast<int64_t>(remaining);
  }
  [[nodiscard]] int64_t ProjectedWallDeadline() const noexcept {
    if (!Active()) return 0;
    const int64_t wallNow = UnixMillis();
    const int64_t remaining = RemainingMilliseconds();
    return remaining > INT64_MAX - wallNow ? INT64_MAX : wallNow + remaining;
  }

  operator int64_t() const noexcept { return wallDeadline_; }

  friend bool operator>=(int64_t, const MonotonicDeadline& deadline) noexcept {
    return deadline.Reached();
  }

  // ScheduleRecreate keeps the earliest pending request. Compare candidate and
  // current deadlines in uptime space so an OS clock correction between two
  // failures cannot replace an earlier retry with a later one.
  friend bool operator<(
      int64_t candidateWallDeadline,
      const MonotonicDeadline& current) noexcept {
    return !current.Active() ||
        TickForWallDeadline(candidateWallDeadline) < current.deadlineTick_;
  }

 private:
  [[nodiscard]] static uint64_t TickForWallDeadline(
      int64_t wallDeadline) noexcept {
    const int64_t wallNow = UnixMillis();
    const uint64_t delay = wallDeadline > wallNow
        ? static_cast<uint64_t>(wallDeadline - wallNow)
        : 0;
    const uint64_t nowTick = GetTickCount64();
    uint64_t deadlineTick = delay > UINT64_MAX - nowTick
        ? UINT64_MAX
        : nowTick + delay;
    if (deadlineTick == 0) deadlineTick = 1;
    return deadlineTick;
  }

  int64_t wallDeadline_ = 0;
  uint64_t deadlineTick_ = 0;
};

// Operational deadlines do not need the originally assigned civil timestamp.
// Expose a freshly projected wall deadline so the App scheduler can keep using
// its existing UTC interface while the actual wait remains based on uptime.
class MonotonicProjectedDeadline {
 public:
  MonotonicProjectedDeadline() noexcept = default;

  MonotonicProjectedDeadline& operator=(int64_t wallDeadline) noexcept {
    deadline_ = wallDeadline;
    return *this;
  }

  [[nodiscard]] bool Active() const noexcept { return deadline_.Active(); }
  [[nodiscard]] bool Reached() const noexcept { return deadline_.Reached(); }
  operator int64_t() const noexcept { return deadline_.ProjectedWallDeadline(); }

 private:
  MonotonicDeadline deadline_;
};

// The ordinary scheduler may sleep for minutes after a stable document. During
// controller creation, delayed recreation, required-script registration, or
// auth-controller creation, expose an immediate wake so watchdog and recovery
// deadlines are evaluated on each App foreground tick.
class StartupAwareWakeDeadline {
 public:
  StartupAwareWakeDeadline(
      const std::atomic<bool>& creating,
      const std::atomic<bool>& recreating,
      const MonotonicDeadline& startupScriptDeadline,
      const MonotonicElapsedTimestamp& authControllerStartedAt,
      const bool& startupNavigationStarted) noexcept
      : creating_(&creating),
        recreating_(&recreating),
        startupScriptDeadline_(&startupScriptDeadline),
        authControllerStartedAt_(&authControllerStartedAt),
        startupNavigationStarted_(&startupNavigationStarted) {}

  StartupAwareWakeDeadline& operator=(int64_t value) noexcept {
    value_ = value;
    return *this;
  }

  operator int64_t() const noexcept {
    const bool startupWatchdogPending =
        creating_->load(std::memory_order_relaxed) ||
        recreating_->load(std::memory_order_relaxed) ||
        (!*startupNavigationStarted_ && startupScriptDeadline_->Active()) ||
        authControllerStartedAt_->Active();
    return startupWatchdogPending ? 0 : static_cast<int64_t>(value_);
  }

 private:
  const std::atomic<bool>* creating_;
  const std::atomic<bool>* recreating_;
  const MonotonicDeadline* startupScriptDeadline_;
  const MonotonicElapsedTimestamp* authControllerStartedAt_;
  const bool* startupNavigationStarted_;
  MonotonicProjectedDeadline value_;
};

struct StationheadDailyPlayPoint {
  int64_t dayStartMsUtc = 0;
  int value = 0;

  bool operator==(const StationheadDailyPlayPoint&) const = default;
};

// A single 5-minute sample of today's cumulative play value, kept over time
// so a flattening of consecutive values can be read back later as a gap in
// listening activity (see App::UpdateStationheadPlayHistory).
struct StationheadPlayHistorySample {
  int64_t timestamp = 0;
  int value = 0;

  bool operator==(const StationheadPlayHistorySample&) const = default;
};

struct StationheadStatus {
  // App handles advance these when a primary/secondary notification or the
  // local track-transition projection changes. Keeping them first lets the
  // default equality operator reject changed snapshots before touching URLs
  // and diagnostic strings.
  uint64_t contentRevision = 0;
  uint64_t secondaryContentRevision = 0;
  bool created = false;
  bool navigating = false;
  bool playing = false;
  bool loginRequired = false;
  bool spotifyAuthorization = false;
  bool visible = false;
  bool processFailed = false;
  bool spotifyConfigured = false;
  bool authAvailable = false;
  bool audioPlaying = false;
  bool audioMuted = false;
  bool secondaryAudioMuted = false;
  bool secondaryPlaying = false;
  bool primaryAudioSelected = true;
  std::wstring url;
  // Render-only routing metadata for choosing the shared playback feed.
  std::wstring fallbackUrl;
  std::wstring secondaryUrl;
  std::wstring detail;
  // Recent per-day listening activity returned by the primary window's
  // authenticated Stationhead account endpoint, oldest first; the last entry
  // is today (partial, still accumulating). Empty for the secondary window.
  SharedImmutableVector<StationheadDailyPlayPoint> dailyPlayCounts;
  int64_t dailyPlayStatsUpdatedAt = 0;
  int64_t dailyPlayStatsServerDateAt = 0;
  int64_t dailyPlayStatsReceivedAt = 0;

  bool operator==(const StationheadStatus&) const = default;
};

// Drives one embedded Stationhead WebView2 window. Both Window A (Primary)
// and Window B (Secondary) are the same class, distinguished only by `role_`.
class StationheadPlayer {
 public:
  StationheadPlayer(StationheadRole role, HWND window, StationheadConfig config,
                    fs::path userDataFolder, Logger& log);
  StationheadPlayer(const StationheadPlayer&) = delete;
  StationheadPlayer& operator=(const StationheadPlayer&) = delete;
  ~StationheadPlayer();

  void Start();
  void Stop();
  void Tick(int64_t nowMs);
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
  [[nodiscard]] bool IsSecondary() const noexcept { return role_ == StationheadRole::Secondary; }
  // Tags shared log lines with which window they came from - both roles run
  // the same code path, so without this a log reader cannot tell whether an
  // "audio playing"/"audio stopped" entry (or any other shared-path log line)
  // came from Window A or Window B.
  [[nodiscard]] const wchar_t* RoleTag() const noexcept { return IsSecondary() ? L"B" : L"A"; }
  void ApplyMute() const noexcept;
  void ApplyVolume() const noexcept;
  void ApplyAudioPlaybackState(bool playing, const std::wstring& source);
  void HandleTrackEnded(int64_t nowMs, bool retry);
  void RecoverTrackBoundaryPlayback();
  void TryStartInitialNavigation();
  void CompletePendingAuthPopupDeferral() noexcept;
  void EnsureDistinctBrowserIdentity() noexcept;
  void Create();
  HRESULT CreateProfileController(
      HWND parentWindow, ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* handler) const noexcept;
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
  void PollAuthProbe(int64_t nowMs);
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

  StationheadRole role_;
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
  MonotonicElapsedTimestamp lastDailyPlayStatsAt_;  // Primary only.
  uint64_t statsDocumentGeneration_ = 0;             // Primary only.
  uint64_t statsAuthGeneration_ = 0;                 // Primary only.
  uint64_t statsLastAcceptedRequestId_ = 0;          // Primary only.
  MonotonicElapsedTimestamp lastAuthProbeAt_;       // Secondary only.
  MonotonicElapsedTimestamp authProbeStartedAt_;    // Secondary only.
  bool authProbeInFlight_ = false;                  // Secondary only.
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
  std::wstring audioLossState_;
  ICoreWebView2* identityWebview_ = nullptr;  // Secondary only.
};
}  // namespace hp
