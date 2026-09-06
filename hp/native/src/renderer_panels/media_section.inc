// Media-panel composition wrapper. Playback scripts are fixed constexpr strings;
// this layer only selects the static TVer variants, routes hidden-window input
// through WebView2 CDP, and keeps Spotify aligned with the media phase.
#undef ExecuteScript
#undef SetTimer
#undef SendInput
#include "media_tver_ad_guard.inc"
#include "media_trusted_input.inc"

namespace {
const wchar_t* ResolveNativeMediaStaticScript(const wchar_t* script) noexcept;
}

#define ExecuteScript(script, callback)                                         \
  ExecuteScript(ResolveNativeMediaStaticScript((script)), (callback))

#define SetTimer(hwnd, timerId, interval, callback)                              \
  (((timerId) == kNativeMediaPhaseTimer                                         \
        ? (SetSpotifyMediaPhase(phase_ == Phase::Tver), 0)                     \
        : 0),                                                                   \
   ((timerId) == kNativeMediaTverWatchdogTimer                                  \
        ? ArmNativeMediaTrustedWakeTimer(                                       \
              (hwnd), webview_.Get(), (timerId), (interval))                   \
        : ::SetTimer((hwnd), (timerId), (interval), (callback))))

#define SendInput(count, inputs, inputSize)                                      \
  NativeMediaDispatchTrustedInput(                                              \
      phase_ == Phase::Tver, webview_.Get(), hostWindow_,                       \
      (count), (inputs), (inputSize))

#include "media_section_base.inc"

#undef SendInput
#undef SetTimer
#undef ExecuteScript

namespace {
const wchar_t* ResolveNativeMediaStaticScript(const wchar_t* script) noexcept {
  if (script == kNativeMediaTverLoopScript) {
    return kNativeMediaTverLoopStaticScript;
  }
  if (script == kNativeMediaTverWatchdogScript) {
    return kNativeMediaTverWatchdogStaticScript;
  }
  return script;
}
}  // namespace
