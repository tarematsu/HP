#include "web_renderer.h"
#include "winhttp_helpers.h"
#include <cmath>

namespace hp {
namespace {
constexpr int64_t kAirGraphWindowMs = 24LL * 60 * 60 * 1000;
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

void Renderer::RebuildNativeAirGraph(int64_t nowMs) {
  AirGraphProjection next;
  next.cutoff = nowMs - kAirGraphWindowMs;
  for (const auto& sample : nativeAirHistory_) {
    if (sample.timestamp < next.cutoff) continue;
    if (next.samples.empty()) {
      next.co2Min = next.co2Max = sample.co2;
      next.temperatureMin = next.temperatureMax = sample.temperature;
      next.humidityMin = next.humidityMax = sample.humidity;
    } else {
      next.co2Min = std::min(next.co2Min, static_cast<double>(sample.co2));
      next.co2Max = std::max(next.co2Max, static_cast<double>(sample.co2));
      next.temperatureMin = std::min(next.temperatureMin, sample.temperature);
      next.temperatureMax = std::max(next.temperatureMax, sample.temperature);
      next.humidityMin = std::min(next.humidityMin, sample.humidity);
      next.humidityMax = std::max(next.humidityMax, sample.humidity);
    }
    next.samples.push_back(sample);
  }
  nativeAirGraph_ = std::move(next);
}

void Renderer::UpdateSensors(const SensorSnapshot& sensors) {
  // SwitchBot publishes through the same sensor-update path at startup and on
  // WM_HP_SWITCHBOT_UPDATED. Load its independently versioned cache here so the
  // one-second clock timer never needs to probe the filesystem for SwitchBot.
  LoadSwitchBot(dataDir_ / L"switchbot.json");

  if (nativeSensors_ == sensors) return;
  const bool repaintAirStats = AirStatsNeedRepaint(nativeSensors_, sensors);
  nativeSensors_ = sensors;
  if (!repaintAirStats || !nativeDashboardVisible_ || !EnsureNativeStaticWindows()) return;
  InvalidatePanelSection(nativeSideWindow_, PanelSection::AirStats);
}

void Renderer::UpdateAirHistory(const std::vector<AirHistorySample>& history) {
  if (nativeAirHistory_ == history) return;
  nativeAirHistory_ = history;
  if (!nativeDashboardVisible_) {
    nativeAirGraph_ = {};
    return;
  }

  const int64_t nowMs = UnixMillis();
  RebuildNativeAirGraph(nowMs);
  if (!EnsureNativeStaticWindows()) return;
  InvalidatePanelSection(nativeSideWindow_, PanelSection::AirGraph);
}

void Renderer::UpdateNativeStaticPanels(const RenderState& state) {
  // Stationhead status still participates in native playback resolution, but no
  // active card renders its retired play-history presentation.
  if (nativeStationhead_ != state.stationhead) {
    nativeStationhead_ = state.stationhead;
  }
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
