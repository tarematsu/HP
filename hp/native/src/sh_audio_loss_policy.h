#pragma once
#include <cstdint>

namespace hp {

// A single WebView2 audio pulse during initial Stationhead startup must not arm
// fallback. Require continuous audio first. Native audio health is sampled every
// 30 seconds; destructive silence recovery begins only after one full minute of
// continuous audio loss. The final second is reserved for rendering any
// authentication controls before native code probes the DOM.
inline constexpr int64_t kStationheadAudioLossArmStabilityMs = 5'000;
inline constexpr int64_t kStationheadAudioLossGraceMs = 59'000;
inline constexpr int64_t kStationheadAudioLossDomSettleMs = 1'000;
inline constexpr int64_t kStationheadFallbackMinimumDwellMs = 15'000;
inline constexpr int64_t kStationheadPrimaryRecoveryStabilityMs = 2'000;

inline constexpr bool StationheadAudioLossCanArm(
    bool audioPlaying,
    bool navigationActive,
    int64_t playingForMs) noexcept {
  return audioPlaying && !navigationActive &&
      playingForMs >= kStationheadAudioLossArmStabilityMs;
}

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

static_assert(!StationheadAudioLossCanArm(true, false, 4'999));
static_assert(StationheadAudioLossCanArm(true, false, 5'000));
static_assert(!StationheadAudioLossCanArm(true, true, 60'000));
static_assert(!StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 59'999));
static_assert(StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 60'000));
static_assert(!StationheadAudioLossCanFallback(true, false, 59'999));
static_assert(StationheadAudioLossCanFallback(true, false, 60'000));
static_assert(!StationheadFallbackDwellSatisfied(14'999));
static_assert(StationheadFallbackDwellSatisfied(15'000));

}  // namespace hp
