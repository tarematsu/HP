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
constexpr UINT_PTR kNativeMediaXStartTimer = 0x4D560008;
constexpr UINT_PTR kNativeMediaPhaseTimer = 0x4D560001;
constexpr UINT_PTR kNativeMediaNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;
constexpr UINT_PTR kNativeMediaTverWatchdogTimer = 0x4D560007;
constexpr UINT kNativeMediaRecreateMessage = WM_USER + 0x4D;
constexpr UINT kNativeMediaXPhaseMs = 1U * 60U * 1000U;
constexpr UINT kNativeMediaStartupXPhaseMs = 1U * 60U * 1000U;
constexpr UINT kNativeMediaYoutubeContentPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaTverContentDurationMs = 58U * 60U * 1000U;
constexpr UINT kNativeMediaYoutubePhaseMs =
    kNativeMediaYoutubeContentPhaseMs + kNativeMediaXPhaseMs;
constexpr UINT kNativeMediaTverPhaseMs =
    kNativeMediaTverContentDurationMs + kNativeMediaXPhaseMs;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 30U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;
constexpr ULONGLONG kNativeMediaWatchdogExecutionTimeoutMs = 5ULL * 1000ULL;

ULONGLONG& NativeMediaStartupXDeadlineTick() noexcept {
  static ULONGLONG deadline = 0;
  return deadline;
}

bool& NativeMediaStartupYoutubePhaseActive() noexcept {
  static bool active = false;
  return active;
}

UINT NativeMediaYoutubeContentIntervalMs() noexcept {
  return NativeMediaStartupYoutubePhaseActive()
      ? kNativeMediaStartupXPhaseMs + kNativeMediaYoutubeContentPhaseMs
      : kNativeMediaYoutubeContentPhaseMs;
}

UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  if (gNativeMediaPowerSaving) {
    // Power-saving mode intentionally has no X slot. Consume the one-shot
    // startup slot so disabling power saving later cannot open a delayed X page.
    if (NativeMediaStartupXDeadlineTick() == 0) {
      NativeMediaStartupXDeadlineTick() = 1;
    }
    NativeMediaStartupYoutubePhaseActive() = false;
    return kNativeMediaYoutubeContentPhaseMs;
  }
  if (tver) {
    NativeMediaStartupYoutubePhaseActive() = false;
    return kNativeMediaTverPhaseMs;
  }

  auto& deadline = NativeMediaStartupXDeadlineTick();
  if (deadline == 0) {
    const ULONGLONG now = std::max<ULONGLONG>(1, GetTickCount64());
    deadline = now + kNativeMediaStartupXPhaseMs;
    NativeMediaStartupYoutubePhaseActive() = true;
  }
  return NativeMediaStartupYoutubePhaseActive()
      ? kNativeMediaStartupXPhaseMs + kNativeMediaYoutubePhaseMs
      : kNativeMediaYoutubePhaseMs;
}

const wchar_t* NativeMediaYoutubeNavigationUrl() noexcept {
  if (gNativeMediaPowerSaving) return kNativeMediaYoutubeContentUrl;
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
#define kNativeMediaYoutubeContentPhaseMs NativeMediaYoutubeContentIntervalMs()
#define kNativeMediaPhaseMs NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
#include "media_host.inc"
#undef kNativeMediaTverForceFullscreenAdSafeScript
#undef kNativeMediaPhaseMs
#undef kNativeMediaYoutubeContentPhaseMs
#undef kNativeMediaYoutubeUrl
#include "media_host_window.inc"

}  // namespace
