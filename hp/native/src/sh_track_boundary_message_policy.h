#pragma once
#include "common.h"

namespace hp {

inline constexpr bool StationheadPlaybackNavigationActive(
    bool navigationInFlight,
    bool statusNavigating,
    bool spotifyAuthorization) noexcept {
  return navigationInFlight || (statusNavigating && !spotifyAuthorization);
}

inline constexpr int64_t StationheadPeriodicRefreshIntervalMs(
    bool secondary) noexcept {
  return (secondary ? 54 : 55) * 60'000;
}

static_assert(StationheadPlaybackNavigationActive(true, false, false));
static_assert(StationheadPlaybackNavigationActive(true, true, true));
static_assert(StationheadPlaybackNavigationActive(false, true, false));
static_assert(!StationheadPlaybackNavigationActive(false, true, true));
static_assert(!StationheadPlaybackNavigationActive(false, false, false));
static_assert(StationheadPeriodicRefreshIntervalMs(false) == 55 * 60'000);
static_assert(StationheadPeriodicRefreshIntervalMs(true) == 54 * 60'000);

}  // namespace hp

// Extend StationheadPlayer while sh.h is parsed, then remove the temporary
// source-rewriting macros before any implementation file is compiled. Periodic
// refresh is intentionally independent per role: A uses 55 minutes and B uses
// 54 minutes. The one-minute skew prevents the normal refreshes from starting
// together without changing the active audio profile.
#define NextWakeAt()                                                          \
  NextWakeAt() const noexcept {                                               \
    int64_t next = NextWakeAtBase();                                          \
    if (periodicRefreshStartedAt_.Active()) {                                 \
      const int64_t due = periodicRefreshStartedAt_ +                         \
          ::hp::StationheadPeriodicRefreshIntervalMs(IsSecondary());          \
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
      periodicRefreshLifecycle_ = lifecycle;                                 \
      periodicRefreshStartedAt_ = 0;                                          \
      periodicRefreshNavigationObserved_ = 0;                                 \
      if (!webview_) return;                                                   \
    }                                                                         \
                                                                                \
    bool statusNavigating = false;                                            \
    {                                                                         \
      std::lock_guard lock(mutex_);                                            \
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
        ::hp::StationheadPeriodicRefreshIntervalMs(IsSecondary());            \
    if (nowMs - periodicRefreshStartedAt_ < intervalMs) return;               \
                                                                                \
    periodicRefreshStartedAt_ = nowMs;                                        \
    NavigateCurrentUrl(                                                       \
        nowMs, IsSecondary() ? L"54-minute periodic refresh"                  \
                             : L"55-minute periodic refresh");                \
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
inline ULONGLONG secondaryReloadMonotonicAt = 0;
inline MonotonicProjectedDeadline primaryAutoClickDeadline;
inline MonotonicProjectedDeadline secondaryAutoClickDeadline;
inline int64_t primaryAutoClickExposed = 0;
inline int64_t secondaryAutoClickExposed = 0;
}  // namespace stationhead_boundary_message_policy

inline int64_t& StationheadAutoClickDeadlineStorage(
    int64_t& storage, bool secondary) noexcept {
  MonotonicProjectedDeadline& deadline = secondary
      ? stationhead_boundary_message_policy::secondaryAutoClickDeadline
      : stationhead_boundary_message_policy::primaryAutoClickDeadline;
  int64_t& exposed = secondary
      ? stationhead_boundary_message_policy::secondaryAutoClickExposed
      : stationhead_boundary_message_policy::primaryAutoClickExposed;
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
  StationheadBoundaryReloadClockProxy(
      int64_t& storage, bool secondary, bool configured) noexcept
      : storage_(storage), secondary_(secondary), configured_(configured) {}

  operator int64_t() const noexcept { return storage_; }

  int64_t operator=(int64_t candidate) noexcept {
    AcquireSRWLockExclusive(
        &stationhead_boundary_message_policy::reloadClockLock);
    const bool accept = configured_ && storage_ <= 0;
    if (accept) {
      storage_ = candidate;
      ULONGLONG& monotonicAt = secondary_
          ? stationhead_boundary_message_policy::secondaryReloadMonotonicAt
          : stationhead_boundary_message_policy::primaryReloadMonotonicAt;
      monotonicAt = GetTickCount64();
    }
    ReleaseSRWLockExclusive(
        &stationhead_boundary_message_policy::reloadClockLock);
    return candidate;
  }

  friend int64_t operator-(
      int64_t wallClockNow,
      const StationheadBoundaryReloadClockProxy& clock) noexcept {
    ULONGLONG monotonicAt = 0;
    AcquireSRWLockShared(
        &stationhead_boundary_message_policy::reloadClockLock);
    monotonicAt = clock.secondary_
        ? stationhead_boundary_message_policy::secondaryReloadMonotonicAt
        : stationhead_boundary_message_policy::primaryReloadMonotonicAt;
    ReleaseSRWLockShared(
        &stationhead_boundary_message_policy::reloadClockLock);
    if (monotonicAt == 0) return wallClockNow - clock.storage_;
    return StationheadBoundaryElapsedMs(monotonicAt, GetTickCount64());
  }

 private:
  int64_t& storage_;
  bool secondary_;
  bool configured_;
};

inline StationheadBoundaryReloadClockProxy StationheadBoundaryReloadClock(
    int64_t& storage, bool secondary, bool configured) noexcept {
  return StationheadBoundaryReloadClockProxy(storage, secondary, configured);
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
  (::hp::StationheadBoundaryReloadClock(                                    \
      (lastReloadAtStorage_), IsSecondary(), webViewConfigured_))
#define nextAutoClickAt_                                                     \
  (::hp::StationheadAutoClickDeadlineStorage(                               \
      (nextAutoClickAt_), IsSecondary()))
#define navigationInFlight_                                                  \
  (::hp::StationheadNavigationInFlightStorage(                              \
      (navigationInFlight_), periodicRefreshStartedAt_,                     \
      periodicRefreshNavigationObserved_))
#define SetFocus(target) (::hp::SetFocusAfterStationheadHide((target)))

#include "sh_shared.h"

namespace hp {
inline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs =
    3'500;
static_assert(kStationheadMeasuredPostPlaybackStopClickDelayMs < 12'000);
}  // namespace hp

#define kStationheadPostPlaybackStopClickDelayMs                             \
  (::hp::kStationheadMeasuredPostPlaybackStopClickDelayMs)
