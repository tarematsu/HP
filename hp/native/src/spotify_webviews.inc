#include "spotify_stagger_timer.inc"

namespace hp {
inline const wchar_t* RewriteSpotifyLegacyAutoplayScript(
    const wchar_t* script) noexcept {
  if (!script) return script;
  const std::wstring_view value(script);
  if (value.find(L"__homePanelLonesomeRabbitLoop") != std::wstring_view::npos ||
      value.find(L"__homePanelSakuraTalkAboutPlayback") != std::wstring_view::npos) {
    return L"true";
  }
  return script;
}
}  // namespace hp

#define SetTimer(hwnd, timerId, interval, callback)                              \
  SpotifyStaggeredSetTimer((hwnd), (timerId), (interval), (callback))
#define DeferWindowPos(batch, hwnd, insertAfter, x, y, width, height, flags)     \
  DeferSpotifyHostWindowPos(                                                    \
      (batch), (hwnd), (insertAfter), (x), (y), (width), (height), (flags))
#define SetWindowPos(hwnd, insertAfter, x, y, width, height, flags)              \
  SetSpotifyHostWindowPos(                                                      \
      (hwnd), (insertAfter), (x), (y), (width), (height), (flags))
#define ExecuteScript(script, callback)                                         \
  ExecuteScript(hp::RewriteSpotifyLegacyAutoplayScript((script)), (callback))
#include "spotify_webviews.cpp"
#undef ExecuteScript
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
#define SetPodcastMode SetPodcastModeImmediate
#include "spotify_phase_sync.inc"
#undef SetPodcastMode
#undef SendInput

#include "spotify_timed_sequence.inc"
#include "spotify_stagger_schedule.inc"

#undef RecomputeForeground
#undef ExecuteScript
#undef SetTimer

#include "spotify_background_click.inc"
}  // namespace hp
