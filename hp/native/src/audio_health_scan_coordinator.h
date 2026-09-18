#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kAudioHealthScanCycleMs = 30ULL * 1000ULL;
inline constexpr ULONGLONG kAudioHealthScanSlotSpacingMs = 5'000ULL;
inline constexpr ULONGLONG kAudioHealthScanRetryMs = 5ULL * 1000ULL;
inline constexpr ULONGLONG kAudioHealthScanMinimumGapMs = 4ULL * 1000ULL;
inline constexpr size_t kAudioHealthScanSlotCount = 6;

// One process-wide clock owns the Stationhead + Spotify audio probes. Slot 0 is
// Stationhead; slots 1/2/3/4/5 are Spotify S1/S2/S3/S4/S5. Their scan phases are
// therefore 0s, 5s, 10s, 15s, 20s and 25s inside each 30-second cycle.
inline std::atomic<ULONGLONG> gAudioHealthScanEpochTick{0};
inline std::atomic<ULONGLONG> gAudioHealthLastScanTick{0};
inline std::atomic<bool> gAudioHealthScanInProgress{false};

inline ULONGLONG AudioHealthScanEpochTick(ULONGLONG now) noexcept {
  if (now == 0) now = GetTickCount64();
  ULONGLONG epoch = gAudioHealthScanEpochTick.load(std::memory_order_acquire);
  if (epoch != 0) return epoch;

  // Start one full cycle in the future so every surface receives a stable first
  // deadline instead of being probed immediately during startup/auth work.
  ULONGLONG candidate = now + kAudioHealthScanCycleMs;
  if (candidate == 0) candidate = 1;
  ULONGLONG expected = 0;
  if (gAudioHealthScanEpochTick.compare_exchange_strong(
          expected, candidate, std::memory_order_acq_rel)) {
    return candidate;
  }
  return expected;
}

inline ULONGLONG NextAudioHealthScanTick(
    ULONGLONG now, size_t slotIndex) noexcept {
  if (now == 0) now = GetTickCount64();
  slotIndex = std::min(slotIndex, kAudioHealthScanSlotCount - 1);
  const ULONGLONG epoch = AudioHealthScanEpochTick(now);
  ULONGLONG due = epoch +
      static_cast<ULONGLONG>(slotIndex) * kAudioHealthScanSlotSpacingMs;
  if (due > now) return due;

  const ULONGLONG elapsed = now - due;
  const ULONGLONG cycles = elapsed / kAudioHealthScanCycleMs + 1;
  return due + cycles * kAudioHealthScanCycleMs;
}

inline ULONGLONG AudioHealthScanDelayMs(
    ULONGLONG now, size_t slotIndex) noexcept {
  const ULONGLONG due = NextAudioHealthScanTick(now, slotIndex);
  return due > now ? due - now : 0;
}

inline bool TryClaimAudioHealthScan(ULONGLONG now) noexcept {
  if (now == 0) now = GetTickCount64();
  const ULONGLONG last =
      gAudioHealthLastScanTick.load(std::memory_order_acquire);
  if (last != 0 && now >= last && now - last < kAudioHealthScanMinimumGapMs) {
    return false;
  }

  bool expected = false;
  if (!gAudioHealthScanInProgress.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return false;
  }

  const ULONGLONG confirmedLast =
      gAudioHealthLastScanTick.load(std::memory_order_acquire);
  if (confirmedLast != 0 && now >= confirmedLast &&
      now - confirmedLast < kAudioHealthScanMinimumGapMs) {
    gAudioHealthScanInProgress.store(false, std::memory_order_release);
    return false;
  }
  gAudioHealthLastScanTick.store(now, std::memory_order_release);
  return true;
}

inline void ReleaseAudioHealthScan() noexcept {
  gAudioHealthScanInProgress.store(false, std::memory_order_release);
}

static_assert(kAudioHealthScanCycleMs == 30ULL * 1000ULL);
static_assert(kAudioHealthScanSlotSpacingMs * kAudioHealthScanSlotCount ==
              kAudioHealthScanCycleMs);
static_assert(kAudioHealthScanMinimumGapMs < kAudioHealthScanSlotSpacingMs);

}  // namespace hp
