#pragma once
#include <cstdint>

namespace hp {

// A single WebView2 audio pulse during initial Stationhead startup must not arm
// fallback. Require continuous audio first. Native audio health is sampled once
// per minute. Keep the player in the background through short track gaps, then
// restore the operation surface only after two full minutes of continuous audio
// loss. One additional second lets the newly restored layout expose any
// authentication controls before the DOM probe and destructive recovery ladder.
inline constexpr int64_t kStationheadAudioLossArmStabilityMs = 5'000;
inline constexpr int64_t kStationheadAudioLossGraceMs = 120'000;
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
    true, false, true, false, false, false, 120'999));
static_assert(StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 121'000));
static_assert(!StationheadAudioLossCanFallback(true, false, 120'999));
static_assert(StationheadAudioLossCanFallback(true, false, 121'000));
static_assert(!StationheadFallbackDwellSatisfied(14'999));
static_assert(StationheadFallbackDwellSatisfied(15'000));

}  // namespace hp
