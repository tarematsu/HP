// Media-panel composition wrapper. Playback scripts are fixed constexpr strings;
// this layer routes hidden-window input through WebView2 CDP, applies the current
// YouTube policy, and keeps Spotify aligned with the media phase.
#undef SetTimer
#undef SendInput
#include "media_tver_ad_guard.inc"
#include "media_tver_start_policy.inc"
#include "media_trusted_input.inc"
#include "media_youtube_policy.inc"
#include "media_youtube_playall_reliable.inc"

namespace {
constexpr UINT kNativeMediaYoutubeControlWatchdogMs = 1000U;
const wchar_t* ResolveNativeMediaPolicyScript(const wchar_t* script) noexcept;
}  // namespace

#define SetTimer(hwnd, timerId, interval, callback)                              \
  (((timerId) == kNativeMediaPhaseTimer                                         \
        ? (SetSpotifyMediaPhase(phase_ == Phase::Tver), 0)                     \
        : 0),                                                                   \
   ((timerId) == kNativeMediaTverWatchdogTimer                                  \
        ? ArmNativeMediaTrustedWakeTimer(                                       \
              (hwnd), webview_.Get(), controller_.Get(),                       \
              (timerId), (interval))                                            \
        : ((timerId) == kNativeMediaYoutubeWatchdogTimer                        \
              ? ::SetTimer((hwnd), (timerId),                                   \
                           kNativeMediaYoutubeControlWatchdogMs, (callback))     \
              : ::SetTimer((hwnd), (timerId), (interval), (callback)))))

#define SendInput(count, inputs, inputSize)                                     \
  NativeMediaDispatchTrustedInput(                                              \
      phase_ == Phase::Tver, webview_.Get(), controller_.Get(), hostWindow_,   \
      (count), (inputs), (inputSize))

#define ExecuteScript(script, handler)                                          \
  ExecuteScript(ResolveNativeMediaPolicyScript((script)), (handler))

#include "media_section_base.inc"

#undef ExecuteScript
#undef SendInput
#undef SetTimer

namespace {
const wchar_t* ResolveNativeMediaPolicyScript(const wchar_t* script) noexcept {
  if (script == kNativeMediaTverWatchdogScript) {
    return kNativeMediaTverWatchdogPolicyScript;
  }
  if (script == kNativeMediaPlayAllScript) {
    return kNativeMediaYoutubeReliablePlayAllScript;
  }
  if (script == kNativeMediaYoutubeWatchdogScript) {
    return kNativeMediaYoutubeWatchdogPolicyScript;
  }
  if (script == kNativeMediaYoutubeHealthScript) {
    return kNativeMediaYoutubeHealthPolicyScript;
  }
  return script;
}
}  // namespace
