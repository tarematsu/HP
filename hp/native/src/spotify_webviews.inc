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
#include "spotify_phase_sync.inc"
#undef ExecuteScript
}  // namespace hp
