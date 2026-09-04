// Kept as one translation unit so cached GDI primitives remain shared.
// Fragment boundaries follow complete responsibilities and never split functions.
#if 0  // Stationhead renderer helpers are intentionally disabled.
#include "stationhead_native_stats.h"
#include "stationhead_play_summary.h"
#endif
#include "shared_webview_environment.h"
#include "spotify_webviews.h"
#include "version.h"
#include "winhttp_helpers.h"
#include "renderer_panels/primitives.inc"
#include "renderer_panels/layout_overrides.inc"
#include "renderer_panels/waste_calendar_section.inc"

#define SplitSidebarSections SplitRearrangedSidebarSections
#define SplitMainSections SplitRearrangedMainSections
#define ClockTimeRectFromCard RearrangedClockTimeRectFromCard
#define DrawClockSection HP_DRAW_CLOCK_WITH_STATUS
#define DrawControlsSection DrawAirSection
#include "renderer_panels/windows.inc"
#undef DrawControlsSection
#undef DrawClockSection
#undef ClockTimeRectFromCard
#undef SplitMainSections
#undef SplitSidebarSections

#include "renderer_panels/environment_sections.inc"

namespace {
constexpr UINT kNativeMediaTverWakeIntervalMs = 350U;
constexpr UINT kNativeMediaTverWakeAttempts = 10U;
HWND gNativeMediaTverWakeWindow = nullptr;
UINT gNativeMediaTverWakeCount = 0;
UINT gNativeMediaTverSteadyIntervalMs = 2000U;

LONG NativeMediaPointerAbsolute(int value, int origin, int span) noexcept {
  if (span <= 1) return 0;
  long long scaled =
      (static_cast<long long>(value - origin) * 65535LL) / (span - 1);
  scaled = std::max(0LL, std::min(65535LL, scaled));
  return static_cast<LONG>(scaled);
}

void WakeNativeMediaTverControls(HWND hwnd) noexcept {
  if (!hwnd || !IsWindow(hwnd)) return;
  RECT client{};
  if (!GetClientRect(hwnd, &client)) return;
  const LONG width = client.right - client.left;
  const LONG height = client.bottom - client.top;
  if (width <= 0 || height <= 0) return;

  const UINT attempt = gNativeMediaTverWakeCount++;
  const LONG yPercent = 35L + static_cast<LONG>(attempt % 3U) * 10L;
  POINT target{
      client.left + width / 2,
      client.top + static_cast<LONG>((static_cast<long long>(height) * yPercent) / 100LL)};
  if (!ClientToScreen(hwnd, &target)) return;

  const int virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (virtualWidth <= 1 || virtualHeight <= 1) return;

  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dx = NativeMediaPointerAbsolute(target.x, virtualLeft, virtualWidth);
  input.mi.dy = NativeMediaPointerAbsolute(target.y, virtualTop, virtualHeight);
  input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE |
                     MOUSEEVENTF_VIRTUALDESK;
  SendInput(1, &input, sizeof(INPUT));
}

void CALLBACK NativeMediaTverWakeTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) noexcept {
  if (hwnd && IsWindow(hwnd) && gNativeMediaTverWakeWindow == hwnd &&
      gNativeMediaTverWakeCount < kNativeMediaTverWakeAttempts) {
    WakeNativeMediaTverControls(hwnd);
  }
  if (hwnd && IsWindow(hwnd)) {
    PostMessageW(hwnd, WM_TIMER, timerId, 0);
    if (gNativeMediaTverWakeCount >= kNativeMediaTverWakeAttempts) {
      ::SetTimer(hwnd, timerId, gNativeMediaTverSteadyIntervalMs, nullptr);
    }
  }
}

UINT_PTR ArmNativeMediaTverWakeTimer(
    HWND hwnd, UINT_PTR timerId, UINT steadyIntervalMs) noexcept {
  gNativeMediaTverWakeWindow = hwnd;
  gNativeMediaTverWakeCount = 0;
  gNativeMediaTverSteadyIntervalMs = steadyIntervalMs;
  return ::SetTimer(hwnd, timerId, kNativeMediaTverWakeIntervalMs,
                    NativeMediaTverWakeTimerProc);
}
}  // namespace

// The media panel is the single one-hour clock. Whenever it arms its phase
// timer, apply that exact phase to Spotify; all other media timers are untouched.
// TVer additionally gets a short burst of trusted native mouse movement after
// navigation so its player controls become visible before the fullscreen probe.
#define SetTimer(hwnd, timerId, interval, callback)                              \
  (((timerId) == kNativeMediaPhaseTimer                                         \
        ? (SetSpotifyMediaPhase(phase_ == Phase::Tver), 0)                     \
        : 0),                                                                   \
   ((timerId) == kNativeMediaTverWatchdogTimer                                  \
        ? ArmNativeMediaTverWakeTimer((hwnd), (timerId), (interval))           \
        : ::SetTimer((hwnd), (timerId), (interval), (callback))))
#include "renderer_panels/media_section.inc"
#undef SetTimer
#include "renderer_panels/data_sections.inc"