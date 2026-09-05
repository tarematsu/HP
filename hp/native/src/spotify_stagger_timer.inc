#include "spotify_webviews.h"

namespace {
constexpr UINT_PTR kSpotifyLegacyStartupTimerId = 1;
constexpr UINT_PTR kSpotifyLegacyModeSwitchTimerId = 3;
constexpr UINT_PTR kSpotifyRobustTimerId = 0x53505243;
constexpr UINT kSpotifyLegacyStartupStepMs = 400U;
constexpr UINT kSpotifyLegacyModeSwitchStepMs = 10U * 1000U;
constexpr UINT kSpotifySerializedSlotStepMs = 3U * 60U * 1000U;

UINT_PTR SpotifyStaggeredSetTimer(
    HWND hwnd, UINT_PTR timerId, UINT interval, TIMERPROC callback) noexcept {
  UINT adjusted = interval;
  if (timerId == kSpotifyLegacyStartupTimerId &&
      interval >= kSpotifyLegacyStartupStepMs &&
      interval <= 5U * kSpotifyLegacyStartupStepMs &&
      interval % kSpotifyLegacyStartupStepMs == 0) {
    adjusted = (interval / kSpotifyLegacyStartupStepMs) *
        kSpotifySerializedSlotStepMs;
  } else if (timerId == kSpotifyLegacyModeSwitchTimerId &&
             interval >= kSpotifyLegacyModeSwitchStepMs &&
             interval <= 5U * kSpotifyLegacyModeSwitchStepMs &&
             interval % kSpotifyLegacyModeSwitchStepMs == 0) {
    adjusted = (interval / kSpotifyLegacyModeSwitchStepMs) *
        kSpotifySerializedSlotStepMs;
  }

  TIMERPROC effectiveCallback = callback;
  if (timerId == kSpotifyRobustTimerId) {
    effectiveCallback = &hp::SpotifyWebViews::StaggeredReconcileTimerProc;
  }
  return ::SetTimer(hwnd, timerId, adjusted, effectiveCallback);
}
}  // namespace
