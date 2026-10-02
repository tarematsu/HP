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
constexpr UINT kNativeMediaXPhaseMs = 2U * 60U * 1000U;
constexpr UINT kNativeMediaStartupXPhaseMs = 2U * 60U * 1000U;
constexpr int kNativeMediaXQuietStartSecond = 1 * 60 * 60;
constexpr int kNativeMediaXQuietEndSecond = 6 * 60 * 60;
// Retained as the neutral/default duration for power saving and legacy contracts.
// Every normal YouTube phase redraws its content duration in the 45-75 minute range.
constexpr UINT kNativeMediaYoutubeContentPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaYoutubeMinContentDurationMinutes = 45U;
constexpr UINT kNativeMediaYoutubeMaxContentDurationMinutes = 75U;
// Retained as the neutral/default duration for startup state and legacy contracts.
// Every actual TVer phase redraws its content duration in the 45-75 minute range.
constexpr UINT kNativeMediaTverContentDurationMs = 58U * 60U * 1000U;
constexpr UINT kNativeMediaTverMinContentDurationMinutes = 45U;
constexpr UINT kNativeMediaTverMaxContentDurationMinutes = 75U;
constexpr UINT kNativeMediaYoutubePhaseMs =
    kNativeMediaYoutubeContentPhaseMs + kNativeMediaXPhaseMs;
constexpr UINT kNativeMediaTverPhaseMs =
    kNativeMediaTverContentDurationMs + kNativeMediaXPhaseMs;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 30U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;
constexpr ULONGLONG kNativeMediaWatchdogExecutionTimeoutMs = 5ULL * 1000ULL;

constexpr bool NativeMediaXCanStartAtSecondOfDay(int secondOfDay) noexcept {
  if (secondOfDay >= kNativeMediaXQuietStartSecond &&
      secondOfDay < kNativeMediaXQuietEndSecond) {
    return false;
  }
  if (secondOfDay < kNativeMediaXQuietStartSecond) {
    const int xPhaseSeconds = static_cast<int>(kNativeMediaXPhaseMs / 1000U);
    return secondOfDay + xPhaseSeconds <= kNativeMediaXQuietStartSecond;
  }
  return true;
}

static_assert(NativeMediaXCanStartAtSecondOfDay(0 * 60 * 60 + 58 * 60));
static_assert(!NativeMediaXCanStartAtSecondOfDay(0 * 60 * 60 + 58 * 60 + 1));
static_assert(!NativeMediaXCanStartAtSecondOfDay(1 * 60 * 60));
static_assert(!NativeMediaXCanStartAtSecondOfDay(5 * 60 * 60 + 59 * 60 + 59));
static_assert(NativeMediaXCanStartAtSecondOfDay(6 * 60 * 60));

bool NativeMediaXRuntimeAllowed() noexcept {
  SYSTEMTIME local{};
  GetLocalTime(&local);
  const int secondOfDay = static_cast<int>(local.wHour) * 60 * 60 +
      static_cast<int>(local.wMinute) * 60 + static_cast<int>(local.wSecond);
  return NativeMediaXCanStartAtSecondOfDay(secondOfDay);
}

struct NativeMediaXCyclePlan {
  bool firstSlot = false;
  bool secondSlot = false;
  UINT youtubeContentDurationMs = kNativeMediaYoutubeContentPhaseMs;
  UINT tverContentDurationMs = kNativeMediaTverContentDurationMs;
};

ULONGLONG NativeMediaXRandomWord() noexcept {
  static ULONGLONG state = 0;
  if (state == 0) {
    state = std::max<ULONGLONG>(1, GetTickCount64()) ^ 0x9E3779B97F4A7C15ULL;
  }
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return state;
}

UINT NativeMediaXRandomBelow(UINT exclusiveUpperBound) noexcept {
  if (exclusiveUpperBound <= 1) return 0;
  return static_cast<UINT>(NativeMediaXRandomWord() % exclusiveUpperBound);
}

