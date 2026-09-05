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
#include "spotify_viewport_recovery.inc"
#define ExecuteScript(script, callback)                                         \
  ExecuteScript(                                                                \
      RewriteSpotifyViewportRecoveryScript(                                     \
          RewriteSpotifyPhaseExecuteScript((script))),                          \
      (callback))
#define RecomputeForeground() RecomputeForegroundAndRefreshSpotifyHostLayout()
#define SendInput(count, inputs, inputSize)                                     \
  ((void)(count), (void)(inputs), (void)(inputSize),                            \
   DispatchSpotifyDevToolsClick(slot, xTenThousandths, yTenThousandths))
#include "spotify_phase_sync.inc"
#undef SendInput
#undef RecomputeForeground
#undef ExecuteScript

#include "spotify_background_click.inc"
}  // namespace hp
