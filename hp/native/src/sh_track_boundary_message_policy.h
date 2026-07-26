#pragma once
#include "common.h"

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

namespace stationhead_boundary_message_policy {
inline SRWLOCK leaseLock = SRWLOCK_INIT;
inline UINT ownerMessage = 0;
inline ULONGLONG expiresAt = 0;
inline bool primaryReloadClockAssignmentPending = false;
inline bool secondaryReloadClockAssignmentPending = false;
inline ULONGLONG primaryReloadMonotonicAt = 0;
inline ULONGLONG secondaryReloadMonotonicAt = 0;
}  // namespace stationhead_boundary_message_policy

class StationheadBoundaryReloadClockProxy {
 public:
  StationheadBoundaryReloadClockProxy(
      int64_t& storage, bool secondary, bool configured) noexcept
      : storage_(storage), secondary_(secondary), configured_(configured) {}

  operator int64_t() const noexcept { return storage_; }

  int64_t operator=(int64_t candidate) noexcept {
    // ConfigureWebView writes the chained lifecycle timestamp before it marks
    // the WebView configured and before initial navigation has committed. Do
    // not begin the 52-minute interval there. The later successful navigation
    // callback initializes the baseline; after that, only an App-accepted
    // boundary refresh may advance it. Generic successful navigations (auth
    // return, fallback, reconnect, WebView rebuild) therefore cannot postpone
    // the next periodic authentication refresh.
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
    // ConfigureWebView intentionally chains `createdAt_ = lastReloadAt_ = now`.
    // Return the candidate even when the periodic clock write is filtered so
    // unrelated lifecycle timestamps keep their original semantics.
    return candidate;
  }

  friend int64_t operator-(
      int64_t wallClockNow,
      const StationheadBoundaryReloadClockProxy& clock) noexcept {
    // Eligibility is elapsed-time logic, not civil-time logic. Use the same
    // monotonic clock as the A/B ownership lease so manual clock changes and
    // NTP corrections cannot force an early refresh or postpone one. The wall
    // value remains available for diagnostics and for a defensive pre-baseline
    // fallback, while the established clock always uses GetTickCount64().
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

// Both Stationhead windows can reach the 52-minute boundary in the same App
// tick. Forward only one role's synchronous readiness messages at a time so A
// and B cannot both wait for the other side to become the stable handoff source.
// The same role may retry freely. A rejected peer receives the normal zero
// result, so its existing bounded retry state remains armed without entering the
// App handoff state concurrently.
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

// This policy header is the final HomePanel PCH layer. Windows headers and the
// policy implementation above have already been parsed, so only application
// call sites are routed through these final aliases.
#define SendMessageW SendMessageWWithStationheadBoundaryLease
#define lastReloadAt_                                                        \
  (::hp::StationheadBoundaryReloadClock(                                    \
      (lastReloadAtStorage_), IsSecondary(), webViewConfigured_))
