// Kept as one translation unit so cached GDI primitives remain shared.
// Fragment boundaries follow complete responsibilities and never split functions.
#if 0  // Stationhead renderer helpers are intentionally disabled.
#include "stationhead_native_stats.h"
#include "stationhead_play_summary.h"
#endif
#include "shared_webview_environment.h"
#include "spotify_webviews.h"
#include "version.h"
#include "winhttp_helpers.h"
#define PlaceNativeWindow BasePlaceNativeWindow
#include "renderer_panels/primitives.inc"
#undef PlaceNativeWindow
#include "renderer_panels/shift_overlay.inc"
#include "renderer_panels/layout_overrides.inc"
#include "renderer_panels/waste_calendar_section.inc"

#define SplitSidebarSections SplitRearrangedSidebarSections
#define SplitMainSections SplitRearrangedMainSections
#define ClockTimeRectFromCard RearrangedClockTimeRectFromCard
#define DrawClockSection HP_DRAW_CLOCK_WITH_STATUS
#define DrawControlsSection DrawAirSection
#include "renderer_panels/windows.inc"
#undef DrawControlsSection
#undef DrawClockSection
#undef ClockTimeRectFromCard
#undef SplitMainSections
#undef SplitSidebarSections

#include "renderer_panels/environment_sections.inc"

namespace {
constexpr UINT_PTR kNativeMvRandomActionTimerForSpotify = 0x4D560001;
constexpr UINT kNativeMvResumeDelayFloorMsForSpotify = 60U * 60U * 1000U;

UINT_PTR SetNativeMvTimerWithSpotifyMode(HWND hwnd, UINT_PTR timerId,
                                        UINT elapseMs,
                                        TIMERPROC timerProc) noexcept {
  const UINT_PTR result = ::SetTimer(hwnd, timerId, elapseMs, timerProc);
  if (result != 0 && timerId == kNativeMvRandomActionTimerForSpotify) {
    // Active-MV delays are 50-60 minutes; pause delays are 60-80 minutes.
    // Key podcast switching off the timer that was actually armed so a failed
    // SetTimer call cannot desynchronize Spotify from the MV pause state.
    SetSpotifyAmazonPodcastMode(
        elapseMs >= kNativeMvResumeDelayFloorMsForSpotify);
  }
  return result;
}
}  // namespace

// Stationhead actions inside the retained MV fragment are compiled out while
// the legacy source remains available for a future rollback.
#define QueueAction(...) ((void)0)
#define SetTimer SetNativeMvTimerWithSpotifyMode
#include "renderer_panels/media_section.inc"
#undef SetTimer
#undef QueueAction
#include "renderer_panels/data_sections.inc"