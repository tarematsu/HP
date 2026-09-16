#pragma once
#include "common.h"

namespace hp {

inline constexpr bool StationheadPlaybackNavigationActive(
    bool navigationInFlight,
    bool statusNavigating,
    bool spotifyAuthorization) noexcept {
  return navigationInFlight || (statusNavigating && !spotifyAuthorization);
}

inline constexpr int64_t StationheadPeriodicRefreshIntervalMs() noexcept {
  return 50 * 60'000;
}

inline void RestoreStationheadPlaybackMemoryTargetForReload(
    ICoreWebView2* webview) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2> baseWebView = webview;
  ComPtr<ICoreWebView2_19> webview19;
  if (FAILED(baseWebView.As(&webview19)) || !webview19) return;

  COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL current =
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL;
  if (SUCCEEDED(webview19->get_MemoryUsageTargetLevel(&current)) &&
      current == COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL) {
    return;
  }
  webview19->put_MemoryUsageTargetLevel(
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
}

static_assert(StationheadPlaybackNavigationActive(true, false, false));
static_assert(StationheadPlaybackNavigationActive(true, true, true));
static_assert(StationheadPlaybackNavigationActive(false, true, false));
static_assert(!StationheadPlaybackNavigationActive(false, true, true));
static_assert(!StationheadPlaybackNavigationActive(false, false, false));
static_assert(StationheadPeriodicRefreshIntervalMs() == 50 * 60'000);

}  // namespace hp

// Extend StationheadPlayer while sh.h is parsed, then remove the temporary
// source-rewriting macros before any implementation file is compiled. The
// single Stationhead player refreshes every 50 minutes.
#define NextWakeAt()                                                          \
  NextWakeAt() const noexcept {                                               \
    int64_t next = NextWakeAtBase();                                          \
    if (periodicRefreshStartedAt_.Active()) {                                 \
      const int64_t due = periodicRefreshStartedAt_ +                         \
          ::hp::StationheadPeriodicRefreshIntervalMs();                       \
      if (next <= 0 || due < next) next = due;                                \
    }                                                                         \
    return next;                                                              \
  }                                                                           \
  [[nodiscard]] int64_t NextWakeAtBase()

#define RecoverUnavailableAuthorization()                                    \
  RecoverUnavailableAuthorization() {                                        \
    RecoverUnavailableAuthorizationBase();                                   \
    RefreshPeriodicNavigation(UnixMillis());                                  \
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
  void RefreshPeriodicNavigation(int64_t nowMs) {                             \
    const auto lifecycle = createCallbackAlive_;                              \
    const auto previousLifecycle = periodicRefreshLifecycle_.lock();          \
    if (!webview_ || previousLifecycle != lifecycle) {                        \
      periodicRefreshLifecycle_ = lifecycle;                                  \
      periodicRefreshStartedAt_ = 0;                                          \
      periodicRefreshNavigationObserved_ = 0;                                 \
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
    if (navigationActive) {                                                   \
      periodicRefreshStartedAt_ = 0;                                          \
      periodicRefreshNavigationObserved_ = 1;                                 \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (!webViewConfigured_ || !startupNavigationStarted_ ||                  \
        spotifyAuthorization_ || loginRequired_ ||                            \
        recreating_.load(std::memory_order_relaxed)) {                        \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (periodicRefreshNavigationObserved_ != 0 ||                            \
        !periodicRefreshStartedAt_.Active()) {                                \
      periodicRefreshNavigationObserved_ = 0;                                 \
      periodicRefreshStartedAt_ = nowMs;                                      \
      return;                                                                 \
    }                                                                         \
    const int64_t intervalMs =                                                \
        ::hp::StationheadPeriodicRefreshIntervalMs();                         \
    if (nowMs - periodicRefreshStartedAt_ < intervalMs) return;               \
                                                                                \
    periodicRefreshStartedAt_ = nowMs;                                        \
    audioPlayingSinceAt_.store(0, std::memory_order_relaxed);                 \
    audioLossPlaybackObserved_ = false;                                       \
    ::hp::RestoreStationheadPlaybackMemoryTargetForReload(webview_.Get());    \
    SetStartupBounds();                                                       \
    NavigateCurrentUrl(nowMs, L"50-minute periodic refresh");                \
  }                                                                           \
  MonotonicElapsedTimestamp periodicRefreshStartedAt_;                        \
  std::weak_ptr<std::atomic<bool>> periodicRefreshLifecycle_;                 \
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

// The page-side detector is the single source of in-page interaction state.
// It already raises the existing login-required message when a
// blocking surface appears. This small bridge publishes the opposite edge once
// the same detector has observed a stable non-blocking page, so native state is
// current rather than a sticky login-history latch.
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
