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
constexpr UINT kNativeMediaYoutubePhaseOverrideMs = 30U * 60U * 1000U;
constexpr UINT kNativeMediaTverPhaseOverrideMs = 90U * 60U * 1000U;
constexpr wchar_t kNativeMediaSakuraMeetsSeriesUrl[] =
    L"https://tver.jp/series/srx97ftk3w";
constexpr wchar_t kNativeMediaDeathGameSeriesUrl[] =
    L"https://tver.jp/series/srkzm5wbvp";
constexpr UINT kNativeMediaTverWakeIntervalMs = 350U;
constexpr UINT kNativeMediaTverWakeAttempts = 10U;
HWND gNativeMediaTverWakeWindow = nullptr;
UINT gNativeMediaTverWakeCount = 0;
UINT gNativeMediaTverSteadyIntervalMs = 2000U;
bool gNativeMediaTverUseDeathGame = false;
std::wstring gNativeMediaPhaseOverlayText;

UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  return tver ? kNativeMediaTverPhaseOverrideMs
              : kNativeMediaYoutubePhaseOverrideMs;
}

std::wstring NativeMediaLocalHourMinute(const FILETIME& utcFileTime) noexcept {
  SYSTEMTIME utc{};
  SYSTEMTIME local{};
  if (!FileTimeToSystemTime(&utcFileTime, &utc) ||
      !SystemTimeToTzSpecificLocalTime(nullptr, &utc, &local)) {
    return L"--:--";
  }
  std::wstring value = L"00:00";
  value[0] = static_cast<wchar_t>(L'0' + local.wHour / 10);
  value[1] = static_cast<wchar_t>(L'0' + local.wHour % 10);
  value[3] = static_cast<wchar_t>(L'0' + local.wMinute / 10);
  value[4] = static_cast<wchar_t>(L'0' + local.wMinute % 10);
  return value;
}

void CaptureNativeMediaPhaseOverlay(bool tver) noexcept {
  FILETIME startUtc{};
  GetSystemTimeAsFileTime(&startUtc);
  ULARGE_INTEGER endTicks{};
  endTicks.LowPart = startUtc.dwLowDateTime;
  endTicks.HighPart = startUtc.dwHighDateTime;
  endTicks.QuadPart +=
      static_cast<ULONGLONG>(NativeMediaPhaseIntervalMs(tver)) * 10000ULL;
  FILETIME endUtc{};
  endUtc.dwLowDateTime = endTicks.LowPart;
  endUtc.dwHighDateTime = endTicks.HighPart;
  gNativeMediaPhaseOverlayText = tver ? L"TVer " : L"YouTube ";
  gNativeMediaPhaseOverlayText += NativeMediaLocalHourMinute(startUtc);
  gNativeMediaPhaseOverlayText += L"–";
  gNativeMediaPhaseOverlayText += NativeMediaLocalHourMinute(endUtc);
}

std::wstring RewriteNativeMediaExecuteScript(const wchar_t* script) {
  if (!script) return {};
  std::wstring value(script);
  if (gNativeMediaPhaseOverlayText.empty() ||
      value.find(L"__homePanelMediaPhaseTime") == std::wstring::npos) {
    return value;
  }
  constexpr std::wstring_view marker = L"  const text = '";
  const size_t begin = value.find(marker);
  if (begin == std::wstring::npos) return value;
  const size_t textBegin = begin + marker.size();
  const size_t end = value.find(L"';", textBegin);
  if (end == std::wstring::npos) return value;
  value.replace(textBegin, end - textBegin, gNativeMediaPhaseOverlayText);
  return value;
}

const wchar_t* ResolveNativeMediaNavigateUrl(const wchar_t* url) noexcept {
  if (!url) return url;
  if (wcscmp(url, kNativeMediaSakuraMeetsSeriesUrl) != 0 &&
      wcscmp(url, kNativeMediaDeathGameSeriesUrl) != 0) {
    return url;
  }
  return gNativeMediaTverUseDeathGame ? kNativeMediaDeathGameSeriesUrl
                                      : kNativeMediaSakuraMeetsSeriesUrl;
}

void AdvanceNativeMediaTverSeries() noexcept {
  gNativeMediaTverUseDeathGame = !gNativeMediaTverUseDeathGame;
}

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

// The media panel runs YouTube for 30 minutes and TVer for 90 minutes. Spotify
// follows the same phase boundary. TVer keeps the existing cleanup/recreate flow,
// but each completed episode advances Sakura Meets <-> Death (Youth) Game.
// TVer additionally gets a short burst of trusted native mouse movement after
// navigation so its player controls become visible before the fullscreen probe.
#define SetTimer(hwnd, timerId, interval, callback)                              \
  (((timerId) == kNativeMediaPhaseTimer                                         \
        ? (CaptureNativeMediaPhaseOverlay(phase_ == Phase::Tver),              \
           SetSpotifyMediaPhase(phase_ == Phase::Tver), 0)                     \
        : 0),                                                                   \
   ((timerId) == kNativeMediaTverWatchdogTimer                                  \
        ? ArmNativeMediaTverWakeTimer((hwnd), (timerId), (interval))           \
        : ::SetTimer(                                                           \
              (hwnd), (timerId),                                                \
              ((timerId) == kNativeMediaPhaseTimer                             \
                   ? NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)         \
                   : (interval)),                                               \
              (callback))))
#define Navigate(url) Navigate(ResolveNativeMediaNavigateUrl((url)))
#define ClearBrowsingData(dataKinds, handler)                                   \
  ClearBrowsingData((AdvanceNativeMediaTverSeries(), (dataKinds)), (handler))
#define ExecuteScript(script, callback)                                         \
  ExecuteScript(RewriteNativeMediaExecuteScript((script)).c_str(), (callback))
#include "renderer_panels/media_section.inc"
#undef ExecuteScript
#undef ClearBrowsingData
#undef Navigate
#undef SetTimer
#include "renderer_panels/data_sections.inc"