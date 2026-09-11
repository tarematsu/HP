// Media-panel composition wrapper. Playback policies remain fixed constexpr
// scripts while this layer provides trusted WebView2 input, page-specific
// routing and event-driven wakeups for the low-frequency native watchdogs.
#include "media_tver_ad_guard.inc"
#include "media_tver_episode_loop_policy.inc"
#include "media_tver_playback_policy.inc"
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
#include "media_trusted_input.inc"
#undef kNativeMediaTverForceFullscreenAdSafeScript
#include "media_youtube_policy.inc"
#include "media_youtube_trusted_action.inc"
#include "media_youtube_event_agent.inc"
#include "media_youtube_control_recovery.inc"
#include "media_youtube_playall_reliable.inc"

namespace {
constexpr wchar_t kNativeMediaNoopScript[] = L"null";
constexpr wchar_t kNativeMediaTverUnexpectedPageScript[] =
    LR"JS((() => 'restart')())JS";
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
HRESULT ExecuteNativeMediaPolicyScript(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive,
    const wchar_t* script,
    ICoreWebView2ExecuteScriptCompletedHandler* handler) noexcept;
}  // namespace

#include "media_section_base.inc"

// TVer playback consumes only the cloud-owned episode feed. Keep the bounded
// native feed client and queue refresher beside the host after timer IDs exist.
#include "media_tver_cloud_feed_native.inc"
#include "media_tver_cloud_queue_refresh.inc"

namespace {
bool NativeMediaReadWebViewSource(
    ICoreWebView2* webview, std::wstring& source) noexcept {
  source.clear();
  if (!webview) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(webview->get_Source(&rawSource)) || !rawSource) return false;
  source.assign(rawSource);
  CoTaskMemFree(rawSource);
  return true;
}

bool NativeMediaWebViewSourceContains(
    ICoreWebView2* webview, std::wstring_view needle) noexcept {
  std::wstring source;
  return NativeMediaReadWebViewSource(webview, source) &&
         source.find(needle) != std::wstring::npos;
}

void NativeMediaEnsureEventWakeBridge(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  static ComPtr<ICoreWebView2> installedWebview;
  static EventRegistrationToken installedToken{};
  if (!webview || !hostWindow || !IsWindow(hostWindow) || !alive) return;
  if (installedWebview.Get() == webview && installedToken.value != 0) return;

  if (installedWebview && installedToken.value != 0) {
    installedWebview->remove_WebMessageReceived(installedToken);
  }
  installedWebview.Reset();
  installedToken = {};

  ComPtr<ICoreWebView2Settings> settings;
  if (FAILED(webview->get_Settings(&settings)) || !settings ||
      FAILED(settings->put_IsWebMessageEnabled(TRUE))) {
    return;
  }

  EventRegistrationToken token{};
  const auto safeAlive = alive;
  const HRESULT registered = webview->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [hostWindow, safeAlive](
              ICoreWebView2* sender,
              ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            if (!safeAlive->load(std::memory_order_acquire) || !sender || !args ||
                !hostWindow || !IsWindow(hostWindow)) {
              return S_OK;
            }
            LPWSTR rawMessage = nullptr;
            if (FAILED(args->TryGetWebMessageAsString(&rawMessage)) ||
                !rawMessage) {
              return S_OK;
            }
            const std::wstring message(rawMessage);
            CoTaskMemFree(rawMessage);

            // A wake message is already page-local and fixed. Read the WebView
            // source once, then validate every route against that single value
            // instead of crossing the COM boundary once per substring check.
            std::wstring source;
            if (!NativeMediaReadWebViewSource(sender, source)) return S_OK;
            const auto sourceContains = [&source](std::wstring_view needle) {
              return source.find(needle) != std::wstring::npos;
            };

            if (message == L"homepanel:youtube-wake" &&
                sourceContains(L"youtube.com/watch") &&
                sourceContains(L"list=PLMWqSdpIVl30")) {
              PostMessageW(hostWindow, WM_TIMER,
                           kNativeMediaYoutubeWatchdogTimer, 0);
            } else if (message == L"homepanel:tver-wake" &&
                       sourceContains(L"tver.jp/episodes/")) {
              PostMessageW(hostWindow, WM_TIMER, kNativeMediaTverWatchdogTimer, 0);
            }
            return S_OK;
          }).Get(),
      &token);
  if (SUCCEEDED(registered)) {
    installedWebview = webview;
    installedToken = token;
  }
}

void NativeMediaEnsureYoutubeTrustedAction(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive,
    bool force = false) noexcept {
  static ICoreWebView2* installedWebview = nullptr;
  static std::wstring installedSource;
  if (!webview) return;
  NativeMediaEnsureEventWakeBridge(webview, hostWindow, alive);

  std::wstring source;
  if (!NativeMediaReadWebViewSource(webview, source)) return;
  if (!force && installedWebview == webview && installedSource == source) return;

  const HRESULT trustedStarted = webview->ExecuteScript(
      kNativeMediaYoutubeTrustedActionBootstrapScript, nullptr);
  const HRESULT agentStarted = webview->ExecuteScript(
      kNativeMediaYoutubeEventAgentScript, nullptr);
  if (SUCCEEDED(trustedStarted) && SUCCEEDED(agentStarted)) {
    installedWebview = webview;
    installedSource = source;
  }
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
    // The static presentation policy is already installed by
    // AddScriptToExecuteOnDocumentCreated. Navigation completion only needs to
    // refresh the source-scoped trusted/event controller, not inject the same
    // clean-player CSS again.
    NativeMediaEnsureYoutubeTrustedAction(webview, hostWindow, alive);
    return kNativeMediaNoopScript;
  }
  if (script == kNativeMediaTverLoopScript) {
    NativeMediaEnsureEventWakeBridge(webview, hostWindow, alive);
    return NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")
        ? kNativeMediaTverEpisodeLoopPolicyScript
        : kNativeMediaNoopScript;
  }
  if (script == kNativeMediaTverWatchdogScript) {
    NativeMediaEnsureEventWakeBridge(webview, hostWindow, alive);
    if (NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")) {
      PrepareNativeMediaTverCloudQueueRefresh(webview, hostWindow, alive);
      return kNativeMediaTverPlaybackWatchdogPolicyScript;
    }
    return NativeMediaWebViewSourceContains(webview, L"tver.jp/")
        ? kNativeMediaTverUnexpectedPageScript
        : kNativeMediaNoopScript;
  }
  if (script == kNativeMediaPlayAllScript) {
    return kNativeMediaYoutubeReliablePlayAllScript;
  }
  if (script == kNativeMediaYoutubeWatchdogScript) {
    NativeMediaEnsureYoutubeTrustedAction(webview, hostWindow, alive);
    return kNativeMediaYoutubeControlRecoveryScript;
  }
  return script;
}

HRESULT ExecuteNativeMediaPolicyScript(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive,
    const wchar_t* script,
    ICoreWebView2ExecuteScriptCompletedHandler* handler) noexcept {
  if (!webview || !script) return E_POINTER;
  const wchar_t* resolved =
      ResolveNativeMediaPolicyScript(script, webview, hostWindow, alive);
  return resolved ? webview->ExecuteScript(resolved, handler) : E_POINTER;
}
}  // namespace
