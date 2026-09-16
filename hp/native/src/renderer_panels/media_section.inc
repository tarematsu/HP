// Media-panel composition wrapper. Playback policies remain fixed constexpr
// scripts while this layer provides trusted WebView2 input, page-specific
// routing and event-driven wakeups for the low-frequency native watchdogs.
#include "media_tver_episode_loop_policy.inc"
#include "media_tver_playback_policy.inc"
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
#include "media_trusted_input.inc"
#undef kNativeMediaTverForceFullscreenAdSafeScript
#include "media_youtube_policy.inc"
#include "media_youtube_control_recovery.inc"
#include "media_youtube_playall_reliable.inc"

namespace {
constexpr wchar_t kNativeMediaNoopScript[] = L"null";
constexpr wchar_t kNativeMediaTverUnexpectedPageScript[] =
    LR"JS((() => 'restart')())JS";
constexpr wchar_t kNativeMediaCursorSuppressionScript[] = LR"JS(
(() => {
  const id = '__homePanelMediaCursorStyle';
  const root = document.head || document.documentElement;
  if (root && !document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '* { cursor:none !important; }';
    root.appendChild(style);
  }
  return true;
})()
)JS";

void NativeMediaTverBeginQueuePhase(
    HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept;
void NativeMediaTverEndQueuePhase() noexcept;
std::wstring NativeMediaTverCurrentEpisodeUrl(
    HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept;
void NativeMediaTverMarkNavigationStarted(std::wstring_view url) noexcept;
void NativeMediaTverMarkMediaReady(std::wstring_view source) noexcept;
bool NativeMediaTverStartupExpired(
    std::wstring_view source, ULONGLONG now) noexcept;
bool NativeMediaTverAdvanceEpisode(std::wstring_view source) noexcept;

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

#include "media_tver_cloud_feed_native.inc"
#include "media_tver_cloud_queue_refresh.inc"

namespace {
bool NativeMediaReadWebViewSource(
    ICoreWebView2* webview, std::wstring& source) noexcept {
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

struct NativeMediaWatchdogExecutionState {
  std::mutex mutex;
  HWND hostWindow = nullptr;
  UINT_PTR timerId = 0;
  uint64_t generation = 0;
  ULONGLONG startedTick = 0;
  bool inFlight = false;
};

NativeMediaWatchdogExecutionState& NativeMediaWatchdogState() noexcept {
  static NativeMediaWatchdogExecutionState state;
  return state;
}

uint64_t NativeMediaBeginWatchdogExecution(
    HWND hostWindow, UINT_PTR timerId) noexcept {
  auto& state = NativeMediaWatchdogState();
  std::lock_guard lock(state.mutex);
  if (++state.generation == 0) ++state.generation;
  state.hostWindow = hostWindow;
  state.timerId = timerId;
  state.startedTick = std::max<ULONGLONG>(1, GetTickCount64());
  state.inFlight = true;
  return state.generation;
}

bool NativeMediaFinishWatchdogExecution(
    HWND hostWindow, uint64_t generation) noexcept {
  auto& state = NativeMediaWatchdogState();
  std::lock_guard lock(state.mutex);
  if (!state.inFlight || state.hostWindow != hostWindow ||
      state.generation != generation) return false;
  state.inFlight = false;
  state.startedTick = 0;
  return true;
}

bool NativeMediaWatchdogExecutionTimedOut(
    HWND hostWindow, UINT_PTR timerId) noexcept {
  auto& state = NativeMediaWatchdogState();
  std::lock_guard lock(state.mutex);
  if (!state.inFlight || state.hostWindow != hostWindow ||
      state.timerId != timerId || state.startedTick == 0) return false;
  const ULONGLONG now = std::max<ULONGLONG>(1, GetTickCount64());
  if (now - state.startedTick < kNativeMediaWatchdogExecutionTimeoutMs) return false;
  if (++state.generation == 0) ++state.generation;
  state.inFlight = false;
  state.startedTick = 0;
  return true;
}

void NativeMediaForgetWatchdogExecution(HWND hostWindow) noexcept {
  auto& state = NativeMediaWatchdogState();
  std::lock_guard lock(state.mutex);
  if (state.hostWindow != hostWindow) return;
  if (++state.generation == 0) ++state.generation;
  state.hostWindow = nullptr;
  state.timerId = 0;
  state.startedTick = 0;
  state.inFlight = false;
}

bool NativeMediaProcessNeedsRecreate(
    COREWEBVIEW2_PROCESS_FAILED_KIND kind) noexcept {
  return kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED ||
         kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED ||
         kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
}

void NativeMediaDispatchFullscreenKeyEvents(
    ICoreWebView2* webview, bool tver) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2> view = webview;
  static constexpr wchar_t kKeyDown[] =
      L"{\"type\":\"keyDown\",\"key\":\"f\",\"code\":\"KeyF\","
      L"\"windowsVirtualKeyCode\":70,\"nativeVirtualKeyCode\":70}";
  static constexpr wchar_t kKeyUp[] =
      L"{\"type\":\"keyUp\",\"key\":\"f\",\"code\":\"KeyF\","
      L"\"windowsVirtualKeyCode\":70,\"nativeVirtualKeyCode\":70}";
  view->CallDevToolsProtocolMethod(
      L"Input.dispatchKeyEvent", kKeyDown,
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [view, tver](HRESULT downResult, LPCWSTR) -> HRESULT {
            if (FAILED(downResult) || !view) return S_OK;
            const HRESULT upStarted = view->CallDevToolsProtocolMethod(
                L"Input.dispatchKeyEvent", kKeyUp,
                Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                    [view, tver](HRESULT upResult, LPCWSTR) -> HRESULT {
                      if (tver && SUCCEEDED(upResult) && view) {
                        view->ExecuteScript(
                            kNativeMediaTverForceFullscreenAdSafeScript, nullptr);
                      }
                      return S_OK;
                    }).Get());
            if (FAILED(upStarted) && tver && view) {
              view->ExecuteScript(
                  kNativeMediaTverForceFullscreenAdSafeScript, nullptr);
            }
            return S_OK;
          }).Get());
}

void NativeMediaDispatchFullscreenKey(
    ICoreWebView2* webview, bool tver) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2> view = webview;
  static constexpr wchar_t kYoutubeFocus[] = LR"JS(
(() => {
  const target = document.querySelector('#movie_player') ||
      document.querySelector('video') || document.body;
  if (!(target instanceof HTMLElement)) return false;
  if (target !== document.body && !target.hasAttribute('tabindex'))
    target.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); }
  catch (_) { try { target.focus(); } catch (_) {} }
  return true;
})()
)JS";
  static constexpr wchar_t kTverFocus[] = LR"JS(
