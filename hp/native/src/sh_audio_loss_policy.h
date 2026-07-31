#pragma once
#include <cstdint>

namespace hp {

// 0 through 10 seconds remain a track-transition wait. Recovery UI and its
// authentication probe become eligible only once the stop reaches 11 seconds.
inline constexpr int64_t kStationheadAudioLossGraceMs = 11'000;
inline constexpr int64_t kStationheadFallbackMinimumDwellMs = 15'000;
inline constexpr int64_t kStationheadPrimaryRecoveryStabilityMs = 2'000;

inline constexpr bool StationheadAudioLossCanProbe(
    bool playbackObserved,
    bool audioPlaying,
    bool created,
    bool navigating,
    bool processFailed,
    bool authenticationPending,
    int64_t stoppedForMs) noexcept {
  return playbackObserved && !audioPlaying && created && !navigating &&
      !processFailed && !authenticationPending &&
      stoppedForMs >= kStationheadAudioLossGraceMs;
}

inline constexpr bool StationheadAudioLossCanFallback(
    bool probeComplete,
    bool authenticationUiDetected,
    int64_t stoppedForMs) noexcept {
  return probeComplete && !authenticationUiDetected &&
      stoppedForMs >= kStationheadAudioLossGraceMs;
}

inline constexpr bool StationheadFallbackDwellSatisfied(
    int64_t fallbackElapsedMs) noexcept {
  return fallbackElapsedMs >= kStationheadFallbackMinimumDwellMs;
}

static_assert(!StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 10'999));
static_assert(StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 11'000));
static_assert(!StationheadAudioLossCanFallback(true, false, 10'999));
static_assert(StationheadAudioLossCanFallback(true, false, 11'000));
static_assert(!StationheadFallbackDwellSatisfied(14'999));
static_assert(StationheadFallbackDwellSatisfied(15'000));

}  // namespace hp