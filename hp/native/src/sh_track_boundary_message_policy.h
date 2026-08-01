#pragma once
#include "common.h"

// Extend the existing public reconnect surface with one native clock-driven
// navigation entry point without changing the large StationheadPlayer header.
#define Reconnect()                                                          \
  Reconnect();                                                               \
  bool SwitchClockStationDestination(                                        \
      const std::wstring& url, const std::wstring& reason)

// Track-ended messages are disabled below, but the handle also asks this method
// to evaluate a native 52-minute recovery path whenever audio is absent. Compile
// that legacy implementation under an unused name and keep the public method a
// strict no-op, so clock-minute navigation is the only automatic route change.
#define RetryPendingTrackBoundaryRefresh(parameters)                         \
  RetryPendingTrackBoundaryRefresh(parameters) {                             \
    (void)nowMs;                                                             \
    trackBoundaryRefreshPending_ = false;                                    \
    return false;                                                            \
  }                                                                          \
  bool RetryPendingTrackBoundaryRefreshDisabled(parameters)

#include "sh.h"
#undef RetryPendingTrackBoundaryRefresh
#undef Reconnect

namespace hp {

inline constexpr int64_t kStationheadClockNavigationClickGuardMs = 1'500;

inline bool StationheadPlayer::SwitchClockStationDestination(
    const std::wstring& url, const std::wstring& reason) {
  if (url.empty() || !webview_ ||
      shuttingDown_.load(std::memory_order_acquire) ||
      recreating_.load(std::memory_order_acquire) ||
      navigationInFlight_.load(std::memory_order_acquire) ||
      spotifyAuthorization_ || loginRequired_) {
    return false;
  }
  {
    std::lock_guard lock(mutex_);
    if (status_.navigating) return false;
  }

  if (IsSecondary()) {
    config_.secondaryUrl = url;
  } else {
    config_.url = url;
  }
  usingFallback_ = false;
  NavigateStationheadUrl(UnixMillis(), url, reason, false);
  // Navigate() can return before WebView2 dispatches NavigationStarting. Block
  // page messages from the outgoing document during that narrow interval, then
  // let the new document's native Start Listening retry run after navigation.
  nextAutoClickAt_ = UnixMillis() + kStationheadClockNavigationClickGuardMs;
  // NavigateStationheadUrl resets startup layout state. Collapse the playback
  // surface again immediately so the clock switch never raises it above the
  // native dashboard while Start Listening retries run.
  KeepPlaybackBehindDashboard();
  PostChange();
  return true;
}

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
static_assert(kStationheadClockNavigationClickGuardMs >= 1'000);

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
#define SetFocus(target) (::hp::SetFocusAfterStationheadHide((target)))

#include "sh_shared.h"

namespace hp {
inline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs =
    3'500;
static_assert(kStationheadMeasuredPostPlaybackStopClickDelayMs < 12'000);
}  // namespace hp

#define kStationheadPostPlaybackStopClickDelayMs                             \
  (::hp::kStationheadMeasuredPostPlaybackStopClickDelayMs)
