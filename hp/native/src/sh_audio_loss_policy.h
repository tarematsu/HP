#pragma once
#include <cstdint>

namespace hp {

// 0 through 10 seconds remain a track-transition wait. The operation surface
// is foregrounded at 11 seconds, then gets one second to finish rendering its
// authentication controls before native code probes the DOM.
inline constexpr int64_t kStationheadAudioLossGraceMs = 11'000;
inline constexpr int64_t kStationheadAudioLossDomSettleMs = 1'000;
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
      stoppedForMs >=
          kStationheadAudioLossGraceMs + kStationheadAudioLossDomSettleMs;
}

inline constexpr bool StationheadAudioLossCanFallback(
    bool probeComplete,
    bool authenticationUiDetected,
    int64_t stoppedForMs) noexcept {
  return probeComplete && !authenticationUiDetected &&
      stoppedForMs >=
          kStationheadAudioLossGraceMs + kStationheadAudioLossDomSettleMs;
}

inline constexpr bool StationheadFallbackDwellSatisfied(
    int64_t fallbackElapsedMs) noexcept {
  return fallbackElapsedMs >= kStationheadFallbackMinimumDwellMs;
}

static_assert(!StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 11'999));
static_assert(StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 12'000));
static_assert(!StationheadAudioLossCanFallback(true, false, 11'999));
static_assert(StationheadAudioLossCanFallback(true, false, 12'000));
static_assert(!StationheadFallbackDwellSatisfied(14'999));
static_assert(StationheadFallbackDwellSatisfied(15'000));

}  // namespace hp