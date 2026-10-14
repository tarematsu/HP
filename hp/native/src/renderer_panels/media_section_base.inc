// Native media composition: shared constants/scripts plus focused host/window modules.
#include "../stationhead_status_strip_bridge.h"

namespace {
bool gNativeMediaPowerSaving = false;
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMediaYoutubeContentUrl[] =
    L"https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start";
constexpr wchar_t kNativeMediaStartupXUrl[] =
    L"https://x.com/home?homepanel=startup";
constexpr wchar_t kNativeMediaProfile[] = L"media-youtube";
constexpr UINT_PTR kNativeMediaPhaseTimer = 0x4D560001;
constexpr UINT_PTR kNativeMediaNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;
constexpr UINT_PTR kNativeMediaTverWatchdogTimer = 0x4D560007;
constexpr UINT kNativeMediaRecreateMessage = WM_USER + 0x4D;
// The only X visit is the initial two-minute phase on each app launch.
constexpr UINT kNativeMediaStartupXPhaseMs = 2U * 60U * 1000U;
// Fixed alternating playback phases. Startup X runs once for two minutes;
// it is never inserted between YouTube and TVer phases.
constexpr UINT kNativeMediaYoutubeContentPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaTverContentDurationMs = 58U * 60U * 1000U;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
// Healthy playback is event-driven; this is only a safety backstop.
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 60U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;
constexpr ULONGLONG kNativeMediaWatchdogExecutionTimeoutMs = 5ULL * 1000ULL;

constexpr UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  // One duration for each service, independent of power-saving transitions.
  return tver ? kNativeMediaTverContentDurationMs
              : kNativeMediaYoutubeContentPhaseMs;
}

constexpr const wchar_t* kNativeMediaPlayAllScript = kNativeMediaYoutubeReliablePlayAllScript;
constexpr const wchar_t* kNativeMediaYoutubeWatchdogScript = kNativeMediaYoutubeCachedProbeScript;
constexpr wchar_t kNativeMediaTverWatchdogScript[] =
    L"null/*homepanel-tver-watchdog-routing-key*/";

bool NativeMediaWatchdogExecutionTimedOut(
    HWND hostWindow, UINT_PTR timerId) noexcept;
void NativeMediaForgetWatchdogExecution(HWND hostWindow) noexcept;
LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

#define kNativeMediaYoutubeUrl kNativeMediaYoutubeContentUrl
#define kNativeMediaPhaseMs NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
#include "media_host.inc"
#undef kNativeMediaTverForceFullscreenAdSafeScript
#undef kNativeMediaPhaseMs
#undef kNativeMediaYoutubeUrl
#include "media_host_window.inc"

}  // namespace
