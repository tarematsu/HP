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
// Retained as the neutral/default duration for power saving and legacy contracts.
// Every normal YouTube phase redraws its content duration in the 50-60 minute range.
constexpr UINT kNativeMediaYoutubeContentPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaYoutubeMinContentDurationMinutes = 50U;
constexpr UINT kNativeMediaYoutubeMaxContentDurationMinutes = 60U;
// Retained as the neutral/default duration for startup state and legacy contracts.
// Every actual TVer phase redraws its content duration in the 45-55 minute range.
constexpr UINT kNativeMediaTverContentDurationMs = 50U * 60U * 1000U;
constexpr UINT kNativeMediaTverMinContentDurationMinutes = 45U;
constexpr UINT kNativeMediaTverMaxContentDurationMinutes = 55U;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 30U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;
constexpr ULONGLONG kNativeMediaWatchdogExecutionTimeoutMs = 5ULL * 1000ULL;

// Only the YouTube/TVer durations are randomized. X is never drawn per cycle.
struct NativeMediaContentPlan {
  UINT youtubeContentDurationMs = kNativeMediaYoutubeContentPhaseMs;
  UINT tverContentDurationMs = kNativeMediaTverContentDurationMs;
};

ULONGLONG NativeMediaRandomWord() noexcept {
  static ULONGLONG state = 0;
  if (state == 0) {
    state = std::max<ULONGLONG>(1, GetTickCount64()) ^ 0x9E3779B97F4A7C15ULL;
  }
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return state;
}

UINT NativeMediaRandomBelow(UINT exclusiveUpperBound) noexcept {
  if (exclusiveUpperBound <= 1) return 0;
  return static_cast<UINT>(NativeMediaRandomWord() % exclusiveUpperBound);
}

NativeMediaContentPlan NativeMediaDrawContentPlan() noexcept {
  NativeMediaContentPlan plan{};
  const UINT youtubeSpan = kNativeMediaYoutubeMaxContentDurationMinutes -
      kNativeMediaYoutubeMinContentDurationMinutes + 1U;
  plan.youtubeContentDurationMs =
      (kNativeMediaYoutubeMinContentDurationMinutes + NativeMediaRandomBelow(youtubeSpan)) * 60U * 1000U;
  const UINT tverSpan = kNativeMediaTverMaxContentDurationMinutes -
      kNativeMediaTverMinContentDurationMinutes + 1U;
  plan.tverContentDurationMs =
      (kNativeMediaTverMinContentDurationMinutes + NativeMediaRandomBelow(tverSpan)) * 60U * 1000U;
  return plan;
}

NativeMediaContentPlan& NativeMediaCurrentContentPlan() noexcept {
  static NativeMediaContentPlan plan{};
  return plan;
}

void NativeMediaObserveContentPhase(bool tver) noexcept {
  static bool initialized = false;
  static bool lastTver = false;
  if (!initialized || lastTver != tver) {
    NativeMediaCurrentContentPlan() = NativeMediaDrawContentPlan();
    initialized = true;
    lastTver = tver;
  }
}

UINT NativeMediaCurrentYoutubeContentDurationMs() noexcept {
  NativeMediaObserveContentPhase(false);
  return NativeMediaCurrentContentPlan().youtubeContentDurationMs;
}

UINT NativeMediaCurrentTverContentDurationMs() noexcept {
  NativeMediaObserveContentPhase(true);
  return NativeMediaCurrentContentPlan().tverContentDurationMs;
}

UINT NativeMediaYoutubeContentIntervalMs() noexcept {
  return NativeMediaCurrentYoutubeContentDurationMs();
}

UINT NativeMediaTverContentIntervalMs() noexcept {
  return NativeMediaCurrentTverContentDurationMs();
}

UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  // Preserve the established fixed 60-minute power-saving cadence.
  if (gNativeMediaPowerSaving) return kNativeMediaYoutubeContentPhaseMs;
  return tver ? NativeMediaTverContentIntervalMs() :
      NativeMediaYoutubeContentIntervalMs();
}

constexpr const wchar_t* kNativeMediaPlayAllScript = kNativeMediaYoutubeReliablePlayAllScript;
constexpr const wchar_t* kNativeMediaYoutubeWatchdogScript = kNativeMediaYoutubeControlRecoveryScript;
constexpr wchar_t kNativeMediaTverWatchdogScript[] =
    L"null/*homepanel-tver-watchdog-routing-key*/";

bool NativeMediaWatchdogExecutionTimedOut(
    HWND hostWindow, UINT_PTR timerId) noexcept;
void NativeMediaForgetWatchdogExecution(HWND hostWindow) noexcept;
LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

#define kNativeMediaYoutubeUrl kNativeMediaYoutubeContentUrl
#define kNativeMediaYoutubeContentPhaseMs NativeMediaYoutubeContentIntervalMs()
#define kNativeMediaTverContentDurationMs NativeMediaTverContentIntervalMs()
#define kNativeMediaPhaseMs NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
#include "media_host.inc"
#undef kNativeMediaTverForceFullscreenAdSafeScript
#undef kNativeMediaPhaseMs
#undef kNativeMediaTverContentDurationMs
#undef kNativeMediaYoutubeContentPhaseMs
#undef kNativeMediaYoutubeUrl
#include "media_host_window.inc"

}  // namespace
