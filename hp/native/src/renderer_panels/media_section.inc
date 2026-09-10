// Media-panel composition wrapper. Playback scripts are fixed constexpr strings;
// this layer routes hidden-window input through WebView2 CDP, applies the current
// YouTube/TVer page-specific policies, and keeps Spotify aligned with the media
// phase.
#undef SetTimer
#undef SendInput
#include "media_tver_ad_guard.inc"
#include "media_tver_cloud_queue_refresh.inc"
#include "media_tver_episode_loop_policy.inc"
#include "media_tver_series_dom_policy.inc"
#include "media_tver_series_policy.inc"
#include "media_tver_playback_policy.inc"
#include "media_trusted_input.inc"
#include "media_youtube_policy.inc"
#include "media_youtube_trusted_action.inc"
#include "media_youtube_control_recovery.inc"
#include "media_youtube_playall_reliable.inc"

namespace {
constexpr wchar_t kNativeMediaTverNavigationPendingScript[] = L"null";
constexpr ULONGLONG kNativeMediaTverNavigationPendingMaxMs = 8ULL * 1000ULL;
constexpr wchar_t kNativeMediaPhaseOverlaySuppressionScript[] = LR"JS(
(() => {
  const badge = document.getElementById('__homePanelMediaPhaseTime');
  if (badge) badge.remove();

  const cursorStyleId = '__homePanelMediaCursorStyle';
  const styleRoot = document.head || document.documentElement;
  if (styleRoot && !document.getElementById(cursorStyleId)) {
    const cursorStyle = document.createElement('style');
    cursorStyle.id = cursorStyleId;
    cursorStyle.textContent = '* { cursor:none !important; }';
    styleRoot.appendChild(cursorStyle);
  }
  return null;
})()
)JS";
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
        : ::SetTimer((hwnd), (timerId), (interval), (callback))))

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

void NativeMediaEnsureYoutubeTrustedAction(
    ICoreWebView2* webview, bool force = false) noexcept {
  // The helper belongs to the current JavaScript document. Cache by WebView and
  // URL for the watchdog, but force reinjection from the clean-player
  // NavigationCompleted path so a same-URL document reload cannot lose it.
  static ICoreWebView2* installedWebview = nullptr;
  static std::wstring installedSource;
  if (!webview) return;

  LPWSTR rawSource = nullptr;
  if (FAILED(webview->get_Source(&rawSource)) || !rawSource) return;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  if (!force && installedWebview == webview && installedSource == source) return;

  const HRESULT started = webview->ExecuteScript(
      kNativeMediaYoutubeTrustedActionBootstrapScript, nullptr);
  if (SUCCEEDED(started)) {
    installedWebview = webview;
    installedSource = source;
  }
}

bool NativeMediaTverNavigationPendingFor(ICoreWebView2* webview) noexcept {
  static ICoreWebView2* observedWebview = nullptr;
  static std::wstring observedSeriesId;
  static uint64_t observedGeneration = 0;
  static ULONGLONG observedAt = 0;

  const auto resetObservation = [&]() noexcept {
    observedWebview = nullptr;
    observedSeriesId.clear();
    observedGeneration = 0;
    observedAt = 0;
  };

  const auto seriesId = NativeMediaTverSeriesIdFromWebView(webview);
  if (!seriesId) {
    resetObservation();
    return false;
  }
  auto& state = NativeMediaTverSeriesResolver();
  std::lock_guard lock(state.mutex);
  if (state.webviewIdentity != webview || state.seriesId != *seriesId ||
      !state.navigationPending) {
    resetObservation();
    return false;
  }

  const ULONGLONG now = GetTickCount64();
  if (observedWebview != webview || observedSeriesId != *seriesId ||
      observedGeneration != state.generation || observedAt == 0) {
    observedWebview = webview;
    observedSeriesId = *seriesId;
    observedGeneration = state.generation;
    observedAt = now;
    return true;
  }
  if (now - observedAt < kNativeMediaTverNavigationPendingMaxMs) return true;

  // Navigate() returning S_OK only means the navigation was accepted. The page
  // can still cancel it, redirect back to /series/, or an ExecuteScript callback
  // can be lost. Never let that transient state suppress the rendered-page
  // episode fallback forever.
  state.navigationPending = false;
  state.failedAt = now;
  resetObservation();
  return false;
}

const wchar_t* ResolveNativeMediaPolicyScript(
    const wchar_t* script, ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  if (script &&
      std::wstring_view(script).find(L"__homePanelMediaPhaseTime") !=
          std::wstring_view::npos) {
    return kNativeMediaPhaseOverlaySuppressionScript;
  }
  if (script == kNativeMediaYoutubeCleanPlayerScript) {
    NativeMediaEnsureYoutubeTrustedAction(webview, true);
    return script;
  }
  if (script == kNativeMediaTverLoopScript &&
      NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")) {
    return kNativeMediaTverEpisodeLoopPolicyScript;
  }
  if (script == kNativeMediaTverWatchdogScript) {
    if (NativeMediaWebViewSourceContains(webview, L"tver.jp/series/")) {
      PrepareNativeMediaTverSeriesResolution(webview, hostWindow, alive);
      if (NativeMediaTverNavigationPendingFor(webview)) {
        return kNativeMediaTverNavigationPendingScript;
      }
      return NativeMediaTverSeriesWatchdogPolicyScript();
    }
    if (NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")) {
      if (webview) {
        webview->ExecuteScript(kNativeMediaTverCloudQueueRefreshScript, nullptr);
      }
      return kNativeMediaTverPlaybackWatchdogPolicyScript;
    }
    return kNativeMediaTverWatchdogStaticScript;
  }
  if (script == kNativeMediaPlayAllScript) {
    return kNativeMediaYoutubeReliablePlayAllScript;
  }
  if (script == kNativeMediaYoutubeWatchdogScript) {
    NativeMediaEnsureYoutubeTrustedAction(webview);
    return kNativeMediaYoutubeControlRecoveryScript;
  }
  return script;
}
}  // namespace