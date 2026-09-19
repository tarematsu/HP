#include "web_renderer.h"
#include "winhttp_helpers.h"
#include <cmath>

namespace hp {
namespace {
constexpr int kAirStatsCo2InvalidateDeltaPpm = 5;
constexpr double kAirStatsTemperatureInvalidateDeltaC = 0.1;
constexpr double kAirStatsHumidityInvalidateDeltaPercent = 1.0;

bool AirStatsNeedRepaint(const SensorSnapshot& previous,
                         const SensorSnapshot& next) noexcept {
  if (previous.co2Connected != next.co2Connected) return true;
  if (!next.co2Connected) return false;
  return std::abs(next.co2 - previous.co2) >= kAirStatsCo2InvalidateDeltaPpm ||
      std::abs(next.temperatureCorrected - previous.temperatureCorrected) >=
          kAirStatsTemperatureInvalidateDeltaC ||
      std::abs(next.humidityCorrected - previous.humidityCorrected) >=
          kAirStatsHumidityInvalidateDeltaPercent;
}

std::wstring ClockDateText(const SYSTEMTIME& now) {
  static constexpr const wchar_t* kWeekdays[] = {
      L"日", L"月", L"火", L"水", L"木", L"金", L"土"};
  wchar_t text[64]{};
  swprintf_s(text, L"%04u年%u月%u日 (%s)", now.wYear, now.wMonth, now.wDay,
             kWeekdays[now.wDayOfWeek % 7]);
  return text;
}

std::wstring ClockTimeText(const SYSTEMTIME& now) {
  wchar_t text[16]{};
  swprintf_s(text, L"%02u:%02u:%02u", now.wHour, now.wMinute, now.wSecond);
  return text;
}
}  // namespace

void Renderer::UpdateSensors(const SensorSnapshot& sensors) {
  if (!AirStatsNeedRepaint(nativeSensors_, sensors)) return;
  nativeSensors_ = sensors;
  if (!nativeDashboardVisible_ || !EnsureNativeStaticWindows()) return;
  InvalidatePanelSection(nativeSideWindow_, PanelSection::AirStats);
}

void Renderer::UpdateAirHistory(const std::vector<AirHistorySample>& history) {
  if (nativeAirHistory_ == history) return;
  nativeAirHistory_ = history;
  if (!nativeDashboardVisible_ || !EnsureNativeStaticWindows()) return;
  InvalidatePanelSection(nativeSideWindow_, PanelSection::AirGraph);
}

void Renderer::TickNativePanels(int64_t, bool timerDriven) {
  if (!nativeDashboardVisible_ || (!timerDriven && nativePanelTimerActive_)) return;

  SYSTEMTIME localTime{};
  const bool previousClockReady = nativeClockReady_;
  const bool clockReady = NetworkClockJstNow(&localTime);
  const int clockDayKey = clockReady
      ? static_cast<int>(localTime.wYear) * 10'000 +
            static_cast<int>(localTime.wMonth) * 100 + static_cast<int>(localTime.wDay)
      : 0;
  const bool clockDayChanged = clockReady && clockDayKey != nativeClockDayKey_;
  const int64_t clockSecondKey = clockReady
      ? (((static_cast<int64_t>(clockDayKey) * 24 + localTime.wHour) * 60 +
          localTime.wMinute) * 60 + localTime.wSecond)
      : -1;
  const int64_t previousClockSecondKey = nativeClockSecondKey_;
  const bool clockSecondChanged = clockSecondKey != previousClockSecondKey;
  const bool clockMinuteChanged = previousClockSecondKey < 0 ||
      (clockReady && clockSecondKey / 60 != previousClockSecondKey / 60);
  const bool clockReadyChanged = clockReady != previousClockReady;

  if (clockReady) {
    nativeClockNow_ = localTime;
    if (clockDayChanged || clockReadyChanged || nativeClockDateText_.empty()) {
      nativeClockDateText_ = ClockDateText(localTime);
    }
    if (clockSecondChanged || clockReadyChanged) {
      nativeClockTimeText_ = ClockTimeText(localTime);
    }
  } else if (clockReadyChanged) {
    nativeClockDateText_ = L"時刻同期中";
    nativeClockTimeText_ = L"--:--:--";
  }
  nativeClockReady_ = clockReady;
  nativeClockDayKey_ = clockDayKey;
  nativeClockSecondKey_ = clockSecondKey;

  if (nativeSideWindow_ && IsWindow(nativeSideWindow_) &&
      IsWindowVisible(nativeSideWindow_) && (clockSecondChanged || clockReadyChanged)) {
    InvalidatePanelSection(
        nativeSideWindow_,
        clockDayChanged || clockMinuteChanged || clockReadyChanged
            ? PanelSection::Clock
            : PanelSection::ClockTime);
  }

  if (clockDayChanged && nativeMainWindow_ && IsWindow(nativeMainWindow_) &&
      IsWindowVisible(nativeMainWindow_)) {
    InvalidateRect(nativeMainWindow_, nullptr, FALSE);
  }
}

}  // namespace hp
