#pragma once
#include "common.h"
#include "audio_health_scan_coordinator.h"
#include "sh_audio_loss_policy.h"

namespace hp {

inline constexpr bool StationheadPlaybackNavigationActive(
    bool navigationInFlight,
    bool statusNavigating,
    bool spotifyAuthorization) noexcept {
  return navigationInFlight || (statusNavigating && !spotifyAuthorization);
}

inline constexpr int64_t StationheadAudioHealthCheckIntervalMs() noexcept {
  return 1 * 60'000;
}

inline constexpr int64_t StationheadAudioRecoverySettleMs() noexcept {
  return 15'000;
}

enum class StationheadAudioRecoveryStage : unsigned char {
  Idle,
  LightRepair,
  Reload,
  Rebuild,
  Fallback,
};

static_assert(StationheadPlaybackNavigationActive(true, false, false));
static_assert(StationheadPlaybackNavigationActive(true, true, true));
static_assert(StationheadPlaybackNavigationActive(false, true, false));
static_assert(!StationheadPlaybackNavigationActive(false, true, true));
static_assert(!StationheadPlaybackNavigationActive(false, false, false));
static_assert(StationheadAudioHealthCheckIntervalMs() == 60'000);
static_assert(StationheadAudioRecoverySettleMs() == 15'000);

}  // namespace hp

// Stationhead keeps one long-lived room URL. Normal silence recovery is a
// single bounded sequence: one lightweight Start Listening repair, one reload,
// one WebView rebuild, then managed fallback. Authentication always interrupts
// the destructive sequence and gets foreground ownership.
#define NextWakeAt()                                                          \
  NextWakeAt() const noexcept {                                               \
    int64_t next = NextWakeAtBase();                                          \
    if (audioHealthCheckStartedAt_.Active()) {                                \
      const int64_t due = audioHealthCheckStartedAt_ +                        \
          ::hp::StationheadAudioHealthCheckIntervalMs();                      \
      if (next <= 0 || due < next) next = due;                                \
    }                                                                         \
    if (audioLossRecoveryStartedAt_.Active()) {                               \
      const int64_t due = audioLossRecoveryStartedAt_ +                       \
          ::hp::StationheadAudioRecoverySettleMs();                           \
      if (next <= 0 || due < next) next = due;                                \
    }                                                                         \
    return next;                                                              \
  }                                                                           \
  [[nodiscard]] int64_t NextWakeAtBase()

#define RecoverUnavailableAuthorization()                                    \
  RecoverUnavailableAuthorization() {                                        \
    RecoverUnavailableAuthorizationBase();                                   \
    const int64_t nowMs = UnixMillis();                                       \
    EscalateAudioLossRecovery(nowMs);                                         \
    PollPeriodicAudioHealth(nowMs);                                           \
  }                                                                           \
  void RecoverUnavailableAuthorizationBase()

#define RetryPendingTrackBoundaryRefresh(parameters)                         \
  RetryPendingTrackBoundaryRefresh(parameters) {                             \
    (void)nowMs;                                                              \
    trackBoundaryRefreshPending_ = false;                                     \
    return false;                                                             \
  }                                                                           \
  bool RetryPendingTrackBoundaryRefreshDisabled(parameters)

#define nextAutoClickAt_                                                      \
  nextAutoClickAt_ = 0;                                                       \
  void ResetAudioLossEscalation() noexcept {                                  \
    ::hp::ResetMediaRecoveryEpisode(mediaRecoveryEpisode_, 1);               \
    audioLossRecoveryStage_ = ::hp::StationheadAudioRecoveryStage::Idle;     \
    audioLossRecoveryAwaitingNavigation_ = false;                             \
    audioLossRecoveryStartedAt_ = 0;                                          \
    audioLossRecoveryLifecycle_.reset();                                      \
  }                                                                           \
  void EscalateAudioLossRecovery(int64_t nowMs) {                             \
    if (audioPlaying_.load(std::memory_order_relaxed)) {                      \
      ResetAudioLossEscalation();                                             \
      return;                                                                 \
    }                                                                         \
    if (!webview_ || usingFallback_ || managedPlaybackFallbackActive_ ||      \
        spotifyAuthorization_ || loginRequired_) {                            \
      return;                                                                 \
    }                                                                         \
                                                                                \
    bool statusNavigating = false;                                            \
    {                                                                         \
      std::lock_guard lock(mutex_);                                           \
      statusNavigating = status_.navigating;                                  \
    }                                                                         \
    const bool navigationActive =                                             \
        ::hp::StationheadPlaybackNavigationActive(                            \
            navigationInFlight_.load(std::memory_order_acquire),              \
            statusNavigating, spotifyAuthorization_);                         \
    if (navigationActive || recreating_.load(std::memory_order_relaxed)) {    \
      return;                                                                 \
    }                                                                         \
                                                                                \
    using RecoveryStage = ::hp::StationheadAudioRecoveryStage;               \
    if (audioLossRecoveryStage_ == RecoveryStage::Idle) {                    \
      if (!audioLossPlaybackObserved_ || !audioLossStartedAt_.Active() ||     \
          audioLossStartedAt_.ElapsedMilliseconds() <                         \
              (::hp::kStationheadAudioLossGraceMs +                           \
               ::hp::kStationheadAudioLossDomSettleMs) ||                     \
          audioLossProbeInFlight_ || !audioLossProbeComplete_ ||              \
          audioLossAuthUiDetected_) {                                         \
        return;                                                               \
      }                                                                       \
      static constexpr wchar_t kLightRepairScript[] = LR"JS(                 \
(() => {                                                                      \
  try { window.__homepanelPrimaryStationhead?.scan?.(0); } catch (_) {}       \
  return true;                                                                \
})()                                                                          \
)JS";                                                                         \
      webview_->ExecuteScript(kLightRepairScript, nullptr);                   \
      nextAutoClickAt_ = nowMs;                                               \
      AttemptNativeStartClick(nowMs);                                         \
      audioLossRecoveryStage_ = RecoveryStage::LightRepair;                  \
      audioLossRecoveryStartedAt_ = nowMs;                                    \
      UpdateAudioLossState(                                                   \
          L"light_recovery",                                                 \
          L"silence confirmed; issued one Start Listening recovery attempt"); \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (audioLossRecoveryStage_ == RecoveryStage::LightRepair) {             \
      if (!audioLossRecoveryStartedAt_.Active() ||                            \
          audioLossRecoveryStartedAt_.ElapsedMilliseconds() <                 \
              ::hp::StationheadAudioRecoverySettleMs()) {                     \
        return;                                                               \
      }                                                                       \
      audioLossRecoveryStage_ = RecoveryStage::Reload;                       \
      audioLossRecoveryAwaitingNavigation_ = true;                            \
      audioLossRecoveryStartedAt_ = 0;                                        \
      audioLossStartedAt_ = 0;                                                \
      ResetAudioLossProbe();                                                  \
      UpdateAudioLossState(                                                   \
          L"reload_recovery",                                                \
          L"lightweight recovery stayed silent; reloading Stationhead once"); \
      NavigateCurrentUrl(nowMs, L"audio-loss recovery reload");              \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (audioLossRecoveryStage_ == RecoveryStage::Reload) {                  \
      if (audioLossRecoveryAwaitingNavigation_) {                             \
        audioLossRecoveryAwaitingNavigation_ = false;                         \
        audioLossRecoveryStartedAt_ = nowMs;                                  \
        nextAutoClickAt_ = nowMs;                                             \
        AttemptNativeStartClick(nowMs);                                       \
        ResetAudioLossProbe();                                                \
        UpdateAudioLossState(                                                 \
            L"reload_settle",                                                \
            L"Stationhead reloaded; waiting for playback or authentication"); \
        return;                                                               \
      }                                                                       \
      if (!audioLossRecoveryStartedAt_.Active() ||                            \
          audioLossRecoveryStartedAt_.ElapsedMilliseconds() <                 \
              ::hp::StationheadAudioRecoverySettleMs()) {                     \
        return;                                                               \
      }                                                                       \
      if (audioLossProbeInFlight_) return;                                    \
      if (!audioLossProbeComplete_) {                                         \
        BeginAudioLossAuthProbe(nowMs);                                       \
        return;                                                               \
      }                                                                       \
      if (audioLossAuthUiDetected_ || loginRequired_) return;                 \
      audioLossRecoveryStage_ = RecoveryStage::Rebuild;                      \
      audioLossRecoveryStartedAt_ = 0;                                        \
      audioLossRecoveryLifecycle_ = createCallbackAlive_;                     \
      audioLossStartedAt_ = 0;                                                \
      ResetAudioLossProbe();                                                  \
      UpdateAudioLossState(                                                   \
          L"webview_recovery",                                               \
          L"reload stayed silent without authentication; rebuilding WebView once"); \
      ScheduleRecreate(L"Stationhead silence recovery WebView rebuild", 1'000); \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (audioLossRecoveryStage_ == RecoveryStage::Rebuild) {                 \
      const auto previousLifecycle = audioLossRecoveryLifecycle_.lock();      \
      if (previousLifecycle != createCallbackAlive_) {                        \
        audioLossRecoveryLifecycle_ = createCallbackAlive_;                   \
        audioLossRecoveryStartedAt_ = nowMs;                                  \
        nextAutoClickAt_ = nowMs;                                             \
        AttemptNativeStartClick(nowMs);                                       \
        ResetAudioLossProbe();                                                \
        UpdateAudioLossState(                                                 \
            L"webview_settle",                                               \
            L"Stationhead WebView rebuilt; waiting for playback or authentication"); \
        return;                                                               \
      }                                                                       \
      if (!audioLossRecoveryStartedAt_.Active() ||                            \
          audioLossRecoveryStartedAt_.ElapsedMilliseconds() <                 \
              ::hp::StationheadAudioRecoverySettleMs()) {                     \
        return;                                                               \
      }                                                                       \
      if (audioLossProbeInFlight_) return;                                    \
      if (!audioLossProbeComplete_) {                                         \
        BeginAudioLossAuthProbe(nowMs);                                       \
        return;                                                               \
      }                                                                       \
      if (audioLossAuthUiDetected_ || loginRequired_) return;                 \
      audioLossRecoveryStage_ = RecoveryStage::Fallback;                     \
      UpdateAudioLossState(                                                   \
          L"fallback_after_rebuild",                                         \
          L"one reload and one WebView rebuild stayed silent; switching to fallback"); \
      SetManagedPlaybackFallback(                                             \
          true,                                                               \
          L"fallback: Stationhead remained silent after bounded recovery");  \
    }                                                                         \
  }                                                                           \
  void PollPeriodicAudioHealth(int64_t nowMs) {                               \
    const auto lifecycle = createCallbackAlive_;                              \
    const auto previousLifecycle = audioHealthLifecycle_.lock();              \
    if (!webview_ || previousLifecycle != lifecycle) {                        \
      audioHealthLifecycle_ = lifecycle;                                      \
      audioHealthCheckStartedAt_ = 0;                                         \
      if (!webview_) return;                                                  \
    }                                                                         \
                                                                                \
    bool statusNavigating = false;                                            \
    {                                                                         \
      std::lock_guard lock(mutex_);                                           \
      statusNavigating = status_.navigating;                                  \
    }                                                                         \
    const bool navigationActive =                                             \
        ::hp::StationheadPlaybackNavigationActive(                            \
            navigationInFlight_.load(std::memory_order_acquire),              \
            statusNavigating, spotifyAuthorization_);                         \
    if (!webViewConfigured_ || !startupNavigationStarted_ ||                  \
        spotifyAuthorization_ || loginRequired_ || navigationActive ||        \
        recreating_.load(std::memory_order_relaxed)) {                        \
      audioHealthCheckStartedAt_ = 0;                                         \
      return;                                                                 \
    }                                                                         \
                                                                                \
    const int64_t intervalMs =                                                \
        ::hp::StationheadAudioHealthCheckIntervalMs();                        \
    const auto scheduleAfter = [&](ULONGLONG delayMs) {                       \
      const int64_t boundedDelay = static_cast<int64_t>(                      \
          std::min<ULONGLONG>(delayMs, static_cast<ULONGLONG>(intervalMs)));  \
      audioHealthCheckStartedAt_ = nowMs - (intervalMs - boundedDelay);       \
    };                                                                        \
    if (!audioHealthCheckStartedAt_.Active()) {                               \
      scheduleAfter(::hp::AudioHealthScanDelayMs(GetTickCount64(), 0));       \
      return;                                                                 \
    }                                                                         \
    if (nowMs - audioHealthCheckStartedAt_ < intervalMs) return;              \
                                                                                \
    const ULONGLONG scanTick = GetTickCount64();                              \
    if (!::hp::TryClaimAudioHealthScan(scanTick)) {                           \
      scheduleAfter(::hp::kAudioHealthScanRetryMs);                           \
      return;                                                                 \
    }                                                                         \
                                                                                \
    ComPtr<ICoreWebView2_8> audioView;                                        \
    BOOL nativePlaying = FALSE;                                               \
    const HRESULT audioInterfaceResult = webview_.As(&audioView);             \
    const HRESULT audioStateResult =                                          \
        SUCCEEDED(audioInterfaceResult) && audioView                          \
            ? audioView->get_IsDocumentPlayingAudio(&nativePlaying)           \
            : E_NOINTERFACE;                                                  \
    ::hp::ReleaseAudioHealthScan();                                           \
    if (FAILED(audioInterfaceResult) || !audioView ||                         \
        FAILED(audioStateResult)) {                                           \
      scheduleAfter(::hp::kAudioHealthScanRetryMs);                           \
      return;                                                                 \
    }                                                                         \
                                                                                \
    scheduleAfter(::hp::AudioHealthScanDelayMs(scanTick, 0));                 \
    ApplyAudioPlaybackState(                                                  \
        nativePlaying != FALSE, L"1-minute native audio health check");      \
  }                                                                           \
  ::hp::StationheadAudioRecoveryStage audioLossRecoveryStage_ =              \
      ::hp::StationheadAudioRecoveryStage::Idle;                              \
  bool audioLossRecoveryAwaitingNavigation_ = false;                          \
  MonotonicElapsedTimestamp audioLossRecoveryStartedAt_;                      \
  std::weak_ptr<std::atomic<bool>> audioLossRecoveryLifecycle_;               \
  MonotonicElapsedTimestamp audioHealthCheckStartedAt_;                       \
  std::weak_ptr<std::atomic<bool>> audioHealthLifecycle_;                     \
  MonotonicElapsedTimestamp periodicRefreshStartedAt_;                        \
  int64_t periodicRefreshNavigationObserved_

#include "sh.h"

#undef nextAutoClickAt_
#undef RetryPendingTrackBoundaryRefresh
#undef RecoverUnavailableAuthorization
#undef NextWakeAt

namespace hp {

inline constexpr int64_t StationheadBoundaryElapsedMs(
    ULONGLONG startedAt, ULONGLONG now) noexcept {
  if (startedAt == 0 || now < startedAt) return 0;
  constexpr ULONGLONG kMaxSignedMilliseconds =
      9'223'372'036'854'775'807ULL;
  const ULONGLONG elapsed = now - startedAt;
  return elapsed > kMaxSignedMilliseconds
      ? static_cast<int64_t>(kMaxSignedMilliseconds)
      : static_cast<int64_t>(elapsed);
}

inline constexpr int64_t StationheadOperationalDeadlineValue(
    bool active, bool reached, int64_t projectedWallDeadline) noexcept {
  if (!active) return 0;
  return reached ? 1 : projectedWallDeadline;
}

inline int64_t StationheadProjectedDeadlineValue(
    const MonotonicProjectedDeadline& deadline) noexcept {
  return StationheadOperationalDeadlineValue(
      deadline.Active(), deadline.Reached(), static_cast<int64_t>(deadline));
}

inline bool operator>=(
    int64_t, const MonotonicProjectedDeadline& deadline) noexcept {
  return deadline.Reached();
}

inline bool operator<(
    int64_t, const MonotonicProjectedDeadline& deadline) noexcept {
  return deadline.Active() && !deadline.Reached();
}

inline int64_t StationheadPolicyWallMillis() noexcept {
  FILETIME fileTime{};
  GetSystemTimeAsFileTime(&fileTime);
  ULARGE_INTEGER ticks{};
  ticks.LowPart = fileTime.dwLowDateTime;
  ticks.HighPart = fileTime.dwHighDateTime;
  constexpr ULONGLONG kUnixEpochFileTimeTicks = 116'444'736'000'000'000ULL;
  if (ticks.QuadPart <= kUnixEpochFileTimeTicks) return 0;
  const ULONGLONG milliseconds =
      (ticks.QuadPart - kUnixEpochFileTimeTicks) / 10'000ULL;
  return milliseconds > static_cast<ULONGLONG>(INT64_MAX)
      ? INT64_MAX
      : static_cast<int64_t>(milliseconds);
}

inline bool StationheadStartupAwareWakePending(
    const StartupAwareWakeDeadline& deadline) noexcept {
  const int64_t projected = static_cast<int64_t>(deadline);
  return projected > 0 && projected > StationheadPolicyWallMillis();
}

inline bool operator<(
    int64_t, const StartupAwareWakeDeadline& deadline) noexcept {
  return StationheadStartupAwareWakePending(deadline);
}

inline bool operator>(
    const MonotonicProjectedDeadline& deadline, int candidate) noexcept {
  if (candidate == 0) return deadline.Active();
  return StationheadProjectedDeadlineValue(deadline) > candidate;
}

inline bool operator<=(
    const MonotonicProjectedDeadline& deadline, int candidate) noexcept {
  if (candidate == 0) return !deadline.Active();
  return StationheadProjectedDeadlineValue(deadline) <= candidate;
}

inline bool operator<(
    const MonotonicProjectedDeadline& deadline, int64_t candidate) noexcept {
  if (!deadline.Active()) return false;
  if (deadline.Reached()) return candidate > 1;
  return static_cast<int64_t>(deadline) < candidate;
}

static_assert(StationheadBoundaryElapsedMs(1'000, 4'120) == 3'120);
static_assert(StationheadBoundaryElapsedMs(4'120, 1'000) == 0);
static_assert(StationheadOperationalDeadlineValue(false, false, 42) == 0);
static_assert(StationheadOperationalDeadlineValue(true, true, 42) == 1);
static_assert(StationheadOperationalDeadlineValue(true, false, 42) == 42);

namespace stationhead_boundary_message_policy {
inline SRWLOCK reloadClockLock = SRWLOCK_INIT;
inline ULONGLONG primaryReloadMonotonicAt = 0;
inline MonotonicProjectedDeadline primaryAutoClickDeadline;
inline int64_t primaryAutoClickExposed = 0;
}  // namespace stationhead_boundary_message_policy

inline int64_t& StationheadAutoClickDeadlineStorage(int64_t& storage) noexcept {
  auto& deadline = stationhead_boundary_message_policy::primaryAutoClickDeadline;
  int64_t& exposed = stationhead_boundary_message_policy::primaryAutoClickExposed;
  if (storage != exposed) deadline = storage;
  storage = StationheadProjectedDeadlineValue(deadline);
  exposed = storage;
  return storage;
}

class StationheadNavigationInFlightProxy {
 public:
  StationheadNavigationInFlightProxy(
      std::atomic<bool>& storage,
      MonotonicElapsedTimestamp& refreshStartedAt,
      int64_t& navigationObserved) noexcept
      : storage_(storage),
        refreshStartedAt_(refreshStartedAt),
        navigationObserved_(navigationObserved) {}

  void store(bool value, std::memory_order order) noexcept {
    if (value) {
      refreshStartedAt_ = 0;
      navigationObserved_ = 1;
    }
    storage_.store(value, order);
  }

  [[nodiscard]] bool load(std::memory_order order) const noexcept {
    return storage_.load(order);
  }

 private:
  std::atomic<bool>& storage_;
  MonotonicElapsedTimestamp& refreshStartedAt_;
  int64_t& navigationObserved_;
};

inline StationheadNavigationInFlightProxy StationheadNavigationInFlightStorage(
    std::atomic<bool>& storage,
    MonotonicElapsedTimestamp& refreshStartedAt,
    int64_t& navigationObserved) noexcept {
  return StationheadNavigationInFlightProxy(
      storage, refreshStartedAt, navigationObserved);
}

class StationheadBoundaryReloadClockProxy {
 public:
  StationheadBoundaryReloadClockProxy(int64_t& storage, bool configured) noexcept
      : storage_(storage), configured_(configured) {}

  operator int64_t() const noexcept { return storage_; }

  int64_t operator=(int64_t candidate) noexcept {
    AcquireSRWLockExclusive(&stationhead_boundary_message_policy::reloadClockLock);
    const bool accept = configured_ && storage_ <= 0;
    if (accept) {
      storage_ = candidate;
      stationhead_boundary_message_policy::primaryReloadMonotonicAt = GetTickCount64();
    }
    ReleaseSRWLockExclusive(&stationhead_boundary_message_policy::reloadClockLock);
    return candidate;
  }

  friend int64_t operator-(
      int64_t wallClockNow,
      const StationheadBoundaryReloadClockProxy& clock) noexcept {
    ULONGLONG monotonicAt = 0;
    AcquireSRWLockShared(&stationhead_boundary_message_policy::reloadClockLock);
    monotonicAt = stationhead_boundary_message_policy::primaryReloadMonotonicAt;
    ReleaseSRWLockShared(&stationhead_boundary_message_policy::reloadClockLock);
    if (monotonicAt == 0) return wallClockNow - clock.storage_;
    return StationheadBoundaryElapsedMs(monotonicAt, GetTickCount64());
  }

 private:
  int64_t& storage_;
  bool configured_;
};

inline StationheadBoundaryReloadClockProxy StationheadBoundaryReloadClock(
    int64_t& storage, bool configured) noexcept {
  return StationheadBoundaryReloadClockProxy(storage, configured);
}

inline constexpr bool StationheadFocusSurfaceIsInteractive(
    LONG width, LONG height) noexcept {
  return width > 1 && height > 1;
}

static_assert(!StationheadFocusSurfaceIsInteractive(1, 1));
static_assert(!StationheadFocusSurfaceIsInteractive(1, 720));
static_assert(!StationheadFocusSurfaceIsInteractive(1280, 1));
static_assert(StationheadFocusSurfaceIsInteractive(2, 2));

inline bool StationheadFocusRemainsInteractive(
    HWND target, HWND focused) noexcept {
  if (!target || !focused || focused == target ||
      !IsWindow(target) || !IsWindow(focused)) {
    return false;
  }

  HWND surface = focused;
  HWND parent = GetParent(surface);
  while (parent && parent != target) {
    surface = parent;
    parent = GetParent(surface);
  }
  if (parent != target || !IsWindowVisible(surface)) return false;

  RECT client{};
  if (!GetClientRect(surface, &client)) return false;
  return StationheadFocusSurfaceIsInteractive(
      client.right - client.left, client.bottom - client.top);
}

inline HWND SetFocusAfterStationheadHide(HWND target) noexcept {
  const HWND focused = GetFocus();
  if (StationheadFocusRemainsInteractive(target, focused)) return focused;
  return ::SetFocus(target);
}

}  // namespace hp

#define lastReloadAt_                                                        \
  (::hp::StationheadBoundaryReloadClock(                                     \
      (lastReloadAtStorage_), webViewConfigured_))
#define nextAutoClickAt_                                                     \
  (::hp::StationheadAutoClickDeadlineStorage(                                \
      (nextAutoClickAt_)))
#define navigationInFlight_                                                  \
  (::hp::StationheadNavigationInFlightStorage(                               \
      (navigationInFlight_), periodicRefreshStartedAt_,                      \
      periodicRefreshNavigationObserved_))
#define SetFocus(target) (::hp::SetFocusAfterStationheadHide((target)))

#include "sh_shared.h"

namespace hp {

inline std::wstring StationheadAutoplayScriptCurrentInteraction(
    const wchar_t* globalName, const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptRuntimeFixed(globalName, messagePrefix);
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadInteractionBridge) {
    return;
  }
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function') return;
  window.__homepanelStationheadInteractionBridge = true;
  const nativeSetInterval = window.setInterval.bind(window);
  let lastBlocking = null;
  const publish = () => {
    const blocking = window.__homepanelStationheadBlockingLoginVisible;
    if (blocking !== true && blocking !== false) return;
    if (blocking === lastBlocking) return;
    lastBlocking = blocking;
    if (!blocking) {
      try {
        webview.postMessage({
          type: 'stationhead-auth-ready',
          source: 'current-interaction-state'
        });
      } catch (_) {}
    }
  };
  publish();
  nativeSetInterval(publish, 1000);
})()
)JS");
  return script;
}

inline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs =
    3'500;
static_assert(kStationheadMeasuredPostPlaybackStopClickDelayMs < 12'000);

}  // namespace hp

#define kStationheadPostPlaybackStopClickDelayMs                             \
  (::hp::kStationheadMeasuredPostPlaybackStopClickDelayMs)