(() => {
  const target = document.querySelector('video') || document.body;
  if (!(target instanceof HTMLElement)) return false;
  if (target !== document.body && !target.hasAttribute('tabindex'))
    target.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); }
  catch (_) { try { target.focus(); } catch (_) {} }
  return true;
})()
)JS";
  const HRESULT focusStarted = view->ExecuteScript(
      tver ? kTverFocus : kYoutubeFocus,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [view, tver](HRESULT, LPCWSTR) -> HRESULT {
            NativeMediaDispatchFullscreenKeyEvents(view.Get(), tver);
            return S_OK;
          }).Get());
  if (FAILED(focusStarted)) {
    NativeMediaDispatchFullscreenKeyEvents(view.Get(), tver);
  }
}

void NativeMediaEnsureEventWakeBridge(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  static ComPtr<ICoreWebView2> installedWebview;
  static EventRegistrationToken installedToken{};
  static EventRegistrationToken installedProcessFailedToken{};
  if (!webview || !hostWindow || !IsWindow(hostWindow) || !alive) return;
  if (installedWebview.Get() == webview && installedToken.value != 0) return;

  if (installedWebview && installedToken.value != 0)
    installedWebview->remove_WebMessageReceived(installedToken);
  if (installedWebview && installedProcessFailedToken.value != 0)
    installedWebview->remove_ProcessFailed(installedProcessFailedToken);
  installedWebview.Reset();
  installedToken = {};
  installedProcessFailedToken = {};

  ComPtr<ICoreWebView2Settings> settings;
  if (FAILED(webview->get_Settings(&settings)) || !settings ||
      FAILED(settings->put_IsWebMessageEnabled(TRUE))) return;

  EventRegistrationToken token{};
  const auto safeAlive = alive;
  const HRESULT registered = webview->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [hostWindow, safeAlive](
              ICoreWebView2* sender,
              ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            if (!safeAlive->load(std::memory_order_acquire) || !sender || !args ||
                !hostWindow || !IsWindow(hostWindow)) return S_OK;
            LPWSTR rawMessage = nullptr;
            if (FAILED(args->TryGetWebMessageAsString(&rawMessage)) || !rawMessage)
              return S_OK;
            const std::wstring message(rawMessage);
            CoTaskMemFree(rawMessage);

            std::wstring source;
            if (!NativeMediaReadWebViewSource(sender, source)) return S_OK;
            const auto sourceContains = [&source](std::wstring_view needle) {
              return source.find(needle) != std::wstring::npos;
            };

            if (message == L"homepanel:youtube-fullscreen-key" &&
                sourceContains(L"youtube.com/watch") &&
                sourceContains(L"list=PLMWqSdpIVl30")) {
              NativeMediaDispatchFullscreenKey(sender, false);
            } else if (message == L"homepanel:tver-fullscreen-key" &&
                       sourceContains(L"tver.jp/episodes/")) {
              NativeMediaDispatchFullscreenKey(sender, true);
            } else if (message == L"homepanel:youtube-wake" &&
                       sourceContains(L"youtube.com/watch") &&
                       sourceContains(L"list=PLMWqSdpIVl30")) {
              PostMessageW(hostWindow, WM_TIMER,
                           kNativeMediaYoutubeWatchdogTimer, 0);
            } else if (message == L"homepanel:tver-media-init" &&
                       sourceContains(L"tver.jp/episodes/")) {
              NativeMediaTverMarkMediaReady(source);
              NativeMediaTrustedWake(hostWindow, sender, nullptr);
              PostMessageW(hostWindow, WM_TIMER,
                           kNativeMediaTverWatchdogTimer, 0);
            } else if (message == L"homepanel:tver-ended" &&
                       sourceContains(L"tver.jp/episodes/")) {
              if (NativeMediaTverAdvanceEpisode(source))
                PostMessageW(hostWindow, WM_TIMER,
                             kNativeMediaNavigationRetryTimer, 0);
            } else if (message == L"homepanel:tver-wake" &&
                       sourceContains(L"tver.jp/episodes/")) {
              PostMessageW(hostWindow, WM_TIMER,
                           kNativeMediaTverWatchdogTimer, 0);
            }
            return S_OK;
          }).Get(),
      &token);
  if (FAILED(registered)) return;

  EventRegistrationToken processFailedToken{};
  const HRESULT processRegistered = webview->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [hostWindow, safeAlive](
              ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args)
              -> HRESULT {
            if (!safeAlive->load(std::memory_order_acquire) || !args ||
                !hostWindow || !IsWindow(hostWindow)) return S_OK;
            COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
            if (FAILED(args->get_ProcessFailedKind(&kind)) ||
                !NativeMediaProcessNeedsRecreate(kind)) return S_OK;
            PostMessageW(hostWindow, kNativeMediaRecreateMessage, 0, 0);
            return S_OK;
          }).Get(),
      &processFailedToken);

  installedWebview = webview;
  installedToken = token;
  if (SUCCEEDED(processRegistered)) installedProcessFailedToken = processFailedToken;
}

