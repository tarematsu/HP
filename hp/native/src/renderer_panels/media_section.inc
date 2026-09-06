// Thin media-panel wrapper: keep the established media implementation intact,
// but replace OS-level pointer input with WebView2 CDP input. This is required
// while power-saving mode hides the dashboard HWND.
#undef SetTimer
#undef SendInput
#include "media_trusted_input.inc"

#define SetTimer(hwnd, timerId, interval, callback)                              \
  (((timerId) == kNativeMediaPhaseTimer                                         \
        ? (CaptureNativeMediaPhaseOverlay(phase_ == Phase::Tver),              \
           SetSpotifyMediaPhase(phase_ == Phase::Tver), 0)                     \
        : 0),                                                                   \
   ((timerId) == kNativeMediaPlaybackHealthTimer                                \
        ? static_cast<UINT_PTR>(1)                                              \
        : ((timerId) == kNativeMediaTverWatchdogTimer                           \
               ? ArmNativeMediaTrustedWakeTimer(                               \
                     (hwnd), webview_.Get(), (timerId), (interval))             \
               : NativeMediaDirectSetTimer(                                     \
                     (hwnd), (timerId),                                         \
                     ((timerId) == kNativeMediaPhaseTimer                       \
                          ? NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)   \
                          : ((timerId) == kNativeMediaPlayAllTimer               \
                                 ? 1000U                                        \
                                 : (interval))),                                \
                     (callback)))))

#define SendInput(count, inputs, inputSize)                                      \
  NativeMediaDispatchTrustedInput(                                              \
      phase_ == Phase::Tver, webview_.Get(), hostWindow_,                       \
      (count), (inputs), (inputSize))

#include "media_section_base.inc"
