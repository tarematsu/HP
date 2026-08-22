#pragma once
#include <cstdint>

namespace hp {

// A single WebView2 audio pulse during initial Stationhead startup must not arm
// fallback. Require continuous audio first; after that, 0 through 10 seconds of
// silence remain a track-transition wait. The operation surface is foregrounded
// at 11 seconds, then gets one second to finish rendering authentication controls
// before native code probes the DOM.
inline constexpr int64_t kStationheadAudioLossArmStabilityMs = 15'000;
inline constexpr int64_t kStationheadAudioLossGraceMs = 11'000;
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

static_assert(!StationheadAudioLossCanArm(true, false, 14'999));
static_assert(StationheadAudioLossCanArm(true, false, 15'000));
static_assert(!StationheadAudioLossCanArm(true, true, 60'000));
static_assert(!StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 11'999));
static_assert(StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 12'000));
static_assert(!StationheadAudioLossCanFallback(true, false, 11'999));
static_assert(StationheadAudioLossCanFallback(true, false, 12'000));
static_assert(!StationheadFallbackDwellSatisfied(14'999));
static_assert(StationheadFallbackDwellSatisfied(15'000));

}  // namespace hp

// Login detection remains available to the audio-loss diagnostics, but it is
// no longer allowed to invoke StationheadPlayer::ShowForLogin(), which also
// cancels refresh/recovery state. Clear only the obsolete latch at those call
// sites; Spotify authorization continues through its dedicated Auth tab.
#ifndef HOMEPANEL_STATIONHEAD_LOGIN_VISIBILITY_DISABLED
#define HOMEPANEL_STATIONHEAD_LOGIN_VISIBILITY_DISABLED
#define ShowForLogin() do { loginRequired_ = false; } while (false)
#endif
