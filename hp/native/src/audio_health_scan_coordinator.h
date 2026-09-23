#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kAudioHealthScanCycleMs = 6ULL * 60ULL * 1000ULL;
inline constexpr ULONGLONG kAudioHealthScanSlotSpacingMs = 60ULL * 1000ULL;
inline constexpr ULONGLONG kAudioHealthScanRetryMs = 5ULL * 1000ULL;
inline constexpr ULONGLONG kAudioHealthScanMinimumGapMs = 4ULL * 1000ULL;
inline constexpr size_t kAudioHealthScanSlotCount = 6;

// One process-wide clock serializes native audio probes. Stationhead maps its
// six profiles to slots 0..5. Each slot starts one minute after the previous
// slot, so only one Stationhead profile is eligible for the native audio probe
// in each minute of the six-minute cycle.
inline std::atomic<ULONGLONG> gAudioHealthScanEpochTick{0};
inline std::atomic<ULONGLONG> gAudioHealthLastScanTick{0};
inline std::atomic<bool> gAudioHealthScanInProgress{false};

inline ULONGLONG AudioHealthScanEpochTick(ULONGLONG now) noexcept {
  if (now == 0) now = GetTickCount64();
  ULONGLONG epoch = gAudioHealthScanEpochTick.load(std::memory_order_acquire);
  if (epoch != 0) return epoch;

  // Start slot 0 one minute in the future. This avoids an immediate startup
  // probe while still allowing the six profiles to enter their stable phases
  // within the first six minutes rather than waiting a whole six-minute cycle.
  ULONGLONG candidate = now + kAudioHealthScanSlotSpacingMs;
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

inline bool AudioHealthScanSlotDue(
    ULONGLONG now, size_t slotIndex) noexcept {
  if (now == 0) now = GetTickCount64();
  slotIndex = std::min(slotIndex, kAudioHealthScanSlotCount - 1);
  const ULONGLONG epoch = AudioHealthScanEpochTick(now);
  if (now < epoch) return false;
  const ULONGLONG phase = (now - epoch) % kAudioHealthScanCycleMs;
  const size_t activeSlot = static_cast<size_t>(
      phase / kAudioHealthScanSlotSpacingMs);
  return activeSlot == slotIndex;
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

inline bool TryClaimAudioHealthScanSlot(
    ULONGLONG now, size_t slotIndex) noexcept {
  if (now == 0) now = GetTickCount64();
  if (!AudioHealthScanSlotDue(now, slotIndex)) return false;
  return TryClaimAudioHealthScan(now);
}

inline void ReleaseAudioHealthScan() noexcept {
  gAudioHealthScanInProgress.store(false, std::memory_order_release);
}

static_assert(kAudioHealthScanCycleMs == 6ULL * 60ULL * 1000ULL);
static_assert(kAudioHealthScanSlotSpacingMs == 60ULL * 1000ULL);
static_assert(kAudioHealthScanSlotSpacingMs * kAudioHealthScanSlotCount ==
              kAudioHealthScanCycleMs);
static_assert(kAudioHealthScanMinimumGapMs < kAudioHealthScanSlotSpacingMs);

}  // namespace hp
