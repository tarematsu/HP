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

namespace stationhead_boundary_message_policy {
inline SRWLOCK leaseLock = SRWLOCK_INIT;
inline UINT ownerMessage = 0;
inline ULONGLONG expiresAt = 0;
}  // namespace stationhead_boundary_message_policy

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
  }
  ReleaseSRWLockExclusive(&stationhead_boundary_message_policy::leaseLock);
  return result;
}

}  // namespace hp

// This policy header is the final HomePanel PCH layer. Windows headers have
// already been parsed, so only application call sites are routed through the
// pass-through wrapper above. Non-Stationhead messages retain native behavior.
#define SendMessageW SendMessageWWithStationheadBoundaryLease