NativeMediaXCyclePlan NativeMediaDrawXCyclePlan() noexcept {
  NativeMediaXCyclePlan plan{};
  const UINT count = 1U + NativeMediaXRandomBelow(2);  // 1 or 2, equally likely.
  if (count == 2) {
    plan.firstSlot = true;
    plan.secondSlot = true;
  } else {
    if (NativeMediaXRandomBelow(2) == 0) {
      plan.firstSlot = true;
    } else {
      plan.secondSlot = true;
    }
  }
  const UINT youtubeMinuteSpan =
      kNativeMediaYoutubeMaxContentDurationMinutes -
      kNativeMediaYoutubeMinContentDurationMinutes + 1U;
  const UINT youtubeMinutes =
      kNativeMediaYoutubeMinContentDurationMinutes +
      NativeMediaXRandomBelow(youtubeMinuteSpan);
  plan.youtubeContentDurationMs = youtubeMinutes * 60U * 1000U;

  const UINT tverMinuteSpan =
      kNativeMediaTverMaxContentDurationMinutes -
      kNativeMediaTverMinContentDurationMinutes + 1U;
  const UINT tverMinutes =
      kNativeMediaTverMinContentDurationMinutes +
      NativeMediaXRandomBelow(tverMinuteSpan);
  plan.tverContentDurationMs = tverMinutes * 60U * 1000U;
  return plan;
}

NativeMediaXCyclePlan& NativeMediaCurrentXCyclePlan() noexcept {
  static NativeMediaXCyclePlan plan{};
  return plan;
}

bool& NativeMediaXCyclePlanInitialized() noexcept {
  static bool initialized = false;
  return initialized;
}

bool& NativeMediaXCycleLastPhaseTver() noexcept {
  static bool tver = false;
  return tver;
}

void NativeMediaObserveXCyclePhase(bool tver) noexcept {
  auto& initialized = NativeMediaXCyclePlanInitialized();
  auto& lastTver = NativeMediaXCycleLastPhaseTver();
  if (!initialized) {
    NativeMediaCurrentXCyclePlan() = NativeMediaDrawXCyclePlan();
    initialized = true;
    lastTver = tver;
    return;
  }
  if (tver == lastTver) return;
  // Entering TVer means the current cycle's second X slot has finished. Draw
  // exactly once for the next cycle: both media durations and the first X slot
  // are followed by YouTube and the cycle's second X slot.
  if (tver) NativeMediaCurrentXCyclePlan() = NativeMediaDrawXCyclePlan();
  lastTver = tver;
}

bool NativeMediaXSlotEnabled(bool firstSlot) noexcept {
  const auto& plan = NativeMediaCurrentXCyclePlan();
  return firstSlot ? plan.firstSlot : plan.secondSlot;
}

UINT NativeMediaCurrentYoutubeContentDurationMs() noexcept {
  return NativeMediaCurrentXCyclePlan().youtubeContentDurationMs;
}

UINT NativeMediaCurrentTverContentDurationMs() noexcept {
  return NativeMediaCurrentXCyclePlan().tverContentDurationMs;
}

ULONGLONG& NativeMediaStartupXDeadlineTick() noexcept {
  static ULONGLONG deadline = 0;
  return deadline;
}

bool& NativeMediaStartupYoutubePhaseActive() noexcept {
  static bool active = false;
  return active;
}

UINT NativeMediaYoutubeContentIntervalMs() noexcept {
  NativeMediaObserveXCyclePhase(false);
  const UINT startupPrefix = NativeMediaStartupYoutubePhaseActive()
      ? kNativeMediaStartupXPhaseMs : 0U;
  const UINT youtubeContentDurationMs = NativeMediaCurrentYoutubeContentDurationMs();
  if (NativeMediaXSlotEnabled(false)) {
    return startupPrefix + youtubeContentDurationMs;
  }
  // No X navigation is scheduled for an unselected slot. Put the X timer just
  // after the shorter phase boundary so the phase switches first.
  return startupPrefix + youtubeContentDurationMs + 1000U;
}

UINT NativeMediaTverContentIntervalMs() noexcept {
  NativeMediaObserveXCyclePhase(true);
  const UINT tverContentDurationMs = NativeMediaCurrentTverContentDurationMs();
  if (NativeMediaXSlotEnabled(true)) return tverContentDurationMs;
  // An unselected first X slot is skipped entirely instead of extending TVer.
  return tverContentDurationMs + 1000U;
}

UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  NativeMediaObserveXCyclePhase(tver);
  if (gNativeMediaPowerSaving) {
    // Power-saving mode intentionally has no X slot and keeps the established
    // fixed 60-minute cadence. Consume the one-shot startup slot so disabling
    // power saving later cannot open a delayed X page.
    if (NativeMediaStartupXDeadlineTick() == 0) {
      NativeMediaStartupXDeadlineTick() = 1;
    }
    NativeMediaStartupYoutubePhaseActive() = false;
    return kNativeMediaYoutubeContentPhaseMs;
  }
  if (tver) {
    NativeMediaStartupYoutubePhaseActive() = false;
    const UINT tverContentDurationMs = NativeMediaCurrentTverContentDurationMs();
    return tverContentDurationMs +
        (NativeMediaXSlotEnabled(true) ? kNativeMediaXPhaseMs : 0U);
  }

  auto& deadline = NativeMediaStartupXDeadlineTick();
  if (deadline == 0) {
    const ULONGLONG now = std::max<ULONGLONG>(1, GetTickCount64());
    const bool startupXEnabled = NativeMediaXSlotEnabled(true);
    deadline = startupXEnabled ? now + kNativeMediaStartupXPhaseMs : 1;
    NativeMediaStartupYoutubePhaseActive() = startupXEnabled;
  }
  const UINT startupPrefix = NativeMediaStartupYoutubePhaseActive()
      ? kNativeMediaStartupXPhaseMs : 0U;
  const UINT youtubeContentDurationMs = NativeMediaCurrentYoutubeContentDurationMs();
  const UINT tailX = NativeMediaXSlotEnabled(false)
      ? kNativeMediaXPhaseMs : 0U;
  return startupPrefix + youtubeContentDurationMs + tailX;
}

const wchar_t* NativeMediaYoutubeNavigationUrl() noexcept {
  NativeMediaObserveXCyclePhase(false);
  if (gNativeMediaPowerSaving || !NativeMediaXSlotEnabled(true) ||
      !NativeMediaXRuntimeAllowed()) {
    return kNativeMediaYoutubeContentUrl;
  }
  const ULONGLONG deadline = NativeMediaStartupXDeadlineTick();
  const ULONGLONG now = std::max<ULONGLONG>(1, GetTickCount64());
  if (deadline > now) return kNativeMediaStartupXUrl;
  return kNativeMediaYoutubeContentUrl;
}

bool NativeMediaHostSuppressX(
    bool tver, bool phaseStarted, ULONGLONG phaseStartedAt,
    bool xPhaseActive) noexcept {
  if (gNativeMediaPowerSaving) return true;
  if (xPhaseActive) return !NativeMediaXRuntimeAllowed();
  if (!phaseStarted) return false;
  const ULONGLONG now = GetTickCount64();
  const UINT xStartMs = tver
      ? NativeMediaTverContentIntervalMs()
      : NativeMediaYoutubeContentIntervalMs();
  return now - phaseStartedAt >= xStartMs && !NativeMediaXRuntimeAllowed();
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
#define kNativeMediaTverContentDurationMs NativeMediaTverContentIntervalMs()
#define kNativeMediaPhaseMs NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)
#define kNativeMediaTverForceFullscreenAdSafeScript \
  kNativeMediaTverForceFullscreenAnyMediaScript
// Keep the random draw stable regardless of the wall clock. Quiet hours only
// suppress X once its selected slot is actually due (or already active), while
// ordinary media timers remain armed so a slot that starts after 06:00 can run.
#define gNativeMediaPowerSaving NativeMediaHostSuppressX( \
    phase_ == Phase::Tver, phaseStarted_, phaseStartedAt_, xPhaseActive_)
#include "media_host.inc"
#undef gNativeMediaPowerSaving
#undef kNativeMediaTverForceFullscreenAdSafeScript
#undef kNativeMediaPhaseMs
#undef kNativeMediaTverContentDurationMs
#undef kNativeMediaYoutubeContentPhaseMs
#undef kNativeMediaYoutubeUrl
#include "media_host_window.inc"

}  // namespace
