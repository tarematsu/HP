// Media-panel composition wrapper. Playback scripts are fixed constexpr strings;
// this layer routes hidden-window input through WebView2 CDP, applies the current
// YouTube/TVer page-specific policies, and keeps Spotify aligned with the media
// phase.
#undef SetTimer
#undef SendInput
#include "media_tver_ad_guard.inc"
#include "media_tver_series_dom_policy.inc"
#include "media_tver_series_policy.inc"
#include "media_tver_playback_policy.inc"
#include "media_trusted_input.inc"
#include "media_youtube_policy.inc"
#include "media_youtube_playall_reliable.inc"

namespace {
constexpr UINT kNativeMediaYoutubeControlWatchdogMs = 1000U;
constexpr wchar_t kNativeMediaTverNavigationPendingScript[] = L"null";
const wchar_t* ResolveNativeMediaPolicyScript(
    const wchar_t* script, ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept;
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
  ExecuteScript(ResolveNativeMediaPolicyScript((script), webview_.Get(), hostWindow_, alive_), \
                (handler))

// The base host already retries failed top-level navigations after three
// seconds. Keep WebView2's built-in network error document out of the visible
// media panel while that retry is armed; otherwise users briefly see
// "このページは表示できません" even though recovery is already in progress.
#define put_IsBuiltInErrorPageEnabled(value) put_IsBuiltInErrorPageEnabled(FALSE)

#include "media_section_base.inc"

#undef put_IsBuiltInErrorPageEnabled
#undef ExecuteScript
#undef SendInput
#undef SetTimer

// Native TVer discovery needs the timer IDs declared by media_section_base.inc,
// while the base host only needs the resolver declaration above. Keep the API
// implementation on this side of the composition boundary.
#include "media_tver_native_series_resolver.inc"

namespace {
bool NativeMediaWebViewSourceContains(
    ICoreWebView2* webview, std::wstring_view needle) noexcept {
  if (!webview) return false;
  LPWSTR source = nullptr;
  if (FAILED(webview->get_Source(&source)) || !source) return false;
  const std::wstring value(source);
  CoTaskMemFree(source);
  return value.find(needle) != std::wstring::npos;
}

bool NativeMediaTverNavigationPendingFor(ICoreWebView2* webview) noexcept {
  const auto seriesId = NativeMediaTverSeriesIdFromWebView(webview);
  if (!seriesId) return false;
  auto& state = NativeMediaTverSeriesResolver();
  std::lock_guard lock(state.mutex);
  return state.webviewIdentity == webview && state.seriesId == *seriesId &&
         state.navigationPending;
}

const wchar_t* ResolveNativeMediaPolicyScript(
    const wchar_t* script, ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  if (script == kNativeMediaTverWatchdogScript) {
    if (NativeMediaWebViewSourceContains(webview, L"tver.jp/series/")) {
      PrepareNativeMediaTverSeriesResolution(webview, hostWindow, alive);
      if (NativeMediaTverNavigationPendingFor(webview)) {
        return kNativeMediaTverNavigationPendingScript;
      }
      return NativeMediaTverSeriesWatchdogPolicyScript();
    }
    if (NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")) {
      return kNativeMediaTverPlaybackWatchdogPolicyScript;
    }
    return kNativeMediaTverWatchdogStaticScript;
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
