// Native media composition: shared constants/scripts plus focused host/window modules.
#include "../stationhead_status_strip_bridge.h"

namespace {
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
constexpr UINT kNativeMediaPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaStartupXPhaseMs = 5U * 60U * 1000U;
constexpr UINT kNativeMediaYoutubePhaseMs = kNativeMediaPhaseMs;
constexpr UINT kNativeMediaTverPhaseMs = kNativeMediaPhaseMs;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 30U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;
constexpr ULONGLONG kNativeMediaWatchdogExecutionTimeoutMs = 5ULL * 1000ULL;

ULONGLONG& NativeMediaStartupXDeadlineTick() noexcept {
  static ULONGLONG deadline = 0;
  return deadline;
}

UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  if (tver) return kNativeMediaTverPhaseMs;
  auto& deadline = NativeMediaStartupXDeadlineTick();
  if (deadline == 0) {
    const ULONGLONG now = std::max<ULONGLONG>(1, GetTickCount64());
    deadline = now + kNativeMediaStartupXPhaseMs;
    return kNativeMediaStartupXPhaseMs + kNativeMediaYoutubePhaseMs;
  }
  return kNativeMediaYoutubePhaseMs;
}

const wchar_t* NativeMediaYoutubeNavigationUrl() noexcept {
  const ULONGLONG deadline = NativeMediaStartupXDeadlineTick();
  const ULONGLONG now = std::max<ULONGLONG>(1, GetTickCount64());
  if (deadline > now) return kNativeMediaStartupXUrl;
  return kNativeMediaYoutubeContentUrl;
}

constexpr const wchar_t* kNativeMediaPlayAllScript = kNativeMediaYoutubeReliablePlayAllScript;
constexpr const wchar_t* kNativeMediaYoutubeWatchdogScript = kNativeMediaYoutubeControlRecoveryScript;
constexpr wchar_t kNativeMediaTverWatchdogScript[] =
    L"null/*homepanel-tver-watchdog-routing-key*/";

bool NativeMediaWatchdogExecutionTimedOut(
    HWND hostWindow, UINT_PTR timerId) noexcept;
void NativeMediaForgetWatchdogExecution(HWND hostWindow) noexcept;
LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

#define kNativeMediaYoutubeUrl NativeMediaYoutubeNavigationUrl()
#define kNativeMediaPhaseMs NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
#include "media_host.inc"
#undef kNativeMediaTverForceFullscreenAdSafeScript
#undef kNativeMediaPhaseMs
#undef kNativeMediaYoutubeUrl
#include "media_host_window.inc"

}  // namespace
