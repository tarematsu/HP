#include "spotify_stagger_timer.inc"
#define SetTimer(hwnd, timerId, interval, callback)                              \
  SpotifyStaggeredSetTimer((hwnd), (timerId), (interval), (callback))
#define DeferWindowPos(batch, hwnd, insertAfter, x, y, width, height, flags)     \
  DeferSpotifyHostWindowPos(                                                    \
      (batch), (hwnd), (insertAfter), (x), (y), (width), (height), (flags))
#define SetWindowPos(hwnd, insertAfter, x, y, width, height, flags)              \
  SetSpotifyHostWindowPos(                                                      \
      (hwnd), (insertAfter), (x), (y), (width), (height), (flags))
#include "spotify_webviews.cpp"
#undef SetWindowPos
#undef DeferWindowPos

#include "spotify_lonesome_guard.inc"
#define ExecuteScript(script, callback)                                         \
  ExecuteScript(RewriteSpotifyPhaseExecuteScript((script)), (callback))
#define RecomputeForeground() RecomputeForegroundAndRefreshSpotifyHostLayout()
#define SendInput(count, inputs, inputSize)                                     \
  ((void)(count), (void)(inputs), (void)(inputSize),                            \
   DispatchSpotifyDevToolsClick(slot, xTenThousandths, yTenThousandths))
#define SetPodcastMode SetPodcastModeImmediate
#include "spotify_phase_sync.inc"
#undef SetPodcastMode
#undef SendInput

#include "spotify_stagger_schedule.inc"

#undef RecomputeForeground
#undef ExecuteScript
#undef SetTimer

#include "spotify_background_click.inc"
}  // namespace hp