const wchar_t* ResolveNativeMediaPolicyScript(
    const wchar_t* script, ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  if (script == kNativeMediaYoutubeCleanPlayerScript) return kNativeMediaNoopScript;
  if (script == kNativeMediaTverLoopScript) {
    NativeMediaEnsureEventWakeBridge(webview, hostWindow, alive);
    return NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")
        ? kNativeMediaTverEpisodeLoopPolicyScript : kNativeMediaNoopScript;
  }
  if (script == kNativeMediaTverWatchdogScript) {
    NativeMediaEnsureEventWakeBridge(webview, hostWindow, alive);
    if (NativeMediaWebViewSourceContains(webview, L"tver.jp/episodes/")) {
      NativeMediaTverPrepareCloudQueueRefresh(hostWindow, alive, false);
      return kNativeMediaTverPlaybackWatchdogPolicyScript;
    }
    return NativeMediaWebViewSourceContains(webview, L"tver.jp/")
        ? kNativeMediaTverUnexpectedPageScript : kNativeMediaNoopScript;
  }
  if (script == kNativeMediaYoutubeWatchdogScript)
    NativeMediaEnsureEventWakeBridge(webview, hostWindow, alive);
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
  if (!resolved) return E_POINTER;

  const UINT_PTR watchdogTimerId = script == kNativeMediaYoutubeWatchdogScript
      ? kNativeMediaYoutubeWatchdogTimer
      : script == kNativeMediaTverWatchdogScript ? kNativeMediaTverWatchdogTimer : 0;
  if (watchdogTimerId == 0 || !handler)
    return webview->ExecuteScript(resolved, handler);

  const uint64_t generation =
      NativeMediaBeginWatchdogExecution(hostWindow, watchdogTimerId);
  ComPtr<ICoreWebView2ExecuteScriptCompletedHandler> downstream = handler;
  const auto safeAlive = alive;
  const auto completed =
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [hostWindow, safeAlive, downstream, generation](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!NativeMediaFinishWatchdogExecution(hostWindow, generation)) return S_OK;
            if (safeAlive && safeAlive->load(std::memory_order_acquire) &&
                FAILED(result) && hostWindow && IsWindow(hostWindow))
              PostMessageW(hostWindow, kNativeMediaRecreateMessage, 0, 0);
            return downstream ? downstream->Invoke(result, json) : S_OK;
          });
  const HRESULT started = webview->ExecuteScript(resolved, completed.Get());
  if (FAILED(started)) {
    NativeMediaFinishWatchdogExecution(hostWindow, generation);
    if (safeAlive && safeAlive->load(std::memory_order_acquire) &&
        hostWindow && IsWindow(hostWindow))
      PostMessageW(hostWindow, kNativeMediaRecreateMessage, 0, 0);
  }
  return started;
}
}  // namespace