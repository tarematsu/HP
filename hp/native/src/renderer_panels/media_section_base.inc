// Native media composition: shared constants/scripts plus focused host/window modules.
namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMediaYoutubeUrl[] =
    L"https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start";
constexpr wchar_t kNativeMediaProfile[] = L"media-youtube";
constexpr UINT_PTR kNativeMediaPhaseTimer = 0x4D560001;
constexpr UINT_PTR kNativeMediaNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;
constexpr UINT_PTR kNativeMediaTverWatchdogTimer = 0x4D560007;
constexpr UINT kNativeMediaPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
// Healthy YouTube playback is event-driven; the timer is only a backstop.
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 30U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;

// Routing sentinel only. The exceptional /playlist fallback installs one
// event-driven resolver in media_youtube_playall_reliable.inc.
constexpr wchar_t kNativeMediaPlayAllScript[] = L"null";

// Legacy symbol retained as a routing key for media_host.inc. The wrapper
// resolves it to the event-aware policy in media_youtube_control_recovery.inc.
constexpr wchar_t kNativeMediaYoutubeWatchdogScript[] = LR"JS(
(() => null)()
)JS";

// TVer uses one routing key as well; episode pages resolve to the event-driven
// policy and trusted watchdog in media_section.inc.
constexpr const wchar_t* kNativeMediaTverLoopScript =
    kNativeMediaTverLoopStaticScript;
constexpr const wchar_t* kNativeMediaTverWatchdogScript =
    kNativeMediaTverWatchdogStaticScript;

LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

#include "media_host.inc"
#include "media_host_window.inc"

}  // namespace