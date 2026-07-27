#pragma once
#include "common.h"

// Extend StationheadPlayer while sh.h is parsed, then remove the temporary
// source-rewriting macros before any implementation file is compiled. This keeps
// the public class layout in one place while replacing the old track-boundary
// trigger with one elapsed-time policy.
#define NextWakeAt()                                                          \
  NextWakeAt() const noexcept {                                               \
    int64_t next = NextWakeAtBase();                                          \
    if (periodicRefreshStartedAt_.Active()) {                                 \
      const int64_t due =                                                     \
          periodicRefreshStartedAt_ + kPeriodicRefreshIntervalMs;             \
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
  static constexpr int64_t kPeriodicRefreshIntervalMs = 55 * 60'000;          \
  void RefreshPeriodicNavigation(int64_t nowMs) {                             \
    const auto lifecycle = createCallbackAlive_;                              \
    const auto previousLifecycle = periodicRefreshLifecycle_.lock();          \
    if (!webview_ || previousLifecycle != lifecycle) {                        \
      periodicRefreshLifecycle_ = lifecycle;                                  \
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
        navigationInFlight_.load(std::memory_order_acquire) ||                \
        statusNavigating;                                                     \
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
    if (nowMs - periodicRefreshStartedAt_ < kPeriodicRefreshIntervalMs) {      \
      return;                                                                 \
    }                                                                         \
                                                                                \
    periodicRefreshStartedAt_ = nowMs;                                        \
    NavigateCurrentUrl(nowMs, L"55-minute periodic refresh");                \
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

inline constexpr ULONGLONG kStationheadBoundaryWaitingLeaseMs = 40'000;
inline constexpr ULONGLONG kStationheadBoundaryCommittedLeaseMs = 3 * 60'000;

inline constexpr bool IsStationheadBoundaryReadyMessage(UINT message) noexcept {
  return message == WM_HP_PRIMARY_RELOAD_READY ||
         message == WM_HP_SECONDARY_RELOAD_READY;
}

inline constexpr bool StationheadBoundaryLeaseAllows(
    UINT ownerMessage,
    ULONGLONG expiresAt,
    UINT candidateMessage,
    ULONGLONG now) noexcept {
  return ownerMessage == 0 || ownerMessage == candidateMessage ||
         now >= expiresAt;
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

static_assert(IsStationheadBoundaryReadyMessage(WM_HP_PRIMARY_RELOAD_READY));
static_assert(IsStationheadBoundaryReadyMessage(WM_HP_SECONDARY_RELOAD_READY));
static_assert(!IsStationheadBoundaryReadyMessage(WM_HP_STATIONHEAD_CHANGED));
static_assert(StationheadBoundaryLeaseAllows(
    0, 10'000, WM_HP_PRIMARY_RELOAD_READY, 1'000));
static_assert(StationheadBoundaryLeaseAllows(
    WM_HP_PRIMARY_RELOAD_READY, 10'000,
    WM_HP_PRIMARY_RELOAD_READY, 1'000));
static_assert(!StationheadBoundaryLeaseAllows(
    WM_HP_PRIMARY_RELOAD_READY, 10'000,
    WM_HP_SECONDARY_RELOAD_READY, 9'999));
static_assert(StationheadBoundaryLeaseAllows(
    WM_HP_PRIMARY_RELOAD_READY, 10'000,
    WM_HP_SECONDARY_RELOAD_READY, 10'000));
static_assert(StationheadBoundaryElapsedMs(1'000, 4'120) == 3'120);
static_assert(StationheadBoundaryElapsedMs(4'120, 1'000) == 0);
static_assert(StationheadOperationalDeadlineValue(false, false, 42) == 0);
static_assert(StationheadOperationalDeadlineValue(true, true, 42) == 1);
static_assert(StationheadOperationalDeadlineValue(true, false, 42) == 42);

namespace stationhead_boundary_message_policy {
inline SRWLOCK leaseLock = SRWLOCK_INIT;
inline UINT ownerMessage = 0;
inline ULONGLONG expiresAt = 0;
inline bool primaryReloadClockAssignmentPending = false;
inline bool secondaryReloadClockAssignmentPending = false;
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
    AcquireSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
    bool accept = storage_ <= 0;
    if (accept && !configured_) accept = false;
    bool& pending = secondary_
        ? stationhead_boundary_message_policy::secondaryReloadClockAssignmentPending
        : stationhead_boundary_message_policy::primaryReloadClockAssignmentPending;
    ULONGLONG& monotonicAt = secondary_
        ? stationhead_boundary_message_policy::secondaryReloadMonotonicAt
        : stationhead_boundary_message_policy::primaryReloadMonotonicAt;
    if (pending) {
      pending = false;
      accept = true;
    }
    if (accept) storage_ = candidate;
    if (accept) monotonicAt = GetTickCount64();
    ReleaseSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
    return candidate;
  }

  friend int64_t operator-(
      int64_t wallClockNow,
      const StationheadBoundaryReloadClockProxy& clock) noexcept {
    ULONGLONG monotonicAt = 0;
    AcquireSRWLockShared(&stationhead_boundary_message_policy::leaseLock);
    monotonicAt = clock.secondary_
        ? stationhead_boundary_message_policy::secondaryReloadMonotonicAt
        : stationhead_boundary_message_policy::primaryReloadMonotonicAt;
    ReleaseSRWLockShared(&stationhead_boundary_message_policy::leaseLock);
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

inline LRESULT SendMessageWWithStationheadBoundaryLease(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  if (!IsStationheadBoundaryReadyMessage(message)) {
    return ::SendMessageW(window, message, wParam, lParam);
  }

  const ULONGLONG now = GetTickCount64();
  bool allowed = false;
  AcquireSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
  if (StationheadBoundaryLeaseAllows(
          stationhead_boundary_message_policy::ownerMessage,
          stationhead_boundary_message_policy::expiresAt,
          message,
          now)) {
    stationhead_boundary_message_policy::ownerMessage = message;
    stationhead_boundary_message_policy::expiresAt =
        now + kStationheadBoundaryWaitingLeaseMs;
    allowed = true;
  }
  ReleaseSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
  if (!allowed) return 0;

  const LRESULT result = ::SendMessageW(window, message, wParam, lParam);
  const ULONGLONG completedAt = GetTickCount64();
  AcquireSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
  if (stationhead_boundary_message_policy::ownerMessage == message) {
    stationhead_boundary_message_policy::expiresAt =
        completedAt + (result != 0
            ? kStationheadBoundaryCommittedLeaseMs
            : kStationheadBoundaryWaitingLeaseMs);
    if (result != 0) {
      bool& pending = message == WM_HP_SECONDARY_RELOAD_READY
          ? stationhead_boundary_message_policy::secondaryReloadClockAssignmentPending
          : stationhead_boundary_message_policy::primaryReloadClockAssignmentPending;
      pending = true;
    }
  }
  ReleaseSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
  return result;
}

}  // namespace hp

#define SendMessageW SendMessageWWithStationheadBoundaryLease
#define lastReloadAt_                                                        \
  (::hp::StationheadBoundaryReloadClock(                                    \
      (lastReloadAtStorage_), IsSecondary(), webViewConfigured_))
#define nextAutoClickAt_                                                     \
  (::hp::StationheadAutoClickDeadlineStorage(                               \
      (nextAutoClickAt_), IsSecondary()))
